import React, { useMemo } from 'react';
import { RichContentBody } from '../RichContentBody.jsx';
import { StatusPill } from '../StatusPill.jsx';
import { ShowReferencePreview } from './ShowReferencePreview.jsx';
import { routeHref } from '../../lib/data.js';
import { ATLAS_PIN_COLORS } from '../../lib/atlasPins.js';
import { recordHasRichContent } from '../../lib/richContent.js';

const pinTone = { blue: 'blue', yellow: 'yellow', red: 'red' };

export function PinDetailPanel({ pin, showReference, onOpenReference }) {
  const colorMeta = ATLAS_PIN_COLORS[pin?.color] || ATLAS_PIN_COLORS.yellow;
  const hasDossier = useMemo(
    () => pin && recordHasRichContent({ dossier: pin.dossier }),
    [pin],
  );

  return (
    <aside className={`atlas-pin-panel${pin ? '' : ' atlas-pin-panel--idle'}`}>
      {pin ? (
        <>
          <div className="atlas-pin-panel-head">
            <div>
              <p className="eyebrow">This spot</p>
              <h2>{pin.name}</h2>
              <div className="pill-row">
                <StatusPill status={pinTone[pin.color] || 'yellow'} label={colorMeta.label} />
                <span className="soft-label">{Math.round(pin.x * 100)}%, {Math.round(pin.y * 100)}% on map</span>
              </div>
            </div>
          </div>
          <ShowReferencePreview showReference={showReference} onOpen={onOpenReference} />
          <div className="atlas-pin-panel-body">
            {pin.summary && <p className="atlas-pin-summary">{pin.summary}</p>}
            {(pin.linkedResearch?.length > 0 || pin.linkedFeatures?.length > 0) && (
              <div className="atlas-pin-links">
                {pin.linkedResearch?.map((id) => (
                  <a key={id} className="button small ghost" href={routeHref('/research', { entry: id })}>{id}</a>
                ))}
                {pin.linkedFeatures?.map((id) => (
                  <a key={id} className="button small ghost" href={routeHref('/board')}>{id}</a>
                ))}
              </div>
            )}
            {hasDossier ? (
              <div className="atlas-pin-dossier feature-dossier-body">
                <RichContentBody record={{ dossier: pin.dossier }} title={pin.name} />
              </div>
            ) : (
              <p className="feature-dossier-empty">Nothing filed under this pin yet.</p>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="atlas-pin-panel-idle">
            <p className="eyebrow">This spot</p>
            <h2>Pick a pin</h2>
            <p className="atlas-pin-summary">
              Every colored marker is a place on the island — notes, screenshots, links.
              Tap open water to step back.
            </p>
          </div>
          <ShowReferencePreview showReference={showReference} onOpen={onOpenReference} />
        </>
      )}
    </aside>
  );
}
