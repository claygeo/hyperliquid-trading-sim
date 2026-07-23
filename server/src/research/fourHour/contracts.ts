export const FOUR_HOUR_MS = 14_400_000;
export const HOUR_MS = 3_600_000;
export const UTC_DAY_MS = 86_400_000;

export const PERP_ASSETS = ['BTC', 'ETH', 'HYPE'] as const;
export const PRIMARY_ASSETS = ['BTC', 'ETH'] as const;
export const MARKET_SYMBOLS = ['BTC', 'ETH', 'HYPE', '@142', '@151'] as const;

export type PerpAsset = (typeof PERP_ASSETS)[number];
export type PrimaryAsset = (typeof PRIMARY_ASSETS)[number];
export type MarketSymbol = (typeof MARKET_SYMBOLS)[number];
export type SpotSymbol = Extract<MarketSymbol, `@${string}`>;
export type StrategyId = 'H2' | 'H3' | 'H4';
export type Direction = -1 | 1;
export type CostCase = 'base' | 'stress';

export interface FourHourCandle {
  symbol: MarketSymbol;
  interval: '4h';
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface HourlyFunding {
  coin: PerpAsset;
  time: number;
  rate: number;
}

export interface SpotTokenMetadata {
  index: number;
  name: string;
  szDecimals: number;
  weiDecimals: number;
  tokenId: string;
}

export interface SpotPairMetadata {
  symbol: SpotSymbol;
  index: number;
  displayName: 'UBTC/USDC' | 'UETH/USDC';
  baseTokenIndex: number;
  quoteTokenIndex: number;
  isCanonical: false;
  wrapperMultiplier: 1;
  tokens: [SpotTokenMetadata, SpotTokenMetadata];
}

export interface RawPageEvidence {
  page: number;
  requestedStartTime: number;
  requestedEndTime: number;
  responseRows: number;
  acceptedRows: number;
  firstTime: number;
  lastTime: number;
  rawResponseSha256: string;
  fetchedAt: string;
}

export interface CandleSeriesSnapshot {
  symbol: MarketSymbol;
  startTime: number;
  endTime: number;
  expectedBars: number;
  pages: RawPageEvidence[];
  candles: FourHourCandle[];
}

export interface FundingSeriesSnapshot {
  coin: PerpAsset;
  startTime: number;
  endTime: number;
  expectedHours: number;
  pages: RawPageEvidence[];
  funding: HourlyFunding[];
}

export type CandleSeriesMap = Partial<Record<MarketSymbol, FourHourCandle[]>>;
export type FundingSeriesMap = Partial<Record<PerpAsset, HourlyFunding[]>>;

export interface ValidatedFamilyData {
  candles: CandleSeriesMap;
  funding: FundingSeriesMap;
  spotPairs: Partial<Record<SpotSymbol, SpotPairMetadata>>;
}

export interface CarrySignal {
  strategy: 'H2';
  asset: PrimaryAsset;
  signalIndex: number;
  decisionTime: number;
  entryIndex: number;
  exitIndex: number;
  fundingSum: number;
  perpClose: number;
  spotClose: number;
}

export interface DirectionalSignal {
  strategy: 'H3' | 'H4';
  asset: PerpAsset;
  signalIndex: number;
  decisionTime: number;
  entryIndex: number;
  exitIndex: number;
  direction: Direction;
  score: number;
  residual?: number;
  residualScale?: number;
}

export type StrategySignal = CarrySignal | DirectionalSignal;

export type InstrumentId =
  | 'BTC-PERP'
  | 'ETH-PERP'
  | 'HYPE-PERP'
  | 'UBTC-SPOT'
  | 'UETH-SPOT';

export interface ScheduledLeg {
  instrument: InstrumentId;
  market: 'perp' | 'spot';
  asset: PerpAsset;
  signedUnits: number;
  entryReferencePrice: number;
}

export interface ScheduledPosition {
  id: string;
  trialId: string;
  strategy: StrategyId;
  asset: PerpAsset;
  signalIndex: number;
  decisionTime: number;
  entryTime: number;
  exitTime: number;
  entryGross: number;
  legs: ScheduledLeg[];
}

export interface SkippedSignal {
  strategy: StrategyId;
  asset: PerpAsset;
  decisionTime: number;
  reason: 'pending_or_open' | 'window_end' | 'capacity' | 'non_positive_nav';
}

export interface AcceptedSchedule {
  trialId: string;
  positions: ScheduledPosition[];
  skipped: SkippedSignal[];
}

export interface ExecutionCostRates {
  perpFee: number;
  spotFee: number;
  slippage: number;
  multiplier: number;
}

export interface TrialWindow {
  startTime: number;
  endTime: number;
}

export type TrialVerdict = 'ERROR' | 'REJECT' | 'INSUFFICIENT' | 'ADVANCE_TO_FORWARD_PAPER';

export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
