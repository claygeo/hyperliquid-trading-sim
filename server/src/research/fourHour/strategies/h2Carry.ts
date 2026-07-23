import {
  FOUR_HOUR_MS,
  HOUR_MS,
  type CarrySignal,
  type FourHourCandle,
  type HourlyFunding,
  type PrimaryAsset,
} from '../contracts.js';
import { H2_CONFIG } from '../frozenTrials.js';

export interface H2CarryInput {
  asset: PrimaryAsset;
  signalIndex: number;
  perpCandles: readonly FourHourCandle[];
  spotCandles: readonly FourHourCandle[];
  funding: readonly HourlyFunding[];
}

function exactFundingWindow(
  asset: PrimaryAsset,
  decisionTime: number,
  records: readonly HourlyFunding[],
): readonly HourlyFunding[] {
  const startTime = decisionTime - H2_CONFIG.fundingLookbackHours * HOUR_MS;
  const window = records.filter((record) => record.time >= startTime && record.time < decisionTime);
  if (window.length !== H2_CONFIG.fundingLookbackHours) {
    throw new Error(`H2 ${asset} requires exactly ${H2_CONFIG.fundingLookbackHours} funding records`);
  }
  for (let index = 0; index < window.length; index += 1) {
    const record = window[index];
    const expectedTime = startTime + index * HOUR_MS;
    if (record.coin !== asset
      || record.time !== expectedTime
      || !Number.isFinite(record.rate)) {
      throw new Error(`H2 ${asset} funding window is not exact and hourly`);
    }
  }
  return window;
}

/** Pure H2 decision; the function never reads an entry or exit candle. */
export function h2CarrySignal(input: H2CarryInput): CarrySignal | null {
  if (!Number.isInteger(input.signalIndex) || input.signalIndex < 0) {
    throw new Error('H2 signal index must be a non-negative integer');
  }
  if (input.asset !== 'BTC' && input.asset !== 'ETH') {
    throw new Error('H2 asset must be BTC or ETH');
  }
  const perp = input.perpCandles[input.signalIndex];
  const spot = input.spotCandles[input.signalIndex];
  if (!perp || !spot) return null;
  if (perp.symbol !== H2_CONFIG.perpSymbols[input.asset]
    || spot.symbol !== H2_CONFIG.spotSymbols[input.asset]
    || perp.interval !== '4h'
    || spot.interval !== '4h'
    || perp.openTime !== spot.openTime
    || perp.closeTime !== spot.closeTime
    || !Number.isInteger(perp.openTime)
    || perp.openTime % FOUR_HOUR_MS !== 0
    || perp.closeTime !== perp.openTime + FOUR_HOUR_MS - 1) {
    throw new Error(`H2 ${input.asset} candle identity/calendar mismatch`);
  }
  if (!Number.isFinite(perp.close)
    || !Number.isFinite(spot.close)
    || perp.close <= 0
    || spot.close <= 0) {
    throw new Error(`H2 ${input.asset} closes must be finite and positive`);
  }

  const decisionTime = perp.openTime + FOUR_HOUR_MS;
  const fundingWindow = exactFundingWindow(input.asset, decisionTime, input.funding);
  const fundingSum = fundingWindow.reduce((sum, record) => sum + record.rate, 0);
  if (!Number.isFinite(fundingSum)) throw new Error(`H2 ${input.asset} funding sum is not finite`);
  if (!(fundingSum > H2_CONFIG.fundingThreshold) || !(perp.close > spot.close)) return null;

  const entryIndex = input.signalIndex + H2_CONFIG.executionDelayBars;
  return {
    strategy: 'H2',
    asset: input.asset,
    signalIndex: input.signalIndex,
    decisionTime,
    entryIndex,
    exitIndex: entryIndex + H2_CONFIG.holdBars,
    fundingSum,
    perpClose: perp.close,
    spotClose: spot.close,
  };
}
