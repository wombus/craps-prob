# Craps Lab 🎲

A craps strategy simulator for the browser. It uses casino-accurate rules and paper money. You can:

- **Simulate** any set of betting strategies thousands of times (Monte Carlo) and rank them on risk vs. reward.
- **Explore** hundreds of bet *permutations* automatically to find the efficient mixes.
- **Play** a clickable craps table with paper money, either by hand or by letting one of your strategies place the bets.
- **Learn** the exact probability math behind every bet, computed from the live table rules.

It has no dependencies or build step. It is plain ES modules, Web Workers and hand-written SVG charts.

**▶ Play it online: https://wombus.github.io/craps-prob/** (hosted free on GitHub Pages)

```bash
npm start        # → http://localhost:8080   (any static server works; file:// does not, see below)
npm test         # 53 engine tests with Node's built-in test runner (Node 18+)
```

---

## What you can do

| Tab | What it's for |
|---|---|
| **Simulator** | Pick or build strategies, set bankroll, games per session, number of sessions, stop-loss and win goal, then press Run. You get headline tiles, written findings, a sortable ranking, a risk-vs-reward frontier, outcome distributions, bankroll fan charts, sample sessions, a per-bet breakdown and dice diagnostics. CSV/JSON export is included. |
| **Strategy Explorer** | Choose options in 8 dimensions: line bet, odds, come bets, box numbers, press/regress, field, hardways and progression. The app builds every unique combination, simulates them all on the same dice, ranks them, and shows the average effect of each individual choice. Send the winners to the Simulator. |
| **Live Table** | A full layout covering Pass/Don't, Come/Don't Come with odds, Place/Buy/Lay, the Field (numbers 2, 3, 4, 9, 10, 11, 12 printed on the felt), Hardways, one-roll numbers 2, 3, 11, 12, Any 7, Any Craps, Horn, C&E and Big 6/8. You get a chip rack, Remove mode (or right-click) and a "set dice" option for learning. Auto-play runs any saved strategy roll by roll using the same executor as the simulator. |
| **Odds & Learn** | The 36 dice combinations, a probability table for sums 2–12, and the house edge of every bet under *your* table rules. It also shows how odds dilute the edge and explains the statistics used. |
| **Table Rules** | Game (standard or **crapless**), table min/max, odds limit (1x … 3‑4‑5x … 100x), field 2/12 payouts, payout rounding, commission rate and timing, and which bets work on the come-out. Casino presets are included. |

### Where are 2, 3, 11 and 12?

In **standard craps** they aren't box numbers. They decide the come-out roll at once: 2, 3 and 12 are "craps" (Pass loses) and 11 is "yo" (Pass wins). On the felt you bet them in three places:

- the **Field**,
- the **one-roll props**: Aces (2) 30:1, Ace-Deuce (3) 15:1, Yo (11) 15:1, Boxcars (12) 30:1,
- the **Horn** (all four at once, 12.5% edge) and **C&E**.

In **crapless craps** (Table Rules → Game) they become box numbers:

- They can be the point, and Place pays 11:2 on 2/12 and 11:4 on 3/11. Odds pay 6:1 and 3:1.
- Only a come-out 7 wins. There are no Don't bets.
- The Pass Line edge jumps from 1.41% to 5.38%. The simulator and the Odds & Learn tab show why.

### Casino accuracy

Everything below follows standard Las Vegas practice by default, and every item can be changed on the Rules tab.

- Pass pays 1:1. Don't Pass bars 12 (push).
- Free odds pay true odds (2:1, 3:2, 6:5). Lay odds may win up to the same multiple, which means "6x on the don't" at a 3‑4‑5x table.
- Place bets pay 9:5 / 7:5 / 7:6. **Payouts are rounded down to the chip**, so a $10 Place 6 wins $11, not $11.67. Bet $12.
- Buy and Lay pay true odds minus 5% commission, rounded down with a $1 minimum. You choose whether it's charged on wins only or on every decision.
- Field pays 2:1 on 2 and 2:1 or 3:1 on 12. Hardways pay 9:1 or 7:1. Props use standard "to 1" payouts. Horn is split four ways (27:4 on 2/12, 3:1 on 3/11) and C&E two ways (3:1 craps, 7:1 eleven).
- Come odds are **off** on the come-out. Place, buy, lay and hardway bets are off on the come-out. Don't-side odds always work.
- The table enforces minimums ($12 on 6/8 at a $10 table), maximums and odds limits. Contract bets can't be removed once a point is set.

---

## How it works, step by step

The engine is pure JavaScript with no DOM access, so the same code runs in the browser UI, in Web Workers and in the Node tests.

```
js/engine/
  constants.js     dice facts (ways to roll each sum), bet keys and labels
  rules.js         table rules, payout math, exact house-edge / EV formulas
  table.js         CrapsTable: the puck + bets state machine; roll() → events
  session.js       PlayerSession: bankroll, legal bet placement, ledger, EV tally
  strategy.js      strategy schema, validation, and the StrategyExecutor
  progressions.js  Martingale, Paroli, D'Alembert, Fibonacci, 1-3-2-6, Oscar's Grind
  rng.js           seeded sfc32 PRNG + unbiased die (rejection sampling)
  simulator.js     playSession() / runBatch(): the Monte Carlo loop
  stats.js         percentiles, CVaR, Wilson CIs, χ² test, Pareto frontier, scoring
  analysis.js      raw results → summaries, rankings, chart data, plain-English insights
  presets.js       20 classic strategies, scaled to the table minimum
  permutations.js  the explorer's combination generator (with de-duplication)
js/sim/
  worker.js        Web Worker entry: runs a slice of trials off the main thread
  runner.js        worker pool: splits trials across cores, merges results in order
js/ui/             DOM + SVG rendering (no framework)
```

### 1. The table is a state machine

`CrapsTable.roll(d1, d2)` resolves every bet against the dice and moves the puck. It doesn't touch money. It returns **events** such as `{key: 'place6', outcome: 'win', net: 14, credit: 14}`. `PlayerSession` applies those events to the bankroll and a ledger. Keeping the table separate from the money makes each part small and easy to test. The tests in `tests/table.test.js` roll specific dice and check each rule.

### 2. Strategies are data, not code

A strategy is a plain JSON object, for example `{line: {type: 'pass', amount: 10, odds: 'max'}, place: {...}, progression: {...}}`. That one object can be:

- edited in the form,
- saved to localStorage,
- exported and imported,
- generated by the Explorer,
- sent to a Web Worker.

Functions can't be serialized, but data can. The `StrategyExecutor` reads the object and, before every roll, makes the table match it. It places a missing line bet, tops up odds, keeps N come bets working, presses or regresses place bets, and so on.

### 3. Monte Carlo: from "what might happen" to a distribution

One **trial** is one casino session. You start with the bankroll and play `games` pass-line decisions (about 3.38 rolls each). The session ends early if you bust (can't cover your smallest bet) or hit the stop-loss or win goal. Any bets left on the table at the end are resolved: contract bets play out and standing bets are taken down. Run that 5,000 times and you get 5,000 final results. Every statistic in the dashboard comes from that sample.

### 4. Two tricks that make comparisons trustworthy

- **Common random numbers.** Trial *i* uses the same seed for every strategy, so all strategies face *identical dice*. Differences in results then come from the strategies, not luck. The "A vs B" insight uses a *paired* comparison that takes advantage of this.
- **Exact expectation alongside simulation.** Each time a bet reaches a decision, the session adds that bet's exact EV (from `rules.js`) to a running tally. That gives each strategy's *true* expected result with almost no sampling noise, even after only a few hundred sessions. Rankings use this exact figure for reward and edge. They use simulated values only where simulation is the only option: chance of profit, risk of ruin, bad-day loss and drawdown. The "Simulation accuracy" insight checks that the two agree within a few standard errors.

### 5. Parallelism and determinism

`SimRunner` splits trials into contiguous ranges, one per CPU core, and runs them in Web Workers. Results come back as transferable typed arrays (zero-copy) and are stitched together **in trial order**. Each trial's seed depends only on `(baseSeed, trialIndex)`, so the output is bit-for-bit identical whatever the core count. A test checks this. Throughput is about 2–3 million rolls per second per core.

### 6. Turning numbers into decisions

| Metric | What it tells you |
|---|---|
| Expected / simulated average | Reward: what the strategy costs you on average per session |
| P(ahead) | How often you walk away a winner |
| Risk of ruin | How often you go broke |
| Worst 5% (CVaR) | Your realistic bad night |
| Volatility, drawdown | How wild the ride is |
| Edge (exact / simulated) | Cost per dollar wagered |
| Cost per hour | Edge × action per roll × rolls per hour |

**Balanced score** is a weighted percentile rank within the current run: expected result 25%, P(ahead) 25%, ruin 20%, CVaR 20%, edge 10%. The more principled view is the **efficient frontier**, the set of strategies that no other strategy beats on both reward and risk.

### Things the simulator shows well

- **No strategy has a positive expectation.** Free odds lower the *edge per dollar*, but nothing makes it negative.
- **Progressions change the shape, not the edge.** Martingale wins more often and loses catastrophically. It also produces a *median* bankroll line that climbs and then falls off a cliff, because its outcomes are bimodal (sessions that have hit a losing streak vs. those that haven't yet).
- **Max odds** gives the lowest edge but the widest swings, which brings real risk of ruin on a small bankroll.

---

## Charts

The charts are hand-written SVG, with a hover tooltip on every mark and a table view of each figure in the ranking and breakdown tables. The categorical palette was validated for color-vision deficiency and contrast on the dark surface. Each strategy keeps its color in every chart, so colors follow strategies, not ranks.

## Hosting (GitHub Pages)

The site is the repository itself: `index.html` at the root, with relative paths throughout. GitHub Pages serves it with no build step:

1. In the repository, open **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to *Deploy from a branch*. Then set **Branch** to `main` and the folder to `/ (root)`, and click **Save**.
3. After about a minute the site is live at `https://<user>.github.io/<repo>/`. Every push to `main` redeploys it automatically.

The empty `.nojekyll` file tells Pages to serve the files exactly as they are, without its default Jekyll build. `assets/og-image.png` and the `og:` meta tags in `index.html` give shared links a title, description and preview image. If you fork the repo, update the URLs in those tags.

Each visitor's strategies and settings are saved in their own browser (localStorage). Nothing is sent to a server, so friends can't see or change each other's data.

## Why a local server?

Browsers block ES-module imports and module Web Workers from `file://` URLs. `npm start` runs a tiny dependency-free static server (`scripts/serve.mjs`). Any other static host also works, such as `python3 -m http.server` or GitHub Pages.

---

*For education and entertainment. Every craps bet except free odds carries a house edge, and no betting system changes that.*
