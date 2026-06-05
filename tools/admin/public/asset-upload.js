const MODAL_ID = 'assetUploadModal';
const ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,.svg,.mp4,.webm,image/*,video/mp4,video/webm';

let activeModal = null;

function removeModal() {
  document.getElementById(MODAL_ID)?.remove();
  activeModal = null;
}

function formatTargetLabel(folder, subdir) {
  const base = String(folder || 'media/uploads').replace(/\/$/, '');
  const extra = String(subdir || '').trim().replace(/^\/+|\/+$/g, '');
  return extra ? `public/${base}/${extra}/` : `public/${base}/`;
}

/**
 * @param {object} opts
 * @param {string} opts.folder Base folder under public/ (e.g. media/atlas)
 * @param {string} [opts.subdir] Optional nested folder (pin id, article slug, …)
 * @param {string} [opts.title]
 * @param {(path: string) => void|Promise<void>} opts.onSuccess
 * @param {Function} opts.esc
 * @param {Function} [opts.log]
 * @param {() => Promise<string[]|void>} [opts.refreshAssets]
 */
export function openAssetUploadModal(opts) {
  const {
    folder = 'media/uploads',
    subdir = '',
    title = 'Upload from your computer',
    onSuccess,
    esc,
    log = () => {},
    refreshAssets,
  } = opts || {};

  removeModal();

  const targetLabel = formatTargetLabel(folder, subdir);
  const html = `<div class="asset-upload-backdrop" id="${MODAL_ID}" role="dialog" aria-modal="true" aria-labelledby="assetUploadTitle">
    <div class="asset-upload-dialog panel">
      <header class="asset-upload-header">
        <h3 id="assetUploadTitle">${esc(title)}</h3>
        <button type="button" class="btn ghost small" data-asset-upload-close aria-label="Close">×</button>
      </header>
      <p class="hint">File is copied into <code>${esc(targetLabel)}</code> and the path is filled in for you.</p>
      <label class="asset-upload-drop">
        <input type="file" accept="${ACCEPT}" data-asset-upload-file hidden>
        <span class="asset-upload-drop-inner">
          <strong>Choose a file</strong>
          <span class="hint">PNG, JPG, WebP, GIF, SVG, MP4, WebM · max 50 MB</span>
          <span class="asset-upload-filename hint" data-asset-upload-name>No file selected</span>
        </span>
      </label>
      <div class="asset-upload-preview hidden" data-asset-upload-preview></div>
      <p class="hint asset-upload-error hidden" data-asset-upload-error></p>
      <div class="asset-upload-actions row">
        <button type="button" class="btn" data-asset-upload-submit disabled>Upload &amp; use</button>
        <button type="button" class="btn ghost" data-asset-upload-close>Cancel</button>
      </div>
    </div>
  </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  const backdrop = document.getElementById(MODAL_ID);
  const fileInput = backdrop.querySelector('[data-asset-upload-file]');
  const nameEl = backdrop.querySelector('[data-asset-upload-name]');
  const previewEl = backdrop.querySelector('[data-asset-upload-preview]');
  const errorEl = backdrop.querySelector('[data-asset-upload-error]');
  const submitBtn = backdrop.querySelector('[data-asset-upload-submit]');

  const setError = (msg) => {
    if (!errorEl) return;
    if (msg) {
      errorEl.textContent = msg;
      errorEl.classList.remove('hidden');
    } else {
      errorEl.textContent = '';
      errorEl.classList.add('hidden');
    }
  };

  const close = () => removeModal();

  backdrop.querySelectorAll('[data-asset-upload-close]').forEach((btn) => {
    btn.addEventListener('click', close);
  });
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });

  fileInput.addEventListener('change', () => {
    setError('');
    const file = fileInput.files?.[0];
    if (!file) {
      nameEl.textContent = 'No file selected';
      submitBtn.disabled = true;
      previewEl.classList.add('hidden');
      previewEl.innerHTML = '';
      return;
    }
    nameEl.textContent = file.name;
    submitBtn.disabled = false;
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      previewEl.innerHTML = `<img src="${url}" alt="" />`;
      previewEl.classList.remove('hidden');
      previewEl.querySelector('img')?.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
    } else {
      previewEl.innerHTML = `<span class="hint">Video: ${esc(file.name)}</span>`;
      previewEl.classList.remove('hidden');
    }
  });

  submitBtn.addEventListener('click', async () => {
    const file = fileInput.files?.[0];
    if (!file) {
      setError('Pick a file first.');
      return;
    }
    setError('');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Uploading…';
    try {
      const body = new FormData();
      body.append('file', file, file.name);
      body.append('folder', folder);
      if (subdir) body.append('subdir', subdir);
      const response = await fetch('/api/assets/upload', { method: 'POST', body });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || `Upload failed (HTTP ${response.status})`);
      }
      if (typeof refreshAssets === 'function' && payload.assets) {
        await refreshAssets(payload.assets);
      }
      log(`Uploaded ${payload.path}`, 'ok');
      if (typeof onSuccess === 'function') await onSuccess(payload.path);
      close();
    } catch (error) {
      setError(error.message || 'Upload failed.');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Upload & use';
      log(error.message || 'Upload failed.', 'error');
    }
  });

  activeModal = backdrop;
  fileInput.click();
}
