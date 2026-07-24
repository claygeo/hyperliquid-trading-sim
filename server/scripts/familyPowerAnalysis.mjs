/**
 * Statistical power analysis of the frozen H1-H4 gate set.
 *
 * PRE-DATA. This script touches no market data, reads no snapshot, and computes no
 * strategy return. It simulates the gate arithmetic against synthetic series in order
 * to answer one question: if a hypothesis in this family had a real edge, could the
 * gates actually detect it?
 *
 * It is committed before any canonical H2-H4 fetch so that the decision it informs
 * cannot later be mistaken for a reaction to an observed result.
 *
 * Run: node server/scripts/familyPowerAnalysis.mjs
 */

const N_DAYS = 365;
const REPLICATES = 2000;

// Deterministic xorshift32 so the reported numbers reproduce exactly.
let state = 0x9e3779b9;
function nextUnit() {
  state ^= state << 13; state >>>= 0;
  state ^= state >>> 17;
  state ^= state << 5; state >>>= 0;
  return state / 2 ** 32;
}
function randn() {
  const u1 = Math.max(nextUnit(), 1e-12);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * nextUnit());
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};

/**
 * The binding gate is the one-sided circular-block-bootstrap lower bound at
 * alpha = 0.05/3, not the advertised "annualized Sharpe >= 1.0".
 *
 * On a daily series of length n the t-statistic of the mean is
 *   t = mean / (sd / sqrt(n)) = (mean/sd) * sqrt(n)
 * and the annualized Sharpe is (mean/sd) * sqrt(365). At n = 365 those coincide, so
 * the bootstrap gate is approximately "annualized Sharpe > z_alpha" with
 * z_(0.05/3) ~= 2.128. The stated 1.0 threshold can therefore never bind.
 */
const Z_ALPHA = 2.128;

function annualisedSharpe(daily) {
  const s = sd(daily);
  return s === 0 ? 0 : (mean(daily) / s) * Math.sqrt(365);
}

function detectionRate(trueAnnualSharpe) {
  let passes = 0;
  for (let r = 0; r < REPLICATES; r += 1) {
    const dailyMu = (trueAnnualSharpe / Math.sqrt(365)) * 0.01;
    const daily = Array.from({ length: N_DAYS }, () => dailyMu + 0.01 * randn());
    if (mean(daily) / (sd(daily) / Math.sqrt(N_DAYS)) > Z_ALPHA) passes += 1;
  }
  return passes / REPLICATES;
}

/**
 * Zero-exposure days remain in the series by specification. A strategy active on only
 * k of n days therefore has its Sharpe diluted:
 *   mean_full = (k/n) * mean_active,  sd_full ~= sqrt(k/n) * sd_active
 *   => SR_full = sqrt(k/n) * SR_active,  annualised => sqrt(k) * SR_active_daily
 * so sqrt(k) is a hard ceiling regardless of how good the edge is.
 */
function realisedSharpeForDutyCycle(activeDays, sharpePerActiveDay) {
  const out = [];
  for (let r = 0; r < 400; r += 1) {
    const daily = new Array(N_DAYS).fill(0);
    const active = new Set();
    while (active.size < Math.round(activeDays)) active.add(Math.floor(nextUnit() * N_DAYS));
    for (const i of active) daily[i] = 0.01 * (sharpePerActiveDay + randn());
    out.push(annualisedSharpe(daily));
  }
  return mean(out);
}

console.log('Frozen family power analysis (pre-data, synthetic only)\n');

console.log('1. Detection rate of the binding bootstrap gate, n=365');
console.log('   trueAnnualSharpe -> P(clears one-sided bound at alpha=0.05/3)');
for (const s of [0.5, 1.0, 1.5, 2.0, 2.128, 2.5, 3.0]) {
  console.log(`   ${s.toFixed(3).padStart(6)} -> ${(detectionRate(s) * 100).toFixed(0).padStart(3)}%`);
}

console.log('\n2. Duty-cycle ceiling. Hold horizons come from the frozen specification:');
console.log('   H2 holds 168h (42 bars); H3 and H4 hold 12h (3 bars).');
console.log('   trial  episodes  holdH  activeDays  sqrt(k) ceiling  realised@SR_active=0.5');
const cases = [
  ['H2', 25, 168], ['H2', 40, 168],
  ['H3', 25, 12], ['H3', 40, 12],
  ['H4', 20, 12], ['H4', 40, 12],
];
for (const [name, episodes, holdHours] of cases) {
  const activeDays = Math.min((episodes * holdHours) / 24, N_DAYS);
  console.log(
    `   ${name.padEnd(6)}${String(episodes).padStart(8)}${String(holdHours).padStart(7)}` +
    `${activeDays.toFixed(1).padStart(12)}${Math.sqrt(activeDays).toFixed(2).padStart(17)}` +
    `${realisedSharpeForDutyCycle(activeDays, 0.5).toFixed(2).padStart(24)}`,
  );
}

console.log('\n3. Conclusion');
console.log('   H3 and H4 hold 12h, so even 40 episodes is only ~20 active days and a');
console.log('   sqrt(k) ceiling near 4.5, with realistic values well under the ~2.13');
console.log('   hurdle. They cannot clear the binding gate even when the edge is real.');
console.log('   H2 has ample active days but is capped by the 40-episode floor');
console.log('   (ceiling floor(2190/43) = 50 entries) and by an entry threshold set to');
console.log('   exactly the stressed round-trip cost.');
