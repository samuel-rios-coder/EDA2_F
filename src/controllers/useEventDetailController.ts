import { useEffect, useMemo, useState } from 'react';
import type { Concert } from '../models/event.model';
import { eventService } from '../services/event.service';

export const useEventDetailController = (id?: string) => {
  const [event, setEvent] = useState<Concert | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!id) { setEvent(null); return; }
    setLoading(true);
    eventService
      .getById(id)
      .then(setEvent)
      .catch(() => setEvent(null))
      .finally(() => setLoading(false));
  }, [id]);

  const [selectedTierId, setSelectedTierId] = useState<string>('');
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    if (event?.ticketTypes.length) {
      setSelectedTierId(String(event.ticketTypes[0].id));
      setQuantity(1);
    }
  }, [event]);

  const selectedTier = useMemo(
    () => event?.ticketTypes.find((t) => String(t.id) === selectedTierId),
    [event, selectedTierId]
  );

  const subtotal = selectedTier ? selectedTier.price * quantity : 0;

  const increaseQty = () => setQuantity((prev) => Math.min(prev + 1, 8));
  const decreaseQty = () => setQuantity((prev) => Math.max(prev - 1, 1));

  return {
    event,
    loading,
    selectedTier,
    selectedTierId,
    setSelectedTierId,
    quantity,
    increaseQty,
    decreaseQty,
    subtotal,
  };
};
