import {
  FOUR_HOUR_MS,
  type Direction,
  type DirectionalSignal,
  type FourHourCandle,
  type PerpAsset,
} from '../contracts.js';
import { H4_CONFIG } from '../frozenTrials.js';
import { fitOlsWithIntercept, logReturn, robustScore } from '../indicators.js';

export type LaggardAsset = Exclude<PerpAsset, 'BTC'>;

export interface H4BtcLagInput {
  asset: LaggardAsset;
  signalIndex: number;
  btcCandles: readonly FourHourCandle[];
  laggardCandles: readonly FourHourCandle[];
}

function returnAt(candles: readonly FourHourCandle[], index: number): number | null {
  if (index <= 0 || index >= candles.length) return null;
  return logReturn(candles[index - 1].close, candles[index].close);
}

/** Pure H4 decision. The rolling fit and robust score both exclude the current bar. */
export function h4BtcLagSignal(input: H4BtcLagInput): DirectionalSignal | null {
  if (!Number.isInteger(input.signalIndex) || input.signalIndex < 0) {
    throw new Error('H4 signal index must be a non-negative integer');
  }
  if (input.asset !== 'ETH' && input.asset !== 'HYPE') {
    throw new Error('H4 laggard asset must be ETH or HYPE');
  }
  if (input.btcCandles.length !== input.laggardCandles.length) {
    throw new Error('H4 BTC and laggard candle arrays must be aligned');
  }
  const index = input.signalIndex;
  if (index < H4_CONFIG.lookbackBars + 1 || index >= input.btcCandles.length) return null;

  const relevantStart = index - H4_CONFIG.lookbackBars - 1;
  for (let cursor = relevantStart; cursor <= index; cursor += 1) {
    const btc = input.btcCandles[cursor];
    const laggard = input.laggardCandles[cursor];
    const previousBtc = input.btcCandles[cursor - 1];
    if (btc.symbol !== 'BTC'
      || laggard.symbol !== input.asset
      || btc.interval !== '4h'
      || laggard.interval !== '4h'
      || btc.openTime !== laggard.openTime
      || btc.closeTime !== laggard.closeTime
      || !Number.isInteger(btc.openTime)
      || btc.openTime % FOUR_HOUR_MS !== 0
      || btc.closeTime !== btc.openTime + FOUR_HOUR_MS - 1
      || (cursor > relevantStart && btc.openTime !== previousBtc.openTime + FOUR_HOUR_MS)) {
      throw new Error(`H4 ${input.asset} candle identity/calendar mismatch`);
    }
  }

  const priorBtc: number[] = [];
  const priorLaggard: number[] = [];
  for (let cursor = index - H4_CONFIG.lookbackBars; cursor < index; cursor += 1) {
    const btcReturn = returnAt(input.btcCandles, cursor);
    const laggardReturn = returnAt(input.laggardCandles, cursor);
    if (btcReturn === null || laggardReturn === null) return null;
    priorBtc.push(btcReturn);
    priorLaggard.push(laggardReturn);
  }
  const currentBtcReturn = returnAt(input.btcCandles, index);
  const currentLaggardReturn = returnAt(input.laggardCandles, index);
  if (currentBtcReturn === null
    || currentLaggardReturn === null
    || currentBtcReturn === 0) return null;

  const score = robustScore(currentBtcReturn, priorBtc, H4_CONFIG.robustScaleFactor);
  const fit = fitOlsWithIntercept(priorBtc, priorLaggard);
  if (score === null || fit === null) return null;
  const currentResidual = currentLaggardReturn
    - (fit.alpha + fit.beta * currentBtcReturn);
  if (!Number.isFinite(currentResidual)) return null;
  const direction: Direction = currentBtcReturn > 0 ? 1 : -1;
  if (!(Math.abs(score.z) >= H4_CONFIG.btcZThreshold)
    || !(direction * currentResidual <= -H4_CONFIG.residualSigmaMultiple * fit.residualScale)) {
    return null;
  }

  const entryIndex = index + H4_CONFIG.executionDelayBars;
  return {
    strategy: 'H4',
    asset: input.asset,
    signalIndex: index,
    decisionTime: input.btcCandles[index].openTime + FOUR_HOUR_MS,
    entryIndex,
    exitIndex: entryIndex + H4_CONFIG.holdBars,
    direction,
    score: score.z,
    residual: currentResidual,
    residualScale: fit.residualScale,
  };
}
