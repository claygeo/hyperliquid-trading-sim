import {
  FOUR_HOUR_MS,
  type Direction,
  type DirectionalSignal,
  type FourHourCandle,
  type PerpAsset,
} from '../contracts.js';
import { H3_CONFIG } from '../frozenTrials.js';
import { logReturn, median, robustScore } from '../indicators.js';

export interface H3ShockInput {
  asset: PerpAsset;
  signalIndex: number;
  candles: readonly FourHourCandle[];
}

function returnAt(candles: readonly FourHourCandle[], index: number): number | null {
  if (index <= 0 || index >= candles.length) return null;
  return logReturn(candles[index - 1].close, candles[index].close);
}

/** Pure H3 decision. Reference returns and volumes exclude the current bar. */
export function h3ShockReversalSignal(input: H3ShockInput): DirectionalSignal | null {
  if (!Number.isInteger(input.signalIndex) || input.signalIndex < 0) {
    throw new Error('H3 signal index must be a non-negative integer');
  }
  if (input.asset !== 'BTC' && input.asset !== 'ETH' && input.asset !== 'HYPE') {
    throw new Error('H3 asset must be BTC, ETH, or HYPE');
  }
  const index = input.signalIndex;
  if (index < H3_CONFIG.lookbackBars + 1 || index >= input.candles.length) return null;

  const relevantStart = index - H3_CONFIG.lookbackBars - 1;
  for (let cursor = relevantStart; cursor <= index; cursor += 1) {
    const current = input.candles[cursor];
    const previous = input.candles[cursor - 1];
    if (current.symbol !== input.asset
      || current.interval !== '4h'
      || !Number.isInteger(current.openTime)
      || current.openTime % FOUR_HOUR_MS !== 0
      || current.closeTime !== current.openTime + FOUR_HOUR_MS - 1
      || (cursor > relevantStart && current.openTime !== previous.openTime + FOUR_HOUR_MS)) {
      throw new Error(`H3 ${input.asset} candle identity/calendar mismatch`);
    }
  }

  const currentReturn = returnAt(input.candles, index);
  if (currentReturn === null || currentReturn === 0) return null;
  const referenceReturns: number[] = [];
  for (let cursor = index - H3_CONFIG.lookbackBars; cursor < index; cursor += 1) {
    const value = returnAt(input.candles, cursor);
    if (value === null) return null;
    referenceReturns.push(value);
  }
  const score = robustScore(currentReturn, referenceReturns, H3_CONFIG.robustScaleFactor);
  if (score === null) return null;

  const referenceVolumes = input.candles
    .slice(index - H3_CONFIG.lookbackBars, index)
    .map((candle) => candle.volume);
  const volumeMedian = median(referenceVolumes);
  const currentVolume = input.candles[index].volume;
  if (volumeMedian === null
    || !(volumeMedian > 0)
    || !Number.isFinite(currentVolume)
    || !(Math.abs(score.z) >= H3_CONFIG.zThreshold)
    || !(currentVolume >= H3_CONFIG.volumeMultiple * volumeMedian)) return null;

  const direction: Direction = currentReturn > 0 ? -1 : 1;
  const entryIndex = index + H3_CONFIG.executionDelayBars;
  return {
    strategy: 'H3',
    asset: input.asset,
    signalIndex: index,
    decisionTime: input.candles[index].openTime + FOUR_HOUR_MS,
    entryIndex,
    exitIndex: entryIndex + H3_CONFIG.holdBars,
    direction,
    score: score.z,
  };
}
