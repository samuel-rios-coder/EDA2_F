import EventCard from '../components/EventCard';
import FilterChips from '../components/FilterChips';
import HeroSection from '../components/HeroSection';
import { useHomeController } from '../../controllers/useHomeController';
import type { Genre } from '../../models/event.model';

function HomePage() {
  const { featured, genres, activeGenre, setActiveGenre, events, loading, preferredGenres, preferredEvents, artists } =
    useHomeController();

  if (loading) {
    return (
      <div className="page-stack">
        <section className="section-card">
          <p className="muted">Cargando conciertos...</p>
        </section>
      </div>
    );
  }

  return (
    <div className="page-stack">
      {featured && <HeroSection event={featured} />}

      {preferredGenres.length > 0 && (
        <section className="section-card">
          <div className="section-head">
            <h2 className="section-title">Segun tus preferencias</h2>
          </div>

          <div className="chip-row" style={{ marginBottom: 14 }}>
            {preferredGenres.map((genre: Genre) => (
              <span key={genre} className="chip active">
                {genre}
              </span>
            ))}
          </div>

          {preferredEvents.length === 0 ? (
            <p className="muted">
              Aun no tenemos eventos publicados para esas preferencias. Prueba marcando mas generos.
            </p>
          ) : (
            <div className="card-grid">
              {preferredEvents.map((event) => (
                <EventCard key={`pref-${event.id}`} event={event} />
              ))}
            </div>
          )}
        </section>
      )}

      {artists.length > 0 && (
        <section className="section-card">
          <div className="section-head">
            <h2 className="section-title">Artistas disponibles</h2>
            <span className="ghost-link">{artists.length} artistas</span>
          </div>

          <div className="card-grid">
            {artists.map((artist) => (
              <article key={artist.id} className="event-card">
                <div className="event-thumb" style={{ backgroundImage: `url(${artist.imageUrl ?? ''})` }} />
                <div className="event-body">
                  <h3 className="event-title">{artist.name}</h3>
                  <p className="muted">{artist.concertsCount} conciertos en cartelera</p>
                  <div className="chip-row">
                    {artist.genres.slice(0, 3).map((genre) => (
                      <span key={`${artist.id}-${genre}`} className="chip active">
                        {genre}
                      </span>
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="section-card">
        <div className="section-head">
          <h2 className="section-title">Eventos Populares</h2>
          <span className="ghost-link">Ver todos →</span>
        </div>

        <FilterChips genres={genres} active={activeGenre} onSelect={setActiveGenre} />

        {events.length === 0 ? (
          <p className="muted">No hay conciertos para este filtro.</p>
        ) : (
          <div className="card-grid">
            {events.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default HomePage;
