import { useEffect, useMemo, useState } from 'react';
import type { Concert, Genre } from '../models/event.model';
import { authService } from '../services/auth.service';
import { eventService } from '../services/event.service';
import { preferencesService } from '../services/preferences.service';

export type HomeGenre = 'All' | string;

interface ArtistSummary {
  id: string;
  name: string;
  imageUrl: string | null;
  genres: string[];
  concertsCount: number;
}

export const useHomeController = () => {
  const [activeGenre, setActiveGenre] = useState<HomeGenre>('All');
  const [concerts, setConcerts] = useState<Concert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    eventService
      .getAll()
      .then(setConcerts)
      .catch(() => setConcerts([]))
      .finally(() => setLoading(false));
  }, []);

  const genres = useMemo<HomeGenre[]>(() => {
    const uniqueGenres = Array.from(new Set(concerts.flatMap((concert) => concert.genres))).filter(Boolean);
    return ['All', ...uniqueGenres];
  }, [concerts]);

  useEffect(() => {
    if (activeGenre === 'All') return;
    if (genres.includes(activeGenre)) return;
    setActiveGenre('All');
  }, [activeGenre, genres]);

  const featured = useMemo(() => concerts.find((c) => c.isFeatured) ?? concerts[0] ?? null, [concerts]);

  const events = useMemo(
    () =>
      activeGenre === 'All'
        ? concerts
        : concerts.filter((c) => c.genres.includes(activeGenre)),
    [concerts, activeGenre]
  );

  const session = authService.getSession();
  const userEmail = session?.user.email ?? '';

  const preferredGenres = useMemo(() => {
    if (!userEmail) return [] as Genre[];
    return preferencesService.getPreferencesByUser(userEmail);
  }, [userEmail]);

  const preferredEvents = useMemo(() => {
    if (preferredGenres.length === 0) return [] as Concert[];
    return concerts.filter((c) => c.genres.some((g) => preferredGenres.includes(g as Genre)));
  }, [concerts, preferredGenres]);

  const artists = useMemo<ArtistSummary[]>(() => {
    const byArtist = new Map<string, ArtistSummary>();

    concerts.forEach((concert) => {
      const key = String(concert.artist?.id ?? concert.artist?.name ?? concert.id);
      const existing = byArtist.get(key);

      if (!existing) {
        byArtist.set(key, {
          id: key,
          name: concert.artist?.name ?? 'Artista por confirmar',
          imageUrl: concert.artist?.imageUrl ?? concert.imageUrl ?? null,
          genres: [...concert.genres],
          concertsCount: 1,
        });
        return;
      }

      existing.concertsCount += 1;
      existing.genres = Array.from(new Set([...existing.genres, ...concert.genres]));
      if (!existing.imageUrl && concert.imageUrl) {
        existing.imageUrl = concert.imageUrl;
      }
    });

    return Array.from(byArtist.values()).sort((a, b) => b.concertsCount - a.concertsCount);
  }, [concerts]);

  return {
    genres,
    activeGenre,
    setActiveGenre,
    events,
    featured,
    loading,
    preferredGenres,
    preferredEvents,
    artists,
  };
};
