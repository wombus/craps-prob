// Statistics: turning raw simulated sessions into decision-ready numbers.

import { WAYS } from './constants.js';
import { END_REASONS } from './simulator.js';

const REASON = Object.fromEntries(END_REASONS.map((r, i) => [r, i]));

/** Linear-interpolated quantile of a sorted array. */
export function quantile(sorted, q) {
  const n = sorted.length;
  if (!n) return NaN;
  const pos = (n - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function mean(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return arr.length ? s / arr.length : NaN;
}

export function sum(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s;
}

/** Wilson score interval half-width-ish bounds for a proportion. */
export function wilson(p, n, z = 1.96) {
  if (!n) return [0, 0];
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

/**
 * Summarize one strategy's merged results.
 * @param {object} o merged per-strategy arrays
 * @param {object} cfg session config
 */
export function summarizeStrategy(o, cfg) {
  const n = o.net.length;
  const net = o.net;
  const sorted = Float64Array.from(net).sort();
  const m = mean(net);
  let ss = 0, down = 0, wins = 0, evens = 0, busts = 0, goals = 0, stops = 0, everUp = 0;
  for (let i = 0; i < n; i++) {
    const x = net[i];
    ss += (x - m) * (x - m);
    if (x < 0) down += x * x;
    if (x > 1e-9) wins++;
    if (x >= -1e-9) evens++;
    const r = o.reason[i];
    if (r === REASON.bust) busts++;
    else if (r === REASON.winGoal) goals++;
    else if (r === REASON.stopLoss) stops++;
    if (o.high[i] > 1e-9) everUp++;
  }
  const sd = n > 1 ? Math.sqrt(ss / (n - 1)) : 0;
  const se = sd / Math.sqrt(n);
  const tail = Math.max(1, Math.ceil(n * 0.05));
  let cvar = 0;
  for (let i = 0; i < tail; i++) cvar += sorted[i];
  cvar /= tail;
  const downDev = Math.sqrt(down / n);
  const totalAction = sum(o.action);
  const totalNet = sum(net);
  const totalExpected = sum(o.expected);
  const avgRolls = mean(o.rolls);
  const ddSorted = Float64Array.from(o.maxDrawdown).sort();
  const pProfit = wins / n;

  return {
    n,
    mean: m, sd, se, ci95: 1.96 * se,
    median: quantile(sorted, 0.5),
    p5: quantile(sorted, 0.05), p10: quantile(sorted, 0.1), p25: quantile(sorted, 0.25),
    p75: quantile(sorted, 0.75), p90: quantile(sorted, 0.9), p95: quantile(sorted, 0.95),
    min: sorted[0], max: sorted[n - 1],
    pProfit, pProfitCI: wilson(pProfit, n),
    pBreakEven: evens / n,
    pRuin: busts / n, pGoal: goals / n, pStopLoss: stops / n,
    pEverAhead: everUp / n,
    var5: quantile(sorted, 0.05),
    cvar5: cvar,
    downDev,
    sortino: downDev > 0 ? m / downDev : 0,
    sharpe: sd > 0 ? m / sd : 0,
    avgMaxDrawdown: mean(o.maxDrawdown), p95MaxDrawdown: quantile(ddSorted, 0.95),
    avgHigh: mean(o.high),
    avgAction: totalAction / n,
    edgeObserved: totalAction > 0 ? -totalNet / totalAction : 0,
    edgeTheory: totalAction > 0 ? -totalExpected / totalAction : 0,
    expectedNet: totalExpected / n,
    avgRolls, avgGames: mean(o.games),
    lossPerHour: avgRolls > 0 ? (-m / avgRolls) * cfg.rollsPerHour : 0,
    theoryLossPerHour: avgRolls > 0 ? (-(totalExpected / n) / avgRolls) * cfg.rollsPerHour : 0,
    actionPerRoll: avgRolls > 0 ? totalAction / n / avgRolls : 0,
  };
}

/** Percentile bands of bankroll at each checkpoint (for fan charts). */
export function trajectoryBands(checkpoints, trials, K) {
  const bands = [];
  const col = new Float64Array(trials);
  for (let k = 0; k < K; k++) {
    for (let i = 0; i < trials; i++) col[i] = checkpoints[i * K + k];
    const s = Float64Array.from(col).sort();
    bands.push({ p5: quantile(s, 0.05), p25: quantile(s, 0.25), p50: quantile(s, 0.5), p75: quantile(s, 0.75), p95: quantile(s, 0.95), mean: mean(col) });
  }
  return bands;
}

/** Histogram over shared bins so several strategies can be compared on one axis. */
export function sharedHistogram(arrays, bins = 40, clip = [0.005, 0.995]) {
  let lo = Infinity, hi = -Infinity;
  for (const a of arrays) {
    const s = Float64Array.from(a).sort();
    lo = Math.min(lo, quantile(s, clip[0]));
    hi = Math.max(hi, quantile(s, clip[1]));
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { edges: [], counts: [] };
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const step = niceStep((hi - lo) / bins);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const nb = Math.max(1, Math.round((hi - lo) / step));
  const edges = Array.from({ length: nb + 1 }, (_, i) => lo + i * step);
  const counts = arrays.map((a) => {
    const c = new Array(nb).fill(0);
    for (let i = 0; i < a.length; i++) {
      let b = Math.floor((a[i] - lo) / step);
      if (b < 0) b = 0; else if (b >= nb) b = nb - 1; // tails folded into the end bins
      c[b]++;
    }
    return c.map((x) => x / a.length);
  });
  return { edges, counts, step };
}

export function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

// ---------------------------------------------------------------------------
// Ranking: which strategy offers the best risk / reward?
// ---------------------------------------------------------------------------

export const OBJECTIVES = {
  balanced: { label: 'Balanced score (recommended)', key: 'score', dir: 1, fmt: 'score' },
  expectedNet: { label: 'Best expected result (exact, lowest expected loss)', key: 'expectedNet', dir: 1, fmt: 'money' },
  mean: { label: 'Best simulated average result', key: 'mean', dir: 1, fmt: 'money' },
  pProfit: { label: 'Highest chance to finish ahead', key: 'pProfit', dir: 1, fmt: 'pct' },
  pRuin: { label: 'Lowest risk of ruin', key: 'pRuin', dir: -1, fmt: 'pct' },
  cvar5: { label: 'Smallest bad-day loss (CVaR 5%)', key: 'cvar5', dir: 1, fmt: 'money' },
  edge: { label: 'Lowest house edge per $ wagered', key: 'edgeTheory', dir: -1, fmt: 'pctEdge' },
  lossPerHour: { label: 'Cheapest per hour of play', key: 'lossPerHour', dir: -1, fmt: 'money' },
  sortino: { label: 'Best downside-adjusted return (Sortino)', key: 'sortino', dir: 1, fmt: 'num' },
  p95: { label: 'Biggest upside (95th percentile)', key: 'p95', dir: 1, fmt: 'money' },
  pGoal: { label: 'Most often reaches the win goal', key: 'pGoal', dir: 1, fmt: 'pct' },
};

// Criteria (and direction) combined into the balanced score.
// Reward and edge use the *exact* expectation of the bets actually made (no sampling noise);
// chance of profit, ruin and bad-day loss can only come from the simulation.
export const SCORE_CRITERIA = [
  ['expectedNet', 1, 0.25], ['pProfit', 1, 0.25], ['pRuin', -1, 0.2], ['cvar5', 1, 0.2], ['edgeTheory', -1, 0.1],
];

function percentileRanks(values, dir) {
  const n = values.length;
  if (n === 1) return [1];
  const idx = values.map((v, i) => [v * dir, i]).sort((a, b) => a[0] - b[0]);
  const ranks = new Array(n);
  for (let i = 0; i < n;) {
    let j = i;
    while (j + 1 < n && Math.abs(idx[j + 1][0] - idx[i][0]) < 1e-12) j++;
    const r = (i + j) / 2 / (n - 1);
    for (let k = i; k <= j; k++) ranks[idx[k][1]] = r;
    i = j + 1;
  }
  return ranks;
}

/** Adds `score` (0-100) to each summary: a weighted average of percentile ranks. */
export function scoreSummaries(summaries) {
  const scores = new Array(summaries.length).fill(0);
  for (const [key, dir, w] of SCORE_CRITERIA) {
    const r = percentileRanks(summaries.map((s) => s[key]), dir);
    r.forEach((v, i) => { scores[i] += v * w; });
  }
  summaries.forEach((s, i) => { s.score = Math.round(scores[i] * 1000) / 10; });
  return summaries;
}

/**
 * Pareto frontier: strategies for which no other strategy is both better on reward
 * (higher mean) AND better on risk (lower riskFn). These are the only rational choices.
 */
export function paretoFrontier(items, rewardFn, riskFn) {
  const front = [];
  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    let dominated = false;
    for (let j = 0; j < items.length && !dominated; j++) {
      if (i === j) continue;
      const b = items[j];
      const better = rewardFn(b) >= rewardFn(a) && riskFn(b) <= riskFn(a);
      const strictly = rewardFn(b) > rewardFn(a) || riskFn(b) < riskFn(a);
      if (better && strictly) dominated = true;
    }
    if (!dominated) front.push(i);
  }
  return front;
}

// ---------------------------------------------------------------------------
// Dice diagnostics
// ---------------------------------------------------------------------------

/** Regularized upper incomplete gamma Q(a, x) — for chi-square p-values. */
export function gammaQ(a, x) {
  if (x < 0 || a <= 0) return NaN;
  if (x === 0) return 1;
  const gln = lnGamma(a);
  if (x < a + 1) {
    let ap = a, del = 1 / a, s = del;
    for (let n = 0; n < 500; n++) { ap++; del *= x / ap; s += del; if (Math.abs(del) < Math.abs(s) * 1e-14) break; }
    return 1 - s * Math.exp(-x + a * Math.log(x) - gln);
  }
  let b = x + 1 - a, c = 1 / 1e-300, d = 1 / b, h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return Math.exp(-x + a * Math.log(x) - gln) * h;
}

function lnGamma(z) {
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/** Chi-square goodness-of-fit of observed dice sums vs. the 1-2-3-4-5-6-5-4-3-2-1 distribution. */
export function diceChiSquare(sums) {
  const total = sums.reduce((a, b) => a + b, 0);
  let chi2 = 0;
  for (let s = 2; s <= 12; s++) {
    const e = (total * WAYS[s]) / 36;
    chi2 += ((sums[s] - e) ** 2) / e;
  }
  return { chi2, df: 10, p: gammaQ(5, chi2 / 2), total };
}

/** Theoretical constants worth showing next to simulated values. */
/**
 * Theoretical dice/table constants for a game, to show next to simulated values.
 * Expected rolls in a shooter's hand (until seven-out), via a small Markov chain:
 *   E_C  = 1 + P(come-out decides)·E_C + Σ (w/36)·E_P(n)
 *   E_Pn = (36 + w·E_C) / (w + 6)
 * Substitute and solve the linear equation for E_C.
 */
export function theoryFor(rules) {
  const crapless = rules && rules.game === 'crapless';
  const pts = crapless ? [2, 3, 4, 5, 6, 8, 9, 10, 11, 12] : [4, 5, 6, 8, 9, 10];
  const settleWays = crapless ? 6 : 12; // come-out rolls that don't set a point
  let a = 1 - settleWays / 36, b = 1;
  for (const n of pts) {
    const w = WAYS[n];
    b += (w / 36) * (36 / (w + 6));
    a -= (w / 36) * (w / (w + 6));
  }
  let rollsPerGame = 1, pointMade = 0, pEst = 0;
  for (const n of pts) {
    rollsPerGame += (WAYS[n] / 36) * (36 / (WAYS[n] + 6));
    pointMade += (WAYS[n] / 36) * (WAYS[n] / (WAYS[n] + 6));
    pEst += WAYS[n] / 36;
  }
  return Object.freeze({
    rollsPerHand: b / a,
    rollsPerGame,
    pPointMadeGivenEstablished: pointMade / pEst,
    pNatural: crapless ? 6 / 36 : 8 / 36,
    pCraps: crapless ? 0 : 4 / 36,
  });
}

export const THEORY = theoryFor(null);
