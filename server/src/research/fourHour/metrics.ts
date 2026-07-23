import { createHash } from 'node:crypto';

import { PRIMARY_ASSETS, type PerpAsset } from './contracts.js';
import { BOOTSTRAP_CONFIG } from './frozenTrials.js';

export interface TimedNav {
  time: number;
  nav: number;
}

export interface EpisodePnl {
  startTime: number;
  endTime: number;
  pnl: number;
}

export interface EpisodeMetrics {
  count: number;
  expectancy: number | null;
  profitFactor: number | null;
  winRate: number | null;
  topFivePositiveConcentration: number | null;
}

export interface ReturnMoments {
  mean: number;
  sampleStd: number | null;
  perPeriodSharpe: number | null;
  skewness: number | null;
  kurtosis: number | null;
}

function requireFinite(values: readonly number[], label: string): void {
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error(`${label} contains a non-finite value`);
  }
}

export function arithmeticMean(values: readonly number[]): number {
  if (values.length === 0) throw new Error('Mean requires at least one value');
  requireFinite(values, 'Mean input');
  if (values.every((value) => value === values[0])) return values[0];
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (!Number.isFinite(mean)) throw new Error('Mean is non-finite');
  return mean;
}

export function sampleStandardDeviation(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const mean = arithmeticMean(values);
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0)
    / (values.length - 1);
  if (!Number.isFinite(variance) || variance < 0) throw new Error('Invalid sample variance');
  return Math.sqrt(variance);
}

export function returnMoments(returns: readonly number[]): ReturnMoments {
  if (returns.length === 0) throw new Error('Return moments require observations');
  const mean = arithmeticMean(returns);
  const sampleStd = sampleStandardDeviation(returns);
  const centered = returns.map((value) => value - mean);
  const m2 = centered.reduce((sum, value) => sum + value ** 2, 0) / returns.length;
  if (!Number.isFinite(m2) || m2 < 0) throw new Error('Invalid second central moment');
  if (m2 === 0) {
    return { mean, sampleStd, perPeriodSharpe: null, skewness: null, kurtosis: null };
  }
  const m3 = centered.reduce((sum, value) => sum + value ** 3, 0) / returns.length;
  const m4 = centered.reduce((sum, value) => sum + value ** 4, 0) / returns.length;
  const skewness = m3 / m2 ** 1.5;
  const kurtosis = m4 / m2 ** 2;
  const perPeriodSharpe = sampleStd && sampleStd > 0 ? mean / sampleStd : null;
  if (![skewness, kurtosis, perPeriodSharpe].every(Number.isFinite)) {
    throw new Error('Invalid standardized return moments');
  }
  return { mean, sampleStd, perPeriodSharpe, skewness, kurtosis };
}

export function annualizedDailySharpe(returns: readonly number[]): number | null {
  const sharpe = returnMoments(returns).perPeriodSharpe;
  return sharpe === null ? null : sharpe * Math.sqrt(365);
}

export function maxDrawdown(points: readonly TimedNav[]): number {
  if (points.length === 0) throw new Error('Drawdown requires NAV points');
  let lastTime = -Infinity;
  let peak = -Infinity;
  let maximum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (!Number.isFinite(point.time) || !Number.isFinite(point.nav)) {
      throw new Error('Drawdown NAV points must be finite');
    }
    if (index === 0 && point.nav <= 0) throw new Error('Drawdown anchor NAV must be positive');
    if (point.time < lastTime) throw new Error('Drawdown NAV points must be chronological');
    lastTime = point.time;
    peak = Math.max(peak, point.nav);
    maximum = Math.max(maximum, (peak - point.nav) / peak);
  }
  return maximum;
}

export function navReturns(points: readonly TimedNav[]): number[] {
  if (points.length < 2) return [];
  const result: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (current.time <= previous.time) throw new Error('NAV return points must have increasing times');
    if (![previous.nav, current.nav].every(Number.isFinite) || previous.nav <= 0) {
      throw new Error('NAV return points are invalid');
    }
    result.push(current.nav / previous.nav - 1);
  }
  return result;
}

export function episodeMetrics(episodes: readonly EpisodePnl[]): EpisodeMetrics {
  for (const episode of episodes) {
    if (
      !Number.isInteger(episode.startTime)
      || !Number.isInteger(episode.endTime)
      || episode.endTime <= episode.startTime
    ) throw new Error('Episode timestamps are invalid');
  }
  const pnl = episodes.map((episode) => episode.pnl);
  requireFinite(pnl, 'Episode PnL');
  if (pnl.length === 0) {
    return {
      count: 0,
      expectancy: null,
      profitFactor: null,
      winRate: null,
      topFivePositiveConcentration: null,
    };
  }
  const positive = pnl.filter((value) => value > 0).sort((a, b) => b - a);
  const negative = pnl.filter((value) => value < 0);
  const positiveSum = positive.reduce((sum, value) => sum + value, 0);
  const negativeSum = negative.reduce((sum, value) => sum + value, 0);
  return {
    count: pnl.length,
    expectancy: arithmeticMean(pnl),
    profitFactor: negative.length === 0 ? null : positiveSum / Math.abs(negativeSum),
    winRate: positive.length / pnl.length,
    topFivePositiveConcentration: positive.length === 0
      ? null
      : positive.slice(0, 5).reduce((sum, value) => sum + value, 0) / positiveSum,
  };
}

export function positiveAssetConcentration(
  netPnlByAsset: Partial<Record<PerpAsset, number>>,
): number | null {
  const values = PRIMARY_ASSETS.map((asset) => netPnlByAsset[asset] ?? 0);
  requireFinite(values, 'Asset PnL');
  const positive = values.map((value) => Math.max(0, value));
  const denominator = positive.reduce((sum, value) => sum + value, 0);
  return denominator === 0 ? null : Math.max(...positive) / denominator;
}

export function trialSeed(trialId: string): number {
  const digest = createHash('sha256').update(trialId, 'utf8').digest('hex');
  const parsed = Number.parseInt(digest.slice(0, 8), 16) >>> 0;
  return parsed === 0 ? 0x9e3779b9 : parsed;
}

export function nextXorshift32(state: number): number {
  let value = state >>> 0;
  value = (value ^ (value << 13)) >>> 0;
  value = (value ^ (value >>> 17)) >>> 0;
  value = (value ^ (value << 5)) >>> 0;
  return value >>> 0;
}

export function circularBlockBootstrapLowerBound(
  returns: readonly number[],
  trialId: string,
  replicates: number = BOOTSTRAP_CONFIG.replicates,
  blockLength: number = BOOTSTRAP_CONFIG.blockLength,
): number {
  if (returns.length < blockLength) throw new Error('Bootstrap requires at least seven returns');
  if (replicates !== BOOTSTRAP_CONFIG.replicates || blockLength !== BOOTSTRAP_CONFIG.blockLength) {
    throw new Error('Frozen bootstrap requires 10,000 seven-day replicates');
  }
  requireFinite(returns, 'Bootstrap returns');
  let state = trialSeed(trialId);
  const means = new Array<number>(replicates);
  for (let replicate = 0; replicate < replicates; replicate += 1) {
    let count = 0;
    let sum = 0;
    while (count < returns.length) {
      state = nextXorshift32(state);
      const start = Math.floor((state / 2 ** 32) * returns.length);
      for (let offset = 0; offset < blockLength && count < returns.length; offset += 1) {
        sum += returns[(start + offset) % returns.length];
        count += 1;
      }
    }
    means[replicate] = sum / returns.length;
  }
  means.sort((left, right) => left - right);
  const index = Math.floor(BOOTSTRAP_CONFIG.familyAlpha * (replicates - 1));
  if (
    index !== BOOTSTRAP_CONFIG.lowerQuantileIndex
    || !Number.isFinite(means[index])
  ) throw new Error('Invalid bootstrap quantile');
  return means[index];
}
