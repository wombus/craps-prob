// Betting progressions: rules that change your bet size based on previous results.
//
// Important lesson the simulator demonstrates: a progression changes the *shape* of the
// outcome distribution (more small wins + rare big losses, or the reverse) but it can
// never change the expected loss per dollar wagered. Every bet still carries its edge.

export const PROGRESSIONS = Object.freeze({
  flat: { label: 'Flat (no progression)', describe: 'Same bet every time.' },
  martingale: { label: 'Martingale', describe: 'Double after every loss; reset after a win.' },
  paroli: { label: 'Paroli (reverse Martingale)', describe: 'Double after each win, up to N wins in a row; reset after a loss.' },
  dalembert: { label: "D'Alembert", describe: 'Add one unit after a loss, remove one after a win.' },
  fibonacci: { label: 'Fibonacci', describe: 'Move one step up the Fibonacci sequence after a loss, two steps back after a win.' },
  oneThreeTwoSix: { label: '1-3-2-6', describe: 'Bet 1, 3, 2, 6 units on consecutive wins; reset after a loss or completing the cycle.' },
  oscar: { label: "Oscar's Grind", describe: 'Add a unit after each win until one unit of profit is locked in for the cycle; never raise after a loss.' },
});

const FIB = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987];

export class Progression {
  /** @param {{type:string, maxMultiplier?:number, paroliSteps?:number}} cfg */
  constructor(cfg = {}) {
    this.type = PROGRESSIONS[cfg.type] ? cfg.type : 'flat';
    this.cap = Math.max(1, cfg.maxMultiplier || 32);
    this.paroliSteps = Math.max(1, cfg.paroliSteps || 3);
    this.reset();
  }

  reset() {
    this.mult = 1;
    this.streak = 0;
    this.fibIndex = 0;
    this.cycleNet = 0; // Oscar's Grind: units won/lost in the current cycle
  }

  /** Current bet multiplier (bet = base unit × multiplier). */
  multiplier() { return this.mult; }

  /** Record the outcome of the driver bet: 'win' | 'lose' | 'push'. */
  record(outcome) {
    if (outcome === 'push') return;
    const win = outcome === 'win';
    switch (this.type) {
      case 'flat': return;
      case 'martingale': {
        if (win) this.mult = 1;
        else this.mult = this.mult * 2 > this.cap ? 1 : this.mult * 2; // table/bankroll cap forces a reset
        return;
      }
      case 'paroli': {
        if (!win) { this.reset(); return; }
        this.streak++;
        if (this.streak >= this.paroliSteps) this.reset();
        else this.mult = Math.min(this.cap, 2 ** this.streak);
        return;
      }
      case 'dalembert': {
        this.mult = win ? Math.max(1, this.mult - 1) : Math.min(this.cap, this.mult + 1);
        return;
      }
      case 'fibonacci': {
        this.fibIndex = win ? Math.max(0, this.fibIndex - 2) : Math.min(FIB.length - 1, this.fibIndex + 1);
        let m = FIB[this.fibIndex];
        if (m > this.cap) { this.fibIndex = 0; m = 1; }
        this.mult = m;
        return;
      }
      case 'oneThreeTwoSix': {
        const seq = [1, 3, 2, 6];
        if (!win) { this.reset(); return; }
        this.streak++;
        if (this.streak >= seq.length) this.reset();
        else this.mult = Math.min(this.cap, seq[this.streak]);
        return;
      }
      case 'oscar': {
        this.cycleNet += win ? this.mult : -this.mult;
        if (this.cycleNet >= 1) { this.reset(); return; }
        if (win) {
          // Never bet more than needed to finish the cycle one unit ahead.
          const needed = 1 - this.cycleNet;
          this.mult = Math.min(this.cap, this.mult + 1, Math.max(1, needed));
        }
        return;
      }
    }
  }
}
