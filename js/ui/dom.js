// Tiny DOM helpers. All user-provided text is inserted with textContent (never innerHTML).

/**
 * Create an element. `props` may include: class, text, html (trusted, static markup only),
 * style, dataset, on: {event: handler}, attrs: {...}, and any DOM property.
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === 'attrs') for (const [a, av] of Object.entries(v)) el.setAttribute(a, av);
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const MINUS = '−';

export function money(x, { decimals = 0, sign = false, compact = false } = {}) {
  if (!Number.isFinite(x)) return '—';
  const neg = x < -1e-9;
  const a = Math.abs(x);
  let body;
  if (compact && a >= 1e6) body = `${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  else if (compact && a >= 1e4) body = `${(a / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K`;
  else body = a.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${neg ? MINUS : sign && x > 1e-9 ? '+' : ''}$${body}`;
}

export const pct = (x, d = 1) => (Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : '—');
export const num = (x, d = 0) => (Number.isFinite(x) ? x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');

export function formatValue(x, kind) {
  switch (kind) {
    case 'money': return money(x);
    case 'money2': return money(x, { decimals: 2 });
    case 'pct': return pct(x, 1);
    case 'pctEdge': return pct(x, 2);
    case 'score': return num(x, 1);
    case 'num2': return num(x, 2);
    default: return num(x, 2);
  }
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

export function toast(message, kind = 'info', ms = 3200) {
  let host = $('#toasts');
  if (!host) { host = h('div', { id: 'toasts', attrs: { 'aria-live': 'polite' } }); document.body.append(host); }
  const icon = { info: 'ℹ', good: '✓', warn: '!', bad: '✕' }[kind] || 'ℹ';
  const t = h('div', { class: `toast toast-${kind}` }, h('span', { class: 'toast-icon', text: icon }), h('span', { text: message }));
  host.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}

// ---------------------------------------------------------------------------
// Form helpers
// ---------------------------------------------------------------------------

export function field(label, control, hint) {
  return h('label', { class: 'field' },
    h('span', { class: 'field-label', text: label }),
    control,
    hint ? h('span', { class: 'field-hint', text: hint }) : null);
}

export function numberInput(value, onChange, { min = 0, max, step = 1, width } = {}) {
  const el = h('input', { type: 'number', value: String(value ?? 0), min: String(min), step: String(step), inputMode: 'decimal' });
  if (max !== undefined) el.max = String(max);
  if (width) el.style.width = width;
  el.addEventListener('input', () => onChange(el.value === '' ? 0 : +el.value));
  return el;
}

export function select(options, value, onChange) {
  const el = h('select');
  for (const o of options) {
    const opt = h('option', { value: String(o.value), text: o.label });
    if (String(o.value) === String(value)) opt.selected = true;
    el.append(opt);
  }
  el.addEventListener('change', () => onChange(el.value));
  return el;
}

export function checkbox(label, checked, onChange) {
  const input = h('input', { type: 'checkbox', checked: !!checked });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'check' }, input, h('span', { text: label }));
}

export function download(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

/** Info tooltip "ⓘ" that explains a metric (title + accessible label). */
export function info(text) {
  return h('span', { class: 'info', tabIndex: 0, title: text, attrs: { 'aria-label': text, role: 'note' }, text: 'ⓘ' });
}
