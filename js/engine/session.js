// A player at the table: bankroll (the chip rack), bet placement rules, and a ledger.
//
// PlayerSession is shared by the Monte Carlo simulator and the interactive Live Table,
// so both enforce exactly the same casino rules.

import { CrapsTable } from './table.js';
import { isPointNumber, PROPS, REMOVABLE_TYPES, betKey, keyLabel } from './constants.js';
import { maxTakeOdds, maxLayOdds, UNITS, makeEvCache } from './rules.js';

const LINE_TYPES = new Set(['pass', 'come', 'dontPass', 'dontCome']);
const NUMBER_TYPES = new Set(['place', 'buy', 'lay']);

/** Minimum bet for a bet type at this table. */
export function minimumFor(type, number, rules) {
  if (PROPS[type]) return rules.propMin * (PROPS[type].units || 1); // Horn = 4 units, C&E = 2 units
  if (type === 'hard') return rules.propMin;
  if (type === 'place' && (number === 6 || number === 8)) {
    // At a $10 table, place 6/8 minimum is $12 (next multiple of $6).
    return Math.ceil(rules.tableMin / 6 - 1e-9) * 6;
  }
  if (type === 'place') return Math.ceil(rules.tableMin / 5 - 1e-9) * 5;
  return rules.tableMin;
}

/** Ledger: per-bet-key aggregates for the analytics breakdown. */
export class Ledger {
  constructor() { this.byKey = Object.create(null); }
  record(ev, expected) {
    let r = this.byKey[ev.key];
    if (!r) r = this.byKey[ev.key] = { action: 0, net: 0, expected: 0, wins: 0, losses: 0, pushes: 0 };
    r.net += ev.net;
    if (ev.outcome === 'win') { r.wins++; r.action += ev.amount; r.expected += expected; }
    else if (ev.outcome === 'lose') { r.losses++; r.action += ev.amount; r.expected += expected; }
    else if (ev.outcome === 'push') { r.pushes++; r.action += ev.amount; r.expected += expected; }
  }
}

export class PlayerSession {
  constructor(rules, bankroll, { trackLedger = true } = {}) {
    this.rules = rules;
    this.table = new CrapsTable(rules);
    this.startBankroll = bankroll;
    this.bankroll = bankroll;   // chips in the rack
    this.rolls = 0;
    this.action = 0;            // total $ that reached a decision
    this.expected = 0;          // theoretical expected net of all decisions made
    this.ledger = trackLedger ? new Ledger() : null;
    this._ev = makeEvCache(rules);
  }

  /** Chips currently on the layout. */
  get onTable() {
    let s = 0;
    for (const b of this.table.bets) s += b.amount + (b.odds || 0);
    return s;
  }
  /** Rack + table: what you'd have if every removable bet came down at par. */
  get equity() { return this.bankroll + this.onTable; }
  get net() { return this.equity - this.startBankroll; }

  // ---------------------------------------------------------------------------
  // Placement
  // ---------------------------------------------------------------------------

  /**
   * Validate a new bet (or an increase to an existing one). Returns an error string or null.
   */
  checkPlacement(type, number, amount, existing = null) {
    const r = this.rules, t = this.table;
    if (!(amount > 0)) return 'Bet amount must be positive.';
    if (amount > this.bankroll + 1e-9) return 'Not enough chips in your rack.';
    const total = amount + (existing ? existing.amount : 0);
    if (total > r.tableMax + 1e-9) return `Table maximum is $${r.tableMax}.`;
    const min = minimumFor(type, number, r);
    if (total < min - 1e-9) return `Minimum for ${labelFor(type, number)} is $${min}.`;
    switch (type) {
      case 'pass': case 'dontPass':
        if (type === 'dontPass' && r.game === 'crapless') return "Crapless craps has no Don't Pass or Don't Come.";
        if (!t.isComeOut && !existing) return `${labelFor(type)} bets are made on the come-out roll.`;
        if (existing && existing.point !== null) return 'You cannot change a line bet once the point is set — add odds instead.';
        break;
      case 'come': case 'dontCome':
        if (type === 'dontCome' && r.game === 'crapless') return "Crapless craps has no Don't Pass or Don't Come.";
        if (t.isComeOut) return `${labelFor(type)} bets are only allowed after a point is established.`;
        if (existing && existing.point !== null) return 'That bet already traveled to a number.';
        break;
      case 'place': case 'buy': case 'lay':
        if (!isPointNumber(number, r)) {
          return [2, 3, 11, 12].includes(number)
            ? `${number} is only a box number at a Crapless craps table (switch the game on the Table Rules tab).`
            : 'Invalid number.';
        }
        if (type === 'lay' && !isPointNumber(number)) return 'Lay bets are offered on 4, 5, 6, 8, 9 and 10.';
        if (type !== 'lay') {
          const other = t.find(type === 'place' ? 'buy' : 'place', number);
          if (other) return `You already have a ${other.type} bet on ${number}.`;
        }
        break;
      case 'hard':
        if (![4, 6, 8, 10].includes(number)) return 'Hardways are 4, 6, 8 and 10.';
        break;
      case 'big':
        if (number !== 6 && number !== 8) return 'Big 6 / Big 8 only.';
        break;
      case 'field': break;
      default:
        if (!PROPS[type]) return `Unknown bet ${type}.`;
    }
    return null;
  }

  /** Find the existing bet a new chip would merge into (same spot). */
  findMergeTarget(type, number) {
    const t = this.table;
    for (const b of t.bets) {
      if (b.type !== type) continue;
      if (LINE_TYPES.has(type)) { if (b.point === null) return b; continue; }
      if (NUMBER_TYPES.has(type) || type === 'hard' || type === 'big') { if (b.number === number) return b; continue; }
      return b;
    }
    return null;
  }

  /** Place (or add to) a bet. Returns {ok, error, bet}. */
  place(type, number, amount, { merge = true } = {}) {
    const existing = merge ? this.findMergeTarget(type, number) : null;
    const err = this.checkPlacement(type, number, amount, existing);
    if (err) return { ok: false, error: err };
    this.bankroll -= amount;
    if (existing) { existing.amount += amount; return { ok: true, bet: existing }; }
    const bet = { type, amount };
    if (number !== undefined && number !== null && !LINE_TYPES.has(type)) bet.number = number;
    return { ok: true, bet: this.table.addBet(bet) };
  }

  maxOddsFor(bet) {
    if (bet.point === null || bet.point === undefined) return 0;
    if (bet.type === 'pass' || bet.type === 'come') return maxTakeOdds(bet.amount, bet.point, this.rules);
    return maxLayOdds(bet.amount, bet.point, this.rules);
  }

  /** Add odds behind a line bet. Clamps to the table's odds limit when `clamp` is set. */
  addOdds(bet, amount, { clamp = false } = {}) {
    if (!bet || !LINE_TYPES.has(bet.type)) return { ok: false, error: 'Odds go behind a Pass, Come, Don\'t Pass or Don\'t Come bet.' };
    if (bet.point === null) return { ok: false, error: 'Odds can only be taken once the bet has a point.' };
    const room = this.maxOddsFor(bet) - bet.odds;
    if (room <= 1e-9) return { ok: false, error: `Odds are already at the ${this.rules.oddsLimit} maximum.` };
    if (amount > room + 1e-9) {
      if (!clamp) return { ok: false, error: `Maximum additional odds here is $${fmt(room)}.` };
      amount = room;
    }
    if (amount > this.bankroll + 1e-9) return { ok: false, error: 'Not enough chips in your rack.' };
    this.bankroll -= amount;
    bet.odds += amount;
    return { ok: true, bet, amount };
  }

  removeOdds(bet, amount = Infinity) {
    if (!bet || !(bet.odds > 0)) return 0;
    const take = Math.min(amount, bet.odds);
    bet.odds -= take;
    this.bankroll += take;
    return take;
  }

  canRemove(bet) {
    return REMOVABLE_TYPES.has(bet.type);
  }

  /** Take a removable bet down (and its odds). Returns the amount returned. */
  takeDown(bet) {
    if (!this.canRemove(bet)) return 0;
    const back = bet.amount + (bet.odds || 0);
    this.table.removeBet(bet);
    this.bankroll += back;
    return back;
  }

  /** Reduce a standing bet (e.g. regress a place bet from $30 to $12). */
  reduce(bet, newAmount) {
    if (!this.canRemove(bet) || newAmount >= bet.amount) return 0;
    if (newAmount <= 0) return this.takeDown(bet);
    const back = bet.amount - newAmount;
    bet.amount = newAmount;
    this.bankroll += back;
    return back;
  }

  // ---------------------------------------------------------------------------
  // Rolling
  // ---------------------------------------------------------------------------

  roll(d1, d2) {
    const res = this.table.roll(d1, d2);
    this.rolls++;
    for (const ev of res.events) {
      this.bankroll += ev.credit;
      if (ev.outcome === 'win' || ev.outcome === 'lose' || ev.outcome === 'push') {
        const exp = this._ev(ev.evType, ev.number, ev.amount);
        this.action += ev.amount;
        this.expected += exp;
        if (this.ledger) this.ledger.record(ev, exp);
      }
    }
    return res;
  }
}

export function labelFor(type, number) {
  const fake = { type, number };
  return keyLabel(betKey(fake));
}

export const fmt = (x) => (Math.round(x * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });

export { UNITS };
