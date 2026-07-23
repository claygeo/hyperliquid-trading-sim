import {
  FOUR_HOUR_MS,
  HOUR_MS,
  type ExecutionCostRates,
  type MarketSymbol,
  type PerpAsset,
  type PrimaryAsset,
  type SpotSymbol,
  type StrategyId,
  type TrialWindow,
} from './contracts.js';

export const FAMILY_ID = 'INDEPENDENT-4H-20260722-001';
export const SPECIFICATION_COMMIT = 'a3c871d26705c6c216968b1b580a396b3be78817';
export const AS_OF_TIME = Date.parse('2026-07-22T00:00:00.000Z');
export const HOLDOUT_START_TIME = Date.parse('2025-07-22T00:00:00.000Z');
export const HALF_SPLIT_TIME = Date.parse('2026-01-20T00:00:00.000Z');
export const INITIAL_NAV = 3_000;

export const HOLDOUT_WINDOW: Readonly<TrialWindow> = Object.freeze({
  startTime: HOLDOUT_START_TIME,
  endTime: AS_OF_TIME,
});

export const HOLDOUT_HALVES: readonly Readonly<TrialWindow>[] = Object.freeze([
  Object.freeze({ startTime: HOLDOUT_START_TIME, endTime: HALF_SPLIT_TIME }),
  Object.freeze({ startTime: HALF_SPLIT_TIME, endTime: AS_OF_TIME }),
]);

export interface CandleWindow {
  symbol: MarketSymbol;
  startTime: number;
  endTime: number;
  expectedBars: number;
}

export interface FundingWindow {
  coin: PerpAsset;
  startTime: number;
  endTime: number;
  expectedHours: number;
}

const BTC_ETH_START = Date.parse('2024-04-10T20:00:00.000Z');
const HYPE_START = Date.parse('2024-12-05T08:00:00.000Z');
const UBTC_START = Date.parse('2025-02-03T00:00:00.000Z');
const UETH_START = Date.parse('2025-03-26T12:00:00.000Z');

export const CANDLE_WINDOWS: Readonly<Record<MarketSymbol, Readonly<CandleWindow>>> =
  Object.freeze({
    BTC: Object.freeze({ symbol: 'BTC', startTime: BTC_ETH_START, endTime: AS_OF_TIME, expectedBars: 4_993 }),
    ETH: Object.freeze({ symbol: 'ETH', startTime: BTC_ETH_START, endTime: AS_OF_TIME, expectedBars: 4_993 }),
    HYPE: Object.freeze({ symbol: 'HYPE', startTime: HYPE_START, endTime: AS_OF_TIME, expectedBars: 3_562 }),
    '@142': Object.freeze({ symbol: '@142', startTime: UBTC_START, endTime: AS_OF_TIME, expectedBars: 3_204 }),
    '@151': Object.freeze({ symbol: '@151', startTime: UETH_START, endTime: AS_OF_TIME, expectedBars: 2_895 }),
  });

export const FUNDING_WINDOWS: Readonly<Record<PerpAsset, Readonly<FundingWindow>>> =
  Object.freeze({
    BTC: Object.freeze({ coin: 'BTC', startTime: BTC_ETH_START, endTime: AS_OF_TIME - HOUR_MS, expectedHours: 19_972 }),
    ETH: Object.freeze({ coin: 'ETH', startTime: BTC_ETH_START, endTime: AS_OF_TIME - HOUR_MS, expectedHours: 19_972 }),
    HYPE: Object.freeze({ coin: 'HYPE', startTime: HYPE_START, endTime: AS_OF_TIME - HOUR_MS, expectedHours: 14_248 }),
  });

export const SPOT_PAIR_CONTRACTS: Readonly<Record<SpotSymbol, {
  displayName: 'UBTC/USDC' | 'UETH/USDC';
  wrapperMultiplier: 1;
}>> = Object.freeze({
  '@142': Object.freeze({ displayName: 'UBTC/USDC', wrapperMultiplier: 1 }),
  '@151': Object.freeze({ displayName: 'UETH/USDC', wrapperMultiplier: 1 }),
});

export const BASE_COSTS: Readonly<ExecutionCostRates> = Object.freeze({
  perpFee: 0.00045,
  spotFee: 0.00070,
  slippage: 0.00050,
  multiplier: 1,
});

export const STRESS_COSTS: Readonly<ExecutionCostRates> = Object.freeze({
  ...BASE_COSTS,
  multiplier: 2,
});

interface BaseTrialConfig {
  id: StrategyId;
  trialId: string;
  rank: 1 | 2 | 3;
  executionDelayBars: 2;
  holdBars: 3 | 42;
  initialNav: 3_000;
  entryGrossCap: 1_500;
  primaryAssets: readonly PrimaryAsset[];
  exploratoryAssets: readonly PerpAsset[];
}

export interface H2TrialConfig extends BaseTrialConfig {
  id: 'H2';
  fundingLookbackHours: 168;
  fundingThreshold: 0.0086;
  perLegNotionalCap: 375;
  perpSymbols: Readonly<Record<PrimaryAsset, PrimaryAsset>>;
  spotSymbols: Readonly<Record<PrimaryAsset, SpotSymbol>>;
}

export interface H3TrialConfig extends BaseTrialConfig {
  id: 'H3';
  lookbackBars: 180;
  robustScaleFactor: 1.4826;
  zThreshold: 3;
  volumeMultiple: 2;
  primaryNotional: 750;
  exploratoryNotional: 375;
}

export interface H4TrialConfig extends BaseTrialConfig {
  id: 'H4';
  lookbackBars: 180;
  robustScaleFactor: 1.4826;
  btcZThreshold: 2;
  residualSigmaMultiple: 1;
  primaryNotional: 750;
  exploratoryNotional: 375;
}

export type FrozenTrialConfig = H2TrialConfig | H3TrialConfig | H4TrialConfig;

export const H2_CONFIG: Readonly<H2TrialConfig> = Object.freeze({
  id: 'H2',
  trialId: 'H2-CARRY-4H-20260722-001',
  rank: 1,
  executionDelayBars: 2,
  holdBars: 42,
  initialNav: INITIAL_NAV,
  entryGrossCap: 1_500,
  primaryAssets: Object.freeze(['BTC', 'ETH'] as const),
  exploratoryAssets: Object.freeze([] as PerpAsset[]),
  fundingLookbackHours: 168,
  fundingThreshold: 0.0086,
  perLegNotionalCap: 375,
  perpSymbols: Object.freeze({ BTC: 'BTC', ETH: 'ETH' }),
  spotSymbols: Object.freeze({ BTC: '@142', ETH: '@151' }),
});

export const H3_CONFIG: Readonly<H3TrialConfig> = Object.freeze({
  id: 'H3',
  trialId: 'H3-SHOCK-REVERSAL-4H-20260722-001',
  rank: 2,
  executionDelayBars: 2,
  holdBars: 3,
  initialNav: INITIAL_NAV,
  entryGrossCap: 1_500,
  primaryAssets: Object.freeze(['BTC', 'ETH'] as const),
  exploratoryAssets: Object.freeze(['HYPE'] as const),
  lookbackBars: 180,
  robustScaleFactor: 1.4826,
  zThreshold: 3,
  volumeMultiple: 2,
  primaryNotional: 750,
  exploratoryNotional: 375,
});

export const H4_CONFIG: Readonly<H4TrialConfig> = Object.freeze({
  id: 'H4',
  trialId: 'H4-BTC-LAG-4H-20260722-001',
  rank: 3,
  executionDelayBars: 2,
  holdBars: 3,
  initialNav: INITIAL_NAV,
  entryGrossCap: 1_500,
  primaryAssets: Object.freeze(['ETH'] as const),
  exploratoryAssets: Object.freeze(['HYPE'] as const),
  lookbackBars: 180,
  robustScaleFactor: 1.4826,
  btcZThreshold: 2,
  residualSigmaMultiple: 1,
  primaryNotional: 750,
  exploratoryNotional: 375,
});

export const FROZEN_TRIALS: readonly Readonly<FrozenTrialConfig>[] = Object.freeze([
  H2_CONFIG,
  H3_CONFIG,
  H4_CONFIG,
]);

export const TRIAL_BY_ID: Readonly<Record<StrategyId, Readonly<FrozenTrialConfig>>> =
  Object.freeze({ H2: H2_CONFIG, H3: H3_CONFIG, H4: H4_CONFIG });

export function expectedFourHourBars(startTime: number, endTime: number): number {
  const bars = (endTime - startTime) / FOUR_HOUR_MS;
  if (!Number.isInteger(bars) || bars <= 0) throw new Error('Window must contain whole 4h bars');
  return bars;
}
