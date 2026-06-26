import { useEffect, useState } from 'react';
import { assetUrl } from './data.js';

const prefetched = new Set();

export function atlasThumbPath(path = '') {
  const trimmed = String(path).trim();
  if (!trimmed || !/\.(jpe?g|png|webp)$/i.test(trimmed)) return null;
  return trimmed.replace(/\.(jpe?g|png|webp)$/i, '-thumb.webp');
}

export function prefetchAtlasImage(path) {
  if (!path) return;
  [atlasThumbPath(path), path].filter(Boolean).forEach((candidate) => {
    const url = assetUrl(candidate);
    if (prefetched.has(url)) return;
    prefetched.add(url);
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
  });
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(url);
    img.onerror = () => reject(new Error(`Unable to load ${url}`));
    img.src = url;
  });
}

export function useProgressiveImage(path) {
  const [state, setState] = useState({
    status: 'idle',
    src: null,
    isPreview: false,
  });

  useEffect(() => {
    if (!path) {
      setState({ status: 'idle', src: null, isPreview: false });
      return undefined;
    }

    let cancelled = false;
    setState({ status: 'loading', src: null, isPreview: false });

    const fullUrl = assetUrl(path);
    const thumb = atlasThumbPath(path);
    const thumbUrl = thumb ? assetUrl(thumb) : null;

    async function run() {
      try {
        if (thumbUrl && thumbUrl !== fullUrl) {
          try {
            const preview = await loadImage(thumbUrl);
            if (cancelled) return;
            setState({ status: 'loading', src: preview, isPreview: true });
          } catch {
            // Thumb missing or failed; continue to full image.
          }
        }

        const full = await loadImage(fullUrl);
        if (cancelled) return;
        setState({ status: 'ready', src: full, isPreview: false });
      } catch {
        if (cancelled) return;
        setState((current) => (
          current.src
            ? { status: 'ready', src: current.src, isPreview: current.isPreview }
            : { status: 'error', src: null, isPreview: false }
        ));
      }
    }

    run();
    return () => { cancelled = true; };
  }, [path]);

  return state;
}
