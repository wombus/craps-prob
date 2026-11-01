// The craps table as a state machine.
//
// State: the puck (point ON/OFF) and the list of bets on the layout.
// Transition: roll(d1, d2) resolves every bet against the dice and moves the puck.
//
// The table knows nothing about bankrolls; it returns a list of *events* describing
// what happened to each bet. PlayerSession turns those events into money.

import { isPointNumber, PROPS, STANDING_TYPES, betKey } from './constants.js';
import { payoutTerms } from './rules.js';

/**
 * @typedef {object} Bet
 * @property {number} id
 * @property {string} type    pass | come | dontPass | dontCome | place | buy | lay | hard | big | field | <prop>
 * @property {number} amount  flat amount
 * @property {number} [number] box number for place/buy/lay/hard/big
 * @property {number|null} [point] for line bets: the number the bet is "on" (null = waiting for come-out/travel)
 * @property {number} [odds]  odds amount behind a line bet
 */

/**
 * @typedef {object} BetEvent
 * @property {Bet} bet
 * @property {string} key     ledger key (e.g. "place6", "passOdds")
 * @property {string} evType  type used for EV lookup ("place", "passOdds", ...)
 * @property {number} number  number relevant to the payout (point / box number)
 * @property {'win'|'lose'|'push'|'return'|'move'} outcome
 * @property {number} amount  amount at risk in this decision
 * @property {number} net     player's profit/loss from this decision
 * @property {number} credit  chips returned to the player's rack
 */

export class CrapsTable {
  constructor(rules) {
    this.rules = rules;
    this.point = null;
    /** @type {Bet[]} */
    this.bets = [];
    this._nextId = 1;
  }

  get isComeOut() { return this.point === null; }

  addBet(bet) {
    bet.id = this._nextId++;
    if (bet.type === 'pass' || bet.type === 'come' || bet.type === 'dontPass' || bet.type === 'dontCome') {
      bet.point = bet.point ?? null;
      bet.odds = bet.odds || 0;
    }
    this.bets.push(bet);
    return bet;
  }

  removeBet(bet) {
    const i = this.bets.indexOf(bet);
    if (i >= 0) this.bets.splice(i, 1);
  }

  find(type, number) {
    for (const b of this.bets) if (b.type === type && (number === undefined || b.number === number)) return b;
    return null;
  }

  /**
   * Resolve all bets for one roll of the dice.
   * @returns {{d1:number,d2:number,sum:number,hard:boolean,wasComeOut:boolean,pointBefore:number|null,
   *   pointAfter:number|null,events:BetEvent[],pointEstablished:boolean,pointMade:boolean,sevenOut:boolean,
   *   natural:boolean,crapsOut:boolean,gameOver:boolean}}
   */
  roll(d1, d2) {
    const sum = d1 + d2;
    const hard = d1 === d2;
    const comeOut = this.point === null;
    const rules = this.rules;
    const events = [];
    const keep = [];

    for (const bet of this.bets) {
      if (this._resolve(bet, sum, hard, comeOut, rules, events)) keep.push(bet);
    }
    this.bets = keep;

    const pointBefore = this.point;
    let pointEstablished = false, pointMade = false, sevenOut = false, natural = false, crapsOut = false;
    if (comeOut) {
      if (isPointNumber(sum)) { this.point = sum; pointEstablished = true; }
      else if (sum === 7 || sum === 11) natural = true;
      else crapsOut = true;
    } else if (sum === this.point) {
      this.point = null; pointMade = true;
    } else if (sum === 7) {
      this.point = null; sevenOut = true;
    }
    return {
      d1, d2, sum, hard, wasComeOut: comeOut, pointBefore, pointAfter: this.point, events,
      pointEstablished, pointMade, sevenOut, natural, crapsOut,
      gameOver: natural || crapsOut || pointMade || sevenOut,
    };
  }

  // Returns true if the bet stays on the table.
  _resolve(bet, sum, hard, comeOut, rules, events) {
    switch (bet.type) {
      case 'pass': case 'come': return this._resolveDo(bet, sum, comeOut, rules, events);
      case 'dontPass': case 'dontCome': return this._resolveDont(bet, sum, rules, events);
      case 'place': case 'buy': {
        if (!rules.placeWorkingOnComeOut && comeOut && !bet.working) return true;
        if (sum === bet.number) { this._emit(events, bet, bet.type, bet.number, 'win', bet.amount, rules); return true; }
        if (sum === 7) { this._emit(events, bet, bet.type, bet.number, 'lose', bet.amount, rules); return false; }
        return true;
      }
      case 'lay': {
        if (!rules.placeWorkingOnComeOut && comeOut && !bet.working) return true;
        if (sum === 7) { this._emit(events, bet, 'lay', bet.number, 'win', bet.amount, rules); return true; }
        if (sum === bet.number) { this._emit(events, bet, 'lay', bet.number, 'lose', bet.amount, rules); return false; }
        return true;
      }
      case 'hard': {
        if (!rules.hardWorkingOnComeOut && comeOut && !bet.working) return true;
        if (sum === bet.number && hard) { this._emit(events, bet, 'hard', bet.number, 'win', bet.amount, rules); return true; }
        if (sum === bet.number || sum === 7) { this._emit(events, bet, 'hard', bet.number, 'lose', bet.amount, rules); return false; }
        return true;
      }
      case 'big': {
        if (sum === bet.number) { this._emit(events, bet, 'big', bet.number, 'win', bet.amount, rules); return true; }
        if (sum === 7) { this._emit(events, bet, 'big', bet.number, 'lose', bet.amount, rules); return false; }
        return true;
      }
      case 'field': {
        const wins = sum === 2 || sum === 3 || sum === 4 || sum === 9 || sum === 10 || sum === 11 || sum === 12;
        this._emit(events, bet, 'field', 0, wins ? 'win' : 'lose', bet.amount, rules, sum);
        return false;
      }
      default: {
        const prop = PROPS[bet.type];
        if (!prop) throw new Error(`Unknown bet type ${bet.type}`);
        this._emit(events, bet, bet.type, 0, prop.wins.includes(sum) ? 'win' : 'lose', bet.amount, rules);
        return false;
      }
    }
  }

  _resolveDo(bet, sum, comeOut, rules, events) {
    if (bet.point === null) {
      if (sum === 7 || sum === 11) { this._emit(events, bet, bet.type, 0, 'win', bet.amount, rules); return false; }
      if (sum === 2 || sum === 3 || sum === 12) { this._emit(events, bet, bet.type, 0, 'lose', bet.amount, rules); return false; }
      bet.point = sum;
      events.push({ bet, key: betKey(bet), evType: bet.type, number: sum, outcome: 'move', amount: bet.amount, net: 0, credit: 0 });
      return true;
    }
    // Pass odds always work while the point is on. Come odds are "off" on the come-out by default.
    const oddsWorking = bet.type === 'pass' || !comeOut || rules.comeOddsWorkingOnComeOut || bet.oddsWorking === true;
    const oddsType = bet.type + 'Odds';
    if (sum === bet.point) {
      this._emit(events, bet, bet.type, bet.point, 'win', bet.amount, rules);
      if (bet.odds > 0) this._emit(events, bet, oddsType, bet.point, oddsWorking ? 'win' : 'return', bet.odds, rules);
      return false;
    }
    if (sum === 7) {
      this._emit(events, bet, bet.type, bet.point, 'lose', bet.amount, rules);
      if (bet.odds > 0) this._emit(events, bet, oddsType, bet.point, oddsWorking ? 'lose' : 'return', bet.odds, rules);
      return false;
    }
    return true;
  }

  _resolveDont(bet, sum, rules, events) {
    if (bet.point === null) {
      if (sum === 2 || sum === 3) { this._emit(events, bet, bet.type, 0, 'win', bet.amount, rules); return false; }
      if (sum === 12) { this._emit(events, bet, bet.type, 0, 'push', bet.amount, rules); return false; } // "Bar 12"
      if (sum === 7 || sum === 11) { this._emit(events, bet, bet.type, 0, 'lose', bet.amount, rules); return false; }
      bet.point = sum;
      events.push({ bet, key: betKey(bet), evType: bet.type, number: sum, outcome: 'move', amount: bet.amount, net: 0, credit: 0 });
      return true;
    }
    // Lay odds on Don't bets are always working.
    const oddsType = bet.type + 'Odds';
    if (sum === 7) {
      this._emit(events, bet, bet.type, bet.point, 'win', bet.amount, rules);
      if (bet.odds > 0) this._emit(events, bet, oddsType, bet.point, 'win', bet.odds, rules);
      return false;
    }
    if (sum === bet.point) {
      this._emit(events, bet, bet.type, bet.point, 'lose', bet.amount, rules);
      if (bet.odds > 0) this._emit(events, bet, oddsType, bet.point, 'lose', bet.odds, rules);
      return false;
    }
    return true;
  }

  _emit(events, bet, evType, number, outcome, amount, rules, sum = 0) {
    const isOdds = evType.endsWith('Odds');
    const key = betKey(bet, isOdds);
    let net = 0, credit = 0;
    if (outcome === 'win') {
      const t = payoutTerms(evType, number, amount, rules, sum);
      net = t.profit - t.feeOnWin;
      // Standing bets stay up: only the winnings come back. Everything else returns stake + win.
      credit = (!isOdds && STANDING_TYPES.has(bet.type)) ? net : amount + net;
    } else if (outcome === 'lose') {
      const t = payoutTerms(evType, number, amount, rules, sum);
      net = -(amount + t.feeOnLoss);
      credit = -t.feeOnLoss;
    } else if (outcome === 'push' || outcome === 'return') {
      credit = amount;
    }
    events.push({ bet, key, evType, number, outcome, amount, net, credit });
  }
}
