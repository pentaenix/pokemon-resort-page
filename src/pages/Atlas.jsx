import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { EmptyState, PageTitle } from '../components/Layout.jsx';
import { IslandMap2D } from '../components/atlas/IslandMap2D.jsx';
import { PinDetailPanel } from '../components/atlas/PinDetailPanel.jsx';
import { ImageGalleryModal } from '../components/ImageGalleryModal.jsx';
import { assetUrl, atlasSectionHref, scrollToSection } from '../lib/data.js';
import { normalizeAtlasPins, ATLAS_PIN_COLORS } from '../lib/atlasPins.js';
import { resolveCarouselSlideDisplay } from '../lib/frameFilename.js';
import { prefetchAtlasImage } from '../lib/atlasImageLoader.js';
import {
  FRAMING_REFERENCE,
  applyIslandBaseRotation,
  applyIslandLighting,
  applyIslandStageOffset,
  createIslandLights,
  fitIslandModel,
  frameCameraToGroup,
  normalizeIslandViewport,
} from '../../tools/admin/shared/island-viewport.js';
import {
  normalizeMapAlignment,
  pickIslandPinDotScreen,
  syncIslandPinDots,
} from '../../tools/admin/shared/island-map-dots.js';

function IslandDotHoverTip({ tip, visible }) {
  if (!tip) return null;
  return (
    <div
      className={`island-dot-hover-tip island-dot-hover-tip--${tip.color || 'yellow'}${visible ? ' is-visible' : ''}`}
      style={{ left: tip.x, top: tip.y }}
      role="tooltip"
    >
      <strong>{tip.name}</strong>
    </div>
  );
}

function IslandStage3D({
  islandModelUrl,
  displaySize = FRAMING_REFERENCE,
  viewport,
  pins = [],
  mapAlignment,
  selectedPinId = null,
  onSelectPin,
}) {
  const mountRef = useRef(null);
  const wrapRef = useRef(null);
  const [modelState, setModelState] = useState(islandModelUrl ? 'loading' : 'placeholder');
  const [hoverTarget, setHoverTarget] = useState(null);
  const [renderTip, setRenderTip] = useState(null);
  const [tipVisible, setTipVisible] = useState(false);
  const setHoverTargetRef = useRef(setHoverTarget);
  setHoverTargetRef.current = setHoverTarget;
  const islandViewport = useMemo(() => normalizeIslandViewport(viewport), [viewport]);
  const islandAlignment = useMemo(() => normalizeMapAlignment(mapAlignment), [mapAlignment]);
  const pinDots = useMemo(
    () => pins.filter((pin) => pin.map3d?.enabled !== false),
    [pins],
  );
  const pinById = useMemo(() => new Map(pinDots.map((pin) => [pin.id, pin])), [pinDots]);

  useEffect(() => {
    if (!hoverTarget) return;
    setRenderTip(hoverTarget);
  }, [hoverTarget]);

  useEffect(() => {
    if (!hoverTarget) {
      setTipVisible(false);
      const timer = window.setTimeout(() => setRenderTip(null), 220);
      return () => window.clearTimeout(timer);
    }
    setRenderTip(hoverTarget);
    const frame = requestAnimationFrame(() => setTipVisible(true));
    return () => cancelAnimationFrame(frame);
  }, [hoverTarget?.id]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let disposed = false;
    const scene = new THREE.Scene();
    const aspect = mount.clientWidth / Math.max(1, mount.clientHeight);
    const camera = new THREE.PerspectiveCamera(38, aspect, 0.08, 120);
    const cameraTarget = new THREE.Vector3();
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    mount.appendChild(renderer.domElement);

    const islandViewport = normalizeIslandViewport(viewport);
    const lights = createIslandLights(scene);
    applyIslandLighting(lights, renderer, islandViewport);

    const rootGroup = new THREE.Group();
    scene.add(rootGroup);
    const modelHolder = new THREE.Group();
    rootGroup.add(modelHolder);
    const dotsGroup = new THREE.Group();
    modelHolder.add(dotsGroup);
    const placeholderGroup = new THREE.Group();
    rootGroup.add(placeholderGroup);
    applyIslandStageOffset(rootGroup, islandViewport);

    const beach = new THREE.Mesh(new THREE.CylinderGeometry(3.05, 3.28, .12, 96), new THREE.MeshStandardMaterial({ color: 0xf4d9a4, roughness: .92 }));
    beach.scale.set(1.22, 1, .87);
    beach.position.y = .05;
    placeholderGroup.add(beach);

    const island = new THREE.Mesh(new THREE.CylinderGeometry(2.75, 3.15, .34, 96), new THREE.MeshStandardMaterial({ color: 0xb8e39b, roughness: .74 }));
    island.scale.set(1.18, 1, .82);
    island.position.y = .19;
    placeholderGroup.add(island);

    let loadedModel = null;

    function refreshDots() {
      syncIslandPinDots(dotsGroup, pinDots, {
        alignment: islandAlignment,
        displaySize,
        meshRoot: loadedModel,
        localSpace: modelHolder,
        selectedPinId,
      });
    }

    if (islandModelUrl) {
      const loader = new GLTFLoader();
      loader.load(
        islandModelUrl,
        (gltf) => {
          if (disposed) return;
          loadedModel = gltf.scene;
          fitIslandModel(loadedModel, displaySize);
          modelHolder.add(loadedModel);
          placeholderGroup.visible = false;
          frameCamera();
          refreshDots();
          setModelState('loaded');
        },
        undefined,
        () => { if (!disposed) setModelState('placeholder'); },
      );
    } else {
      setModelState('placeholder');
    }

    let yaw = islandViewport.yaw;
    let dragging = false;
    let dragMoved = false;
    let lastX = 0;

    function applyRotation() {
      applyIslandBaseRotation(rootGroup, islandViewport, yaw);
    }
    applyRotation();

    function frameCamera() {
      const framingSubject = loadedModel ? modelHolder : rootGroup;
      frameCameraToGroup(
        camera,
        cameraTarget,
        rootGroup,
        mount.clientWidth / Math.max(1, mount.clientHeight),
        displaySize,
        islandViewport,
        framingSubject,
      );
    }
    frameCamera();
    refreshDots();

    function updateDotHover(event) {
      if (!loadedModel || pinDots.length === 0) {
        setHoverTargetRef.current(null);
        return;
      }
      const pinId = pickIslandPinDotScreen(dotsGroup, event, camera, renderer.domElement, 18);
      if (!pinId) {
        setHoverTargetRef.current(null);
        renderer.domElement.style.cursor = 'grab';
        return;
      }
      const pin = pinById.get(pinId);
      const wrap = wrapRef.current;
      const dot = dotsGroup.children.find((child) => child.userData?.pinId === pinId);
      if (!wrap || !pin || !dot) return;

      const projected = new THREE.Vector3();
      dot.getWorldPosition(projected);
      projected.project(camera);
      const canvasRect = renderer.domElement.getBoundingClientRect();
      const wrapRect = wrap.getBoundingClientRect();
      const sx = (projected.x * 0.5 + 0.5) * canvasRect.width + (canvasRect.left - wrapRect.left);
      const sy = (-projected.y * 0.5 + 0.5) * canvasRect.height + (canvasRect.top - wrapRect.top);

      setHoverTargetRef.current({
        id: pinId,
        name: pin.name || pinId,
        color: pin.color || 'yellow',
        x: sx,
        y: sy,
      });
      renderer.domElement.style.cursor = 'pointer';
    }

    function handlePointerDown(event) {
      dragging = true;
      dragMoved = false;
      lastX = event.clientX;
      setHoverTargetRef.current(null);
      renderer.domElement.style.cursor = 'grabbing';
      renderer.domElement.setPointerCapture?.(event.pointerId);
    }
    function handlePointerMove(event) {
      if (dragging) {
        if (Math.abs(event.clientX - lastX) > 2) dragMoved = true;
        yaw += (event.clientX - lastX) * .006;
        lastX = event.clientX;
        applyRotation();
        return;
      }
      updateDotHover(event);
    }
    function handlePointerUp(event) {
      if (dragging && !dragMoved && loadedModel) {
        const pinId = pickIslandPinDotScreen(dotsGroup, event, camera, renderer.domElement, 18);
        if (pinId) onSelectPin?.(pinId);
      }
      dragging = false;
      renderer.domElement.style.cursor = 'grab';
      renderer.domElement.releasePointerCapture?.(event.pointerId);
      updateDotHover(event);
    }
    function handlePointerLeave() {
      if (!dragging) setHoverTargetRef.current(null);
      renderer.domElement.style.cursor = 'grab';
    }

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointermove', handlePointerMove);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);
    renderer.domElement.addEventListener('pointercancel', handlePointerUp);
    renderer.domElement.addEventListener('pointerleave', handlePointerLeave);

    function resize() {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      frameCamera();
    }
    window.addEventListener('resize', resize);

    let raf = 0;
    function animate() {
      raf = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    }
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointermove', handlePointerMove);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      renderer.domElement.removeEventListener('pointercancel', handlePointerUp);
      renderer.domElement.removeEventListener('pointerleave', handlePointerLeave);
      window.removeEventListener('resize', resize);
      if (loadedModel) {
        loadedModel.traverse((child) => {
          if (child.isMesh) {
            child.geometry?.dispose();
            if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
            else child.material?.dispose();
          }
        });
      }
      dotsGroup.traverse((child) => {
        if (child.isMesh) {
          child.geometry?.dispose();
          child.material?.dispose();
        }
      });
      mount.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, [islandModelUrl, displaySize, islandViewport, islandAlignment, pinDots, pinById, selectedPinId, onSelectPin]);

  const modelHint = modelState === 'loading'
    ? 'Loading island mesh…'
    : modelState === 'loaded'
      ? 'Drag to rotate'
      : 'Island model in progress';

  return (
    <div className="island-stage-wrap island-stage-wrap--atlas" ref={wrapRef}>
      <div className="island-stage island-stage--atlas" ref={mountRef} />
      <IslandDotHoverTip tip={renderTip} visible={tipVisible} />
      <span className="island-stage-hint soft-label">{modelHint}</span>
    </div>
  );
}

function buildCarouselGalleryImages(items = []) {
  return items.map((item) => {
    const display = resolveCarouselSlideDisplay(item);
    const caption = [display.metaLine, display.description].filter(Boolean).join(' · ');
    return {
      path: item.src,
      caption: caption || display.title || '',
    };
  });
}

function AtlasCarousel({ items = [], onOpenSlide }) {
  if (!items.length) return null;
  return (
    <section className="atlas-carousel-section" id="atlas-carousel" aria-label="Island Atlas gallery">
      <div className="section-intro compact">
        <p className="eyebrow">Field captures</p>
        <h2>Frames &amp; references</h2>
        <p>Show stills, research grabs, and work-in-progress shots from the atlas desk.</p>
      </div>
      <div className="media-carousel atlas-media-carousel">
        {items.map((item, index) => {
          const display = resolveCarouselSlideDisplay(item);
          const openLabel = display.title
            ? `Open ${display.title} full size`
            : `Open frame ${index + 1} full size`;
          return (
            <figure key={item.id || item.src} className="carousel-card atlas-carousel-card">
              <button
                type="button"
                className="atlas-carousel-open"
                onClick={() => onOpenSlide?.(index)}
                aria-label={openLabel}
              >
                {item.type === 'video' ? (
                  <video src={assetUrl(item.src)} muted loop playsInline controls={false} aria-hidden="true" />
                ) : (
                  <img src={assetUrl(item.src)} alt="" />
                )}
                <span className="atlas-carousel-open-lens" aria-hidden="true">
                  <svg viewBox="0 0 16 16" fill="none">
                    <path d="M6.2 10.4a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4Z" stroke="currentColor" strokeWidth="1.3" />
                    <path d="M9.4 9.4 13 13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  </svg>
                  <span>Open</span>
                </span>
              </button>
              <figcaption>
                {(display.episodeLine || display.timeLine) ? (
                  <span className="carousel-card-meta">
                    {display.episodeLine ? <span className="carousel-card-episode">{display.episodeLine}</span> : null}
                    {display.episodeLine && display.timeLine ? <span className="carousel-card-meta-sep" aria-hidden="true"> · </span> : null}
                    {display.timeLine ? <span className="carousel-card-time">{display.timeLine}</span> : null}
                  </span>
                ) : null}
                {display.title ? <strong>{display.title}</strong> : null}
                {display.description ? <span>{display.description}</span> : null}
              </figcaption>
            </figure>
          );
        })}
      </div>
    </section>
  );
}

function AtlasJumpLink({ sectionId, label }) {
  const href = atlasSectionHref(sectionId);
  return (
    <a
      href={href}
      onClick={(event) => {
        if (window.location.hash.startsWith('#/atlas')) {
          event.preventDefault();
          window.history.replaceState(null, '', href);
          scrollToSection(sectionId);
        }
      }}
    >
      {label}
    </a>
  );
}

export default function Atlas({ data, query }) {
  const atlas = useMemo(() => normalizeAtlasPins(data.atlasPins), [data.atlasPins]);
  const allPins = atlas.pins;
  const [colorFilter, setColorFilter] = useState('all');
  const pins = useMemo(
    () => (colorFilter === 'all' ? allPins : allPins.filter((p) => p.color === colorFilter)),
    [allPins, colorFilter],
  );
  const [selectedId, setSelectedId] = useState(query?.pin || null);
  const [layers, setLayers] = useState({ ...atlas.map.defaultLayers });
  const [galleryOpen, setGalleryOpen] = useState(null);

  const selected = useMemo(
    () => allPins.find((p) => p.id === selectedId) || null,
    [allPins, selectedId],
  );

  useEffect(() => {
    if (query?.pin) setSelectedId(query.pin);
  }, [query?.pin]);

  useEffect(() => {
    if (!query?.section) return;
    const id = window.setTimeout(() => scrollToSection(query.section), 80);
    return () => window.clearTimeout(id);
  }, [query?.section]);

  useEffect(() => {
    prefetchAtlasImage(atlas.map.showReference?.path);
    allPins.forEach((pin) => prefetchAtlasImage(pin.coverImage?.path));
  }, [allPins, atlas.map.showReference?.path]);

  useEffect(() => {
    prefetchAtlasImage(selected?.coverImage?.path);
  }, [selected?.coverImage?.path]);

  function toggleLayer(key, value) {
    setLayers((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <main>
      <PageTitle eyebrow="Island Atlas" title="The resort island (mapped so far)">
        Hand-traced from Pokémon Concierge. Blue pins are researched, yellow are layout notes, red are still guesses.
      </PageTitle>

      <section className="atlas-jumpbar" aria-label="Atlas sections">
        <AtlasJumpLink sectionId="atlas-map" label="Cork board" />
        <AtlasJumpLink sectionId="atlas-carousel" label="Gallery" />
        <AtlasJumpLink sectionId="atlas-3d" label="Island model" />
      </section>

      <section className="atlas-pin-filter-card" aria-label="Pin color filters">
        <div><p className="eyebrow">Pin legend</p><h2>What the colors mean</h2></div>
        <div className="segmented wrap">
          <button type="button" className={colorFilter === 'all' ? 'active' : ''} onClick={() => setColorFilter('all')}>All</button>
          {atlas.pinColors.map((color) => (
            <button
              key={color.id}
              type="button"
              className={`atlas-pin-filter atlas-pin-filter--${color.id}${colorFilter === color.id ? ' active' : ''}`}
              onClick={() => setColorFilter(color.id)}
            >
              {color.label}
            </button>
          ))}
        </div>
      </section>

      <section className="atlas-map-layout" id="atlas-map">
        <div className="atlas-map-main">
          <div className="atlas-card atlas-card--map">
            <div className="atlas-card-top">
              <div>
                <strong>Cork board</strong>
                <span>Traced from the show · peel layers on or off</span>
              </div>
              <span className="soft-label">{pins.length} pin{pins.length === 1 ? '' : 's'}</span>
            </div>
            <IslandMap2D
              mapConfig={atlas.map}
              pins={pins}
              selectedPinId={selected?.id}
              onSelectPin={setSelectedId}
              layerVisibility={layers}
              onLayerToggle={toggleLayer}
              pinColors={atlas.pinColors}
            />
            <div className="atlas-pin-tabs">
              {allPins.map((pin) => (
                <button
                  key={pin.id}
                  type="button"
                  className={`atlas-pin-tab atlas-pin-tab--${pin.color}${selected?.id === pin.id ? ' active' : ''}`}
                  onClick={() => setSelectedId(pin.id)}
                  onMouseEnter={() => prefetchAtlasImage(pin.coverImage?.path)}
                  onFocus={() => prefetchAtlasImage(pin.coverImage?.path)}
                >
                  {pin.name}
                </button>
              ))}
            </div>
          </div>
        </div>
        <PinDetailPanel
          pin={selected}
          ideasManifest={data.ideas}
          showReference={atlas.map.showReference}
          onOpenReference={() => setGalleryOpen({
            title: atlas.map.showReference?.label || 'From the show',
            images: [{
              path: atlas.map.showReference.path,
              caption: atlas.map.showReference.caption,
            }],
          })}
          onOpenPinCover={() => {
            if (!selected?.coverImage?.path) return;
            setGalleryOpen({
              title: selected.coverImage.label || selected.name,
              images: [{
                path: selected.coverImage.path,
                caption: selected.coverImage.caption,
              }],
            });
          }}
        />
      </section>

      {galleryOpen ? (
        <ImageGalleryModal
          title={galleryOpen.title}
          images={galleryOpen.images}
          startIndex={galleryOpen.startIndex ?? 0}
          onClose={() => setGalleryOpen(null)}
        />
      ) : null}

      <AtlasCarousel
        items={atlas.map.carousel}
        onOpenSlide={(index) => {
          const items = atlas.map.carousel || [];
          const slide = items[index];
          if (!slide?.src) return;
          const display = resolveCarouselSlideDisplay(slide);
          setGalleryOpen({
            title: display.title || 'Field capture',
            images: buildCarouselGalleryImages(items),
            startIndex: index,
          });
        }}
      />

      <section className="atlas-3d-section" id="atlas-3d">
        <div className="section-intro compact">
          <p className="eyebrow">3D pass</p>
          <h2>Island diorama</h2>
          <p>Rough mesh built from the cork-board layout. Colored dots match cork pins — click a dot to jump to that location. Drag to turn the island.</p>
        </div>
        <div className="atlas-card atlas-card--3d">
          <IslandStage3D
            islandModelUrl={data.models?.mainModel?.file ? assetUrl(data.models.mainModel.file) : null}
            displaySize={Number(data.models?.mainModel?.displaySize) || FRAMING_REFERENCE}
            viewport={data.models?.mainModel?.viewport}
            mapAlignment={data.models?.mainModel?.mapAlignment}
            pins={allPins}
            selectedPinId={selected?.id}
            onSelectPin={(pinId) => {
              setSelectedId(pinId);
              scrollToSection('atlas-map');
            }}
          />
        </div>
      </section>

      {!allPins.length && (
        <EmptyState title="No pins yet." actionHref="#/source" actionLabel="Open resource guide">
          Add pins in the admin tool (npm run admin).
        </EmptyState>
      )}

      <div className="atlas-pin-legend">
        {Object.entries(ATLAS_PIN_COLORS).map(([id, meta]) => (
          <span key={id} className={`atlas-pin-legend-item atlas-pin-legend-item--${id}`}>{meta.label}</span>
        ))}
      </div>
    </main>
  );
}
