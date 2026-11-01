// Web Worker entry: runs a slice of the Monte Carlo trials off the main thread so the UI
// stays responsive. Results are posted back with their typed-array buffers *transferred*
// (zero-copy) rather than cloned.

import { runBatch } from '../engine/simulator.js';

self.onmessage = (e) => {
  const { id, job } = e.data;
  try {
    const result = runBatch(job, (done, total) => self.postMessage({ id, type: 'progress', done, total }));
    const transfer = [];
    for (const s of result.strategies) {
      for (const k of ['net', 'rolls', 'games', 'maxDrawdown', 'high', 'low', 'action', 'expected', 'reason', 'checkpoints']) {
        if (s[k]) transfer.push(s[k].buffer);
      }
      for (const p of s.paths) transfer.push(p.values.buffer);
    }
    self.postMessage({ id, type: 'done', result }, transfer);
  } catch (err) {
    self.postMessage({ id, type: 'error', message: err && err.message ? err.message : String(err) });
  }
};
