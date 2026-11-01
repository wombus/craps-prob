// Analysis: merged simulation output → summaries, rankings, chart data and plain-English insights.

import { summarizeStrategy, scoreSummaries, trajectoryBands, paretoFrontier, diceChiSquare, theoryFor, mean } from './stats.js';
import { keyLabel } from './constants.js';
import { describeStrategy } from './strategy.js';

/** Paired comparison of two strategies on the same dice (common random numbers). */
export function pairedDifference(a, b) {
  const n = Math.min(a.length, b.length);
  let m = 0;
  for (let i = 0; i < n; i++) m += a[i] - b[i];
  m /= n;
  let ss = 0;
  for (let i = 0; i < n; i++) { const d = a[i] - b[i] - m; ss += d * d; }
  const sd = n > 1 ? Math.sqrt(ss / (n - 1)) : 0;
  const ci = (1.96 * sd) / Math.sqrt(n);
  let aWins = 0;
  for (let i = 0; i < n; i++) if (a[i] > b[i]) aWins++;
  return { mean: m, ci, significant: Math.abs(m) > ci, aBetterShare: aWins / n };
}

export function analyze(merged, strategies, session, rules) {
  const K = merged.checkpointGames.length;
  const summaries = merged.strategies.map((o, i) => {
    const st = strategies[i];
    const sum = summarizeStrategy(o, session);
    return {
      index: i, id: st.id, name: st.name, colorSlot: st.colorSlot ?? null,
      description: describeStrategy(st), progression: st.progression?.type || 'flat',
      ...sum,
    };
  });
  scoreSummaries(summaries);

  const bands = merged.strategies.map((o) => (o.checkpoints ? trajectoryBands(o.checkpoints, merged.trials, K) : null));
  const breakdown = merged.strategies.map((o) => Object.entries(o.byKey)
    .map(([key, r]) => ({
      key, label: keyLabel(key), ...r,
      edgeObserved: r.action > 0 ? -r.net / r.action : 0,
      edgeTheory: r.action > 0 ? -r.expected / r.action : 0,
      winRate: r.wins + r.losses > 0 ? r.wins / (r.wins + r.losses) : 0,
      netPerSession: r.net / merged.trials,
      actionPerSession: r.action / merged.trials,
    }))
    .filter((r) => r.action > 0)
    .sort((a, b) => b.action - a.action));

  // Reward = exact expected result of the bets made (low noise); risk = simulated spread.
  const frontierSd = paretoFrontier(summaries, (s) => s.expectedNet, (s) => s.sd);
  const frontierCvar = paretoFrontier(summaries, (s) => s.expectedNet, (s) => -s.cvar5);
  summaries.forEach((s, i) => { s.onFrontier = frontierSd.includes(i); s.onCvarFrontier = frontierCvar.includes(i); });

  const d = merged.dice;
  const dice = {
    ...d,
    chi: diceChiSquare(d.sums),
    avgRollsPerGame: d.rolls / Math.max(1, merged.trials * session.games),
    avgHandLength: d.sevenOuts ? (d.rolls - 0) / d.sevenOuts : 0,
    theory: theoryFor(rules),
  };

  const insights = buildInsights(summaries, merged, session, rules);
  return { summaries, bands, breakdown, dice, insights, checkpointGames: merged.checkpointGames, trials: merged.trials, session, rules, paths: merged.strategies.map((o) => o.paths), raw: merged.strategies };
}

const $ = (x) => {
  const v = Math.round(x);
  return `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US')}`;
};
const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;

function buildInsights(S, merged, session, rules) {
  const out = [];
  if (!S.length) return out;
  const by = (k, dir = 1) => [...S].sort((a, b) => dir * (b[k] - a[k]))[0];
  const best = by('score');
  const cheapest = by('edgeTheory', -1);
  const priciest = by('edgeTheory');
  const likely = by('pProfit');
  const safest = by('pRuin', -1);

  const positive = S.filter((s) => s.mean > 0);
  if (!positive.length) {
    out.push({ kind: 'info', title: 'No strategy beats the house', text: `All ${S.length} strategies lost money on average over ${merged.trials.toLocaleString()} simulated sessions. Every bet on a craps table (except free odds) has a built-in edge, so the "best" strategy is the one that buys the most entertainment and upside per dollar of expected loss.` });
  } else {
    for (const s of positive) {
      const lucky = s.mean - s.ci95 <= 0;
      out.push({ kind: lucky ? 'warn' : 'info', title: `${s.name} finished positive`, text: lucky
        ? `Its average of ${$(s.mean)} has a 95% confidence interval of ±${$(s.ci95)}, which includes zero — that's sampling luck, not an edge. Theory says it should average ${$(s.expectedNet)}. Run more sessions to see it converge.`
        : `Average ${$(s.mean)} ± ${$(s.ci95)}. Theory says ${$(s.expectedNet)}. A result this far from theory usually means too few sessions or a very high-variance strategy.` });
    }
  }

  out.push({ kind: 'good', title: `Best overall: ${best.name}`, text: `Balanced score ${best.score}/100. Expected result ${$(best.expectedNet)} per session (simulated ${$(best.mean)}), ${pct(best.pProfit)} chance to walk away ahead, ${pct(best.pRuin)} risk of ruin, and a bad-day (worst 5%) average of ${$(best.cvar5)}.` });

  if (S.length > 1) {
    const ranked = [...S].sort((a, b) => b.score - a.score);
    const [a, b] = ranked;
    const cmp = pairedDifference(merged.strategies[a.index].net, merged.strategies[b.index].net);
    out.push({ kind: cmp.significant ? 'info' : 'warn', title: `${a.name} vs. ${b.name}`, text: cmp.significant
      ? `Played on identical dice, ${a.name} averaged ${$(Math.abs(cmp.mean))} ${cmp.mean >= 0 ? 'more' : 'less'} per session (95% CI ±${$(cmp.ci)}) — a statistically significant difference. It finished ahead of ${b.name} in ${pct(cmp.aBetterShare, 0)} of sessions.`
      : `On identical dice, the average difference is ${$(cmp.mean)} ± ${$(cmp.ci)} — not statistically significant. They rank differently on risk, not on expected value.` });
  }

  if (cheapest !== priciest) {
    out.push({ kind: 'info', title: 'Cost of play', text: `Per dollar wagered, ${cheapest.name} pays the lowest house edge (${pct(cheapest.edgeTheory, 2)}) while ${priciest.name} pays the highest (${pct(priciest.edgeTheory, 2)}). At ~${session.rollsPerHour} rolls/hour the expected cost is about ${$(cheapest.theoryLossPerHour)} vs ${$(priciest.theoryLossPerHour)} per hour.` });
  }

  if (likely !== best) {
    const tailVs = likely.cvar5 < best.cvar5;
    out.push({ kind: tailVs ? 'warn' : 'info', title: `Most likely to win: ${likely.name}`, text: `It finishes ahead ${pct(likely.pProfit)} of the time${tailVs ? `, but its worst 5% of sessions average ${$(likely.cvar5)} (vs ${$(best.cvar5)} for ${best.name}). Frequent small wins are being paid for with rare large losses.` : '.'}` });
  }

  const risky = S.filter((s) => s.pRuin >= 0.05).sort((a, b) => b.pRuin - a.pRuin);
  if (risky.length) {
    out.push({ kind: 'bad', title: 'Risk of ruin', text: `${risky.slice(0, 3).map((s) => `${s.name} (${pct(s.pRuin)})`).join(', ')} ${risky.length > 1 ? 'bust' : 'busts'} the ${$(session.bankroll)} bankroll in at least 5% of sessions. ${safest.pRuin < 0.001 ? `${safest.name} essentially never busts.` : ''}` });
  }

  const progs = S.filter((s) => s.progression !== 'flat');
  if (progs.length) {
    const p = progs[0];
    out.push({ kind: 'info', title: 'Progressions don\'t change the edge', text: `${p.name} wagered ${$(p.avgAction)} per session. Its exact edge on that action is ${pct(p.edgeTheory, 2)} — the same as its underlying bets flat-bet (the simulated ${pct(p.edgeObserved, 2)} differs only by luck). Changing bet sizes reshapes the distribution (see the histogram); it can't remove the edge, and betting more means losing more in dollars.` });
  }

  const noisy = S.filter((s) => s.ci95 > Math.abs(s.expectedNet) * 2 && s.ci95 > 5);
  if (noisy.length && merged.trials < 3000) {
    out.push({ kind: 'warn', title: 'Simulated averages are noisy', text: `With ${merged.trials.toLocaleString()} sessions, averages are only accurate to about ±${$(mean(S.map((s) => s.ci95)))}. Rankings therefore use the exact expected value of the bets each strategy made; run more sessions to sharpen probabilities like P(ahead) and risk of ruin.` });
  }

  // Theory vs simulation agreement
  const zs = S.map((s) => (s.se > 0 ? Math.abs(s.mean - s.expectedNet) / s.se : 0));
  const worst = Math.max(...zs);
  out.push({ kind: worst < 3 ? 'good' : 'warn', title: 'Simulation accuracy', text: worst < 3
    ? `Every strategy's simulated average is within ${worst.toFixed(1)} standard errors of its theoretical expectation — the Monte Carlo has converged. Average standard error: ${$(mean(S.map((s) => s.se)))}.`
    : `At least one strategy's average is ${worst.toFixed(1)} standard errors from theory. That happens with very skewed strategies or few sessions; increase the session count.` });

  if (session.stopLoss || session.winGoal) {
    const g = by('pGoal');
    out.push({ kind: 'info', title: 'Stop rules', text: `${session.winGoal ? `${g.name} reached the ${$(session.winGoal)} win goal most often (${pct(g.pGoal)}). ` : ''}Stop-loss and win-goal rules change how often you leave happy, not the edge per dollar — but by limiting time at the table they do reduce total expected loss.` });
  }
  return out;
}
