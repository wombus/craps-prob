// Monte Carlo simulation.
//
// One *trial* = one casino session: start with a bankroll, play a fixed number of games
// (a "game" = one pass-line decision: come-out roll through to the point being made or a
// seven-out), stop early if busted or a stop-loss / win-goal is hit, then let any contract
// bets still on the table play out.
//
// Repeating that thousands of times turns "what might happen" into a distribution we can
// measure: averages, percentiles, chance of profit, risk of ruin, and so on.

import { PlayerSession } from './session.js';
import { StrategyExecutor, normalizeStrategy } from './strategy.js';
import { CrapsTable } from './table.js';
import { makeRng, trialSeed } from './rng.js';

export const END_REASONS = ['games', 'stopLoss', 'winGoal', 'bust', 'limit'];
const REASON_CODE = Object.fromEntries(END_REASONS.map((r, i) => [r, i]));

export const DEFAULT_SESSION = Object.freeze({
  bankroll: 1000,
  games: 100,       // pass-line decisions per session (~3.4 rolls each)
  trials: 5000,     // number of simulated sessions per strategy
  stopLoss: 0,      // 0 = none; otherwise stop when down this much
  winGoal: 0,       // 0 = none; otherwise stop when up this much
  rollsPerHour: 100,
  seed: 20261101,
});

export function normalizeSession(s = {}) {
  const o = { ...DEFAULT_SESSION, ...s };
  o.bankroll = Math.max(1, +o.bankroll || DEFAULT_SESSION.bankroll);
  o.games = Math.min(100000, Math.max(1, Math.floor(+o.games || DEFAULT_SESSION.games)));
  o.trials = Math.min(1000000, Math.max(1, Math.floor(+o.trials || DEFAULT_SESSION.trials)));
  o.stopLoss = Math.max(0, +o.stopLoss || 0);
  o.winGoal = Math.max(0, +o.winGoal || 0);
  o.rollsPerHour = Math.max(1, +o.rollsPerHour || 100);
  o.seed = Math.floor(Math.abs(+o.seed)) % 4294967296 || 1;
  return o;
}

/** Evenly spaced game indices at which bankroll is sampled for trajectory charts. */
export function checkpointGames(games, maxPoints = 60) {
  const k = Math.min(games, maxPoints);
  const out = [0];
  for (let j = 1; j <= k; j++) out.push(Math.round((j * games) / k));
  return out;
}

/**
 * Play one session of one strategy.
 * @param {Float64Array|null} path  optional buffer (length games+1) receiving equity after each game.
 */
export function playSession(strategy, rules, cfg, rng, path = null) {
  const sess = new PlayerSession(rules, cfg.bankroll);
  const ex = new StrategyExecutor(strategy, rules, { normalized: true });
  const minReq = ex.minRequired();
  const start = cfg.bankroll;
  const rollLimit = cfg.games * 60 + 2000; // safety valve; a game averages ~3.4 rolls
  let games = 0, stopped = false, reason = 'games';
  let peak = start, maxDD = 0, high = start, low = start;
  if (path) path[0] = start;

  for (;;) {
    if (!stopped) {
      ex.beforeRoll(sess);
      if (sess.table.bets.length === 0 && sess.bankroll < minReq) { reason = 'bust'; break; }
    } else {
      ex.windDown(sess);
      if (sess.table.bets.length === 0) break;
    }
    const res = sess.roll(rng.die(), rng.die());
    ex.afterRoll(sess, res);

    const eq = sess.equity;
    if (eq > peak) peak = eq;
    if (peak - eq > maxDD) maxDD = peak - eq;
    if (eq > high) high = eq;
    if (eq < low) low = eq;

    if (!stopped) {
      if (res.gameOver) {
        games++;
        if (path) path[games] = eq;
        if (games >= cfg.games) { stopped = true; reason = 'games'; }
      }
      if (!stopped) {
        const net = eq - start;
        if (cfg.stopLoss > 0 && net <= -cfg.stopLoss) { stopped = true; reason = 'stopLoss'; }
        else if (cfg.winGoal > 0 && net >= cfg.winGoal) { stopped = true; reason = 'winGoal'; }
      }
    }
    if (sess.rolls > rollLimit) { reason = 'limit'; break; }
  }
  const final = sess.equity; // after wind-down this is just the rack (table is empty)
  if (path) {
    for (let g = games + 1; g <= cfg.games; g++) path[g] = final;
    if (games >= cfg.games) path[cfg.games] = final; // include wind-down of the last contract bets
  }
  if (final < low) low = final;
  return {
    net: final - start, final, games, rolls: sess.rolls, reason, maxDrawdown: maxDD,
    high: high - start, low: low - start, action: sess.action, expected: sess.expected,
    ledger: sess.ledger,
  };
}

/** Table-only pass over the dice for one trial: pure dice/table statistics (strategy independent). */
export function diceSession(rules, games, rng, acc) {
  const t = new CrapsTable(rules);
  let g = 0, handRolls = 0, handPoints = 0;
  while (g < games) {
    const d1 = rng.die(), d2 = rng.die();
    const res = t.roll(d1, d2);
    acc.sums[res.sum]++;
    acc.rolls++;
    handRolls++;
    if (res.wasComeOut) {
      acc.comeOuts++;
      if (res.natural) acc.naturals++;
      if (res.crapsOut) acc.craps++;
      if (res.pointEstablished) acc.pointsEstablished[res.sum]++;
    }
    if (res.pointMade) { acc.pointsMade[res.pointBefore]++; handPoints++; }
    if (res.sevenOut) {
      acc.sevenOuts++;
      acc.handLengths[Math.min(handRolls, acc.handLengths.length - 1)]++;
      acc.handPoints[Math.min(handPoints, acc.handPoints.length - 1)]++;
      acc.longestHand = Math.max(acc.longestHand, handRolls);
      handRolls = 0; handPoints = 0;
    }
    if (res.gameOver) g++;
  }
}

export function newDiceAcc() {
  return {
    sums: new Array(13).fill(0), rolls: 0, comeOuts: 0, naturals: 0, craps: 0,
    pointsEstablished: new Array(13).fill(0), pointsMade: new Array(13).fill(0), sevenOuts: 0,
    handLengths: new Array(61).fill(0), handPoints: new Array(11).fill(0), longestHand: 0,
  };
}

export function mergeDiceAcc(a, b) {
  for (const k of ['sums', 'pointsEstablished', 'pointsMade', 'handLengths', 'handPoints']) for (let i = 0; i < a[k].length; i++) a[k][i] += b[k][i];
  for (const k of ['rolls', 'comeOuts', 'naturals', 'craps', 'sevenOuts']) a[k] += b[k];
  a.longestHand = Math.max(a.longestHand, b.longestHand);
  return a;
}

/**
 * Run trials [trialStart, trialStart + trialCount) for every strategy.
 * Designed to be called inside a Web Worker (or directly in Node tests).
 *
 * @param {object} job
 * @param {object[]} job.strategies
 * @param {object} job.rules
 * @param {object} job.session
 * @param {number} job.trialStart
 * @param {number} job.trialCount
 * @param {boolean} [job.collectPaths]  sample bankroll trajectories (checkpoints + a few full paths)
 * @param {number} [job.samplePaths]    number of full per-game paths to keep (lowest trial indices)
 * @param {(done:number)=>void} [onProgress]
 */
export function runBatch(job, onProgress) {
  const { rules, trialStart, trialCount } = job;
  const cfg = normalizeSession(job.session);
  const strategies = job.strategies.map(normalizeStrategy);
  const collectPaths = job.collectPaths !== false;
  const samplePaths = job.samplePaths ?? 12;
  const cps = checkpointGames(cfg.games);
  const K = cps.length;
  const path = new Float64Array(cfg.games + 1);

  const out = strategies.map(() => ({
    net: new Float64Array(trialCount),
    rolls: new Float64Array(trialCount),
    games: new Float64Array(trialCount),
    maxDrawdown: new Float64Array(trialCount),
    high: new Float64Array(trialCount),
    low: new Float64Array(trialCount),
    action: new Float64Array(trialCount),
    expected: new Float64Array(trialCount),
    reason: new Uint8Array(trialCount),
    checkpoints: collectPaths ? new Float32Array(trialCount * K) : null,
    paths: [],
    byKey: Object.create(null),
  }));
  const dice = newDiceAcc();
  const totalWork = trialCount * (strategies.length + 1);
  let done = 0, lastReport = 0;

  for (let i = 0; i < trialCount; i++) {
    const trial = trialStart + i;
    const seed = trialSeed(cfg.seed, trial);
    for (let si = 0; si < strategies.length; si++) {
      const rng = makeRng(seed); // identical dice for every strategy (common random numbers)
      const r = playSession(strategies[si], rules, cfg, rng, collectPaths ? path : null);
      const o = out[si];
      o.net[i] = r.net; o.rolls[i] = r.rolls; o.games[i] = r.games; o.maxDrawdown[i] = r.maxDrawdown;
      o.high[i] = r.high; o.low[i] = r.low; o.action[i] = r.action; o.expected[i] = r.expected;
      o.reason[i] = REASON_CODE[r.reason];
      if (collectPaths) {
        for (let k = 0; k < K; k++) o.checkpoints[i * K + k] = path[cps[k]];
        if (trial < samplePaths) o.paths.push({ trial, values: Float32Array.from(path) });
      }
      for (const key in r.ledger.byKey) {
        const src = r.ledger.byKey[key];
        const dst = o.byKey[key] || (o.byKey[key] = { action: 0, net: 0, expected: 0, wins: 0, losses: 0, pushes: 0 });
        dst.action += src.action; dst.net += src.net; dst.expected += src.expected;
        dst.wins += src.wins; dst.losses += src.losses; dst.pushes += src.pushes;
      }
      done++;
    }
    diceSession(rules, cfg.games, makeRng(seed), dice);
    done++;
    if (onProgress && done - lastReport >= 200) { lastReport = done; onProgress(done, totalWork); }
  }
  if (onProgress) onProgress(done, totalWork);
  return { trialStart, trialCount, checkpointGames: cps, strategies: out, dice };
}
