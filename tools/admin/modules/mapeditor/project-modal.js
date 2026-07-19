import { clearMapPlanThumbCache, drawMapPlanThumb, paintMapPlanThumb } from './map-plan-thumb.js';

const MAP_WORLD_ORIGIN_X = 1800;
const MAP_WORLD_ORIGIN_Y = 1400;
const MAP_PIXELS_PER_TILE = 6;
const MAP_LAYOUT_SNAP_DISTANCE = 48;

function linkedMaps(project) {
  return (project?.maps || []).filter((m) => m.linked !== false);
}

function separatedMaps(project) {
  return (project?.maps || []).filter((m) => m.linked === false);
}

function mapSurfaceSize(editor, map) {
  const dims = editor.mapDimensionsByFile?.[map.file];
  if (!dims || dims.missing) return { width: 128, height: 96, label: 'missing' };
  const scale = Math.max(2, Math.min(
    MAP_PIXELS_PER_TILE,
    480 / Math.max(1, dims.width),
    360 / Math.max(1, dims.height),
  ));
  return {
    width: dims.width * scale,
    height: dims.height * scale,
    label: `${dims.width}×${dims.height}`,
  };
}

function connectedMapPositions(editor, maps) {
  const byCell = new Map(maps
    .filter((map) => map.linked !== false)
    .map((map) => [`${map.gridX},${map.gridY}`, map]));
  const sizes = new Map(maps.map((map) => [map.id, mapSurfaceSize(editor, map)]));
  const positions = new Map();
  const directions = [
    [1, 0, 'east'],
    [-1, 0, 'west'],
    [0, 1, 'south'],
    [0, -1, 'north'],
  ];
  let componentLeft = MAP_WORLD_ORIGIN_X;

  while (positions.size < maps.length) {
    const root = maps.find((map) => !positions.has(map.id));
    if (!root) break;
    positions.set(root.id, { left: componentLeft, top: MAP_WORLD_ORIGIN_Y });
    const queue = [root];
    let componentRight = componentLeft + sizes.get(root.id).width;

    while (queue.length) {
      const current = queue.shift();
      const currentPos = positions.get(current.id);
      const currentSize = sizes.get(current.id);
      for (const [dx, dy, direction] of directions) {
        const neighbor = byCell.get(`${current.gridX + dx},${current.gridY + dy}`);
        if (!neighbor || positions.has(neighbor.id)) continue;
        const neighborSize = sizes.get(neighbor.id);
        let left = currentPos.left;
        let top = currentPos.top;
        if (direction === 'east') left += currentSize.width;
        if (direction === 'west') left -= neighborSize.width;
        if (direction === 'south') top += currentSize.height;
        if (direction === 'north') top -= neighborSize.height;
        positions.set(neighbor.id, { left, top });
        componentRight = Math.max(componentRight, left + neighborSize.width);
        queue.push(neighbor);
      }
    }
    componentLeft = componentRight + 180;
  }
  return { positions, sizes };
}

function ensureProjectModalHost() {
  let host = document.getElementById('mapProjectModalHost');
  if (host) return host;
  host = document.createElement('div');
  host.id = 'mapProjectModalHost';
  host.className = 'map-project-modal-backdrop hidden';
  host.setAttribute('role', 'presentation');
  host.innerHTML = `<div class="map-project-modal" role="dialog" aria-modal="true" aria-labelledby="mapProjectModalTitle">
    <header class="map-project-modal-head">
      <div>
        <strong id="mapProjectModalTitle">Project &amp; maps</strong>
        <p class="map-project-modal-lede" id="mapProjectModalLede"></p>
      </div>
      <button type="button" class="map-preview-close" id="mapProjectModalClose" title="Close">×</button>
    </header>
    <div class="map-project-modal-tabs" role="tablist">
      <button type="button" class="map-project-modal-tab active" data-project-modal-tab="layout" role="tab">Layout</button>
      <button type="button" class="map-project-modal-tab" data-project-modal-tab="files" role="tab">Map files</button>
      <button type="button" class="map-project-modal-tab" data-project-modal-tab="project" role="tab">Project</button>
      <button type="button" class="map-project-modal-tab" data-project-modal-tab="visuals" role="tab">Visuals</button>
    </div>
    <div class="map-project-modal-body" id="mapProjectModalBody"></div>
    <footer class="map-project-modal-foot">
      <label class="map-project-delete-files"><input type="checkbox" id="mapProjectDeleteFiles"> Also delete .owmap files from disk</label>
      <div class="map-project-modal-actions">
        <button type="button" class="btn ghost" id="mapProjectRemoveAll">Remove all maps</button>
        <button type="button" class="btn ghost" id="mapProjectSaveProject">Save project</button>
        <button type="button" class="btn" id="mapProjectModalDone">Done</button>
      </div>
    </footer>
  </div>`;
  document.body.appendChild(host);
  return host;
}

function layoutGridHtml(editor, esc, maps) {
  const activeId = editor.map?.id || editor.project?.editor?.activeMapId || '';
  const { positions, sizes } = connectedMapPositions(editor, maps);
  const cards = maps.map((map) => {
    const size = sizes.get(map.id);
    const position = positions.get(map.id);
    const active = map.id === activeId || map.file === editor.currentFile ? ' active' : '';
    const separated = map.linked === false ? ' separated' : '';
    return `<article class="map-layout-card${active}${separated}" data-layout-map="${esc(map.id)}"
      data-grid-x="${map.gridX}" data-grid-y="${map.gridY}"
      style="left:${position.left}px;top:${position.top}px;width:${size.width}px;height:${size.height}px">
      <canvas class="map-layout-thumb" data-plan-thumb="${esc(map.file)}" aria-hidden="true"></canvas>
      <div class="map-layout-label">
        <strong>${esc(map.name || map.id)}</strong>
        <span>${esc(size.label)}</span>
        ${map.linked === false ? '<em>Separated</em>' : ''}
      </div>
    </article>`;
  }).join('');

  return `<div class="map-layout-viewport" id="mapLayoutViewport">
    <div class="map-layout-hud">
      <span>Drag maps to move</span>
      <span>Snap edges to connect</span>
      <span>Drop away to separate</span>
      <span>Drag empty space to pan</span>
      <span>Scroll to zoom</span>
      <span>Right-click a map for actions</span>
    </div>
    <div class="map-layout-zoom">
      <button type="button" data-map-view-zoom="out" title="Zoom out">−</button>
      <button type="button" data-map-view-reset title="Center maps">⌖</button>
      <button type="button" data-map-view-zoom="in" title="Zoom in">+</button>
    </div>
    <div class="map-layout-canvas" id="mapLayoutCanvas">
      ${cards}
    </div>
    <div class="map-layout-context hidden" id="mapLayoutContextMenu" role="menu">
      <button type="button" data-context-open-map>Open map</button>
      <button type="button" data-context-standalone-map>Separate map</button>
      <button type="button" class="danger" data-context-delete-map>Delete map…</button>
    </div>
  </div>`;
}

export function renderProjectModalBody(editor, esc, tab, getBuilders = () => ({})) {
  const builders = typeof getBuilders === 'function' ? getBuilders() : getBuilders;
  if (tab === 'layout') {
    return `<div class="map-project-layout-tab">
      ${layoutGridHtml(editor, esc, editor.project?.maps || [])}
    </div>`;
  }
  if (tab === 'files') {
    return `<div class="map-project-files-panel">
      <p class="hint">Every .owmap in the maps folder. Files not yet in the project are listed under Other map files, where they can be added as separated maps.</p>
      ${builders.filesHtml?.() || '<p class="hint">No files listed.</p>'}
    </div>`;
  }
  if (tab === 'project') {
    return `<div class="map-project-settings-panel">
      ${builders.projectHtml?.() || ''}
    </div>`;
  }
  if (tab === 'visuals') {
    return `<div class="map-project-visuals-panel">
      ${editor.map ? (builders.visualsHtml?.() || '<p class="hint">Load a map to edit visuals.</p>') : '<p class="hint">Open a map in the editor to adjust terrain visuals.</p>'}
    </div>`;
  }
  return '';
}

function paintThumbsIn(root, editor) {
  if (!root) return;
  root.querySelectorAll('[data-plan-thumb]').forEach((canvas) => {
    const file = canvas.dataset.planThumb;
    if (!file) return;
    const isCurrent = editor?.map && (
      file === editor.currentFile
      || editor.project?.maps?.some((entry) => entry.file === file && entry.id === editor.map.id)
    );
    if (isCurrent) {
      drawMapPlanThumb(canvas, editor.map, { showCollision: true, edgeToEdge: true });
      return;
    }
    paintMapPlanThumb(canvas, file, { showCollision: true, edgeToEdge: true });
  });
}

export function syncProjectModal(editor, esc, getBuilders) {
  const host = document.getElementById('mapProjectModalHost');
  if (!host || host.classList.contains('hidden')) return;
  const tab = editor.projectModalTab || 'layout';
  const body = host.querySelector('#mapProjectModalBody');
  if (!body) return;
  const lede = host.querySelector('#mapProjectModalLede');
  if (lede) {
    lede.textContent = `${editor.project?.name || 'Project'} · ${(editor.project?.maps || []).length} maps · ${linkedMaps(editor.project).length} connected · ${separatedMaps(editor.project).length} separated`;
  }
  body.innerHTML = renderProjectModalBody(editor, esc, tab, getBuilders);
  host.querySelectorAll('.map-project-modal-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.projectModalTab === tab);
  });
  paintThumbsIn(body, editor);
  editor._bindProjectMapSurface?.();
}

async function deleteMapFile(fileName) {
  const res = await fetch('/api/maps/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload.ok) throw new Error(payload.error || 'Could not delete map file.');
}

function removeMapEntry(editor, mapId, { deleteFile = false } = {}) {
  const entry = editor.project?.maps?.find((m) => m.id === mapId);
  if (!entry || !editor.project) return null;
  editor.project.maps = editor.project.maps.filter((m) => m.id !== mapId);
  if (editor.project.editor?.activeMapId === mapId) {
    editor.project.editor.activeMapId = editor.project.maps[0]?.id || '';
  }
  const wasCurrent = editor.map?.id === mapId || editor.currentFile === entry.file;
  editor.projectDirty = true;
  clearMapPlanThumbCache(entry.file);
  return { entry, wasCurrent, deleteFile };
}

export function bindProjectModal(state, deps, getBuilders) {
  const { render, log, esc } = deps;
  const editor = deps.ensureMapEditorState(state);
  const host = ensureProjectModalHost();

  if (!editor.projectModalHostReady) {
    editor.projectModalHostReady = true;

    const close = () => {
      editor.projectModalOpen = false;
      host.classList.add('hidden');
      render();
    };

    host.querySelector('#mapProjectModalClose')?.addEventListener('click', close);
    host.querySelector('#mapProjectModalDone')?.addEventListener('click', close);
    host.addEventListener('click', (e) => { if (e.target === host) close(); });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && editor.projectModalOpen) close();
    });

    host.addEventListener('click', async (e) => {
      const tabBtn = e.target.closest('[data-project-modal-tab]');
      if (tabBtn) {
        editor.projectModalTab = tabBtn.dataset.projectModalTab;
        syncProjectModal(editor, esc, getBuilders);
        if (editor.projectModalTab === 'visuals' || editor.projectModalTab === 'project') {
          deps.bindTerrainVisualInputs?.(state, deps, host);
          deps.bindProjectPanelInputs?.(state, deps, host);
        }
        return;
      }

      const saveBtn = e.target.closest('#mapProjectSaveProject');
      if (saveBtn) {
        try {
          deps.syncProjectFromEditor?.(editor);
          await deps.saveProject?.(editor);
          log('Project saved.', 'ok');
          syncProjectModal(editor, esc, getBuilders);
        } catch (err) {
          log(err.message || 'Save failed.', 'error');
        }
        return;
      }

      const removeAllBtn = e.target.closest('#mapProjectRemoveAll');
      if (removeAllBtn) {
        const count = editor.project?.maps?.length || 0;
        if (!count) return;
        const alsoFiles = Boolean(host.querySelector('#mapProjectDeleteFiles')?.checked);
        const msg = alsoFiles
          ? `Remove all ${count} maps from this project and delete their .owmap files? This cannot be undone.`
          : `Remove all ${count} maps from this project? Map files will stay on disk.`;
        if (!window.confirm(msg)) return;
        const files = [...(editor.project.maps || [])].map((m) => m.file);
        editor.project.maps = [];
        editor.project.editor.activeMapId = '';
        editor.map = null;
        editor.currentFile = '';
        editor.dirty = false;
        editor.projectDirty = true;
        if (alsoFiles) {
          for (const file of files) {
            try { await deleteMapFile(file); clearMapPlanThumbCache(file); } catch (err) { log(err.message, 'error'); }
          }
          editor.files = (editor.files || []).filter((file) => !files.includes(file.name));
        }
        await deps.saveProject?.(editor);
        log('All maps removed from project.', 'ok');
        syncProjectModal(editor, esc, getBuilders);
        render();
        return;
      }

      const delBtn = e.target.closest('[data-delete-project-map]');
      if (delBtn) {
        e.stopPropagation();
        const id = delBtn.dataset.deleteProjectMap;
        const alsoFile = Boolean(host.querySelector('#mapProjectDeleteFiles')?.checked);
        const entry = editor.project?.maps?.find((m) => m.id === id);
        if (!entry) return;
        const msg = alsoFile
          ? `Remove "${entry.name || entry.id}" and delete ${entry.file}?`
          : `Remove "${entry.name || entry.id}" from the project?`;
        if (!window.confirm(msg)) return;
        const result = removeMapEntry(editor, id);
        if (alsoFile && result?.entry?.file) {
          try { await deleteMapFile(result.entry.file); } catch (err) { log(err.message, 'error'); }
          editor.files = (editor.files || []).filter((file) => file.name !== result.entry.file);
        }
        if (result?.wasCurrent) {
          editor.map = null;
          editor.currentFile = '';
          editor.dirty = false;
        }
        await deps.saveProject?.(editor);
        log(`Removed ${entry.name || entry.id}.`, 'ok');
        syncProjectModal(editor, esc, getBuilders);
        render();
        return;
      }

      const contextMenu = host.querySelector('#mapLayoutContextMenu');
      const contextMapId = contextMenu?.dataset.mapId;
      const contextOpen = e.target.closest('[data-context-open-map]');
      if (contextOpen && contextMapId) {
        const entry = editor.project?.maps?.find((m) => m.id === contextMapId);
        if (!entry?.file) return;
        try {
          await deps.loadMapFileIntoEditor?.(state, deps, entry.file);
          editor.projectModalOpen = false;
          host.classList.add('hidden');
          render();
        } catch (err) {
          log(err.message || 'Could not open map.', 'error');
        }
        return;
      }

      const contextStandalone = e.target.closest('[data-context-standalone-map]');
      if (contextStandalone && contextMapId) {
        const entry = editor.project?.maps?.find((m) => m.id === contextMapId);
        if (!entry) return;
        entry.linked = false;
        editor.projectDirty = true;
        syncProjectModal(editor, esc, getBuilders);
        return;
      }

      const contextDelete = e.target.closest('[data-context-delete-map]');
      if (contextDelete && contextMapId) {
        const entry = editor.project?.maps?.find((m) => m.id === contextMapId);
        if (!entry) return;
        if (!window.confirm(`Delete "${entry.name || entry.id}" and its file ${entry.file}? This cannot be undone.`)) return;
        const result = removeMapEntry(editor, contextMapId);
        try {
          await deleteMapFile(entry.file);
          editor.files = (editor.files || []).filter((file) => file.name !== entry.file);
        } catch (err) {
          log(err.message || 'Could not delete map file.', 'error');
        }
        if (result?.wasCurrent) {
          editor.map = null;
          editor.currentFile = '';
          editor.dirty = false;
        }
        await deps.saveProject?.(editor);
        log(`Deleted ${entry.name || entry.id}.`, 'ok');
        syncProjectModal(editor, esc, getBuilders);
        render();
        return;
      }

      const unlinkBtn = e.target.closest('[data-unlink-map]');
      if (unlinkBtn) {
        e.stopPropagation();
        const entry = editor.project?.maps?.find((m) => m.id === unlinkBtn.dataset.unlinkMap);
        if (!entry) return;
        entry.linked = false;
        editor.projectDirty = true;
        syncProjectModal(editor, esc, getBuilders);
        return;
      }

      const fileBtn = e.target.closest('[data-map-file]');
      if (fileBtn) {
        const file = fileBtn.dataset.mapFile;
        if (!file) return;
        try {
          await deps.loadMapFileIntoEditor?.(state, deps, file);
          editor.projectModalOpen = false;
          host.classList.add('hidden');
          render();
        } catch { /* logged elsewhere */ }
        return;
      }

      const addOrphan = e.target.closest('[data-add-orphan-map]');
      if (addOrphan) {
        const file = addOrphan.dataset.addOrphanMap;
        if (!file || !editor.project) return;
        const id = file.replace(/\.owmap$/i, '');
        if (editor.project.maps.some((m) => m.file === file)) return;
        editor.project.maps.push({
          id,
          name: id.replace(/_/g, ' '),
          file,
          gridX: 0,
          gridY: 0,
          linked: false,
        });
        editor.projectDirty = true;
        syncProjectModal(editor, esc, getBuilders);
        log(`Added ${file} as a separated map.`, 'ok');
        return;
      }

      const addBlank = e.target.closest('#mapLayoutAddBlank');
      if (addBlank) {
        deps.onNewBlankMap?.(state, deps);
        editor.projectModalTab = 'layout';
        syncProjectModal(editor, esc, getBuilders);
      }
    });

    host.addEventListener('change', (e) => {
      const nameInput = e.target.closest('[data-project-map-name]');
      if (!nameInput) return;
      const entry = editor.project?.maps?.find((m) => m.id === nameInput.dataset.projectMapName);
      if (!entry) return;
      entry.name = nameInput.value.trim() || entry.id;
      if (editor.map && (editor.map.id === entry.id || editor.currentFile === entry.file)) {
        editor.map.name = entry.name;
      }
      editor.projectDirty = true;
    });

    editor._bindProjectMapSurface = () => {
      const canvas = host.querySelector('#mapLayoutCanvas');
      if (!canvas) return;
      bindLayoutDrag(canvas, editor, () => {
        editor.projectDirty = true;
        syncProjectModal(editor, esc, getBuilders);
      });
    };

    editor._openProjectModal = async () => {
      editor.projectModalOpen = true;
      editor.projectModalTab = editor.projectModalTab || 'layout';
      host.classList.remove('hidden');
      clearMapPlanThumbCache();
      try {
        const listing = await fetch('/api/maps/list').then((r) => r.json()).catch(() => null);
        if (listing?.ok) {
          editor.files = listing.files || [];
          editor.resolvedPath = listing.base || editor.resolvedPath;
          editor.settings = listing.settings || editor.settings;
        }
        const added = deps.syncDiskMapsIntoProject?.(editor) || [];
        if (added.length) {
          log(`Found ${added.length} map file${added.length === 1 ? '' : 's'} on disk and added as separated.`, 'ok');
        }
        await deps.refreshProjectMapDimensions?.(editor);
      } catch { /* keep modal usable */ }
      syncProjectModal(editor, esc, getBuilders);
      deps.bindProjectPanelInputs?.(state, deps, host);
      deps.bindTerrainVisualInputs?.(state, deps, host);
    };

    editor._closeProjectModal = () => {
      editor.projectModalOpen = false;
      host.classList.add('hidden');
      render();
    };
  }

  // bindMapEditor creates a fresh dependency object after every workbench render.
  // Keep the controller with the persistent editor state and expose it to each
  // new dependency object so the Project & maps button continues to work.
  deps.openProjectModal = editor._openProjectModal;
  deps.closeProjectModal = editor._closeProjectModal;
}

export function findMapSnap(moving, candidates, maxDistance = MAP_LAYOUT_SNAP_DISTANCE) {
  const placements = [];
  for (const candidate of candidates || []) {
    placements.push(
      {
        candidate,
        direction: 'east',
        left: candidate.left + candidate.width,
        top: candidate.top,
        gridX: candidate.gridX + 1,
        gridY: candidate.gridY,
      },
      {
        candidate,
        direction: 'west',
        left: candidate.left - moving.width,
        top: candidate.top,
        gridX: candidate.gridX - 1,
        gridY: candidate.gridY,
      },
      {
        candidate,
        direction: 'south',
        left: candidate.left,
        top: candidate.top + candidate.height,
        gridX: candidate.gridX,
        gridY: candidate.gridY + 1,
      },
      {
        candidate,
        direction: 'north',
        left: candidate.left,
        top: candidate.top - moving.height,
        gridX: candidate.gridX,
        gridY: candidate.gridY - 1,
      },
    );
  }
  const nearest = placements
    .map((placement) => ({
      ...placement,
      distance: Math.hypot(moving.left - placement.left, moving.top - placement.top),
    }))
    .sort((a, b) => a.distance - b.distance)[0];
  return nearest && nearest.distance <= maxDistance ? nearest : null;
}

function bindLayoutDrag(canvas, editor, onMoved) {
  if (canvas.dataset.dragBound === '1') return;
  canvas.dataset.dragBound = '1';
  const viewport = canvas.closest('#mapLayoutViewport');
  if (!viewport) return;
  const contextMenu = viewport.querySelector('#mapLayoutContextMenu');
  const view = editor.projectMapView || (editor.projectMapView = { zoom: 1, panX: null, panY: null });
  let gesture = null;

  const applyView = () => {
    canvas.style.transform = `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`;
  };
  const centerView = () => {
    const cards = [...canvas.querySelectorAll('.map-layout-card')];
    if (!cards.length) {
      view.zoom = 1;
      view.panX = viewport.clientWidth / 2 - MAP_WORLD_ORIGIN_X;
      view.panY = viewport.clientHeight / 2 - MAP_WORLD_ORIGIN_Y;
      applyView();
      return;
    }
    const minX = Math.min(...cards.map((card) => parseFloat(card.style.left) || 0));
    const minY = Math.min(...cards.map((card) => parseFloat(card.style.top) || 0));
    const maxX = Math.max(...cards.map((card) => (parseFloat(card.style.left) || 0) + card.offsetWidth));
    const maxY = Math.max(...cards.map((card) => (parseFloat(card.style.top) || 0) + card.offsetHeight));
    const contentW = Math.max(1, maxX - minX);
    const contentH = Math.max(1, maxY - minY);
    view.zoom = Math.max(0.35, Math.min(1.5,
      (viewport.clientWidth - 140) / contentW,
      (viewport.clientHeight - 140) / contentH));
    view.panX = viewport.clientWidth / 2 - ((minX + maxX) / 2) * view.zoom;
    view.panY = viewport.clientHeight / 2 - ((minY + maxY) / 2) * view.zoom;
    applyView();
  };
  if (!Number.isFinite(view.panX) || !Number.isFinite(view.panY)) centerView();
  else applyView();

  const hideContextMenu = () => {
    contextMenu?.classList.add('hidden');
    if (contextMenu) delete contextMenu.dataset.mapId;
  };

  viewport.addEventListener('contextmenu', (event) => {
    const card = event.target.closest('.map-layout-card');
    if (!card || !contextMenu) return;
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    contextMenu.dataset.mapId = card.dataset.layoutMap;
    contextMenu.style.left = `${Math.min(event.clientX - rect.left, rect.width - 190)}px`;
    contextMenu.style.top = `${Math.min(event.clientY - rect.top, rect.height - 120)}px`;
    contextMenu.classList.remove('hidden');
  });

  viewport.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.map-layout-context')) return;
    if (event.button !== 0 && event.button !== 1) return;
    hideContextMenu();
    const card = event.target.closest('.map-layout-card');
    if (card && event.button === 0) {
      const map = editor.project?.maps?.find((m) => m.id === card.dataset.layoutMap);
      if (!map) return;
      gesture = {
        mode: 'map',
        pointerId: event.pointerId,
        card,
        map,
        startX: event.clientX,
        startY: event.clientY,
        startLeft: parseFloat(card.style.left) || 0,
        startTop: parseFloat(card.style.top) || 0,
        originGX: map.gridX,
        originGY: map.gridY,
        snap: null,
      };
      card.classList.add('is-dragging');
    } else {
      gesture = {
        mode: 'pan',
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startPanX: view.panX,
        startPanY: view.panY,
      };
      viewport.classList.add('is-panning');
    }
    viewport.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });

  viewport.addEventListener('pointermove', (event) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (gesture.mode === 'pan') {
      view.panX = gesture.startPanX + dx;
      view.panY = gesture.startPanY + dy;
      applyView();
      return;
    }
    const moving = {
      left: gesture.startLeft + dx / view.zoom,
      top: gesture.startTop + dy / view.zoom,
      width: gesture.card.offsetWidth,
      height: gesture.card.offsetHeight,
    };
    const candidates = [...canvas.querySelectorAll('.map-layout-card')]
      .filter((card) => card !== gesture.card)
      .map((card) => {
        const map = editor.project?.maps?.find((entry) => entry.id === card.dataset.layoutMap);
        return {
          card,
          left: parseFloat(card.style.left) || 0,
          top: parseFloat(card.style.top) || 0,
          width: card.offsetWidth,
          height: card.offsetHeight,
          map,
          gridX: map?.gridX || 0,
          gridY: map?.gridY || 0,
        };
      });
    canvas.querySelectorAll('.map-layout-card.is-snap-target').forEach((card) => card.classList.remove('is-snap-target'));
    gesture.snap = findMapSnap(moving, candidates);
    if (gesture.snap) gesture.snap.candidate.card.classList.add('is-snap-target');
    gesture.card.style.left = `${gesture.snap?.left ?? moving.left}px`;
    gesture.card.style.top = `${gesture.snap?.top ?? moving.top}px`;
  });

  viewport.addEventListener('pointerup', (event) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    viewport.classList.remove('is-panning');
    if (gesture.mode === 'map') {
      gesture.card.classList.remove('is-dragging');
      canvas.querySelectorAll('.map-layout-card.is-snap-target').forEach((card) => card.classList.remove('is-snap-target'));
      const dx = event.clientX - gesture.startX;
      const dy = event.clientY - gesture.startY;
      if (Math.abs(dx) + Math.abs(dy) >= 5) {
        if (!gesture.snap) {
          gesture.map.linked = false;
        } else {
          const occupant = linkedMaps(editor.project).find(
            (map) => map.id !== gesture.map.id
              && map.gridX === gesture.snap.gridX
              && map.gridY === gesture.snap.gridY,
          );
          if (occupant) {
            occupant.gridX = gesture.originGX;
            occupant.gridY = gesture.originGY;
          }
          gesture.snap.candidate.map.linked = true;
          gesture.map.linked = true;
          gesture.map.gridX = gesture.snap.gridX;
          gesture.map.gridY = gesture.snap.gridY;
        }
        onMoved();
      }
    }
    gesture = null;
  });

  viewport.addEventListener('wheel', (event) => {
    event.preventDefault();
    hideContextMenu();
    const rect = viewport.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const worldX = (pointerX - view.panX) / view.zoom;
    const worldY = (pointerY - view.panY) / view.zoom;
    const nextZoom = Math.max(0.35, Math.min(2.5, view.zoom * (event.deltaY < 0 ? 1.12 : 0.89)));
    view.panX = pointerX - worldX * nextZoom;
    view.panY = pointerY - worldY * nextZoom;
    view.zoom = nextZoom;
    applyView();
  }, { passive: false });

  viewport.querySelectorAll('[data-map-view-zoom]').forEach((button) => {
    button.onclick = () => {
      const factor = button.dataset.mapViewZoom === 'in' ? 1.2 : 0.8;
      const centerX = viewport.clientWidth / 2;
      const centerY = viewport.clientHeight / 2;
      const worldX = (centerX - view.panX) / view.zoom;
      const worldY = (centerY - view.panY) / view.zoom;
      view.zoom = Math.max(0.35, Math.min(2.5, view.zoom * factor));
      view.panX = centerX - worldX * view.zoom;
      view.panY = centerY - worldY * view.zoom;
      applyView();
    };
  });
  const resetButton = viewport.querySelector('[data-map-view-reset]');
  if (resetButton) resetButton.onclick = centerView;
}

export function openProjectModal(state, deps, getBuilders) {
  deps.ensureMapEditorState(state);
  if (!deps.openProjectModal) bindProjectModal(state, deps, getBuilders);
  deps.openProjectModal();
}

export function isProjectModalOpen(editor) {
  return Boolean(editor?.projectModalOpen);
}
