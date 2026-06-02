import React, { useId, useState } from 'react';
import { DossierBlockView } from './blockViews.jsx';

export function DossierTabs({ block, onOpenGallery, variant = 'default' }) {
  const baseId = useId();
  const tabs = block.tabs || [];
  const [activeId, setActiveId] = useState(tabs[0]?.id || '');

  const active = tabs.find((tab) => tab.id === activeId) || tabs[0];
  const rootClass = variant === 'prominent'
    ? 'dossier-block dossier-block-tabs dossier-block-tabs--prominent'
    : 'dossier-block dossier-block-tabs';

  return (
    <div className={rootClass}>
      {block.caption && variant !== 'prominent' && (
        <p className="dossier-block-label">{block.caption}</p>
      )}
      <div className="dossier-tabs-bar" role="tablist" aria-label={block.caption || 'Sections'}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`${baseId}-${tab.id}`}
            aria-selected={active?.id === tab.id}
            aria-controls={`${baseId}-panel-${tab.id}`}
            className={active?.id === tab.id ? 'active' : ''}
            onClick={() => setActiveId(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {active && (
        <div
          className="dossier-tabs-panel"
          role="tabpanel"
          id={`${baseId}-panel-${active.id}`}
          aria-labelledby={`${baseId}-${active.id}`}
        >
          {block.caption && variant === 'prominent' && (
            <p className="dossier-tabs-panel-lede">{block.caption}</p>
          )}
          <div className="feature-dossier-blocks">
            {active.blocks.map((nested, index) => (
              <DossierBlockView
                key={`${active.id}-${index}`}
                block={nested}
                onOpenGallery={onOpenGallery}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
