import React from 'react';
import { resolvePinTilt } from '../../lib/atlasPins.js';

export function CorkPin({
  pin,
  selected,
  onSelect,
  onPointerDown,
  editable,
  onHoverStart,
  onHoverMove,
  onHoverEnd,
}) {
  const tilt = resolvePinTilt(pin);

  return (
    <button
      type="button"
      className={`cork-pin cork-pin--${pin.color}${selected ? ' cork-pin--selected' : ''}${editable ? ' cork-pin--editable' : ''}`}
      style={{
        left: `${pin.x * 100}%`,
        top: `${pin.y * 100}%`,
        '--pin-tilt': `${tilt}deg`,
      }}
      aria-label={pin.name}
      title={editable ? pin.name : undefined}
      onClick={(event) => {
        event.stopPropagation();
        onSelect?.(pin.id);
      }}
      onPointerDown={(event) => {
        if (!editable) return;
        event.stopPropagation();
        onPointerDown?.(event, pin.id);
      }}
      onMouseEnter={(event) => onHoverStart?.(pin, event)}
      onMouseMove={(event) => onHoverMove?.(event)}
      onMouseLeave={() => onHoverEnd?.()}
    >
      <span className="cork-pin-shadow" aria-hidden="true" />
      <span className="cork-pin-figure" aria-hidden="true">
        <span className="cork-pin-head" />
        <span className="cork-pin-stem" />
      </span>
    </button>
  );
}
