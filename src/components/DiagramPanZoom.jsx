import React, { useCallback, useEffect, useRef, useState } from 'react';

const MIN_SCALE = 0.2;
const MAX_SCALE = 4;

export function DiagramPanZoom({ children, className = '' }) {
  const surfaceRef = useRef(null);
  const contentRef = useRef(null);
  const dragRef = useRef(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });

  const clampScale = (scale) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

  const fitToView = useCallback(() => {
    const surface = surfaceRef.current;
    const content = contentRef.current;
    if (!surface || !content) return;
    const svg = content.querySelector('svg');
    if (!svg) {
      setTransform({ x: 0, y: 0, scale: 1 });
      return;
    }
    const pad = 24;
    const surfaceRect = surface.getBoundingClientRect();
    let box;
    try {
      box = svg.getBBox();
    } catch {
      box = { x: 0, y: 0, width: svg.clientWidth || 400, height: svg.clientHeight || 240 };
    }
    const width = Math.max(box.width, 1);
    const height = Math.max(box.height, 1);
    const scale = clampScale(Math.min(
      (surfaceRect.width - pad * 2) / width,
      (surfaceRect.height - pad * 2) / height,
      1.4,
    ));
    const x = (surfaceRect.width - width * scale) / 2 - box.x * scale;
    const y = (surfaceRect.height - height * scale) / 2 - box.y * scale;
    setTransform({ x, y, scale });
  }, []);

  const resetView = useCallback(() => {
    setTransform({ x: 0, y: 0, scale: 1 });
  }, []);

  const zoomBy = useCallback((factor) => {
    setTransform((current) => ({
      ...current,
      scale: clampScale(current.scale * factor),
    }));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(fitToView, 60);
    return () => window.clearTimeout(timer);
  }, [children, fitToView]);

  const onWheel = (event) => {
    event.preventDefault();
    const delta = event.deltaY < 0 ? 1.08 : 0.92;
    setTransform((current) => ({
      ...current,
      scale: clampScale(current.scale * delta),
    }));
  };

  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      baseX: transform.x,
      baseY: transform.y,
      pointerId: event.pointerId,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setTransform((current) => ({
      ...current,
      x: drag.baseX + (event.clientX - drag.startX),
      y: drag.baseY + (event.clientY - drag.startY),
    }));
  };

  const onPointerUp = (event) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  return (
    <div className={`diagram-panzoom ${className}`.trim()}>
      <div className="diagram-panzoom-toolbar">
        <button type="button" className="text-btn" onClick={() => zoomBy(1.15)} aria-label="Zoom in">+</button>
        <button type="button" className="text-btn" onClick={() => zoomBy(0.87)} aria-label="Zoom out">−</button>
        <button type="button" className="text-btn" onClick={fitToView}>Fit</button>
        <button type="button" className="text-btn" onClick={resetView}>100%</button>
        <span className="diagram-panzoom-hint">Drag to pan · scroll to zoom</span>
      </div>
      <div
        ref={surfaceRef}
        className="diagram-panzoom-surface"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          ref={contentRef}
          className="diagram-panzoom-content"
          style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
