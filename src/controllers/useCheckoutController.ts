import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { PaymentCard } from '../models/payment.model';
import { formatConcertDate, type Concert } from '../models/event.model';
import { authService } from '../services/auth.service';
import { eventService } from '../services/event.service';
import { paymentService } from '../services/payment.service';
import { reservationService } from '../services/reservation.service';
import { socketQueueService } from '../services/socketQueue.service';
import { apiFetch } from '../services/api.service';

const emptyCard: PaymentCard = {
  holderName: '',
  cardNumber: '',
  expiry: '',
  cvc: '',
};

const sanitizeHolderName = (value: string) =>
  value
    .replace(/[^A-Za-zÀ-ÖØ-öø-ÿ\s]/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^\s+/, '')
    .slice(0, 60);

const sanitizeCardNumber = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 16);
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
};

const sanitizeExpiry = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 4);
  if (digits.length === 0) return '';
  if (digits.length < 2) return digits;
  if (digits.length === 2) return `${digits}/`;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
};

const sanitizeCvc = (value: string) => value.replace(/\D/g, '').slice(0, 3);

type QueueState = 'idle' | 'granted';
type BaseSeatStatus = 'available' | 'reserved' | 'blocked';
type SeatStatus = BaseSeatStatus | 'selected';

interface BaseSeatCell {
  id: string;
  label: string;
  status: BaseSeatStatus;
}

interface SeatCell {
  id: string;
  label: string;
  status: SeatStatus;
}

interface RealSeat {
  seatLabel: string | null;
  row: string | null;
  status: string;
}

const clampQty = (value: number) => Math.min(Math.max(Math.floor(value), 1), 8);

export const useCheckoutController = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const eventId = searchParams.get('event');
  const requestedTier = searchParams.get('tier');
  const requestedQtyRaw = Number(searchParams.get('qty') || 1);
  const requestedQty = Number.isFinite(requestedQtyRaw) ? clampQty(requestedQtyRaw) : 1;

  const [event, setEvent] = useState<Concert | null>(null);

  useEffect(() => {
    if (!eventId) { setEvent(null); return; }
    eventService
      .getById(eventId)
      .then(setEvent)
      .catch(() => setEvent(null));
  }, [eventId]);

  const [selectedTierId, setSelectedTierId] = useState<string>(requestedTier ?? '');
  const [quantity, setQuantity] = useState(requestedQty);
  const [card, setCard] = useState<PaymentCard>(emptyCard);
  const [selectedSeats, setSelectedSeats] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [statusType, setStatusType] = useState<'error' | 'success' | 'info'>('info');
  const [queueState, setQueueState] = useState<QueueState>('idle');
  const [queuePosition, setQueuePosition] = useState(0);
  const [queueEtaSeconds, setQueueEtaSeconds] = useState(0);
  const [turnSecondsLeft, setTurnSecondsLeft] = useState(0);
  const [loading, setLoading] = useState(false);
  const completedPurchaseRef = useRef(false);

  useEffect(() => {
    if (!event) {
      setSelectedTierId('');
      setSelectedSeats([]);
      setQueueState('idle');
      return;
    }

    const hasRequestedTier =
      !!requestedTier && event.ticketTypes.some((t) => String(t.id) === requestedTier);

    setSelectedTierId(
      hasRequestedTier ? (requestedTier as string) : String(event.ticketTypes[0]?.id ?? '')
    );
    setQuantity(requestedQty);
  }, [event, requestedQty, requestedTier]);

  const selectedTier = useMemo(() => {
    if (!event) return null;
    return (
      event.ticketTypes.find((t) => String(t.id) === selectedTierId) ??
      event.ticketTypes[0] ??
      null
    );
  }, [event, selectedTierId]);

  const subtotal = selectedTier ? selectedTier.price * quantity : 0;
  const summary = paymentService.calculateSummary(subtotal);

  const [rawSeats, setRawSeats] = useState<RealSeat[]>([]);

  useEffect(() => {
    if (!selectedTierId) { setRawSeats([]); return; }
    apiFetch<RealSeat[]>(`/tickets/seats?ticketTypeId=${selectedTierId}`)
      .then(setRawSeats)
      .catch(() => setRawSeats([]));
  }, [selectedTierId]);

  const baseSeatMap = useMemo((): BaseSeatCell[][] => {
    if (rawSeats.length === 0) return [];
    const rowMap = new Map<string, BaseSeatCell[]>();
    for (const seat of rawSeats) {
      if (!seat.seatLabel) continue;
      const rowKey = seat.row ?? seat.seatLabel[0] ?? 'A';
      if (!rowMap.has(rowKey)) rowMap.set(rowKey, []);
      const uiStatus: BaseSeatStatus =
        seat.status === 'AVAILABLE' || seat.status === 'CANCELLED' ? 'available' : 'reserved';
      rowMap.get(rowKey)!.push({ id: seat.seatLabel, label: seat.seatLabel, status: uiStatus });
    }
    return Array.from(rowMap.values());
  }, [rawSeats]);

  const seatMap = useMemo(() => {
    return baseSeatMap.map((row) =>
      row.map((seat) => {
        if (seat.status !== 'available') return seat as SeatCell;
        if (selectedSeats.includes(seat.id)) return { ...seat, status: 'selected' as const };
        return seat as SeatCell;
      })
    );
  }, [baseSeatMap, selectedSeats]);

  useEffect(() => {
    setSelectedSeats([]);
  }, [event?.id, selectedTierId]);

  useEffect(() => {
    setSelectedSeats((prev) => prev.slice(0, quantity));
  }, [quantity]);

  useEffect(() => {
    if (!event || !selectedTierId) return;

    const activeTurn = socketQueueService.getActiveTurn();
    if (!activeTurn || activeTurn.expiresAt <= Date.now() || activeTurn.roomId !== String(event.id)) {
      socketQueueService.clearActiveTurn();
      setQueueState('idle');
      setQueuePosition(0);
      setQueueEtaSeconds(0);
      setTurnSecondsLeft(0);
      setStatusType('info');
      setStatus('Debes entrar primero a la sala de espera para obtener un turno de compra.');
      navigate(`/queue?event=${event.id}&tier=${selectedTierId}&qty=${quantity}`, { replace: true });
      return;
    }

    setQueueState('granted');
    setQueuePosition(0);
    setQueueEtaSeconds(0);
    setStatusType('success');
    setStatus('Turno activo. Completa la compra antes de que termine el tiempo.');

    const syncTurnRemaining = () => {
      const currentTurn = socketQueueService.getActiveTurn();
      const expiresAt = currentTurn?.expiresAt ?? activeTurn.expiresAt;
      const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setTurnSecondsLeft(remaining);
    };

    syncTurnRemaining();
    const intervalId = setInterval(syncTurnRemaining, 1000);

    const detachExpired = socketQueueService.onQueueExpired((payload) => {
      setQueueState('idle');
      setQueuePosition(0);
      setQueueEtaSeconds(0);
      setTurnSecondsLeft(0);
      setStatusType('error');
      setStatus(payload.message || 'Tu turno de compra termino y saliste de la cola.');
      navigate(`/queue?event=${event.id}&tier=${selectedTierId}&qty=${quantity}`, { replace: true });
    });

    const detachError = socketQueueService.onQueueError((payload) => {
      setStatusType('error');
      setStatus(payload.message || 'No fue posible entrar a la cola');
    });

    const detachCompleted = socketQueueService.onQueueCompleted(() => {
      setQueueState('idle');
      setQueuePosition(0);
      setQueueEtaSeconds(0);
      setTurnSecondsLeft(0);
    });

    return () => {
      clearInterval(intervalId);
      detachExpired();
      detachError();
      detachCompleted();
    };
  }, [event?.id, selectedTierId, quantity, navigate]);

  useEffect(() => {
    return () => {
      if (!completedPurchaseRef.current && socketQueueService.getActiveTurn()) {
        socketQueueService.leaveQueue();
      }
      socketQueueService.disconnect();
    };
  }, []);

  const updateCardField = (field: keyof PaymentCard, value: string) => {
    let sanitizedValue = value;
    if (field === 'holderName') sanitizedValue = sanitizeHolderName(value);
    if (field === 'cardNumber') sanitizedValue = sanitizeCardNumber(value);
    if (field === 'expiry') sanitizedValue = sanitizeExpiry(value);
    if (field === 'cvc') sanitizedValue = sanitizeCvc(value);
    setCard((prev) => ({ ...prev, [field]: sanitizedValue }));
  };

  const increaseQty = () => setQuantity((prev) => Math.min(prev + 1, 8));
  const decreaseQty = () => setQuantity((prev) => Math.max(prev - 1, 1));

  const toggleSeatSelection = (seat: SeatCell) => {
    if (queueState !== 'granted') {
      setStatusType('error');
      setStatus('Debes esperar tu turno en la cola para seleccionar asientos');
      return;
    }
    if (seat.status === 'blocked' || seat.status === 'reserved') return;
    setSelectedSeats((prev) => {
      if (prev.includes(seat.id)) return prev.filter((id) => id !== seat.id);
      if (prev.length >= quantity) {
        setStatusType('error');
        setStatus(`Solo puedes seleccionar ${quantity} asiento(s)`);
        return prev;
      }
      return [...prev, seat.id];
    });
  };

  const hasMissingCardFields = () =>
    [card.holderName, card.cardNumber, card.expiry, card.cvc].some((f) => !f.trim());

  const hasInvalidCardFormat = () => {
    const holderNameIsValid = /^[A-Za-zÀ-ÖØ-öø-ÿ]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ]+)*$/.test(
      card.holderName.trim()
    );
    const cardNumberIsValid = card.cardNumber.replace(/\D/g, '').length === 16;
    const expiryIsValid = /^(0[1-9]|1[0-2])\/\d{2}$/.test(card.expiry);
    const cvcIsValid = /^\d{3}$/.test(card.cvc);
    return !(holderNameIsValid && cardNumberIsValid && expiryIsValid && cvcIsValid);
  };

  const submitPayment = async () => {
    if (!event || !selectedTier) {
      setStatusType('error');
      setStatus('Selecciona un concierto antes de continuar con la compra');
      return;
    }

    const session = authService.getSession();
    if (!session) {
      setStatusType('error');
      setStatus('Debes iniciar sesion para confirmar la compra');
      return;
    }

    if (hasMissingCardFields()) {
      setStatusType('error');
      setStatus('Completa todos los campos de la tarjeta para continuar');
      return;
    }

    if (hasInvalidCardFormat()) {
      setStatusType('error');
      setStatus('Verifica los datos: nombre solo letras, tarjeta y CVC numericos, expiracion MM/AA');
      return;
    }

    if (queueState !== 'granted') {
      setStatusType('error');
      setStatus('Aun no tienes turno habilitado en la cola de compra');
      return;
    }

    if (turnSecondsLeft <= 0) {
      setStatusType('error');
      setStatus('Tu turno de compra ya expiro. Debes volver a entrar en la cola.');
      return;
    }

    if (selectedSeats.length !== quantity) {
      setStatusType('error');
      setStatus(`Debes seleccionar exactamente ${quantity} asiento(s) para continuar`);
      return;
    }

    try {
      setLoading(true);

      await apiFetch('/tickets/reserve', {
        method: 'POST',
        body: JSON.stringify({ ticketTypeId: Number(selectedTierId), quantity }),
      });

      await apiFetch('/orders', {
        method: 'POST',
        body: JSON.stringify({ items: [{ ticketTypeId: Number(selectedTierId), quantity }] }),
      });

      const result = await paymentService.processCardPayment(card, summary.total);
      const dateLabel = formatConcertDate(event.date);

      reservationService.addReservation(session.user.email, {
        eventName: event.tourName,
        eventDate: dateLabel.split(' - ')[0] ?? dateLabel,
        venue: event.venue.name,
        seats: selectedSeats,
        quantity,
        amountPaid: summary.total,
        status: 'CONFIRMED',
      });

      // Refresh seat map so any concurrent viewer sees updated statuses
      if (selectedTierId) {
        apiFetch<RealSeat[]>(`/tickets/seats?ticketTypeId=${selectedTierId}`)
          .then(setRawSeats)
          .catch(() => {});
      }

      completedPurchaseRef.current = true;
      const activeTurn = socketQueueService.getActiveTurn();
      socketQueueService.completeTurn({ roomId: activeTurn?.roomId });
      socketQueueService.clearActiveTurn();
      setQueueState('idle');
      setTurnSecondsLeft(0);

      setStatusType('success');
      setStatus(`Pago aprobado - Operacion ${result.operationId}`);
      navigate('/tickets', { state: { purchaseSuccess: 'Compra realizada correctamente' } });
    } catch (error) {
      setStatusType('error');
      setStatus(error instanceof Error ? error.message : 'No fue posible procesar el pago');
    } finally {
      setLoading(false);
    }
  };

  return {
    event,
    selectedTierId,
    setSelectedTierId,
    selectedTier,
    seatMap,
    selectedSeats,
    toggleSeatSelection,
    quantity,
    increaseQty,
    decreaseQty,
    card,
    updateCardField,
    queueState,
    queuePosition,
    queueEtaSeconds,
    turnSecondsLeft,
    summary,
    submitPayment,
    status,
    statusType,
    loading,
  };
};
