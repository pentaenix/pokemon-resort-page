import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { EmptyState, PageTitle } from '../components/Layout.jsx';
import { StatusPill } from '../components/StatusPill.jsx';
import { assetUrl, atlasSectionHref, scrollToSection } from '../lib/data.js';

const confidenceTone = {
  Confirmed: 'green',
  Likely: 'blue',
  Possible: 'yellow',
  Speculative: 'yellow',
  'Original for gameplay': 'gray',
};

function IslandStage({ pois, selectedId, onSelect }) {
  const mountRef = useRef(null);
  const markerMap = useRef(new Map());
  const selectedRef = useRef(selectedId);
  useEffect(() => { selectedRef.current = selectedId; }, [selectedId]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf4fcff);
    const camera = new THREE.PerspectiveCamera(42, mount.clientWidth / Math.max(1, mount.clientHeight), 0.1, 100);
    camera.position.set(0, 4.6, 5.8);
    camera.lookAt(0, 0, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x9bd4ca, 2.4);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(5, 8, 4);
    scene.add(sun);

    const water = new THREE.Mesh(new THREE.CircleGeometry(5.4, 96), new THREE.MeshStandardMaterial({ color: 0x83d7ea, roughness: .5, metalness: .08 }));
    water.rotation.x = -Math.PI / 2;
    water.position.y = -0.08;
    scene.add(water);

    const beach = new THREE.Mesh(new THREE.CylinderGeometry(3.05, 3.28, .12, 96), new THREE.MeshStandardMaterial({ color: 0xf4d9a4, roughness: .92 }));
    beach.scale.set(1.22, 1, .87);
    beach.position.y = .05;
    scene.add(beach);

    const island = new THREE.Mesh(new THREE.CylinderGeometry(2.75, 3.15, .34, 96), new THREE.MeshStandardMaterial({ color: 0xb8e39b, roughness: .74 }));
    island.scale.set(1.18, 1, .82);
    island.position.y = .19;
    scene.add(island);

    const pathMat = new THREE.MeshStandardMaterial({ color: 0xfff4cc, roughness: .85 });
    const path1 = new THREE.Mesh(new THREE.BoxGeometry(3.5, .045, .18), pathMat);
    path1.position.set(.05, .4, .08);
    path1.rotation.y = .35;
    scene.add(path1);
    const path2 = new THREE.Mesh(new THREE.BoxGeometry(.18, .045, 2.8), pathMat);
    path2.position.set(-.42, .405, -.16);
    path2.rotation.y = -.3;
    scene.add(path2);

    const lodge = new THREE.Mesh(new THREE.BoxGeometry(.8, .45, .62), new THREE.MeshStandardMaterial({ color: 0xf7f0d5, roughness: .8 }));
    lodge.position.set(.02, .68, .02);
    scene.add(lodge);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(.62, .32, 4), new THREE.MeshStandardMaterial({ color: 0xd97757, roughness: .8 }));
    roof.position.set(.02, 1.08, .02);
    roof.rotation.y = Math.PI / 4;
    scene.add(roof);

    const markerMaterial = (color) => new THREE.MeshStandardMaterial({ color, roughness: .45, emissive: color, emissiveIntensity: .12 });
    const colors = { Likely: 0x32a7c4, Possible: 0xf2b64b, Speculative: 0xe8a647, Confirmed: 0x45c784, 'Original for gameplay': 0x8da2b7 };
    markerMap.current.clear();
    pois.forEach((poi) => {
      const group = new THREE.Group();
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(.095, 24, 16), markerMaterial(colors[poi.confidence] || 0x7dd3fc));
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(.018, .018, .24, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .4 }));
      stem.position.y = -.13;
      group.add(stem, sphere);
      group.position.set(poi.position[0], poi.position[1] + .34, poi.position[2]);
      group.userData.poiId = poi.id;
      scene.add(group);
      markerMap.current.set(poi.id, group);
    });

    let rotation = -.25;
    let dragging = false;
    let lastX = 0;
    let moved = false;
    const rootGroup = new THREE.Group();
    while (scene.children.length) rootGroup.add(scene.children[0]);
    scene.add(rootGroup);
    rootGroup.rotation.y = rotation;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    function handlePointerDown(event) {
      dragging = true;
      moved = false;
      lastX = event.clientX;
      renderer.domElement.setPointerCapture?.(event.pointerId);
    }
    function handlePointerMove(event) {
      if (!dragging) return;
      const dx = event.clientX - lastX;
      lastX = event.clientX;
      if (Math.abs(dx) > 2) moved = true;
      rotation += dx * .006;
      rootGroup.rotation.y = rotation;
    }
    function handlePointerUp(event) {
      if (!dragging) return;
      dragging = false;
      if (moved) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const objects = [...markerMap.current.values()].flatMap((group) => group.children);
      const hit = raycaster.intersectObjects(objects, true)[0];
      if (hit) {
        let current = hit.object;
        while (current && !current.userData.poiId) current = current.parent;
        if (current?.userData.poiId) onSelect(current.userData.poiId);
      }
    }
    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointermove', handlePointerMove);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);
    renderer.domElement.addEventListener('pointercancel', handlePointerUp);

    function resize() {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    window.addEventListener('resize', resize);

    let raf = 0;
    function animate() {
      raf = requestAnimationFrame(animate);
      markerMap.current.forEach((group, id) => {
        const selected = selectedRef.current === id;
        const scale = selected ? 1.45 : 1 + Math.sin(Date.now() / 450 + group.position.x) * .04;
        group.scale.setScalar(scale);
      });
      renderer.render(scene, camera);
    }
    animate();

    return () => {
      cancelAnimationFrame(raf);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointermove', handlePointerMove);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      renderer.domElement.removeEventListener('pointercancel', handlePointerUp);
      window.removeEventListener('resize', resize);
      mount.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, [pois, onSelect]);

  return <div className="island-stage" ref={mountRef} />;
}

function PoiPanel({ poi }) {
  if (!poi) return null;
  return (
    <aside className="poi-panel">
      <div className="panel-header">
        <p className="eyebrow">Point of Interest</p>
        <h2>{poi.name}</h2>
        <div className="pill-row"><StatusPill status={confidenceTone[poi.confidence] || 'blue'} label={poi.confidence} /><span className="soft-label">{poi.devStatus}</span></div>
      </div>
      <p>{poi.summary}</p>
      <div className="route-summary-grid">
        <span><strong>Type</strong>{poi.type}</span>
        <span><strong>Canon status</strong>{poi.canonStatus}</span>
      </div>
      {poi.evidence?.length ? <><h3>Evidence</h3><div className="evidence-grid">{poi.evidence.map((item) => <figure key={item.label}><img src={assetUrl(item.image)} alt={item.label} /><figcaption><strong>{item.label}</strong>{item.note}</figcaption></figure>)}</div></> : null}
      <h3>Needed assets</h3>
      <ul className="asset-list">{poi.assetNeeds.map((asset) => <li key={asset}>{asset}</li>)}</ul>
      {(poi.linkedFeatures?.length || poi.relatedBugs?.length) && <div className="linked-list"><strong>Linked work</strong>{poi.linkedFeatures?.map((id) => <a key={id} href="#/board">{id}</a>)}{poi.relatedBugs?.map((id) => <a key={id} href={`#/board?q=${id}`}>{id}</a>)}</div>}
    </aside>
  );
}

function ModelSections({ models }) {
  const submodels = models?.submodels || [];
  return (
    <section className="resource-shell atlas-resource-block" id="atlas-models">
      <div className="section-intro compact"><p className="eyebrow">3D Model Stack</p><h2>Main island and submodels.</h2><p>The atlas keeps the main model in view while submodels expand beneath it as you create them.</p></div>
      <article className="model-card main-model-card">
        <div className="model-preview">{models?.mainModel?.preview ? <img src={assetUrl(models.mainModel.preview)} alt={`${models.mainModel.name} preview`} /> : <span>{models?.mainModel?.file}</span>}</div>
        <div>
          <span className="soft-label">{models?.mainModel?.status}</span>
          <h3>{models?.mainModel?.name}</h3>
          <p>{models?.mainModel?.summary}</p>
          <div className="linked-list"><strong>Model path</strong><span>{models?.mainModel?.file}</span></div>
        </div>
      </article>
      {submodels.length ? <div className="model-grid submodel-grid">{submodels.map((model) => <details key={model.id} className="submodel-detail"><summary><strong>{model.name}</strong><span>{model.status}</span></summary><p>{model.summary}</p><div className="linked-list"><strong>Files</strong><span>{model.file}</span>{model.preview && <span>{model.preview}</span>}</div>{model.neededAssets?.length ? <ul className="checklist compact-list">{model.neededAssets.map((asset) => <li key={asset.label} className={asset.done ? 'done' : ''}>{asset.label}</li>)}</ul> : null}</details>)}</div> : <EmptyState title="Submodels will appear here when added." actionHref="#/source" actionLabel="Open resource guide">The public page is ready for ferry docks, lodges, paths, props, transport, and service-area models. Add them through the local Operations Desk.</EmptyState>}
    </section>
  );
}

function CharacterSections({ characters }) {
  const people = [...(characters?.seriesCharacters || []), ...(characters?.plannedVisitors || [])];
  return (
    <section className="resource-shell atlas-resource-block" id="atlas-characters">
      <div className="section-intro compact"><p className="eyebrow">Visitors & Staff</p><h2>Characters, duties, and animated sprites.</h2><p>Use GIF, animated WebP, or transparent sprite sheets to show planned visitors and staff behavior.</p></div>
      {people.length ? <div className="character-grid">{people.map((person) => <article className="character-card" key={person.id}><div className="character-media">{person.portrait && <img src={assetUrl(person.portrait)} alt={`${person.name} portrait`} />}{person.idle && <img src={assetUrl(person.idle)} alt={`${person.name} idle animation`} />}</div><div><span className="soft-label">{person.implementationStatus || person.type}</span><h3>{person.name}</h3><p>{person.role}</p></div></article>)}</div> : <div className="requirements-panel"><h2>Sprite resource checklist</h2><div className="resource-list">{characters.spriteRequirements.map((req) => <article key={req.label}><strong>{req.label}</strong><span>{req.path}</span><small>{req.formats.join(', ')}</small></article>)}</div></div>}
    </section>
  );
}


function AtlasCarousel({ gallery }) {
  const items = gallery?.carousel || gallery?.items || [];
  if (!items.length) return null;
  return (
    <section className="atlas-carousel-section" aria-label="Featured island media">
      <div className="section-intro compact"><p className="eyebrow">Resort Media Carousel</p><h2>Images, GIFs, animated WebP, and short clips.</h2><p>Set these from the local Operations Desk to highlight gameplay clips, model renders, research diagrams, and sprite animations.</p></div>
      <div className="media-carousel">
        {items.map((item) => (
          <figure key={item.id || item.src} className="carousel-card">
            {item.type === 'video' ? <video src={assetUrl(item.src)} muted playsInline loop controls={false} autoPlay /> : <img src={assetUrl(item.src)} alt={item.alt || item.title} />}
            <figcaption><strong>{item.title}</strong><span>{item.caption}</span></figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

function GallerySections({ gallery }) {
  const items = gallery?.items || [];
  if (!items.length) return null;
  return (
    <section className="resource-shell atlas-resource-block" id="atlas-gallery">
      <div className="section-intro compact"><p className="eyebrow">Gallery</p><h2>Connected visual archive.</h2><p>Screenshots, renders, diagrams, sprites, and research images can all link back to POIs, routes, features, models, or characters.</p></div>
      <div className="gallery-grid">{items.map((item) => <figure key={item.id} className="gallery-card"><img src={assetUrl(item.src)} alt={item.alt || item.title} /><div><strong>{item.title}</strong><span>{item.category}</span></div></figure>)}</div>
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
  const allPois = data.research.pois || [];
  const [confidence, setConfidence] = useState('All');
  const pois = useMemo(() => confidence === 'All' ? allPois : allPois.filter((poi) => poi.confidence === confidence), [allPois, confidence]);
  const [selectedId, setSelectedId] = useState(allPois[0]?.id);
  const selected = useMemo(() => pois.find((poi) => poi.id === selectedId) || pois[0] || allPois[0], [pois, allPois, selectedId]);
  const legend = ['All', ...(data.research.confidenceLegend || [])];
  useEffect(() => {
    if (!query?.section) return;
    const id = window.setTimeout(() => scrollToSection(query.section), 80);
    return () => window.clearTimeout(id);
  }, [query?.section]);
  return (
    <main>
      <PageTitle eyebrow="Island Research Atlas" title="A 3D resort map that doubles as research navigation.">
        Rotate the island, click markers, inspect evidence and asset needs, then expand into submodels, characters, and gallery resources as they are added.
      </PageTitle>
      <section className="atlas-jumpbar" aria-label="Atlas sections">
        <AtlasJumpLink sectionId="atlas-map" label="Map" />
        <AtlasJumpLink sectionId="atlas-media" label="Media Carousel" />
        <AtlasJumpLink sectionId="atlas-models" label="Submodels" />
        <AtlasJumpLink sectionId="atlas-characters" label="Characters & Sprites" />
        <AtlasJumpLink sectionId="atlas-gallery" label="Gallery" />
      </section>
      <section className="confidence-filter-card" aria-label="Evidence confidence filters">
        <div><p className="eyebrow">Evidence Confidence</p><h2>Filter the atlas by how certain the reconstruction is.</h2></div>
        <div className="segmented wrap">{legend.map((label) => <button key={label} className={confidence === label ? 'active' : ''} onClick={() => { setConfidence(label); setSelectedId((label === 'All' ? allPois : allPois.filter((poi) => poi.confidence === label))[0]?.id); }}>{label}</button>)}</div>
      </section>
      <section className="atlas-layout" id="atlas-map">
        <div className="atlas-card">
          <div className="atlas-card-top"><div><strong>Island planning viewport</strong><span>Drag to rotate · click markers</span></div><span className="soft-label">{pois.length} visible POI{pois.length === 1 ? '' : 's'}</span></div>
          <IslandStage pois={pois} selectedId={selected?.id} onSelect={setSelectedId} />
          <div className="poi-tabs">{pois.map((poi) => <button key={poi.id} className={selected?.id === poi.id ? 'active' : ''} onClick={() => setSelectedId(poi.id)}>{poi.name}</button>)}</div>
        </div>
        <PoiPanel poi={selected} />
      </section>
      <div id="atlas-media"><AtlasCarousel gallery={data.gallery} /></div>
      <ModelSections models={data.models} />
      <CharacterSections characters={data.characters} />
      <GallerySections gallery={data.gallery} />
    </main>
  );
}
