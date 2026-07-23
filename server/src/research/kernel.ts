import { createHash } from 'node:crypto';

export const DAY_MS = 86_400_000;
export const ASSETS = ['BTC', 'ETH'] as const;

export type ResearchAsset = (typeof ASSETS)[number];
export type ScreenVerdict =
  | 'ERROR'
  | 'PRICE_EDGE_REJECT'
  | 'PRICE_EDGE_INSUFFICIENT'
  | 'PRICE_EDGE_CANDIDATE';

export interface ResearchCandle {
  symbol: ResearchAsset;
  interval: '1d';
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface FrozenResearchConfig {
  trialId: string;
  startTime: number;
  asOfTime: number;
  holdoutStartTime: number;
  initialNav: number;
  returnLookbackDays: number;
  emaDays: number;
  volatilityLookbackDays: number;
  volatilityTarget: number;
  perAssetEntryCap: number;
  portfolioEntryCap: number;
  feeRate: number;
  slippageRate: number;
  stressMultiplier: number;
  executionDelayDays: number;
}

export const FROZEN_CONFIG: Readonly<FrozenResearchConfig> = Object.freeze({
  trialId: 'H1-TREND-DAILY-20260722-001',
  startTime: Date.parse('2023-04-10T00:00:00.000Z'),
  asOfTime: Date.parse('2026-07-22T00:00:00.000Z'),
  holdoutStartTime: Date.parse('2025-07-27T00:00:00.000Z'),
  initialNav: 3_000,
  returnLookbackDays: 28,
  emaDays: 84,
  volatilityLookbackDays: 20,
  volatilityTarget: 0.2,
  perAssetEntryCap: 750,
  portfolioEntryCap: 1_500,
  feeRate: 0.00045,
  slippageRate: 0.0005,
  stressMultiplier: 2,
  executionDelayDays: 2,
});

export interface IndicatorPoint {
  ema: number | null;
  return28: number | null;
  annualizedVolatility20: number | null;
  long: boolean;
}

export interface ExecutionRecord {
  asset: ResearchAsset;
  time: number;
  side: 'BUY' | 'SELL';
  units: number;
  referencePrice: number;
  referenceNotional: number;
  fee: number;
  slippage: number;
  totalCost: number;
  reason: 'signal' | 'dataset_end' | 'non_positive_nav';
}

export interface CompletedTrade {
  asset: ResearchAsset;
  entryTime: number;
  exitTime: number;
  units: number;
  entryPrice: number;
  exitPrice: number;
  entryNotional: number;
  exitNotional: number;
  pricePnl: number;
  executionCosts: number;
  adjustedPricePnl: number;
  reason: 'signal' | 'dataset_end' | 'non_positive_nav';
}

export interface ExposureEpisode {
  startTime: number;
  endTime: number;
  startNav: number;
  endNav: number;
  adjustedPricePnl: number;
  return: number;
}

export interface DailyLedgerPoint {
  time: number;
  nav: number;
  markedGross: number;
  exposed: boolean;
}

export interface PortfolioMetrics {
  startingNav: number;
  endingNav: number;
  adjustedPricePnl: number;
  cagr: number | null;
  annualizedVolatility: number | null;
  sharpe: number | null;
  maxDrawdown: number;
  completedTrades: number;
  winningTrades: number;
  winRate: number | null;
  effectiveEpisodes: number;
  effectiveEpisodeExpectancy: number | null;
  profitFactor: number | null;
  averageAdjustedTradePnl: number | null;
  exposureFraction: number;
  turnover: number;
  largestPositiveTradeConcentration: number | null;
  topFivePositiveTradeConcentration: number | null;
  largestPositiveAssetConcentration: number | null;
  positivePnlByAsset: Record<ResearchAsset, number>;
  maxMarkedGross: number;
  maxMarkedGrossToNav: number | null;
  nonPositiveNav: boolean;
}

export interface ReferenceMetrics {
  entryTime: number;
  endingNav: number;
  adjustedPricePnl: number;
  sharpe: number | null;
  maxDrawdown: number;
}

export interface LedgerResult {
  metrics: PortfolioMetrics;
  executions: ExecutionRecord[];
  trades: CompletedTrade[];
  episodes: ExposureEpisode[];
  daily: DailyLedgerPoint[];
}

export interface WindowResult {
  startTime: number;
  endTime: number;
  base: LedgerResult;
  doubledCosts: LedgerResult;
  buyAndHold: {
    base: ReferenceMetrics;
    doubledCosts: ReferenceMetrics;
  };
  executionScheduleSha256: string;
}

export interface ResearchResult {
  schemaVersion: 1;
  trialId: string;
  screenVerdict: ScreenVerdict;
  promotionEligible: false;
  limitations: string[];
  config: FrozenResearchConfig;
  fullHistory: WindowResult;
  holdout: WindowResult;
}

interface Position {
  asset: ResearchAsset;
  units: number;
  entryPrice: number;
  entryTime: number;
  entryNotional: number;
  entryCost: number;
}

interface MutableLedger {
  costMultiplier: number;
  cash: number;
  positions: Map<ResearchAsset, Position>;
  executions: ExecutionRecord[];
  trades: CompletedTrade[];
  episodes: ExposureEpisode[];
  daily: DailyLedgerPoint[];
  episodeStartTime: number | null;
  episodeStartNav: number | null;
  nonPositiveNav: boolean;
}

interface SignalState {
  indicators: Record<ResearchAsset, IndicatorPoint[]>;
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} is not finite`);
  }
  return value;
}

function sampleStandardDeviation(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0)
    / (values.length - 1);
  return Math.sqrt(variance);
}

export function calculateIndicators(
  candles: ResearchCandle[],
  config: FrozenResearchConfig = FROZEN_CONFIG,
): IndicatorPoint[] {
  const result: IndicatorPoint[] = candles.map(() => ({
    ema: null,
    return28: null,
    annualizedVolatility20: null,
    long: false,
  }));

  if (candles.length < config.emaDays) return result;

  const seedIndex = config.emaDays - 1;
  const alpha = 2 / (config.emaDays + 1);
  const seed = candles.slice(0, config.emaDays)
    .reduce((sum, candle) => sum + candle.close, 0) / config.emaDays;
  result[seedIndex].ema = seed;

  for (let index = seedIndex + 1; index < candles.length; index += 1) {
    result[index].ema = alpha * candles[index].close
      + (1 - alpha) * (result[index - 1].ema as number);
  }

  for (let index = 0; index < candles.length; index += 1) {
    if (index >= config.returnLookbackDays) {
      result[index].return28 = candles[index].close
        / candles[index - config.returnLookbackDays].close - 1;
    }

    if (index >= config.volatilityLookbackDays) {
      const logReturns: number[] = [];
      for (let cursor = index - config.volatilityLookbackDays + 1;
        cursor <= index;
        cursor += 1) {
        logReturns.push(Math.log(candles[cursor].close / candles[cursor - 1].close));
      }
      const dailyVolatility = sampleStandardDeviation(logReturns);
      const annualized = dailyVolatility === null ? null : dailyVolatility * Math.sqrt(365);
      result[index].annualizedVolatility20 = annualized !== null && Number.isFinite(annualized)
        ? annualized
        : null;
    }

    const point = result[index];
    point.long = point.ema !== null
      && point.return28 !== null
      && point.return28 > 0
      && candles[index].close > point.ema;
  }

  return result;
}

function validateAlignedSeries(series: Record<ResearchAsset, ResearchCandle[]>): void {
  const expectedLength = series.BTC.length;
  if (expectedLength === 0 || series.ETH.length !== expectedLength) {
    throw new Error('BTC and ETH series must be non-empty and equal length');
  }

  for (let index = 0; index < expectedLength; index += 1) {
    const btc = series.BTC[index];
    const eth = series.ETH[index];
    if (btc.openTime !== eth.openTime || btc.closeTime !== eth.closeTime) {
      throw new Error(`BTC/ETH calendar mismatch at index ${index}`);
    }
  }
}

function createLedger(costMultiplier: number, initialNav: number): MutableLedger {
  return {
    costMultiplier,
    cash: initialNav,
    positions: new Map(),
    executions: [],
    trades: [],
    episodes: [],
    daily: [],
    episodeStartTime: null,
    episodeStartNav: null,
    nonPositiveNav: false,
  };
}

function navAt(
  ledger: MutableLedger,
  prices: Record<ResearchAsset, number>,
): number {
  let nav = ledger.cash;
  for (const position of ledger.positions.values()) {
    nav += position.units * (prices[position.asset] - position.entryPrice);
  }
  return finite(nav, 'NAV');
}

function grossAt(
  ledger: MutableLedger,
  prices: Record<ResearchAsset, number>,
): number {
  let gross = 0;
  for (const position of ledger.positions.values()) {
    gross += Math.abs(position.units * prices[position.asset]);
  }
  return finite(gross, 'marked gross');
}

function executionCost(
  units: number,
  price: number,
  ledger: MutableLedger,
  config: FrozenResearchConfig,
): { notional: number; fee: number; slippage: number; total: number } {
  const notional = Math.abs(units * price);
  const fee = notional * config.feeRate * ledger.costMultiplier;
  const slippage = notional * config.slippageRate * ledger.costMultiplier;
  return {
    notional,
    fee,
    slippage,
    total: fee + slippage,
  };
}

function enterPosition(
  ledger: MutableLedger,
  asset: ResearchAsset,
  units: number,
  price: number,
  time: number,
  config: FrozenResearchConfig,
): void {
  if (!(units > 0) || ledger.positions.has(asset)) return;
  const cost = executionCost(units, price, ledger, config);
  ledger.cash -= cost.total;
  ledger.positions.set(asset, {
    asset,
    units,
    entryPrice: price,
    entryTime: time,
    entryNotional: cost.notional,
    entryCost: cost.total,
  });
  ledger.executions.push({
    asset,
    time,
    side: 'BUY',
    units,
    referencePrice: price,
    referenceNotional: cost.notional,
    fee: cost.fee,
    slippage: cost.slippage,
    totalCost: cost.total,
    reason: 'signal',
  });
}

function exitPosition(
  ledger: MutableLedger,
  asset: ResearchAsset,
  price: number,
  time: number,
  reason: ExecutionRecord['reason'],
  config: FrozenResearchConfig,
): void {
  const position = ledger.positions.get(asset);
  if (!position) return;
  const cost = executionCost(position.units, price, ledger, config);
  const pricePnl = position.units * (price - position.entryPrice);
  ledger.cash += pricePnl - cost.total;
  ledger.positions.delete(asset);
  ledger.executions.push({
    asset,
    time,
    side: 'SELL',
    units: position.units,
    referencePrice: price,
    referenceNotional: cost.notional,
    fee: cost.fee,
    slippage: cost.slippage,
    totalCost: cost.total,
    reason,
  });
  ledger.trades.push({
    asset,
    entryTime: position.entryTime,
    exitTime: time,
    units: position.units,
    entryPrice: position.entryPrice,
    exitPrice: price,
    entryNotional: position.entryNotional,
    exitNotional: cost.notional,
    pricePnl,
    executionCosts: position.entryCost + cost.total,
    adjustedPricePnl: pricePnl - position.entryCost - cost.total,
    reason,
  });
}

function startEpisodeIfNeeded(
  ledger: MutableLedger,
  wasExposed: boolean,
  nowExposed: boolean,
  time: number,
  startNav: number,
): void {
  if (!wasExposed && nowExposed) {
    ledger.episodeStartTime = time;
    ledger.episodeStartNav = startNav;
  }
}

function finishEpisodeIfNeeded(
  ledger: MutableLedger,
  wasExposed: boolean,
  nowExposed: boolean,
  time: number,
  endNav: number,
): void {
  if (!wasExposed || nowExposed) return;
  if (ledger.episodeStartTime === null || ledger.episodeStartNav === null) {
    throw new Error('Exposure episode ended without a start');
  }
  const pnl = endNav - ledger.episodeStartNav;
  ledger.episodes.push({
    startTime: ledger.episodeStartTime,
    endTime: time,
    startNav: ledger.episodeStartNav,
    endNav,
    adjustedPricePnl: pnl,
    return: ledger.episodeStartNav === 0 ? 0 : pnl / ledger.episodeStartNav,
  });
  ledger.episodeStartTime = null;
  ledger.episodeStartNav = null;
}

function desiredNotional(
  point: IndicatorPoint,
  config: FrozenResearchConfig,
): number {
  const volatility = point.annualizedVolatility20;
  if (!point.long || volatility === null || volatility <= 0) return 0;
  return Math.min(
    config.perAssetEntryCap,
    config.perAssetEntryCap * Math.min(1, config.volatilityTarget / volatility),
  );
}

export function costAwareEntryBudget(
  controllerNav: number,
  retainedGross: number,
  desiredTotal: number,
  config: FrozenResearchConfig = FROZEN_CONFIG,
): number {
  const stressEntryRate = config.stressMultiplier
    * (config.feeRate + config.slippageRate);
  const grossCapacity = config.portfolioEntryCap - retainedGross;
  const navCapacity = (controllerNav - retainedGross) / (1 + stressEntryRate);
  return Math.max(0, Math.min(desiredTotal, grossCapacity, navCapacity));
}

function scheduleIdentity(executions: ExecutionRecord[]): unknown[] {
  return executions.map((execution) => ({
    asset: execution.asset,
    time: execution.time,
    side: execution.side,
    units: execution.units,
    referencePrice: execution.referencePrice,
    referenceNotional: execution.referenceNotional,
    reason: execution.reason,
  }));
}

function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Canonical JSON cannot contain non-finite numbers');
    return JSON.stringify(value);
  }
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value !== 'object') {
    throw new Error(`Canonical JSON cannot contain ${typeof value}`);
  }
  if (Array.isArray(value)) return `[${Array.from(value, stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${stableStringify(record[key])}`
  )).join(',')}}`;
}

function assertIdenticalSchedules(base: MutableLedger, stress: MutableLedger): string {
  const baseSchedule = stableStringify(scheduleIdentity(base.executions));
  const stressSchedule = stableStringify(scheduleIdentity(stress.executions));
  if (baseSchedule !== stressSchedule) {
    throw new Error('Base and doubled-cost execution schedules diverged');
  }
  return createHash('sha256').update(baseSchedule).digest('hex');
}

function dailyReturns(points: DailyLedgerPoint[]): number[] {
  const returns: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1].nav;
    if (!(previous > 0)) continue;
    returns.push(points[index].nav / previous - 1);
  }
  return returns;
}

function maximumDrawdown(points: DailyLedgerPoint[]): number {
  let peak = points.length > 0 ? points[0].nav : 0;
  let maximum = 0;
  for (const point of points) {
    peak = Math.max(peak, point.nav);
    if (peak > 0) maximum = Math.max(maximum, (peak - point.nav) / peak);
  }
  return maximum;
}

function ledgerMetrics(
  ledger: MutableLedger,
  config: FrozenResearchConfig,
): PortfolioMetrics {
  const endingNav = ledger.daily.length > 0
    ? ledger.daily[ledger.daily.length - 1].nav
    : config.initialNav;
  const returns = dailyReturns(ledger.daily);
  const dailyVolatility = sampleStandardDeviation(returns);
  const meanReturn = returns.length === 0
    ? null
    : returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const sharpe = dailyVolatility !== null && dailyVolatility > 0 && meanReturn !== null
    ? meanReturn / dailyVolatility * Math.sqrt(365)
    : null;
  const elapsedDays = ledger.daily.length >= 2
    ? (ledger.daily[ledger.daily.length - 1].time - ledger.daily[0].time) / DAY_MS
    : 0;
  const cagr = elapsedDays > 0 && endingNav > 0
    ? (endingNav / config.initialNav) ** (365.25 / elapsedDays) - 1
    : null;
  const wins = ledger.trades.filter((trade) => trade.adjustedPricePnl > 0);
  const positiveEpisodePnl = ledger.episodes
    .filter((episode) => episode.adjustedPricePnl > 0)
    .reduce((sum, episode) => sum + episode.adjustedPricePnl, 0);
  const negativeEpisodePnl = ledger.episodes
    .filter((episode) => episode.adjustedPricePnl < 0)
    .reduce((sum, episode) => sum + episode.adjustedPricePnl, 0);
  const positiveTrades = wins.map((trade) => trade.adjustedPricePnl)
    .sort((left, right) => right - left);
  const totalPositiveTradePnl = positiveTrades.reduce((sum, value) => sum + value, 0);
  const positivePnlByAsset: Record<ResearchAsset, number> = { BTC: 0, ETH: 0 };
  for (const trade of wins) positivePnlByAsset[trade.asset] += trade.adjustedPricePnl;
  const averageNav = ledger.daily.length === 0
    ? config.initialNav
    : ledger.daily.reduce((sum, point) => sum + point.nav, 0) / ledger.daily.length;
  const tradedNotional = ledger.executions
    .reduce((sum, execution) => sum + execution.referenceNotional, 0);
  const maxMarkedGross = ledger.daily.reduce(
    (maximum, point) => Math.max(maximum, point.markedGross),
    0,
  );
  const maxMarkedGrossToNavValues = ledger.daily
    .filter((point) => point.nav > 0)
    .map((point) => point.markedGross / point.nav);
  const episodeExpectancy = ledger.episodes.length === 0
    ? null
    : ledger.episodes.reduce((sum, episode) => sum + episode.adjustedPricePnl, 0)
      / ledger.episodes.length;

  return {
    startingNav: config.initialNav,
    endingNav,
    adjustedPricePnl: endingNav - config.initialNav,
    cagr: cagr === null ? null : finite(cagr, 'CAGR'),
    annualizedVolatility: dailyVolatility === null
      ? null
      : finite(dailyVolatility * Math.sqrt(365), 'annualized volatility'),
    sharpe: sharpe === null ? null : finite(sharpe, 'Sharpe'),
    maxDrawdown: maximumDrawdown(ledger.daily),
    completedTrades: ledger.trades.length,
    winningTrades: wins.length,
    winRate: ledger.trades.length === 0 ? null : wins.length / ledger.trades.length,
    effectiveEpisodes: ledger.episodes.length,
    effectiveEpisodeExpectancy: episodeExpectancy,
    profitFactor: negativeEpisodePnl < 0 ? positiveEpisodePnl / Math.abs(negativeEpisodePnl) : null,
    averageAdjustedTradePnl: ledger.trades.length === 0
      ? null
      : ledger.trades.reduce((sum, trade) => sum + trade.adjustedPricePnl, 0)
        / ledger.trades.length,
    exposureFraction: ledger.daily.length === 0
      ? 0
      : ledger.daily.filter((point) => point.exposed).length / ledger.daily.length,
    turnover: averageNav > 0 ? tradedNotional / averageNav : 0,
    largestPositiveTradeConcentration: totalPositiveTradePnl > 0
      ? positiveTrades[0] / totalPositiveTradePnl
      : null,
    topFivePositiveTradeConcentration: totalPositiveTradePnl > 0
      ? positiveTrades.slice(0, 5).reduce((sum, value) => sum + value, 0)
        / totalPositiveTradePnl
      : null,
    largestPositiveAssetConcentration: totalPositiveTradePnl > 0
      ? Math.max(positivePnlByAsset.BTC, positivePnlByAsset.ETH) / totalPositiveTradePnl
      : null,
    positivePnlByAsset,
    maxMarkedGross,
    maxMarkedGrossToNav: maxMarkedGrossToNavValues.length === 0
      ? null
      : Math.max(...maxMarkedGrossToNavValues),
    nonPositiveNav: ledger.nonPositiveNav,
  };
}

function closeAll(
  ledger: MutableLedger,
  prices: Record<ResearchAsset, number>,
  time: number,
  reason: ExecutionRecord['reason'],
  config: FrozenResearchConfig,
): void {
  for (const asset of ASSETS) exitPosition(ledger, asset, prices[asset], time, reason, config);
}

function simulateWindow(
  series: Record<ResearchAsset, ResearchCandle[]>,
  signals: SignalState,
  startIndex: number,
  config: FrozenResearchConfig,
): { base: MutableLedger; stress: MutableLedger; scheduleHash: string } {
  const base = createLedger(1, config.initialNav);
  const stress = createLedger(config.stressMultiplier, config.initialNav);
  const lastIndex = series.BTC.length - 1;

  for (let index = startIndex; index <= lastIndex; index += 1) {
    const openPrices: Record<ResearchAsset, number> = {
      BTC: series.BTC[index].open,
      ETH: series.ETH[index].open,
    };
    const closePrices: Record<ResearchAsset, number> = {
      BTC: series.BTC[index].close,
      ETH: series.ETH[index].close,
    };
    const time = series.BTC[index].openTime;
    const decisionIndex = index - config.executionDelayDays;
    const decisionAllowed = decisionIndex >= startIndex;
    const targetLong: Record<ResearchAsset, boolean> = {
      BTC: decisionAllowed && signals.indicators.BTC[decisionIndex]?.long === true,
      ETH: decisionAllowed && signals.indicators.ETH[decisionIndex]?.long === true,
    };
    const wasExposed = stress.positions.size > 0;
    const baseNavBeforeOrders = navAt(base, openPrices);
    const stressNavBeforeOrders = navAt(stress, openPrices);

    for (const asset of ASSETS) {
      if (!targetLong[asset]) {
        exitPosition(base, asset, openPrices[asset], time, 'signal', config);
        exitPosition(stress, asset, openPrices[asset], time, 'signal', config);
      }
    }

    const desiredEntries = ASSETS
      .filter((asset) => targetLong[asset] && !stress.positions.has(asset))
      .map((asset) => ({
        asset,
        desired: desiredNotional(signals.indicators[asset][decisionIndex], config),
      }))
      .filter((entry) => entry.desired > 0);
    const desiredTotal = desiredEntries.reduce((sum, entry) => sum + entry.desired, 0);

    if (desiredTotal > 0) {
      const controllerNav = navAt(stress, openPrices);
      const retainedGross = grossAt(stress, openPrices);
      const budget = costAwareEntryBudget(
        controllerNav,
        retainedGross,
        desiredTotal,
        config,
      );
      let assigned = 0;

      desiredEntries.forEach((entry, entryIndex) => {
        const allocation = entryIndex === desiredEntries.length - 1
          ? budget - assigned
          : budget * entry.desired / desiredTotal;
        assigned += allocation;
        const units = allocation / openPrices[entry.asset];
        enterPosition(base, entry.asset, units, openPrices[entry.asset], time, config);
        enterPosition(stress, entry.asset, units, openPrices[entry.asset], time, config);
      });
    }

    const nowExposed = stress.positions.size > 0;
    startEpisodeIfNeeded(base, wasExposed, nowExposed, time, baseNavBeforeOrders);
    startEpisodeIfNeeded(stress, wasExposed, nowExposed, time, stressNavBeforeOrders);
    finishEpisodeIfNeeded(base, wasExposed, nowExposed, time, navAt(base, openPrices));
    finishEpisodeIfNeeded(stress, wasExposed, nowExposed, time, navAt(stress, openPrices));

    const exposedDuringDay = wasExposed || nowExposed;
    let baseCloseNav = navAt(base, closePrices);
    let stressCloseNav = navAt(stress, closePrices);
    const baseCloseMarkedGross = grossAt(base, closePrices);
    const stressCloseMarkedGross = grossAt(stress, closePrices);

    if (baseCloseNav <= 0 || stressCloseNav <= 0) {
      base.nonPositiveNav = baseCloseNav <= 0;
      stress.nonPositiveNav = stressCloseNav <= 0;
      const exposedBeforeRiskClose = stress.positions.size > 0;
      closeAll(base, closePrices, series.BTC[index].closeTime, 'non_positive_nav', config);
      closeAll(stress, closePrices, series.BTC[index].closeTime, 'non_positive_nav', config);
      baseCloseNav = navAt(base, closePrices);
      stressCloseNav = navAt(stress, closePrices);
      finishEpisodeIfNeeded(
        base,
        exposedBeforeRiskClose,
        false,
        series.BTC[index].closeTime,
        baseCloseNav,
      );
      finishEpisodeIfNeeded(
        stress,
        exposedBeforeRiskClose,
        false,
        series.BTC[index].closeTime,
        stressCloseNav,
      );
    } else if (index === lastIndex) {
      const exposedBeforeTerminalClose = stress.positions.size > 0;
      closeAll(base, closePrices, series.BTC[index].closeTime, 'dataset_end', config);
      closeAll(stress, closePrices, series.BTC[index].closeTime, 'dataset_end', config);
      baseCloseNav = navAt(base, closePrices);
      stressCloseNav = navAt(stress, closePrices);
      finishEpisodeIfNeeded(
        base,
        exposedBeforeTerminalClose,
        false,
        series.BTC[index].closeTime,
        baseCloseNav,
      );
      finishEpisodeIfNeeded(
        stress,
        exposedBeforeTerminalClose,
        false,
        series.BTC[index].closeTime,
        stressCloseNav,
      );
    }

    base.daily.push({
      time: series.BTC[index].closeTime,
      nav: baseCloseNav,
      markedGross: baseCloseMarkedGross,
      exposed: exposedDuringDay,
    });
    stress.daily.push({
      time: series.BTC[index].closeTime,
      nav: stressCloseNav,
      markedGross: stressCloseMarkedGross,
      exposed: exposedDuringDay,
    });

    if (base.nonPositiveNav || stress.nonPositiveNav) break;
  }

  return {
    base,
    stress,
    scheduleHash: assertIdenticalSchedules(base, stress),
  };
}

function referenceMetrics(
  series: Record<ResearchAsset, ResearchCandle[]>,
  startIndex: number,
  costMultiplier: number,
  config: FrozenResearchConfig,
): ReferenceMetrics {
  const ledger = createLedger(costMultiplier, config.initialNav);
  const entryIndex = Math.max(startIndex, config.emaDays - 1) + config.executionDelayDays;
  const lastIndex = series.BTC.length - 1;
  if (entryIndex > lastIndex) {
    return {
      entryTime: series.BTC[startIndex].openTime,
      endingNav: config.initialNav,
      adjustedPricePnl: 0,
      sharpe: null,
      maxDrawdown: 0,
    };
  }

  for (let index = startIndex; index <= lastIndex; index += 1) {
    const opens: Record<ResearchAsset, number> = {
      BTC: series.BTC[index].open,
      ETH: series.ETH[index].open,
    };
    const closes: Record<ResearchAsset, number> = {
      BTC: series.BTC[index].close,
      ETH: series.ETH[index].close,
    };
    if (index === entryIndex) {
      for (const asset of ASSETS) {
        enterPosition(
          ledger,
          asset,
          config.perAssetEntryCap / opens[asset],
          opens[asset],
          series.BTC[index].openTime,
          config,
        );
      }
    }
    const exposed = ledger.positions.size > 0;
    if (index === lastIndex) {
      closeAll(ledger, closes, series.BTC[index].closeTime, 'dataset_end', config);
    }
    ledger.daily.push({
      time: series.BTC[index].closeTime,
      nav: navAt(ledger, closes),
      markedGross: grossAt(ledger, closes),
      exposed,
    });
  }

  const metrics = ledgerMetrics(ledger, config);
  return {
    entryTime: series.BTC[entryIndex].openTime,
    endingNav: metrics.endingNav,
    adjustedPricePnl: metrics.adjustedPricePnl,
    sharpe: metrics.sharpe,
    maxDrawdown: metrics.maxDrawdown,
  };
}

function finalizeWindow(
  series: Record<ResearchAsset, ResearchCandle[]>,
  signals: SignalState,
  startIndex: number,
  config: FrozenResearchConfig,
): WindowResult {
  const simulation = simulateWindow(series, signals, startIndex, config);
  return {
    startTime: series.BTC[startIndex].openTime,
    endTime: series.BTC[series.BTC.length - 1].closeTime,
    base: {
      metrics: ledgerMetrics(simulation.base, config),
      executions: simulation.base.executions,
      trades: simulation.base.trades,
      episodes: simulation.base.episodes,
      daily: simulation.base.daily,
    },
    doubledCosts: {
      metrics: ledgerMetrics(simulation.stress, config),
      executions: simulation.stress.executions,
      trades: simulation.stress.trades,
      episodes: simulation.stress.episodes,
      daily: simulation.stress.daily,
    },
    buyAndHold: {
      base: referenceMetrics(series, startIndex, 1, config),
      doubledCosts: referenceMetrics(series, startIndex, config.stressMultiplier, config),
    },
    executionScheduleSha256: simulation.scheduleHash,
  };
}

export function screenVerdict(
  base: PortfolioMetrics,
  doubledCosts: PortfolioMetrics,
): ScreenVerdict {
  if (base.nonPositiveNav || doubledCosts.nonPositiveNav) return 'PRICE_EDGE_REJECT';
  if (
    (base.effectiveEpisodeExpectancy !== null && base.effectiveEpisodeExpectancy <= 0)
    || (base.sharpe !== null && base.sharpe <= 0)
    || (
      doubledCosts.effectiveEpisodeExpectancy !== null
      && doubledCosts.effectiveEpisodeExpectancy <= 0
    )
  ) return 'PRICE_EDGE_REJECT';

  if (
    base.effectiveEpisodes < 30
    || base.effectiveEpisodeExpectancy === null
    || base.sharpe === null
    || doubledCosts.effectiveEpisodeExpectancy === null
    || base.topFivePositiveTradeConcentration === null
    || base.topFivePositiveTradeConcentration > 0.5
    || base.largestPositiveAssetConcentration === null
    || base.largestPositiveAssetConcentration > 0.8
  ) return 'PRICE_EDGE_INSUFFICIENT';

  return 'PRICE_EDGE_CANDIDATE';
}

export function runFrozenResearch(
  series: Record<ResearchAsset, ResearchCandle[]>,
  config: FrozenResearchConfig = FROZEN_CONFIG,
): ResearchResult {
  validateAlignedSeries(series);
  const expectedCandles = (config.asOfTime - config.startTime) / DAY_MS;
  if (series.BTC.length !== expectedCandles) {
    throw new Error(`Expected ${expectedCandles} candles, received ${series.BTC.length}`);
  }
  if (series.BTC[0].openTime !== config.startTime) {
    throw new Error('Series does not start at the frozen boundary');
  }
  if (series.BTC[series.BTC.length - 1].closeTime !== config.asOfTime - 1) {
    throw new Error('Series does not end at the frozen boundary');
  }

  const holdoutIndex = series.BTC.findIndex(
    (candle) => candle.openTime === config.holdoutStartTime,
  );
  if (holdoutIndex < 0) throw new Error('Holdout boundary is missing from the calendar');

  const signals: SignalState = {
    indicators: {
      BTC: calculateIndicators(series.BTC, config),
      ETH: calculateIndicators(series.ETH, config),
    },
  };
  const fullHistory = finalizeWindow(series, signals, 0, config);
  const holdout = finalizeWindow(series, signals, holdoutIndex, config);

  return {
    schemaVersion: 1,
    trialId: config.trialId,
    screenVerdict: screenVerdict(holdout.base.metrics, holdout.doubledCosts.metrics),
    promotionEligible: false,
    limitations: [
      'Price-edge screen only; perpetual funding is excluded.',
      'Daily OHLC candles cannot establish intrabar execution quality.',
      'No order-book depth, latency, partial fills, or liquidation mechanics are modeled.',
      'A favorable screen does not authorize forward paper deployment or live trading.',
    ],
    config: { ...config },
    fullHistory,
    holdout,
  };
}

export const canonicalJson = stableStringify;
