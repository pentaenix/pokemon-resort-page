import { openAssetUploadModal } from './asset-upload.js';

const MODAL_ID = 'assetPickerModal';
const MEDIA_RE = /\.(png|jpe?g|webp|gif|svg|mp4|webm)$/i;

let activePicker = null;

function removePicker() {
  document.getElementById(MODAL_ID)?.remove();
  activePicker = null;
}

/** @param {string[]} assets */
export function getFolderContents(assets, folderPath = '') {
  const prefix = folderPath ? `${folderPath}/` : '';
  const subfolders = new Set();
  const files = [];
  for (const asset of assets) {
    if (folderPath && !asset.startsWith(prefix)) continue;
    const rest = folderPath ? asset.slice(prefix.length) : asset;
    const slash = rest.indexOf('/');
    if (slash === -1) {
      if (MEDIA_RE.test(rest)) files.push(asset);
      continue;
    }
    const top = rest.slice(0, slash);
    if (!folderPath && top) subfolders.add(top);
    else if (folderPath) subfolders.add(top);
  }
  return {
    subfolders: [...subfolders].sort((a, b) => a.localeCompare(b)),
    files: files.sort((a, b) => a.localeCompare(b)),
  };
}

/** @param {string[]} assets */
export function listTopFolders(assets) {
  const roots = new Set();
  for (const asset of assets) {
    const top = asset.split('/')[0];
    if (top) roots.add(top);
  }
  return [...roots].sort((a, b) => a.localeCompare(b));
}

/** @param {string[]} assets */
function allFolderPaths(assets) {
  const set = new Set(['']);
  for (const asset of assets) {
    const parts = asset.split('/');
    parts.pop();
    for (let i = 1; i <= parts.length; i += 1) {
      set.add(parts.slice(0, i).join('/'));
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function renderFolderTree(assets, currentFolder, esc) {
  return allFolderPaths(assets).map((folderPath) => {
    const depth = folderPath ? folderPath.split('/').length : 0;
    const label = folderPath ? `${folderPath.split('/').pop()}/` : 'All media';
    return `<button type="button" class="asset-picker-folder${currentFolder === folderPath ? ' active' : ''}" style="--depth:${depth}" data-picker-folder="${esc(folderPath)}">${esc(label)}</button>`;
  }).join('');
}

function renderGrid(assets, currentFolder, query, esc, adminAssetUrl) {
  const q = String(query || '').trim().toLowerCase();
  let subfolders = [];
  let files = [];
  if (q) {
    files = assets.filter((p) => p.toLowerCase().includes(q));
  } else {
    const contents = getFolderContents(assets, currentFolder);
    subfolders = contents.subfolders;
    files = contents.files;
  }

  const folderTiles = subfolders.map((name) => {
    const full = currentFolder ? `${currentFolder}/${name}` : name;
    return `<button type="button" class="asset-picker-tile asset-picker-tile--folder" data-picker-folder="${esc(full)}" title="${esc(full)}">
      <span class="asset-picker-folder-icon" aria-hidden="true">📁</span>
      <span class="asset-picker-tile-label">${esc(name)}</span>
    </button>`;
  }).join('');

  const fileTiles = files.map((path) => {
    const name = path.split('/').pop();
    const isVideo = /\.(mp4|webm)$/i.test(path);
    const media = isVideo
      ? `<span class="asset-picker-video-badge">MP4</span>`
      : `<img src="${esc(adminAssetUrl(path))}" alt="" loading="lazy" />`;
    return `<button type="button" class="asset-picker-tile asset-picker-tile--file" data-picker-select="${esc(path)}" title="${esc(path)}">
      ${media}
      <span class="asset-picker-tile-label">${esc(name)}</span>
    </button>`;
  }).join('');

  if (!folderTiles && !fileTiles) {
    return '<p class="hint asset-picker-empty">No images here yet — upload one above.</p>';
  }
  return `${folderTiles}${fileTiles}`;
}

/**
 * @param {object} opts
 * @param {Function} opts.esc
 * @param {Function} opts.adminAssetUrl
 * @param {() => string[]} opts.getAssets
 * @param {string} [opts.defaultFolder]
 * @param {string} [opts.uploadFolder]
 * @param {string} [opts.uploadSubdir]
 * @param {string} [opts.title]
 * @param {(path: string) => void|Promise<void>} opts.onSelect
 * @param {Function} [opts.log]
 * @param {Function} [opts.refreshAssets]
 */
export function openAssetPickerModal(opts) {
  const {
    esc,
    adminAssetUrl,
    getAssets,
    defaultFolder = 'media',
    uploadFolder = 'media/uploads',
    uploadSubdir = '',
    title = 'Choose image',
    onSelect,
    log = () => {},
    refreshAssets,
  } = opts || {};

  removePicker();

  let currentFolder = defaultFolder || 'media';
  let query = '';

  const assets = typeof getAssets === 'function' ? getAssets().filter((p) => MEDIA_RE.test(p)) : [];

  const html = `<div class="asset-picker-backdrop" id="${MODAL_ID}" role="dialog" aria-modal="true" aria-labelledby="assetPickerTitle">
    <div class="asset-picker-dialog panel">
      <header class="asset-picker-header">
        <div>
          <h3 id="assetPickerTitle">${esc(title)}</h3>
          <p class="hint asset-picker-path-hint" data-picker-path-hint>Browse <code>public/</code></p>
        </div>
        <div class="asset-picker-header-actions">
          <button type="button" class="btn small" data-picker-upload>Upload here</button>
          <button type="button" class="btn ghost small" data-picker-close aria-label="Close">×</button>
        </div>
      </header>
      <label class="asset-picker-search">Search all assets<input type="search" data-picker-search placeholder="Filter by filename or path…" autocomplete="off"></label>
      <div class="asset-picker-body">
        <nav class="asset-picker-folders" data-picker-folders aria-label="Folders"></nav>
        <div class="asset-picker-grid-wrap">
          <p class="hint asset-picker-breadcrumb" data-picker-breadcrumb></p>
          <div class="asset-picker-grid" data-picker-grid></div>
        </div>
      </div>
    </div>
  </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  const backdrop = document.getElementById(MODAL_ID);
  const foldersEl = backdrop.querySelector('[data-picker-folders]');
  const gridEl = backdrop.querySelector('[data-picker-grid]');
  const breadcrumbEl = backdrop.querySelector('[data-picker-breadcrumb]');
  const searchEl = backdrop.querySelector('[data-picker-search]');
  const pathHintEl = backdrop.querySelector('[data-picker-path-hint]');

  const close = () => removePicker();

  const paint = () => {
    const list = typeof getAssets === 'function' ? getAssets().filter((p) => MEDIA_RE.test(p)) : assets;
    foldersEl.innerHTML = renderFolderTree(list, query ? '' : currentFolder, esc);
    gridEl.innerHTML = renderGrid(list, query ? '' : currentFolder, query, esc, adminAssetUrl);
    breadcrumbEl.textContent = query
      ? `${list.filter((p) => p.toLowerCase().includes(query.toLowerCase())).length} matches`
      : currentFolder
        ? `public/${currentFolder}/`
        : 'public/ — all media';
    const uploadTarget = uploadSubdir ? `${uploadFolder}/${uploadSubdir}` : uploadFolder;
    pathHintEl.innerHTML = `Uploads go to <code>public/${esc(uploadTarget)}/</code>`;
  };

  const selectPath = async (path) => {
    if (!path) return;
    log(`Selected ${path}`, 'ok');
    if (typeof onSelect === 'function') await onSelect(path);
    close();
  };

  backdrop.querySelector('[data-picker-close]')?.addEventListener('click', close);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });

  backdrop.querySelector('[data-picker-upload]')?.addEventListener('click', () => {
    openAssetUploadModal({
      esc,
      log,
      folder: uploadFolder,
      subdir: uploadSubdir,
      title: 'Upload image',
      refreshAssets,
      onSuccess: async (path) => {
        if (typeof refreshAssets === 'function') { /* list refreshed by upload */ }
        paint();
        await selectPath(path);
      },
    });
  });

  searchEl?.addEventListener('input', () => {
    query = searchEl.value;
    paint();
  });

  backdrop.addEventListener('click', (event) => {
    const folderBtn = event.target.closest('[data-picker-folder]');
    if (folderBtn) {
      event.preventDefault();
      currentFolder = folderBtn.dataset.pickerFolder || '';
      query = '';
      if (searchEl) searchEl.value = '';
      paint();
      return;
    }
    const selectBtn = event.target.closest('[data-picker-select]');
    if (selectBtn) {
      event.preventDefault();
      selectPath(selectBtn.dataset.pickerSelect);
    }
  });

  paint();
  activePicker = backdrop;
  searchEl?.focus();
}
