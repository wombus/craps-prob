// Dependency-free SVG charts.
//
// Conventions (from the data-viz method this app follows):
//  • thin marks: 2px lines, ≤24px bars with 4px rounded data-ends, ≥8px dots with a 2px surface ring
//  • hairline, solid, recessive gridlines; one y-axis per chart
//  • a legend for ≥2 series; selective direct labels; text in ink colors, never series colors
//  • every chart has a hover layer (crosshair for lines, per-mark for bars/dots)

import { h } from './dom.js';
import { niceStep } from '../engine/stats.js';

const NS = 'http://www.w3.org/2000/svg';
const INK = { primary: '#f0efec', secondary: '#c3c2b7', muted: '#898781', grid: '#2c2c2a', axis: '#383835', surface: '#1a1a19' };

function s(tag, attrs = {}, parent) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, v);
  if (parent) parent.appendChild(el);
  return el;
}
function text(parent, x, y, str, attrs = {}) {
  const t = s('text', { x, y, fill: INK.muted, 'font-size': 11, ...attrs }, parent);
  t.textContent = str;
  return t;
}

export function scale(d0, d1, r0, r1) {
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  const f = (v) => r0 + (v - d0) * k;
  f.invert = (p) => (k === 0 ? d0 : d0 + (p - r0) / k);
  return f;
}

export function niceDomain(min, max, count = 5, includeZero = false) {
  if (includeZero) { min = Math.min(0, min); max = Math.max(0, max); }
  if (!(max > min)) { const pad = Math.abs(min) * 0.1 || 1; min -= pad; max += pad; }
  const step = niceStep((max - min) / count);
  const lo = Math.floor(min / step + 1e-9) * step;
  const hi = Math.ceil(max / step - 1e-9) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step * 1e-6; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return { lo, hi, ticks, step };
}

// ---------------------------------------------------------------------------
// Tooltip (one shared element)
// ---------------------------------------------------------------------------

let tipEl = null;
function tip() {
  if (!tipEl) { tipEl = h('div', { class: 'chart-tip', attrs: { role: 'tooltip' } }); document.body.append(tipEl); }
  return tipEl;
}
/**
 * @param {{title?:string, rows:{color?:string, value:string, label:string, key?:'line'|'rect'|'dot'}[]}} content
 */
export function showTip(content, clientX, clientY) {
  const t = tip();
  t.replaceChildren();
  if (content.title) t.append(h('div', { class: 'tip-title', text: content.title }));
  for (const r of content.rows) {
    const key = r.color ? h('span', { class: `tip-key tip-key-${r.key || 'line'}`, style: { background: r.color } }) : h('span', { class: 'tip-key-empty' });
    t.append(h('div', { class: 'tip-row' }, key, h('strong', { text: r.value }), h('span', { class: 'tip-label', text: r.label })));
  }
  t.style.display = 'block';
  const w = t.offsetWidth, ht = t.offsetHeight;
  let x = clientX + 14, y = clientY + 14;
  if (x + w > window.innerWidth - 8) x = clientX - w - 14;
  if (y + ht > window.innerHeight - 8) y = clientY - ht - 14;
  t.style.left = `${Math.max(4, x)}px`;
  t.style.top = `${Math.max(4, y)}px`;
}
export function hideTip() { if (tipEl) tipEl.style.display = 'none'; }

// ---------------------------------------------------------------------------
// Mounting with responsive re-render
// ---------------------------------------------------------------------------

const observers = new WeakMap();
/** Render `draw(width)` into `container` now and whenever it is resized. */
export function mount(container, draw) {
  container._draw = draw;
  renderInto(container, true);
  if (!observers.has(container) && typeof ResizeObserver !== 'undefined') {
    let raf = 0;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => renderInto(container, false)); });
    ro.observe(container);
    observers.set(container, ro);
  }
}

function renderInto(container, force) {
  if (!container._draw || !container.isConnected) return;
  const w = Math.max(280, Math.floor(container.clientWidth || 600));
  if (!force && container._lastW === w) return;
  container._lastW = w;
  container.replaceChildren(container._draw(w));
}

export function legend(items) {
  return h('div', { class: 'legend' }, items.map((it) => h('span', { class: 'legend-item' },
    h('span', { class: `legend-key legend-key-${it.kind || 'line'}`, style: { background: it.color } }),
    h('span', { text: it.name }))));
}

function frame(width, height, m) {
  const svg = s('svg', { width, height, viewBox: `0 0 ${width} ${height}`, class: 'chart-svg', role: 'img' });
  const iw = width - m.l - m.r, ih = height - m.t - m.b;
  const g = s('g', { transform: `translate(${m.l},${m.t})` }, svg);
  return { svg, g, iw, ih };
}

function yAxis(g, y, ticks, iw, fmt) {
  for (const t of ticks) {
    const py = y(t);
    s('line', { x1: 0, x2: iw, y1: py, y2: py, stroke: t === 0 ? INK.axis : INK.grid, 'stroke-width': 1, 'shape-rendering': 'crispEdges' }, g);
    text(g, -8, py + 4, fmt(t), { 'text-anchor': 'end', class: 'tnum' });
  }
}
function xAxis(g, x, ticks, ih, fmt) {
  s('line', { x1: 0, x2: x.range1, y1: ih, y2: ih, stroke: INK.axis, 'stroke-width': 1, 'shape-rendering': 'crispEdges' }, g);
  let prev = null;
  for (const t of ticks) {
    const label = fmt(t);
    if (label === prev) continue; // e.g. fractional ticks that round to the same integer
    prev = label;
    text(g, x(t), ih + 16, label, { 'text-anchor': 'middle', class: 'tnum' });
  }
}
function axisTitle(svg, str, x, y, rotate = false) {
  if (!str) return;
  text(svg, x, y, str, { 'text-anchor': 'middle', fill: INK.muted, 'font-size': 11, transform: rotate ? `rotate(-90 ${x} ${y})` : undefined });
}

function pathD(xs, ys) {
  let d = '';
  for (let i = 0; i < xs.length; i++) d += `${i ? 'L' : 'M'}${xs[i].toFixed(1)},${ys[i].toFixed(1)}`;
  return d;
}

// ---------------------------------------------------------------------------
// Line chart (+ optional percentile bands): trajectories over games played
// ---------------------------------------------------------------------------

/**
 * @param {object} o
 * @param {{name:string,color:string,x:number[],y:number[],width?:number,opacity?:number,muted?:boolean,noTip?:boolean}[]} o.series
 * @param {{color:string,x:number[],lo:number[],hi:number[],opacity?:number,name?:string}[]} [o.bands]
 */
export function lineChart(o) {
  return (width) => {
    const height = o.height || 280;
    const m = { l: 64, r: o.endLabels ? 120 : 16, t: 12, b: 40 };
    const { svg, g, iw, ih } = frame(width, height, m);
    const xs = o.series[0]?.x || o.bands?.[0]?.x || [0, 1];
    let ymin = Infinity, ymax = -Infinity;
    for (const se of o.series) for (const v of se.y) { if (v < ymin) ymin = v; if (v > ymax) ymax = v; }
    for (const b of o.bands || []) { for (const v of b.lo) ymin = Math.min(ymin, v); for (const v of b.hi) ymax = Math.max(ymax, v); }
    if (o.refY !== undefined) { ymin = Math.min(ymin, o.refY); ymax = Math.max(ymax, o.refY); }
    const yd = niceDomain(ymin, ymax, 5);
    const x = scale(xs[0], xs[xs.length - 1], 0, iw); x.range1 = iw;
    const y = scale(yd.lo, yd.hi, ih, 0);
    yAxis(g, y, yd.ticks, iw, o.yFormat || String);
    const xd = niceDomain(xs[0], xs[xs.length - 1], Math.max(2, Math.floor(iw / 90)));
    xAxis(g, x, xd.ticks.filter((t) => t >= xs[0] && t <= xs[xs.length - 1]), ih, o.xFormat || String);
    axisTitle(svg, o.xTitle, m.l + iw / 2, height - 4);
    axisTitle(svg, o.yTitle, 12, m.t + ih / 2, true);

    if (o.refY !== undefined) {
      s('line', { x1: 0, x2: iw, y1: y(o.refY), y2: y(o.refY), stroke: INK.secondary, 'stroke-width': 1, opacity: 0.6 }, g);
      if (o.refLabel) text(g, 4, y(o.refY) - 5, o.refLabel, { fill: INK.secondary });
    }
    for (const b of o.bands || []) {
      const top = b.x.map((v) => x(v)), hiY = b.hi.map((v) => y(v)), loY = b.lo.map((v) => y(v));
      const d = pathD(top, hiY) + pathD([...top].reverse(), [...loY].reverse()).replace(/^M/, 'L') + 'Z';
      s('path', { d, fill: b.color, opacity: b.opacity ?? 0.12, stroke: 'none' }, g);
    }
    const drawn = [];
    for (const se of o.series) {
      const px = se.x.map((v) => x(v)), py = se.y.map((v) => y(v));
      s('path', { d: pathD(px, py), fill: 'none', stroke: se.color, 'stroke-width': se.width || 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: se.opacity ?? 1 }, g);
      if (!se.muted) drawn.push({ se, px, py });
    }
    if (o.endLabels) {
      // Direct end labels with leader lines; collisions resolved by spacing the labels, keeping leaders.
      const labs = drawn.map((d) => ({ name: d.se.name, color: d.se.color, y0: d.py[d.py.length - 1], x0: d.px[d.px.length - 1] })).sort((a, b) => a.y0 - b.y0);
      let last = -Infinity;
      for (const l of labs) { l.y = Math.max(l.y0, last + 13); last = l.y; }
      const over = last - ih; if (over > 0) for (const l of labs) l.y -= over;
      for (const l of labs) {
        s('line', { x1: l.x0 + 2, x2: iw + 10, y1: l.y0, y2: l.y, stroke: l.color, 'stroke-width': 1, opacity: 0.7 }, g);
        s('circle', { cx: l.x0, cy: l.y0, r: 4, fill: l.color, stroke: INK.surface, 'stroke-width': 2 }, g);
        text(g, iw + 14, l.y + 4, truncate(l.name, 16), { fill: INK.secondary });
      }
    }
    // Hover crosshair
    const cross = s('line', { y1: 0, y2: ih, stroke: INK.secondary, 'stroke-width': 1, opacity: 0, 'pointer-events': 'none' }, g);
    const dots = s('g', { 'pointer-events': 'none' }, g);
    const hit = s('rect', { x: 0, y: 0, width: iw, height: ih, fill: 'transparent' }, g);
    const tipSeries = o.series.filter((se) => !se.noTip);
    hit.addEventListener('pointermove', (ev) => {
      const r = hit.getBoundingClientRect();
      const xv = x.invert(((ev.clientX - r.left) / r.width) * iw);
      let idx = 0, best = Infinity;
      for (let i = 0; i < xs.length; i++) { const d = Math.abs(xs[i] - xv); if (d < best) { best = d; idx = i; } }
      const px = x(xs[idx]);
      cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('opacity', 0.5);
      dots.replaceChildren();
      const rows = [];
      for (const se of tipSeries) {
        if (se.y[idx] === undefined) continue;
        s('circle', { cx: px, cy: y(se.y[idx]), r: 4, fill: se.color, stroke: INK.surface, 'stroke-width': 2 }, dots);
        rows.push({ color: se.color, value: (o.yFormat || String)(se.y[idx]), label: se.name, v: se.y[idx] });
      }
      for (const b of o.bands || []) if (b.name) rows.push({ color: b.color, key: 'rect', value: `${(o.yFormat || String)(b.lo[idx])} – ${(o.yFormat || String)(b.hi[idx])}`, label: b.name, v: -Infinity });
      rows.sort((a, b) => b.v - a.v);
      showTip({ title: `${o.xTipLabel || ''}${(o.xFormat || String)(xs[idx])}`, rows: rows.slice(0, 12) }, ev.clientX, ev.clientY);
    });
    hit.addEventListener('pointerleave', () => { cross.setAttribute('opacity', 0); dots.replaceChildren(); hideTip(); });
    return svg;
  };
}

// ---------------------------------------------------------------------------
// Step histogram: distributions of session results on shared bins
// ---------------------------------------------------------------------------

export function histogram(o) {
  return (width) => {
    const height = o.height || 280;
    const m = { l: 56, r: 16, t: 12, b: 40 };
    const { svg, g, iw, ih } = frame(width, height, m);
    const { edges } = o;
    const nb = edges.length - 1;
    let ymax = 0;
    for (const se of o.series) for (const v of se.values) ymax = Math.max(ymax, v);
    const yd = niceDomain(0, ymax || 0.01, 4);
    const x = scale(edges[0], edges[nb], 0, iw); x.range1 = iw;
    const y = scale(0, yd.hi, ih, 0);
    yAxis(g, y, yd.ticks, iw, o.yFormat || ((v) => `${Math.round(v * 100)}%`));
    const xd = niceDomain(edges[0], edges[nb], Math.max(2, Math.floor(iw / 80)));
    xAxis(g, x, xd.ticks.filter((t) => t >= edges[0] && t <= edges[nb]), ih, o.xFormat || String);
    axisTitle(svg, o.xTitle, m.l + iw / 2, height - 4);
    axisTitle(svg, o.yTitle, 12, m.t + ih / 2, true);
    if (edges[0] < 0 && edges[nb] > 0) {
      s('line', { x1: x(0), x2: x(0), y1: 0, y2: ih, stroke: INK.secondary, 'stroke-width': 1, opacity: 0.6 }, g);
      text(g, x(0) + 4, 12, 'break-even', { fill: INK.secondary });
    }
    if (o.series.length === 1) {
      // Single distribution: real bars with a 2px surface gap, rounded top.
      const se = o.series[0];
      const bw = Math.max(1, iw / nb - 2);
      for (let i = 0; i < nb; i++) {
        const v = se.values[i]; if (!v) continue;
        const x0 = x(edges[i]) + 1, top = y(v), hgt = ih - top;
        s('path', { d: roundedTop(x0, top, bw, hgt, Math.min(4, bw / 2)), fill: edges[i + 1] <= 0 ? '#e66767' : edges[i] >= 0 ? '#3987e5' : '#898781' }, g);
      }
    } else {
      for (const se of o.series) {
        let d = `M${x(edges[0])},${ih}`;
        for (let i = 0; i < nb; i++) d += `L${x(edges[i]).toFixed(1)},${y(se.values[i]).toFixed(1)}L${x(edges[i + 1]).toFixed(1)},${y(se.values[i]).toFixed(1)}`;
        d += `L${x(edges[nb])},${ih}`;
        s('path', { d: d + 'Z', fill: se.color, opacity: 0.08 }, g);
        s('path', { d, fill: 'none', stroke: se.color, 'stroke-width': 2, 'stroke-linejoin': 'round' }, g);
      }
    }
    const band = s('rect', { y: 0, height: ih, fill: INK.primary, opacity: 0, 'pointer-events': 'none' }, g);
    const hit = s('rect', { x: 0, y: 0, width: iw, height: ih, fill: 'transparent' }, g);
    hit.addEventListener('pointermove', (ev) => {
      const r = hit.getBoundingClientRect();
      const xv = x.invert(((ev.clientX - r.left) / r.width) * iw);
      const i = Math.max(0, Math.min(nb - 1, Math.floor((xv - edges[0]) / (edges[1] - edges[0]))));
      band.setAttribute('x', x(edges[i])); band.setAttribute('width', Math.max(1, x(edges[i + 1]) - x(edges[i]))); band.setAttribute('opacity', 0.06);
      const f = o.xFormat || String;
      const rows = o.series.map((se) => ({ color: se.color, key: o.series.length === 1 ? 'rect' : 'line', value: `${(se.values[i] * 100).toFixed(1)}%`, label: se.name, v: se.values[i] })).sort((a, b) => b.v - a.v);
      const edgeNote = i === 0 ? ' (and below)' : i === nb - 1 ? ' (and above)' : '';
      showTip({ title: `${f(edges[i])} to ${f(edges[i + 1])}${edgeNote}`, rows }, ev.clientX, ev.clientY);
    });
    hit.addEventListener('pointerleave', () => { band.setAttribute('opacity', 0); hideTip(); });
    return svg;
  };
}

function roundedTop(x, y, w, hgt, r) {
  if (hgt <= 0) return '';
  r = Math.min(r, hgt);
  return `M${x},${y + hgt}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hgt}Z`;
}
/** Horizontal bar from baseline x0 to x1 with a rounded data-end only. */
function hBar(x0, x1, yc, th, r) {
  const left = Math.min(x0, x1), right = Math.max(x0, x1), w = right - left;
  if (w < 0.5) return '';
  r = Math.min(r, w, th / 2);
  const t = yc - th / 2, b = yc + th / 2;
  if (x1 >= x0) return `M${left},${t}H${right - r}Q${right},${t} ${right},${t + r}V${b - r}Q${right},${b} ${right - r},${b}H${left}Z`;
  return `M${right},${t}H${left + r}Q${left},${t} ${left},${t + r}V${b - r}Q${left},${b} ${left + r},${b}H${right}Z`;
}

// ---------------------------------------------------------------------------
// Horizontal bars (ranked comparisons; supports negative values and CI whiskers)
// ---------------------------------------------------------------------------

/**
 * @param {{items:{label:string,value:number,color:string,ci?:[number,number],tip?:{label:string,value:string}[]}[], format:(v:number)=>string, includeZero?:boolean, domain?:[number,number]}} o
 */
export function hbars(o) {
  return (width) => {
    const row = 30;
    const labelW = Math.min(220, Math.max(110, width * 0.3));
    const height = o.items.length * row + 40;
    const m = { l: labelW, r: 70, t: 8, b: 30 };
    const { svg, g, iw, ih } = frame(width, height, m);
    let lo = Infinity, hi = -Infinity;
    for (const it of o.items) { lo = Math.min(lo, it.value, it.ci ? it.ci[0] : it.value); hi = Math.max(hi, it.value, it.ci ? it.ci[1] : it.value); }
    if (o.domain) [lo, hi] = o.domain;
    const d = niceDomain(lo, hi, Math.max(2, Math.floor(iw / 90)), o.includeZero !== false);
    const x = scale(d.lo, d.hi, 0, iw);
    for (const t of d.ticks) {
      s('line', { x1: x(t), x2: x(t), y1: 0, y2: ih, stroke: t === 0 ? INK.axis : INK.grid, 'stroke-width': 1, 'shape-rendering': 'crispEdges' }, g);
      text(g, x(t), ih + 16, o.format(t), { 'text-anchor': 'middle', class: 'tnum' });
    }
    const x0 = x(Math.max(d.lo, Math.min(0, d.hi)));
    o.items.forEach((it, i) => {
      const yc = i * row + row / 2;
      const grp = s('g', { class: 'bar-row', tabindex: 0 }, g);
      s('rect', { x: -labelW, y: i * row, width: labelW + iw + m.r, height: row, fill: 'transparent' }, grp);
      text(grp, -10, yc + 4, truncate(it.label, Math.floor(labelW / 7)), { 'text-anchor': 'end', fill: INK.secondary, 'font-size': 12 });
      const bar = s('path', { d: hBar(x0, x(it.value), yc, Math.min(18, row - 10), 4), fill: it.color }, grp);
      if (it.ci) {
        s('line', { x1: x(it.ci[0]), x2: x(it.ci[1]), y1: yc, y2: yc, stroke: INK.primary, 'stroke-width': 1, opacity: 0.8 }, grp);
        for (const c of it.ci) s('line', { x1: x(c), x2: x(c), y1: yc - 4, y2: yc + 4, stroke: INK.primary, 'stroke-width': 1, opacity: 0.8 }, grp);
      }
      const tipX = it.value >= 0 ? Math.max(x(it.value), it.ci ? x(it.ci[1]) : 0) + 6 : Math.min(x(it.value), it.ci ? x(it.ci[0]) : iw) - 6;
      text(grp, tipX, yc + 4, o.format(it.value), { 'text-anchor': it.value >= 0 ? 'start' : 'end', fill: INK.primary, class: 'tnum', 'font-size': 11 });
      const show = (ev) => {
        bar.setAttribute('opacity', 0.85);
        const rows = [{ color: it.color, key: 'rect', value: o.format(it.value), label: o.valueLabel || 'Value' }];
        if (it.ci) rows.push({ value: `${o.format(it.ci[0])} to ${o.format(it.ci[1])}`, label: '95% confidence' });
        for (const t of it.tip || []) rows.push({ value: t.value, label: t.label });
        const b = ev.clientX !== undefined ? ev : grp.getBoundingClientRect();
        showTip({ title: it.label, rows }, ev.clientX ?? b.right, ev.clientY ?? b.top);
      };
      grp.addEventListener('pointermove', show);
      grp.addEventListener('focus', () => { const b = grp.getBoundingClientRect(); show({ clientX: b.left + labelW, clientY: b.top }); });
      grp.addEventListener('pointerleave', () => { bar.setAttribute('opacity', 1); hideTip(); });
      grp.addEventListener('blur', () => { bar.setAttribute('opacity', 1); hideTip(); });
    });
    return svg;
  };
}

// ---------------------------------------------------------------------------
// Columns: dice-sum frequency (observed bars vs. theoretical markers)
// ---------------------------------------------------------------------------

export function columns(o) {
  return (width) => {
    const height = o.height || 240;
    const m = { l: 52, r: 12, t: 12, b: 36 };
    const { svg, g, iw, ih } = frame(width, height, m);
    const n = o.categories.length;
    let ymax = 0;
    for (const v of o.values) ymax = Math.max(ymax, v);
    for (const v of o.expected || []) ymax = Math.max(ymax, v);
    const yd = niceDomain(0, ymax || 1, 4);
    const y = scale(0, yd.hi, ih, 0);
    yAxis(g, y, yd.ticks, iw, o.yFormat || String);
    s('line', { x1: 0, x2: iw, y1: ih, y2: ih, stroke: INK.axis, 'stroke-width': 1 }, g);
    const slot = iw / n, bw = Math.min(24, slot - 6);
    axisTitle(svg, o.xTitle, m.l + iw / 2, height - 2);
    o.categories.forEach((c, i) => {
      const cx = slot * i + slot / 2;
      text(g, cx, ih + 16, String(c), { 'text-anchor': 'middle', fill: INK.secondary, class: 'tnum' });
      const grp = s('g', { tabindex: 0 }, g);
      s('rect', { x: slot * i, y: 0, width: slot, height: ih, fill: 'transparent' }, grp);
      const v = o.values[i];
      const bar = s('path', { d: roundedTop(cx - bw / 2, y(v), bw, ih - y(v), 4), fill: o.color || '#3987e5' }, grp);
      if (o.expected) {
        const ey = y(o.expected[i]);
        s('line', { x1: cx - bw / 2 - 5, x2: cx + bw / 2 + 5, y1: ey, y2: ey, stroke: INK.primary, 'stroke-width': 2, 'stroke-linecap': 'round' }, grp);
      }
      const show = (ev) => {
        bar.setAttribute('opacity', 0.85);
        const rows = [{ color: o.color || '#3987e5', key: 'rect', value: (o.tipFormat || o.yFormat || String)(v), label: o.valueLabel || 'Observed' }];
        if (o.expected) rows.push({ color: INK.primary, value: (o.tipFormat || o.yFormat || String)(o.expected[i]), label: o.expectedLabel || 'Expected' });
        if (o.extraTip) rows.push(...o.extraTip(i));
        showTip({ title: `${o.catLabel || ''}${c}`, rows }, ev.clientX, ev.clientY);
      };
      grp.addEventListener('pointermove', show);
      grp.addEventListener('focus', () => { const b = grp.getBoundingClientRect(); show({ clientX: b.right, clientY: b.top }); });
      grp.addEventListener('pointerleave', () => { bar.setAttribute('opacity', 1); hideTip(); });
      grp.addEventListener('blur', () => { bar.setAttribute('opacity', 1); hideTip(); });
    });
    return svg;
  };
}

// ---------------------------------------------------------------------------
// Scatter: risk (x) vs. reward (y), with the efficient frontier
// ---------------------------------------------------------------------------

/**
 * @param {{points:{x:number,y:number,label:string,color:string,emph?:boolean,tip?:{label:string,value:string}[]}[], frontier?:number[]}} o
 */
export function scatter(o) {
  return (width) => {
    const height = o.height || 320;
    const m = { l: 64, r: 24, t: 16, b: 44 };
    const { svg, g, iw, ih } = frame(width, height, m);
    const xs = o.points.map((p) => p.x), ys = o.points.map((p) => p.y);
    const xd = niceDomain(Math.min(...xs), Math.max(...xs), Math.max(2, Math.floor(iw / 90)), o.xZero);
    const yd = niceDomain(Math.min(...ys), Math.max(...ys), 5, o.yZero);
    const x = scale(xd.lo, xd.hi, 0, iw); x.range1 = iw;
    const y = scale(yd.lo, yd.hi, ih, 0);
    yAxis(g, y, yd.ticks, iw, o.yFormat || String);
    xAxis(g, x, xd.ticks, ih, o.xFormat || String);
    axisTitle(svg, o.xTitle, m.l + iw / 2, height - 4);
    axisTitle(svg, o.yTitle, 12, m.t + ih / 2, true);
    if (o.frontier && o.frontier.length > 1) {
      const f = [...o.frontier].sort((a, b) => o.points[a].x - o.points[b].x);
      s('path', { d: pathD(f.map((i) => x(o.points[i].x)), f.map((i) => y(o.points[i].y))), fill: 'none', stroke: INK.secondary, 'stroke-width': 1.5, opacity: 0.7 }, g);
    }
    const order = o.points.map((p, i) => i).sort((a, b) => (o.points[a].emph ? 1 : 0) - (o.points[b].emph ? 1 : 0));
    const labelled = [];
    const emphCount = o.points.filter((p) => p.emph).length;
    for (const i of order) {
      const p = o.points[i];
      const cx = x(p.x), cy = y(p.y);
      const grp = s('g', { tabindex: 0, class: 'dot' }, g);
      s('circle', { cx, cy, r: 12, fill: 'transparent' }, grp); // ≥24px hit target
      const dot = s('circle', { cx, cy, r: p.emph ? 6 : 4.5, fill: p.color, stroke: INK.surface, 'stroke-width': 2, opacity: p.emph ? 1 : 0.85 }, grp);
      if (p.emph && emphCount <= 14) labelled.push({ cx, cy, label: p.label });
      const show = (ev) => {
        dot.setAttribute('r', p.emph ? 8 : 6.5);
        showTip({ title: p.label, rows: [
          { color: p.color, key: 'dot', value: (o.yFormat || String)(p.y), label: o.yTitle || 'y' },
          { value: (o.xFormat || String)(p.x), label: o.xTitle || 'x' },
          ...(p.tip || []),
        ] }, ev.clientX, ev.clientY);
      };
      grp.addEventListener('pointermove', show);
      grp.addEventListener('focus', () => { const b = grp.getBoundingClientRect(); show({ clientX: b.right, clientY: b.top }); });
      grp.addEventListener('pointerleave', () => { dot.setAttribute('r', p.emph ? 6 : 4.5); hideTip(); });
      grp.addEventListener('blur', () => { dot.setAttribute('r', p.emph ? 6 : 4.5); hideTip(); });
    }
    // Selective direct labels (frontier points), nudged to avoid overlap.
    const placed = [];
    for (const l of labelled.sort((a, b) => a.cy - b.cy)) {
      let ly = l.cy - 10;
      const right = l.cx < iw * 0.7;
      for (const p of placed) if (Math.abs(p.y - ly) < 13 && Math.abs(p.x - l.cx) < 140) ly = p.y + 13;
      placed.push({ x: l.cx, y: ly });
      text(g, right ? l.cx + 10 : l.cx - 10, ly, truncate(l.label, 28), { 'text-anchor': right ? 'start' : 'end', fill: INK.secondary, 'font-size': 11, 'pointer-events': 'none' });
    }
    return svg;
  };
}

export function truncate(str, n) {
  return str.length > n ? `${str.slice(0, Math.max(1, n - 1))}…` : str;
}

export const CHART_INK = INK;
