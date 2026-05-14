import type { Artist, Concert, ConcertStatus, TicketType, Venue } from '../models/event.model';
import { apiFetch } from './api.service';

const FALLBACK_CONCERTS_URL = '/fallback/concerts.json';
const VALID_STATUSES: ConcertStatus[] = ['DRAFT', 'PUBLISHED', 'LIVE', 'SOLD_OUT', 'CANCELLED', 'COMPLETED'];
const FORCE_FALLBACK_HOSTS = new Set(['frontend-ed-2.vercel.app']);

let fallbackConcertsCache: Concert[] | null = null;

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord =>
  typeof value === 'object' && value !== null ? (value as UnknownRecord) : {};

const asId = (value: unknown): string => {
  const rec = asRecord(value);
  const raw = rec.id ?? rec._id ?? value;
  return raw == null ? '' : String(raw);
};

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

const asNullableString = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

const asNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((item) => String(item)).filter(Boolean)
    : [];

const normalizeStatus = (value: unknown): ConcertStatus => {
  const candidate = String(value || 'PUBLISHED') as ConcertStatus;
  return VALID_STATUSES.includes(candidate) ? candidate : 'PUBLISHED';
};

const normalizeArtist = (value: unknown): Artist => {
  const rec = asRecord(value);

  return {
    id: asId(value),
    name: asString(rec.name, 'Artista por confirmar'),
    bio: asNullableString(rec.bio),
    imageUrl: asNullableString(rec.imageUrl),
    genres: asStringArray(rec.genres),
  };
};

const normalizeVenue = (value: unknown): Venue => {
  const rec = asRecord(value);

  return {
    id: asId(value),
    name: asString(rec.name, 'Venue por confirmar'),
    address: asString(rec.address, ''),
    city: asString(rec.city, ''),
    country: asString(rec.country, 'Colombia'),
    imageUrl: asNullableString(rec.imageUrl),
  };
};

const normalizeTicketType = (value: unknown): TicketType => {
  const rec = asRecord(value);

  return {
    id: asId(value),
    concertId: asId(rec.concertId),
    name: asString(rec.name, 'General'),
    description: asNullableString(rec.description),
    price: asNumber(rec.price, 0),
    totalQuantity: asNumber(rec.totalQuantity, 0),
    availableQuantity: asNumber(rec.availableQuantity, 0),
    maxPerOrder: asNumber(rec.maxPerOrder, 8),
  };
};

const normalizeConcert = (value: unknown): Concert => {
  const rec = asRecord(value);
  const artistSource = rec.artist ?? rec.artistId;
  const venueSource = rec.venue ?? rec.venueId;
  const ticketTypeRaw = Array.isArray(rec.ticketTypes) ? rec.ticketTypes : [];

  return {
    id: asId(value),
    artistId: asId(artistSource),
    tourName: asString(rec.tourName, 'Concierto sin titulo'),
    description: asNullableString(rec.description),
    date: asString(rec.date, new Date().toISOString()),
    doorsOpenAt: asNullableString(rec.doorsOpenAt),
    imageUrl: asNullableString(rec.imageUrl),
    bannerUrl: asNullableString(rec.bannerUrl) ?? asNullableString(rec.imageUrl),
    status: normalizeStatus(rec.status),
    isFeatured: Boolean(rec.isFeatured),
    genres: asStringArray(rec.genres),
    viewerCount: asNumber(rec.viewerCount, 0),
    artist: normalizeArtist(artistSource),
    venue: normalizeVenue(venueSource),
    ticketTypes: ticketTypeRaw.map(normalizeTicketType),
  };
};

const normalizeConcertList = (value: unknown): Concert[] =>
  Array.isArray(value)
    ? value.map(normalizeConcert).filter((concert) => String(concert.id).length > 0)
    : [];

const isRecoverableFailure = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  return /failed to fetch|networkerror|cors|application failed to respond|bad gateway|gateway/i.test(error.message);
};

const shouldForceFallbackCatalog = (): boolean => {
  if (typeof window === 'undefined') return false;
  if (!import.meta.env.PROD) return false;
  return FORCE_FALLBACK_HOSTS.has(window.location.hostname);
};

const applyFilters = (
  concerts: Concert[],
  params?: { city?: string; genre?: string; status?: string }
): Concert[] => {
  if (!params) return concerts;

  return concerts.filter((concert) => {
    if (params.city && concert.venue.city !== params.city) return false;
    if (params.genre && !concert.genres.includes(params.genre)) return false;
    if (params.status && concert.status !== params.status) return false;
    return true;
  });
};

const loadFallbackConcerts = async (): Promise<Concert[]> => {
  if (fallbackConcertsCache) return fallbackConcertsCache;

  try {
    const response = await fetch(FALLBACK_CONCERTS_URL);
    if (!response.ok) return [];

    const raw = await response.json();
    const normalized = normalizeConcertList(raw);
    fallbackConcertsCache = normalized;
    return normalized;
  } catch {
    return [];
  }
};

const getAll = async (params?: { city?: string; genre?: string; status?: string }): Promise<Concert[]> => {
  if (shouldForceFallbackCatalog()) {
    const fallback = await loadFallbackConcerts();
    return applyFilters(fallback, params);
  }

  const query = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';

  try {
    const raw = await apiFetch<unknown[]>(`/concerts${query}`);
    const normalized = normalizeConcertList(raw);
    if (normalized.length > 0) return normalized;
  } catch (error) {
    if (!isRecoverableFailure(error)) throw error;
  }

  const fallback = await loadFallbackConcerts();
  return applyFilters(fallback, params);
};

const getFeatured = async (): Promise<Concert[]> => {
  const concerts = await getAll();
  const featured = concerts.filter((concert) => concert.isFeatured);
  return featured.length > 0 ? featured : concerts.slice(0, 6);
};

const getById = async (id: string | number): Promise<Concert> => {
  const normalizedId = String(id);

  if (shouldForceFallbackCatalog()) {
    const fallback = await loadFallbackConcerts();
    const found = fallback.find((concert) => String(concert.id) === normalizedId);

    if (!found) throw new Error('Concierto no encontrado');
    return found;
  }

  try {
    const raw = await apiFetch<unknown>(`/concerts/${encodeURIComponent(normalizedId)}`);
    return normalizeConcert(raw);
  } catch (error) {
    if (!isRecoverableFailure(error)) throw error;
  }

  const fallback = await loadFallbackConcerts();
  const found = fallback.find((concert) => String(concert.id) === normalizedId);

  if (!found) throw new Error('Concierto no encontrado');
  return found;
};

const search = async (q: string): Promise<Concert[]> => {
  const query = q.trim();

  if (shouldForceFallbackCatalog()) {
    const fallback = await loadFallbackConcerts();
    if (!query) return fallback;

    const lower = query.toLowerCase();
    return fallback.filter((concert) =>
      concert.tourName.toLowerCase().includes(lower) ||
      concert.artist.name.toLowerCase().includes(lower)
    );
  }

  try {
    const raw = await apiFetch<unknown[]>(`/concerts/search?q=${encodeURIComponent(query)}`);
    const normalized = normalizeConcertList(raw);
    if (normalized.length > 0) return normalized;
  } catch (error) {
    if (!isRecoverableFailure(error)) throw error;
  }

  const fallback = await loadFallbackConcerts();
  if (!query) return fallback;

  const lower = query.toLowerCase();
  return fallback.filter((concert) =>
    concert.tourName.toLowerCase().includes(lower) ||
    concert.artist.name.toLowerCase().includes(lower)
  );
};

const getRelated = async (id: string | number): Promise<Concert[]> => {
  const normalizedId = String(id);

  if (shouldForceFallbackCatalog()) {
    const fallback = await loadFallbackConcerts();
    const current = fallback.find((concert) => String(concert.id) === normalizedId);
    if (!current) return [];

    return fallback
      .filter((concert) => String(concert.id) !== normalizedId)
      .filter((concert) =>
        concert.artist.id === current.artist.id ||
        concert.venue.city === current.venue.city ||
        concert.genres.some((genre) => current.genres.includes(genre))
      )
      .slice(0, 6);
  }

  try {
    const raw = await apiFetch<unknown[]>(`/concerts/${encodeURIComponent(normalizedId)}/related`);
    const normalized = normalizeConcertList(raw);
    if (normalized.length > 0) return normalized;
  } catch (error) {
    if (!isRecoverableFailure(error)) throw error;
  }

  const fallback = await loadFallbackConcerts();
  const current = fallback.find((concert) => String(concert.id) === normalizedId);
  if (!current) return [];

  return fallback
    .filter((concert) => String(concert.id) !== normalizedId)
    .filter((concert) =>
      concert.artist.id === current.artist.id ||
      concert.venue.city === current.venue.city ||
      concert.genres.some((genre) => current.genres.includes(genre))
    )
    .slice(0, 6);
};

export const eventService = {
  getAll,
  getFeatured,
  getById,
  search,
  getRelated,
};
