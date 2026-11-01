// Seeded pseudo-random number generation.
//
// Why seeded? Two reasons:
//  1. Reproducibility — the same seed gives the same dice, so a result can be re-checked.
//  2. Common random numbers — every strategy in a comparison is played against the
//     *identical* sequence of dice for trial i. Differences between strategies then come
//     from the strategies, not from one of them getting luckier dice. This is a standard
//     variance-reduction technique in Monte Carlo comparisons.

/** splitmix32: a tiny, well-mixed hash used to expand seeds. */
export function splitmix32(a) {
  a |= 0;
  a = (a + 0x9e3779b9) | 0;
  let t = a ^ (a >>> 16);
  t = Math.imul(t, 0x21f0aaad);
  t ^= t >>> 15;
  t = Math.imul(t, 0x735a2d97);
  t ^= t >>> 15;
  return t >>> 0;
}

/** Derive an independent 32-bit seed for a trial from the base seed. */
export function trialSeed(baseSeed, trial) {
  return splitmix32((baseSeed >>> 0) ^ splitmix32(trial + 0x51ed27));
}

/**
 * sfc32 (Small Fast Counting) PRNG — passes PractRand/BigCrush, very fast in JS.
 */
export function makeRng(seed) {
  let a = splitmix32(seed);
  let b = splitmix32(a);
  let c = splitmix32(b);
  let d = 1;
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return t >>> 0;
  };
  for (let i = 0; i < 12; i++) next(); // warm up
  // 2^32 is not divisible by 6; reject the top sliver so each face is exactly 1/6.
  const LIMIT = 4294967292; // 6 * 715827882
  return {
    next,
    float: () => next() / 4294967296,
    die() {
      let x;
      do { x = next(); } while (x >= LIMIT);
      return (x % 6) + 1;
    },
  };
}

/** Cryptographically strong die for the Live Table (falls back to Math.random). */
export function cryptoDie() {
  const c = globalThis.crypto;
  if (c && c.getRandomValues) {
    const buf = new Uint32Array(1);
    const LIMIT = 4294967292;
    do { c.getRandomValues(buf); } while (buf[0] >= LIMIT);
    return (buf[0] % 6) + 1;
  }
  return 1 + Math.floor(Math.random() * 6);
}

export function randomSeed() {
  const c = globalThis.crypto;
  if (c && c.getRandomValues) return c.getRandomValues(new Uint32Array(1))[0] % 1000000000;
  return Math.floor(Math.random() * 1e9);
}
