export function vectorFieldHtml(field, mod, common, esc) {
  const labels = mod.components || ['X', 'Y (height)', 'Z'];
  const values = Array.isArray(field.value) ? field.value : [];
  return `<div class="data-vector-field" data-vector-field>${labels.map((label, index) =>
    `<label><span>${esc(label)}</span><input type="number" step="${esc(mod.step ?? 0.01)}" value="${esc(values[index] ?? 0)}" data-vector-component="${index}" aria-label="${esc(`${mod.label || field.path}: ${label}`)}"></label>`
  ).join('')}<input type="hidden" ${common} data-json-editor value="${esc(JSON.stringify(values))}"></div>`;
}

export function bindVectorFields(root = document) {
  root.querySelectorAll('[data-vector-field]').forEach((wrap) => {
    const target = wrap.querySelector('[data-data-field]');
    wrap.querySelectorAll('[data-vector-component]').forEach((input) => {
      input.oninput = () => {
        const controls = [...wrap.querySelectorAll('[data-vector-component]')];
        if (controls.some((control) => control.value === '' || control.validity.badInput)) return;
        const values = controls.map((control) => Number(control.value));
        if (values.some((value) => !Number.isFinite(value))) return;
        target.value = JSON.stringify(values);
        target.dispatchEvent(new Event('input', { bubbles: true }));
      };
    });
  });
}
