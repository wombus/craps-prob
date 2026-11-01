// Worker pool: splits trials across CPU cores, then stitches the slices back together
// in trial order so results are identical no matter how many workers ran.

import { runBatch, newDiceAcc, mergeDiceAcc } from '../engine/simulator.js';

const ARRAY_FIELDS = ['net', 'rolls', 'games', 'maxDrawdown', 'high', 'low', 'action', 'expected', 'reason'];

export function mergeBatches(batches, strategyCount) {
  batches.sort((a, b) => a.trialStart - b.trialStart);
  const trials = batches.reduce((a, b) => a + b.trialCount, 0);
  const cps = batches[0].checkpointGames;
  const K = cps.length;
  const strategies = [];
  for (let si = 0; si < strategyCount; si++) {
    const first = batches[0].strategies[si];
    const merged = { paths: [], byKey: Object.create(null) };
    for (const f of ARRAY_FIELDS) merged[f] = new first[f].constructor(trials);
    merged.checkpoints = first.checkpoints ? new Float32Array(trials * K) : null;
    let off = 0;
    for (const b of batches) {
      const s = b.strategies[si];
      for (const f of ARRAY_FIELDS) merged[f].set(s[f], off);
      if (merged.checkpoints) merged.checkpoints.set(s.checkpoints, off * K);
      merged.paths.push(...s.paths);
      for (const key in s.byKey) {
        const src = s.byKey[key];
        const dst = merged.byKey[key] || (merged.byKey[key] = { action: 0, net: 0, expected: 0, wins: 0, losses: 0, pushes: 0 });
        for (const k in src) dst[k] += src[k];
      }
      off += b.trialCount;
    }
    merged.paths.sort((a, b) => a.trial - b.trial);
    strategies.push(merged);
  }
  const dice = batches.reduce((acc, b) => mergeDiceAcc(acc, b.dice), newDiceAcc());
  return { trials, checkpointGames: cps, strategies, dice };
}

export class SimRunner {
  constructor() {
    this.size = Math.max(1, Math.min(8, (globalThis.navigator && navigator.hardwareConcurrency) || 4));
    this.workers = null;
    this.workerOk = typeof Worker !== 'undefined';
    this._jobId = 0;
    this._cancel = null;
  }

  _ensureWorkers() {
    if (this.workers || !this.workerOk) return;
    try {
      this.workers = Array.from({ length: this.size }, () => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }));
    } catch (e) {
      console.warn('Module workers unavailable, running on the main thread.', e);
      this.workerOk = false;
      this.workers = null;
    }
  }

  cancel() {
    if (this._cancel) this._cancel();
  }

  /**
   * @param {{strategies:object[], rules:object, session:object, collectPaths?:boolean, samplePaths?:number}} spec
   * @param {(fraction:number)=>void} onProgress
   */
  run(spec, onProgress = () => {}) {
    this._ensureWorkers();
    const trials = spec.session.trials;
    if (!this.workers) return this._runInline(spec, onProgress);

    const n = Math.min(this.workers.length, Math.max(1, Math.ceil(trials / 50)));
    const per = Math.ceil(trials / n);
    const jobId = ++this._jobId;
    const progress = new Array(n).fill(0);
    let totalWork = 0;

    return new Promise((resolve, reject) => {
      const batches = [];
      let remaining = 0;
      const cleanup = () => { for (const w of this.workers) w.onmessage = null; this._cancel = null; };
      this._cancel = () => {
        // Terminating is the only way to stop a busy worker; recreate them lazily next run.
        for (const w of this.workers) w.terminate();
        this.workers = null;
        this._cancel = null;
        reject(new Error('cancelled'));
      };
      for (let i = 0; i < n; i++) {
        const trialStart = i * per;
        const trialCount = Math.min(per, trials - trialStart);
        if (trialCount <= 0) continue;
        remaining++;
        totalWork += trialCount * (spec.strategies.length + 1);
        const w = this.workers[i];
        w.onmessage = (e) => {
          const msg = e.data;
          if (msg.id !== jobId) return;
          if (msg.type === 'progress') {
            progress[i] = msg.done;
            onProgress(progress.reduce((a, b) => a + b, 0) / totalWork);
          } else if (msg.type === 'done') {
            batches.push(msg.result);
            if (--remaining === 0) {
              cleanup();
              resolve(mergeBatches(batches, spec.strategies.length));
            }
          } else if (msg.type === 'error') {
            cleanup();
            reject(new Error(msg.message));
          }
        };
        w.postMessage({ id: jobId, job: { ...spec, trialStart, trialCount } });
      }
    });
  }

  // Fallback: chunked execution on the main thread, yielding so the page can repaint.
  async _runInline(spec, onProgress) {
    const trials = spec.session.trials;
    const chunk = Math.max(10, Math.ceil(trials / 50));
    const batches = [];
    let cancelled = false;
    this._cancel = () => { cancelled = true; };
    for (let start = 0; start < trials; start += chunk) {
      if (cancelled) { this._cancel = null; throw new Error('cancelled'); }
      batches.push(runBatch({ ...spec, trialStart: start, trialCount: Math.min(chunk, trials - start) }));
      onProgress(Math.min(1, (start + chunk) / trials));
      await new Promise((r) => setTimeout(r, 0));
    }
    this._cancel = null;
    return mergeBatches(batches, spec.strategies.length);
  }
}
