import React, { useCallback, useEffect, useRef, useState } from 'react';
import { assetUrl } from '../../lib/data.js';
import { CorkPin } from './CorkPin.jsx';

const HOVER_DELAY_MS = 1000;

export function IslandMap2D({
  mapConfig,
  pins,
  selectedPinId,
  onSelectPin,
  editable = false,
  activeColor = 'yellow',
  onActiveColorChange,
  onPinMove,
  onAddPin,
  layerVisibility,
  onLayerToggle,
  pinColors = [],
}) {
  const boardRef = useRef(null);
  const dragRef = useRef(null);
  const hoverTimerRef = useRef(0);
  const hoverPinRef = useRef(null);
  const [hoverTip, setHoverTip] = useState(null);
  const [addMode, setAddMode] = useState(false);

  const layers = mapConfig?.layers || {};
  const showBuildings = layerVisibility?.buildings !== false;
  const showPaths = layerVisibility?.paths !== false;
  const showPins = layerVisibility?.pins !== false;

  const clearHover = useCallback(() => {
    window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = 0;
    hoverPinRef.current = null;
    setHoverTip(null);
  }, []);

  useEffect(() => () => clearHover(), [clearHover]);

  function clientToNorm(clientX, clientY) {
    const board = boardRef.current;
    if (!board) return null;
    const rect = board.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
    };
  }

  function handleBoardClick(event) {
    if (event.target.closest('.cork-pin')) return;
    if (editable && addMode) {
      const norm = clientToNorm(event.clientX, event.clientY);
      if (!norm) return;
      onAddPin?.(norm.x, norm.y, activeColor);
      setAddMode(false);
      return;
    }
    if (!editable) {
      onSelectPin?.(null);
    }
  }

  function handlePinPointerDown(event, pinId) {
    if (!editable) return;
    event.preventDefault();
    clearHover();
    dragRef.current = { pinId, pointerId: event.pointerId };

    function onMove(moveEvent) {
      if (moveEvent.pointerId !== event.pointerId) return;
      const norm = clientToNorm(moveEvent.clientX, moveEvent.clientY);
      if (norm) onPinMove?.(pinId, norm.x, norm.y);
    }

    function onUp(upEvent) {
      if (upEvent.pointerId !== event.pointerId) return;
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  function scheduleHover(pin, clientX, clientY) {
    if (editable) return;
    hoverPinRef.current = pin.id;
    window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(() => {
      if (hoverPinRef.current !== pin.id) return;
      setHoverTip({ pin, x: clientX, y: clientY });
    }, HOVER_DELAY_MS);
  }

  function updateHoverPosition(clientX, clientY) {
    if (!hoverTip) return;
    setHoverTip((prev) => (prev ? { ...prev, x: clientX, y: clientY } : prev));
  }

  return (
    <div className="island-map2d-shell">
      {editable && (
        <div className="island-map2d-toolbar">
          <div className="island-map2d-colors" role="group" aria-label="Pin color">
            {pinColors.map((color) => (
              <button
                key={color.id}
                type="button"
                className={`island-map2d-color island-map2d-color--${color.id}${activeColor === color.id ? ' active' : ''}`}
                title={color.hint || color.label}
                onClick={() => onActiveColorChange?.(color.id)}
              >
                {color.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`button small ghost${addMode ? ' active' : ''}`}
            onClick={() => setAddMode((v) => !v)}
          >
            {addMode ? 'Click map to drop pin…' : 'Add pin'}
          </button>
          <div className="island-map2d-layers" role="group" aria-label="Map layers">
            <label className="island-map2d-layer-toggle">
              <input
                type="checkbox"
                checked={showBuildings}
                onChange={() => onLayerToggle?.('buildings', !showBuildings)}
              />
              Buildings
            </label>
            <label className="island-map2d-layer-toggle">
              <input
                type="checkbox"
                checked={showPaths}
                onChange={() => onLayerToggle?.('paths', !showPaths)}
              />
              Paths (show)
            </label>
            <label className="island-map2d-layer-toggle">
              <input
                type="checkbox"
                checked={showPins}
                onChange={() => onLayerToggle?.('pins', !showPins)}
              />
              Pins
            </label>
          </div>
        </div>
      )}

      {!editable && (
        <div className="island-map2d-layer-bar">
          <label className="island-map2d-layer-toggle">
            <input
              type="checkbox"
              checked={showBuildings}
              onChange={() => onLayerToggle?.('buildings', !showBuildings)}
            />
            Buildings
          </label>
          <label className="island-map2d-layer-toggle">
            <input
              type="checkbox"
              checked={showPaths}
              onChange={() => onLayerToggle?.('paths', !showPaths)}
            />
            Paths (show)
          </label>
          <label className="island-map2d-layer-toggle">
            <input
              type="checkbox"
              checked={showPins}
              onChange={() => onLayerToggle?.('pins', !showPins)}
            />
            Pins
          </label>
        </div>
      )}

      <div
        ref={boardRef}
        className={`island-map2d-board${editable ? ' island-map2d-board--editable' : ''}${addMode ? ' island-map2d-board--add-mode' : ''}`}
        onClick={handleBoardClick}
      >
        <div className="island-map2d-layers-stack">
          {layers.terrain && (
            <img className="island-map2d-layer island-map2d-layer--terrain" src={assetUrl(layers.terrain)} alt="" draggable={false} />
          )}
          {layers.buildings && showBuildings && (
            <img className="island-map2d-layer island-map2d-layer--buildings" src={assetUrl(layers.buildings)} alt="" draggable={false} />
          )}
          {layers.paths && showPaths && (
            <img className="island-map2d-layer island-map2d-layer--paths" src={assetUrl(layers.paths)} alt="" draggable={false} />
          )}
        </div>
        {showPins ? (
          <div className="island-map2d-pins">
            {pins.map((pin) => (
              <CorkPin
                key={pin.id}
                pin={pin}
                selected={selectedPinId === pin.id}
                editable={editable}
                onSelect={onSelectPin}
                onPointerDown={handlePinPointerDown}
                onHoverStart={(p, event) => scheduleHover(p, event.clientX, event.clientY)}
                onHoverMove={(event) => updateHoverPosition(event.clientX, event.clientY)}
                onHoverEnd={clearHover}
              />
            ))}
          </div>
        ) : null}
      </div>

      {hoverTip && !editable && (
        <div
          className="cork-pin-hover-tip"
          style={{ left: hoverTip.x + 20, top: hoverTip.y - 6 }}
          role="tooltip"
        >
          <strong>{hoverTip.pin.name}</strong>
          <span>{hoverTip.pin.summary}</span>
        </div>
      )}
    </div>
  );
}
