/* eslint-disable @typescript-eslint/no-loss-of-precision -- Cephes and AS241 constants intentionally round to Float64. */

import { type StrategyId, type TrialVerdict } from './contracts.js';
import {
  returnMoments,
  sampleStandardDeviation,
  type ReturnMoments,
} from './metrics.js';

function horner(x: number, coefficients: readonly number[]): number {
  return coefficients.reduceRight((value, coefficient) => value * x + coefficient, 0);
}

const AS241_A = [
  3.3871328727963666080,
  133.14166789178437745,
  1971.5909503065514427,
  13731.693765509461,
  45921.953931549871,
  67265.770927008700,
  33430.575583588128,
  2509.0809287301227,
] as const;
const AS241_B = [
  1,
  42.313330701600911252,
  687.18700749205790830,
  5394.1960214247511,
  21213.794301586596,
  39307.895800092710,
  28729.085735721943,
  5226.4952788528544,
] as const;
const AS241_C = [
  1.42343711074968357734,
  4.63033784615654529590,
  5.76949722146069140550,
  3.64784832476320460504,
  1.27045825245236838258,
  0.24178072517745061177,
  0.0227238449892691845833,
  0.00077454501427834140764,
] as const;
const AS241_D = [
  1,
  2.05319162663775882187,
  1.67638483018380384940,
  0.68976733498510000455,
  0.14810397642748007459,
  0.0151986665636164571966,
  0.00054759380849953449460,
  1.05075007164441684324e-9,
] as const;
const AS241_E = [
  6.65790464350110377720,
  5.46378491116411436990,
  1.78482653991729133580,
  0.29656057182850489123,
  0.026532189526576123093,
  0.0012426609473880784386,
  0.0000271155556874348757815,
  2.01033439929228813265e-7,
] as const;
const AS241_F = [
  1,
  0.59983220655588793769,
  0.13692988092273580531,
  0.0148753612908506148525,
  0.0007868691311456132591,
  0.000018463183175100546818,
  1.42151175831644588870e-7,
  2.04426310338993978564e-15,
] as const;

export function normalInverseCdf(probability: number): number {
  if (!(probability > 0 && probability < 1)) {
    if (probability === 0) return -Infinity;
    if (probability === 1) return Infinity;
    throw new Error('Normal inverse CDF probability must be in [0, 1]');
  }
  const q = probability - 0.5;
  if (Math.abs(q) <= 0.425) {
    const r = 0.180625 - q * q;
    return q * horner(r, AS241_A) / horner(r, AS241_B);
  }
  const tail = q < 0 ? probability : 1 - probability;
  let r = Math.sqrt(-Math.log(tail));
  let value: number;
  if (r <= 5) {
    r -= 1.6;
    value = horner(r, AS241_C) / horner(r, AS241_D);
  } else {
    r -= 5;
    value = horner(r, AS241_E) / horner(r, AS241_F);
  }
  return q < 0 ? -value : value;
}

function cephesPolevl(value: number, coefficients: readonly number[]): number {
  let result = coefficients[0];
  for (let index = 1; index < coefficients.length; index += 1) {
    result = result * value + coefficients[index];
  }
  return result;
}

function cephesP1evl(value: number, coefficients: readonly number[]): number {
  let result = value + coefficients[0];
  for (let index = 1; index < coefficients.length; index += 1) {
    result = result * value + coefficients[index];
  }
  return result;
}

const ERF_T = [
  9.60497373987051638749e0,
  9.00260197203842689217e1,
  2.23200534594684319226e3,
  7.00332514112805075473e3,
  5.55923013010394962768e4,
] as const;
const ERF_U = [
  3.35617141647503099647e1,
  5.21357949780152679795e2,
  4.59432382970980127987e3,
  2.26290000613890934246e4,
  4.92673942608635921086e4,
] as const;
const ERFC_P = [
  2.46196981473530512524e-10,
  5.64189564831068821977e-1,
  7.46321056442269912687e0,
  4.86371970985681366614e1,
  1.96520832956077098242e2,
  5.26445194995477358631e2,
  9.34528527171957607540e2,
  1.02755188689515710272e3,
  5.57535335369399327526e2,
] as const;
const ERFC_Q = [
  1.32281951154744992508e1,
  8.67072140885989742329e1,
  3.54937778887819891062e2,
  9.75708501743205489753e2,
  1.82390916687909736289e3,
  2.24633760818710981792e3,
  1.65666309194161350182e3,
  5.57535340817727675546e2,
] as const;
const ERFC_R = [
  5.64189583547755073984e-1,
  1.27536670759978104416e0,
  5.01905042251180477414e0,
  6.16021097993053585195e0,
  7.40974269950448939160e0,
  2.97886665372100240670e0,
] as const;
const ERFC_S = [
  2.26052863220117276590e0,
  9.39603524938001434673e0,
  1.20489539808096656605e1,
  1.70814450747565897222e1,
  9.60896809063285878198e0,
  3.36907645100081516050e0,
] as const;

function cephesErf(value: number): number {
  if (Math.abs(value) > 1) return 1 - cephesErfc(value);
  const square = value * value;
  return value * cephesPolevl(square, ERF_T) / cephesP1evl(square, ERF_U);
}

function cephesErfc(value: number): number {
  const absolute = Math.abs(value);
  if (absolute < 1) return 1 - cephesErf(value);
  const exponential = Math.exp(-absolute * absolute);
  if (exponential === 0) return value < 0 ? 2 : 0;
  const numerator = cephesPolevl(absolute, absolute < 8 ? ERFC_P : ERFC_R);
  const denominator = cephesP1evl(absolute, absolute < 8 ? ERFC_Q : ERFC_S);
  const result = exponential * numerator / denominator;
  return value < 0 ? 2 - result : result;
}

export function normalCdf(value: number): number {
  if (value === Infinity) return 1;
  if (value === -Infinity) return 0;
  if (!Number.isFinite(value)) throw new Error('Normal CDF input must be finite');
  return 0.5 * cephesErfc(-value / Math.SQRT2);
}

export interface DsrTrialInput {
  id: 'H1' | StrategyId;
  returns: readonly number[];
}

export interface DsrTrialResult {
  id: 'H1' | StrategyId;
  moments: ReturnMoments;
  selectionSharpe: number | null;
  dsr: number | null;
}

export interface DsrFamilyResult {
  available: boolean;
  sigmaSharpe: number | null;
  expectedMaxSharpe: number | null;
  trials: DsrTrialResult[];
}

export function deflatedSharpeFamily(inputs: readonly DsrTrialInput[]): DsrFamilyResult {
  if (inputs.length !== 4 || inputs.map((input) => input.id).join(',') !== 'H1,H2,H3,H4') {
    throw new Error('DSR requires frozen H1,H2,H3,H4 order');
  }
  const trials = inputs.map((input): DsrTrialResult => {
    const moments = returnMoments(input.returns);
    const allZero = input.returns.every((value) => value === 0);
    return {
      id: input.id,
      moments,
      selectionSharpe: allZero ? 0 : moments.perPeriodSharpe,
      dsr: null,
    };
  });
  const sharpes = trials.map((trial) => trial.selectionSharpe);
  if (sharpes.some((value) => value === null || !Number.isFinite(value))) {
    return { available: false, sigmaSharpe: null, expectedMaxSharpe: null, trials };
  }
  const sigmaSharpe = sampleStandardDeviation(sharpes as number[]);
  if (sigmaSharpe === null || !Number.isFinite(sigmaSharpe)) {
    return { available: false, sigmaSharpe: null, expectedMaxSharpe: null, trials };
  }
  const nTrials = 4;
  const gamma = 0.5772156649015329;
  const expectedMaxSharpe = sigmaSharpe * (
    (1 - gamma) * normalInverseCdf(1 - 1 / nTrials)
    + gamma * normalInverseCdf(1 - 1 / (nTrials * Math.E))
  );
  for (const trial of trials) {
    const { moments } = trial;
    const sharpe = moments.perPeriodSharpe;
    if (
      sharpe === null
      || moments.skewness === null
      || moments.kurtosis === null
      || trial.selectionSharpe === 0 && moments.sampleStd === 0
    ) continue;
    const radicand = 1 - moments.skewness * sharpe
      + ((moments.kurtosis - 1) / 4) * sharpe ** 2;
    if (!(radicand > 0) || inputs.find((input) => input.id === trial.id)!.returns.length < 3) {
      continue;
    }
    const statistic = (sharpe - expectedMaxSharpe)
      * Math.sqrt(inputs.find((input) => input.id === trial.id)!.returns.length - 1)
      / Math.sqrt(radicand);
    const dsr = normalCdf(statistic);
    trial.dsr = Number.isFinite(dsr) ? dsr : null;
  }
  return { available: true, sigmaSharpe, expectedMaxSharpe, trials };
}

export interface TrialGateInput {
  id: StrategyId;
  error?: string | null;
  baseExpectancy: number | null;
  stressExpectancy: number | null;
  adverseBoundaryStressExpectancy: number | null;
  baseMaxDrawdown: number;
  stressMaxDrawdown: number;
  requiredSleevePnl: readonly number[];
  halfAdjustedPnl: readonly [number, number];
  effectiveEpisodes: number;
  baseAnnualizedSharpe: number | null;
  baseProfitFactor: number | null;
  stressAdjustedPnl: number;
  bootstrapLowerBound: number | null;
  dsr: number | null;
  topFiveConcentration: number | null;
  assetConcentration: number | null;
  assetConcentrationApplicable: boolean;
  requiredSleevesWithExposure: boolean;
}

export interface TrialGateResult {
  id: StrategyId;
  verdict: TrialVerdict;
  reasons: string[];
}

export function evaluateTrial(input: TrialGateInput): TrialGateResult {
  if (input.error) return { id: input.id, verdict: 'ERROR', reasons: [input.error] };
  const reject: string[] = [];
  if (input.baseExpectancy !== null && input.baseExpectancy <= 0) reject.push('base_expectancy');
  if (input.stressExpectancy !== null && input.stressExpectancy <= 0) reject.push('stress_expectancy');
  if (
    input.adverseBoundaryStressExpectancy !== null
    && input.adverseBoundaryStressExpectancy <= 0
  ) reject.push('boundary_funding_expectancy');
  if (input.baseMaxDrawdown > 0.08) reject.push('base_drawdown');
  if (input.stressMaxDrawdown > 0.08) reject.push('stress_drawdown');
  if (input.requiredSleevePnl.some((value) => value < 0)) reject.push('required_sleeve');
  if (reject.length > 0) return { id: input.id, verdict: 'REJECT', reasons: reject };

  const insufficient: string[] = [];
  if (input.effectiveEpisodes < 40) insufficient.push('episodes');
  if (input.baseAnnualizedSharpe === null || input.baseAnnualizedSharpe < 1) {
    insufficient.push('sharpe');
  }
  if (input.baseProfitFactor === null || input.baseProfitFactor < 1.25) {
    insufficient.push('profit_factor');
  }
  if (input.stressAdjustedPnl <= 0) insufficient.push('stress_pnl');
  if (input.bootstrapLowerBound === null || input.bootstrapLowerBound <= 0) {
    insufficient.push('bootstrap');
  }
  if (input.dsr === null || input.dsr < 0.95) insufficient.push('dsr');
  if (input.halfAdjustedPnl.some((value) => value < 0)) insufficient.push('halves');
  if (input.topFiveConcentration === null || input.topFiveConcentration > 0.5) {
    insufficient.push('top_five_concentration');
  }
  if (
    input.assetConcentrationApplicable
    && (input.assetConcentration === null || input.assetConcentration > 0.8)
  ) insufficient.push('asset_concentration');
  if (!input.requiredSleevesWithExposure) insufficient.push('required_sleeve_exposure');
  return {
    id: input.id,
    verdict: insufficient.length > 0 ? 'INSUFFICIENT' : 'ADVANCE_TO_FORWARD_PAPER',
    reasons: insufficient,
  };
}

export interface FamilyGateResult {
  verdict: TrialVerdict;
  selectedTrial: StrategyId | null;
}

export function aggregateFamily(results: readonly TrialGateResult[]): FamilyGateResult {
  if (results.length !== 3 || results.map((result) => result.id).join(',') !== 'H2,H3,H4') {
    throw new Error('Family result requires frozen H2,H3,H4 order');
  }
  if (results.some((result) => result.verdict === 'ERROR')) {
    return { verdict: 'ERROR', selectedTrial: null };
  }
  const selected = results.find((result) => result.verdict === 'ADVANCE_TO_FORWARD_PAPER');
  if (selected) return { verdict: 'ADVANCE_TO_FORWARD_PAPER', selectedTrial: selected.id };
  if (results.some((result) => result.verdict === 'REJECT')) {
    return { verdict: 'REJECT', selectedTrial: null };
  }
  return { verdict: 'INSUFFICIENT', selectedTrial: null };
}
