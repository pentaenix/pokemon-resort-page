import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { assetUrl } from '../lib/data.js';
import { lockBodyScroll } from '../lib/scrollLock.js';

function BoxArtModal({ game, onClose }) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const unlockScroll = lockBodyScroll();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      unlockScroll();
    };
  }, [onClose]);

  if (!game) return null;

  return createPortal(
    <div className="boxart-modal-backdrop" onClick={onClose} role="presentation">
      <figure className="boxart-modal" role="dialog" aria-modal="true" aria-label={`${game.title} box art`}>
        <img src={assetUrl(game.boxArt)} alt={`${game.title} box art`} />
        <figcaption>
          <strong>{game.title}</strong>
          <span>{game.platform} · {game.releaseYear}</span>
        </figcaption>
      </figure>
    </div>,
    document.body,
  );
}

export function GameCard({ game, compact = false, onPreview }) {
  const [missing, setMissing] = useState(false);
  if (!game) return null;
  const hasArt = game.boxArt && !missing;
  const openPreview = () => {
    if (hasArt && onPreview) onPreview(game);
  };

  return (
    <article
      className={`game-card ${compact ? 'compact' : ''}${hasArt ? ' game-card--preview' : ''}`}
      onClick={openPreview}
      onKeyDown={(event) => {
        if (!hasArt || !onPreview) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onPreview(game);
        }
      }}
      role={hasArt ? 'button' : undefined}
      tabIndex={hasArt ? 0 : undefined}
      aria-label={hasArt ? `View ${game.title} box art` : undefined}
    >
      <div className={`game-card-art ${hasArt ? '' : 'title-card'}`}>
        {hasArt ? (
          <img src={assetUrl(game.boxArt)} alt="" loading="lazy" onError={() => setMissing(true)} />
        ) : (
          <div className="game-card-fallback" aria-label={game.title}>
            <span>{game.shortTitle || game.title}</span>
            <small>{game.platform}</small>
          </div>
        )}
      </div>
      <div className="game-card-copy">
        <strong>{game.shortTitle || game.title}</strong>
        <span>{game.platform} · {game.releaseYear}</span>
      </div>
    </article>
  );
}

export function GameCardGrid({ games = [], compact = false }) {
  const [preview, setPreview] = useState(null);
  return (
    <>
      <div className={`game-card-grid ${compact ? 'compact' : ''}`}>
        {games.map((game) => (
          <GameCard key={game.id} game={game} compact={compact} onPreview={setPreview} />
        ))}
      </div>
      {preview ? <BoxArtModal game={preview} onClose={() => setPreview(null)} /> : null}
    </>
  );
}
