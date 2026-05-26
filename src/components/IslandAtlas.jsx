import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { assetUrl } from '../lib/data.js';

function makeTextSprite(text) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = 512;
  canvas.height = 128;
  ctx.fillStyle = 'rgba(255, 253, 248, 0.92)';
  roundRect(ctx, 20, 20, 472, 74, 24);
  ctx.fill();
  ctx.strokeStyle = 'rgba(18, 50, 63, 0.18)';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = '#12323f';
  ctx.font = '700 38px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 58);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.9, 0.48, 1);
  return sprite;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function addProceduralIsland(scene) {
  const island = new THREE.Group();
  const sand = new THREE.MeshStandardMaterial({ color: '#f7d58c', roughness: 0.95 });
  const grass = new THREE.MeshStandardMaterial({ color: '#6db879', roughness: 0.9 });
  const reef = new THREE.MeshStandardMaterial({ color: '#48d1cc', roughness: 0.75, transparent: true, opacity: 0.42 });
  const rock = new THREE.MeshStandardMaterial({ color: '#8b927c', roughness: 0.9 });
  const path = new THREE.MeshStandardMaterial({ color: '#fff0c7', roughness: 0.88 });
  const roof = new THREE.MeshStandardMaterial({ color: '#f16a43', roughness: 0.82 });
  const wood = new THREE.MeshStandardMaterial({ color: '#93603a', roughness: 0.9 });

  const lagoon = new THREE.Mesh(new THREE.CylinderGeometry(4.8, 5.8, 0.08, 96), reef);
  lagoon.position.y = -0.06;
  lagoon.scale.set(1.22, 1, 0.78);
  island.add(lagoon);

  const beach = new THREE.Mesh(new THREE.CylinderGeometry(3.7, 4.2, 0.2, 96), sand);
  beach.scale.set(1.18, 1, 0.72);
  island.add(beach);

  const green = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 3.1, 0.24, 96), grass);
  green.position.y = 0.15;
  green.scale.set(1.08, 1, 0.66);
  island.add(green);

  const pathOne = new THREE.Mesh(new THREE.TorusGeometry(1.65, 0.055, 12, 80, Math.PI * 1.65), path);
  pathOne.rotation.x = Math.PI / 2;
  pathOne.rotation.z = -0.35;
  pathOne.position.y = 0.31;
  pathOne.scale.set(1.12, 0.76, 1);
  island.add(pathOne);

  const lodge = new THREE.Group();
  const lodgeBase = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.36, 0.55), wood);
  lodgeBase.position.set(0.1, 0.55, -0.75);
  const lodgeRoof = new THREE.Mesh(new THREE.ConeGeometry(0.58, 0.35, 4), roof);
  lodgeRoof.position.set(0.1, 0.9, -0.75);
  lodgeRoof.rotation.y = Math.PI / 4;
  lodge.add(lodgeBase, lodgeRoof);
  island.add(lodge);

  const dock = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.22), wood);
  dock.position.set(-3.05, 0.23, 1.7);
  dock.rotation.y = -0.35;
  island.add(dock);

  const boat = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.12, 0.26), new THREE.MeshStandardMaterial({ color: '#fff7e6', roughness: 0.8 }));
  boat.position.set(-3.75, 0.16, 1.9);
  boat.rotation.y = -0.2;
  island.add(boat);

  for (let i = 0; i < 10; i += 1) {
    const palm = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.055, 0.46, 8), wood);
    trunk.position.y = 0.35;
    const fronds = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.28, 7), new THREE.MeshStandardMaterial({ color: '#2c9b65', roughness: 0.9 }));
    fronds.position.y = 0.65;
    palm.add(trunk, fronds);
    const angle = (i / 10) * Math.PI * 2;
    const radius = i % 2 ? 2.45 : 3.05;
    palm.position.set(Math.cos(angle) * radius, 0.18, Math.sin(angle) * radius * 0.55);
    island.add(palm);
  }

  const rockCluster = new THREE.Group();
  for (let i = 0; i < 6; i += 1) {
    const pebble = new THREE.Mesh(new THREE.DodecahedronGeometry(0.15 + Math.random() * 0.05), rock);
    pebble.position.set(2.1 + Math.random() * 0.5, 0.32, -0.9 + Math.random() * 0.5);
    pebble.scale.y = 0.5;
    rockCluster.add(pebble);
  }
  island.add(rockCluster);
  scene.add(island);
}

function useThreeAtlas(canvasRef, pois, selectedId, onSelect, modelUrl) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog('#dff7ff', 6, 13);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(5.2, 4.6, 5.8);

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.target.set(0, 0.3, 0);
    controls.maxDistance = 11;
    controls.minDistance = 3.8;
    controls.maxPolarAngle = Math.PI / 2.05;

    const hemi = new THREE.HemisphereLight('#ffffff', '#74c6d4', 2.8);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight('#fff3c2', 3.2);
    sun.position.set(3, 5, 2);
    scene.add(sun);

    const water = new THREE.Mesh(
      new THREE.CircleGeometry(8, 128),
      new THREE.MeshStandardMaterial({ color: '#50c8d8', transparent: true, opacity: 0.28, roughness: 0.4 })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = -0.12;
    scene.add(water);

    let modelGroup = new THREE.Group();
    scene.add(modelGroup);
    if (modelUrl) {
      const loader = new GLTFLoader();
      loader.load(
        assetUrl(modelUrl),
        (gltf) => {
          modelGroup.clear();
          const root = gltf.scene;
          root.scale.setScalar(1);
          modelGroup.add(root);
        },
        undefined,
        () => addProceduralIsland(modelGroup)
      );
    } else {
      addProceduralIsland(modelGroup);
    }

    const markers = new Map();
    const markerMaterial = new THREE.MeshStandardMaterial({ color: '#ff7a59', emissive: '#7a240f', emissiveIntensity: 0.35, roughness: 0.55 });
    const activeMaterial = new THREE.MeshStandardMaterial({ color: '#ffd166', emissive: '#ffb703', emissiveIntensity: 0.8, roughness: 0.4 });
    pois.forEach((poi) => {
      const marker = new THREE.Mesh(new THREE.SphereGeometry(0.13, 24, 16), poi.id === selectedId ? activeMaterial : markerMaterial);
      marker.position.set(...poi.position);
      marker.userData.poiId = poi.id;
      scene.add(marker);
      const label = makeTextSprite(poi.name);
      label.position.set(poi.position[0], poi.position[1] + 0.42, poi.position[2]);
      label.userData.poiId = poi.id;
      scene.add(label);
      markers.set(poi.id, { marker, label });
    });

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    function resize() {
      const rect = canvas.getBoundingClientRect();
      renderer.setSize(rect.width, rect.height, false);
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
    }

    function click(event) {
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const clickable = [];
      markers.forEach(({ marker, label }) => clickable.push(marker, label));
      const hit = raycaster.intersectObjects(clickable, false)[0];
      if (hit?.object?.userData?.poiId) onSelect(hit.object.userData.poiId);
    }

    canvas.addEventListener('click', click);
    window.addEventListener('resize', resize);
    resize();

    let raf = 0;
    function animate() {
      raf = requestAnimationFrame(animate);
      const t = performance.now() * 0.001;
      markers.forEach(({ marker }, id) => {
        marker.position.y = pois.find((poi) => poi.id === id)?.position[1] + Math.sin(t * 2.2 + marker.position.x) * 0.035;
        marker.material = id === selectedId ? activeMaterial : markerMaterial;
      });
      water.material.opacity = 0.22 + Math.sin(t * 1.4) * 0.035;
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('click', click);
      window.removeEventListener('resize', resize);
      renderer.dispose();
      controls.dispose();
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose?.();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((mat) => mat.dispose?.());
          else obj.material.dispose?.();
        }
      });
    };
  }, [canvasRef, pois, selectedId, onSelect, modelUrl]);
}

function EvidenceList({ evidence }) {
  return (
    <div className="evidence-list">
      {evidence.map((item, index) => (
        <article className="evidence-card" key={`${item.label}-${index}`}>
          {item.image ? <img src={assetUrl(item.image)} alt={item.label} /> : <div className="empty-evidence">Reference image slot</div>}
          <div>
            <h4>{item.label}</h4>
            <p>{item.note}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

export function IslandAtlas({ atlas, features, bugs }) {
  const [selectedId, setSelectedId] = useState(atlas.defaultSelectedId || atlas.pois[0]?.id);
  const canvasRef = useRef(null);
  const selected = atlas.pois.find((poi) => poi.id === selectedId) || atlas.pois[0];
  const featureMap = useMemo(() => new Map(features.items.map((item) => [item.id, item])), [features.items]);
  const bugMap = useMemo(() => new Map(bugs.items.map((bug) => [bug.id, bug])), [bugs.items]);

  useThreeAtlas(canvasRef, atlas.pois, selected?.id, setSelectedId, atlas.modelUrl);

  return (
    <section className="section-wrap island-atlas" id="island-atlas" aria-labelledby="island-atlas-title">
      <div className="section-heading split-heading">
        <div>
          <p className="eyebrow">Research Atlas</p>
          <h2 id="island-atlas-title">The island map is the interface.</h2>
          <p>
            Click a point in the 3D viewport to see the research confidence, evidence, asset needs, linked work, and implementation notes for that place.
          </p>
        </div>
        <div className="confidence-key" aria-label="Confidence labels">
          {atlas.confidenceLevels.map((level) => <span key={level}>{level}</span>)}
        </div>
      </div>
      <div className="atlas-layout">
        <div className="atlas-viewer glass-panel">
          <canvas ref={canvasRef} aria-label="Interactive 3D island atlas" />
          <div className="viewer-hint">Drag to orbit · scroll to zoom · click glowing markers</div>
        </div>
        {selected && (
          <aside className="poi-panel stack-panel">
            <span className="status-pill confidence">{selected.confidence}</span>
            <h3>{selected.name}</h3>
            <p className="poi-type">{selected.type}</p>
            <p>{selected.summary}</p>
            <dl className="detail-list">
              <div><dt>Game dev status</dt><dd>{selected.gameDevStatus}</dd></div>
              <div><dt>Canon status</dt><dd>{selected.canonStatus}</dd></div>
            </dl>
            <h4>Evidence</h4>
            <EvidenceList evidence={selected.evidence} />
            <h4>Assets needed</h4>
            <ul className="chip-list">
              {selected.assetNeeds.map((asset) => <li key={asset}>{asset}</li>)}
            </ul>
            {selected.relatedFeatures?.length ? (
              <>
                <h4>Linked features</h4>
                <ul className="link-list">
                  {selected.relatedFeatures.map((id) => <li key={id}>{featureMap.get(id)?.title || id}</li>)}
                </ul>
              </>
            ) : null}
            {selected.relatedBugs?.length ? (
              <>
                <h4>Linked bugs</h4>
                <ul className="link-list bug-links">
                  {selected.relatedBugs.map((id) => <li key={id}>{bugMap.get(id)?.title || id}</li>)}
                </ul>
              </>
            ) : null}
          </aside>
        )}
      </div>
    </section>
  );
}
