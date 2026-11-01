// Application state with localStorage persistence and a minimal pub/sub.

import { normalizeRules, DEFAULT_RULES } from '../engine/rules.js';
import { normalizeStrategy } from '../engine/strategy.js';
import { normalizeSession, DEFAULT_SESSION } from '../engine/simulator.js';
import { presetCatalog, STARTER_PRESETS } from '../engine/presets.js';

const KEY = 'crapsLab.v1';
export const COLOR_SLOTS = 8;

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}

const listeners = new Map();

export const store = {
  rules: normalizeRules(DEFAULT_RULES),
  session: normalizeSession(DEFAULT_SESSION),
  strategies: [],
  included: new Set(),
  liveBankroll: 1000,

  init() {
    const saved = load();
    if (saved) {
      this.rules = normalizeRules(saved.rules);
      this.session = normalizeSession(saved.session);
      this.strategies = (saved.strategies || []).map((s) => ({ ...normalizeStrategy(s), colorSlot: s.colorSlot ?? null }));
      this.included = new Set(saved.included || this.strategies.map((s) => s.id));
      this.liveBankroll = saved.liveBankroll || 1000;
    }
    if (!this.strategies.length) this.resetToStarters();
    this._fixColors();
  },

  resetToStarters() {
    const cat = presetCatalog(this.rules.tableMin);
    this.strategies = STARTER_PRESETS.map((k) => cat.find((p) => p.key === k).build());
    this.included = new Set(this.strategies.map((s) => s.id));
    this.strategies.forEach((s, i) => { s.colorSlot = i < COLOR_SLOTS ? i : null; });
  },

  /** Color follows the strategy (not its rank): assign the lowest free slot once, keep it. */
  _fixColors() {
    const used = new Set();
    for (const s of this.strategies) {
      if (s.colorSlot !== null && s.colorSlot !== undefined && !used.has(s.colorSlot) && s.colorSlot < COLOR_SLOTS) used.add(s.colorSlot);
      else s.colorSlot = null;
    }
    for (const s of this.strategies) {
      if (s.colorSlot !== null) continue;
      for (let c = 0; c < COLOR_SLOTS; c++) if (!used.has(c)) { s.colorSlot = c; used.add(c); break; }
    }
  },

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        rules: this.rules, session: this.session, strategies: this.strategies,
        included: [...this.included], liveBankroll: this.liveBankroll,
      }));
    } catch (e) { console.warn('Could not save state', e); }
  },

  getStrategy(id) { return this.strategies.find((s) => s.id === id); },

  upsertStrategy(s) {
    const i = this.strategies.findIndex((x) => x.id === s.id);
    const norm = { ...normalizeStrategy(s), colorSlot: s.colorSlot ?? null };
    if (i >= 0) this.strategies[i] = norm;
    else { this.strategies.push(norm); this.included.add(norm.id); }
    this._fixColors();
    this.save();
    this.emit('strategies');
    return norm;
  },

  removeStrategy(id) {
    this.strategies = this.strategies.filter((s) => s.id !== id);
    this.included.delete(id);
    this._fixColors();
    this.save();
    this.emit('strategies');
  },

  setRules(r) {
    this.rules = normalizeRules(r);
    this.save();
    this.emit('rules');
  },

  setSession(s) {
    this.session = normalizeSession(s);
    this.save();
    this.emit('session');
  },

  on(evt, fn) {
    if (!listeners.has(evt)) listeners.set(evt, new Set());
    listeners.get(evt).add(fn);
    return () => listeners.get(evt).delete(fn);
  },
  emit(evt, data) { for (const fn of listeners.get(evt) || []) fn(data); },
};

// Dark-surface categorical palette (validated set; see README "Charts").
export const SERIES_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
export const OTHER_COLOR = '#898781';
export const colorFor = (slot) => (slot === null || slot === undefined ? OTHER_COLOR : SERIES_COLORS[slot] || OTHER_COLOR);
