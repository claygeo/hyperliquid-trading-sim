import {
  FOUR_HOUR_MS,
  HOUR_MS,
  type AcceptedSchedule,
  type CostCase,
  type ExecutionCostRates,
  type FourHourCandle,
  type HourlyFunding,
  type InstrumentId,
  type PerpAsset,
  type ScheduledLeg,
  type ScheduledPosition,
  type TrialWindow,
  type ValidatedFamilyData,
} from './contracts.js';
import {
  BASE_COSTS,
  FROZEN_TRIALS,
  INITIAL_NAV,
  STRESS_COSTS,
  type FrozenTrialConfig,
} from './frozenTrials.js';
import type { EpisodePnl, TimedNav } from './metrics.js';

export type LedgerPhase =
  | 'anchor'
  | 'completed_close'
  | 'daily_sample'
  | 'current_open'
  | 'exit'
  | 'entry'
  | 'post_execution'
  | 'termination';

export type LedgerEventKind =
  | 'anchor'
  | 'funding'
  | 'boundary_funding_debit'
  | 'mark'
  | 'daily_sample'
  | 'exit'
  | 'entry'
  | 'termination'
  | 'truncated_entry';

export interface LedgerEvent {
  sequence: number;
  time: number;
  phase: LedgerPhase;
  kind: LedgerEventKind;
  nav: number;
  positionId?: string;
  asset?: PerpAsset;
  instrument?: InstrumentId;
  amount?: number;
  fundingTime?: number;
  fundingRate?: number;
  oracleProxy?: number;
  boundaryPositionId?: string;
}

export interface AssetLedgerPnl {
  pricePnl: number;
  funding: number;
  fees: number;
  slippage: number;
  adjustedPnl: number;
}

export interface CompletedPosition {
  id: string;
  asset: PerpAsset;
  entryTime: number;
  exitTime: number;
  forced: boolean;
  pricePnl: number;
  funding: number;
  fees: number;
  slippage: number;
  adjustedPnl: number;
}

export interface LedgerTermination {
  time: number;
  phase: 'completed_close' | 'current_open' | 'execution_batch' | 'shared_stop';
  reason: 'non_positive_nav' | 'shared_cost_case';
  reference: 'close' | 'open';
  navBeforeClose: number;
}

export interface ReplayStop {
  time: number;
  phase: LedgerTermination['phase'];
  reference: LedgerTermination['reference'];
  truncateSameBoundaryEntries?: boolean;
}

export interface ReplayScheduleInput {
  schedule: Readonly<AcceptedSchedule>;
  data: Readonly<ValidatedFamilyData>;
  window: Readonly<TrialWindow>;
  costs: Readonly<ExecutionCostRates>;
  boundaryFunding?: 'exclude' | 'adverse_debits';
  sharedStop?: Readonly<ReplayStop>;
}

export interface LedgerResult {
  trialId: string;
  costCase: CostCase;
  boundaryFunding: 'exclude' | 'adverse_debits';
  initialNav: number;
  endingNav: number;
  adjustedPnl: number;
  cash: number;
  pricePnl: number;
  funding: number;
  fees: number;
  slippage: number;
  turnover: number;
  navPoints: TimedNav[];
  dailyNav: TimedNav[];
  episodes: EpisodePnl[];
  completedPositions: CompletedPosition[];
  truncatedPositionIds: string[];
  pnlByAsset: Record<PerpAsset, AssetLedgerPnl>;
  maximumMarkedGross: number;
  maximumGrossToNav: number;
  maximumLongGross: number;
  maximumShortGross: number;
  events: LedgerEvent[];
  termination: LedgerTermination | null;
}

export interface CostCaseReplay {
  base: LedgerResult;
  stress: LedgerResult;
}

interface PositionAccounting {
  position: ScheduledPosition;
  funding: number;
  fees: number;
  slippage: number;
}

interface ExecutionCost {
  fee: number;
  slippage: number;
  total: number;
  notional: number;
}

interface BatchState {
  time: number;
  grossBefore: number;
  navBefore: number;
}

const ASSET_ORDER: Readonly<Record<PerpAsset, number>> = Object.freeze({ BTC: 0, ETH: 1, HYPE: 2 });

const INSTRUMENT_ORDER: Readonly<Record<InstrumentId, number>> = Object.freeze({
  'BTC-PERP': 0,
  'ETH-PERP': 1,
  'HYPE-PERP': 2,
  'UBTC-SPOT': 3,
  'UETH-SPOT': 4,
});

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}

function positive(value: number, label: string): number {
  finite(value, label);
  if (!(value > 0)) throw new Error(`${label} must be positive`);
  return value;
}

function equalWithinFrozenTolerance(left: number, right: number): boolean {
  return Math.abs(left - right) <= Math.max(1, Math.abs(right)) * 1e-12;
}

function assertAlignedTime(time: number, label: string): void {
  if (!Number.isInteger(time) || time % FOUR_HOUR_MS !== 0) {
    throw new Error(`${label} must be aligned to a four-hour UTC boundary`);
  }
}

export function instrumentSymbol(instrument: InstrumentId): 'BTC' | 'ETH' | 'HYPE' | '@142' | '@151' {
  switch (instrument) {
    case 'BTC-PERP': return 'BTC';
    case 'ETH-PERP': return 'ETH';
    case 'HYPE-PERP': return 'HYPE';
    case 'UBTC-SPOT': return '@142';
    case 'UETH-SPOT': return '@151';
  }
}

export function executionCostForLeg(
  leg: Readonly<ScheduledLeg>,
  referencePrice: number,
  costs: Readonly<ExecutionCostRates>,
): ExecutionCost {
  const price = positive(referencePrice, 'Execution reference price');
  finite(leg.signedUnits, 'Execution units');
  if (leg.signedUnits === 0) throw new Error('Execution units cannot be zero');
  const multiplier = positive(costs.multiplier, 'Cost multiplier');
  const feeRate = leg.market === 'perp' ? costs.perpFee : costs.spotFee;
  if (![feeRate, costs.slippage].every((rate) => Number.isFinite(rate) && rate >= 0)) {
    throw new Error('Execution cost rates must be finite and non-negative');
  }
  const notional = Math.abs(leg.signedUnits) * price;
  const fee = notional * feeRate * multiplier;
  const slippage = notional * costs.slippage * multiplier;
  return { fee, slippage, total: fee + slippage, notional };
}

export function entryCostsForPosition(
  position: Readonly<ScheduledPosition>,
  costs: Readonly<ExecutionCostRates>,
): ExecutionCost {
  return position.legs.reduce<ExecutionCost>((sum, leg) => {
    const value = executionCostForLeg(leg, leg.entryReferencePrice, costs);
    return {
      fee: sum.fee + value.fee,
      slippage: sum.slippage + value.slippage,
      total: sum.total + value.total,
      notional: sum.notional + value.notional,
    };
  }, { fee: 0, slippage: 0, total: 0, notional: 0 });
}

function costCase(costs: Readonly<ExecutionCostRates>): CostCase {
  if (costs.multiplier === BASE_COSTS.multiplier
    && costs.perpFee === BASE_COSTS.perpFee
    && costs.spotFee === BASE_COSTS.spotFee
    && costs.slippage === BASE_COSTS.slippage) return 'base';
  if (costs.multiplier === STRESS_COSTS.multiplier
    && costs.perpFee === STRESS_COSTS.perpFee
    && costs.spotFee === STRESS_COSTS.spotFee
    && costs.slippage === STRESS_COSTS.slippage) return 'stress';
  throw new Error('Ledger accepts only the frozen base or stress cost schedule');
}

function emptyAssetPnl(): Record<PerpAsset, AssetLedgerPnl> {
  return {
    BTC: { pricePnl: 0, funding: 0, fees: 0, slippage: 0, adjustedPnl: 0 },
    ETH: { pricePnl: 0, funding: 0, fees: 0, slippage: 0, adjustedPnl: 0 },
    HYPE: { pricePnl: 0, funding: 0, fees: 0, slippage: 0, adjustedPnl: 0 },
  };
}

function validateCandle(candle: FourHourCandle | undefined, symbol: string, openTime: number): FourHourCandle {
  if (!candle
    || candle.symbol !== symbol
    || candle.interval !== '4h'
    || candle.openTime !== openTime
    || candle.closeTime !== openTime + FOUR_HOUR_MS - 1
    || ![candle.open, candle.high, candle.low, candle.close].every((value) => Number.isFinite(value) && value > 0)
    || candle.low > Math.min(candle.open, candle.close)
    || candle.high < Math.max(candle.open, candle.close)
    || candle.low > candle.high) {
    throw new Error(`Missing or invalid ${symbol} candle at ${openTime}`);
  }
  return candle;
}

function findCandle(
  data: Readonly<ValidatedFamilyData>,
  instrument: InstrumentId,
  openTime: number,
): FourHourCandle {
  const symbol = instrumentSymbol(instrument);
  const candles = data.candles[symbol];
  if (!candles) throw new Error(`Missing candle series for ${symbol}`);
  // Adapter output is sorted. Binary search prevents replay cost from depending on the snapshot span.
  let low = 0;
  let high = candles.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const time = candles[middle].openTime;
    if (time === openTime) return validateCandle(candles[middle], symbol, openTime);
    if (time < openTime) low = middle + 1;
    else high = middle - 1;
  }
  throw new Error(`Missing ${symbol} candle at ${openTime}`);
}

function frozenTrialForId(trialId: string): Readonly<FrozenTrialConfig> {
  const trial = FROZEN_TRIALS.find((candidate) => candidate.trialId === trialId);
  if (!trial) throw new Error(`Unknown frozen trial ${trialId}`);
  return trial;
}

function perpInstrument(asset: PerpAsset): 'BTC-PERP' | 'ETH-PERP' | 'HYPE-PERP' {
  if (asset === 'BTC') return 'BTC-PERP';
  if (asset === 'ETH') return 'ETH-PERP';
  return 'HYPE-PERP';
}

function assertLegIdentity(
  leg: Readonly<ScheduledLeg>,
  asset: PerpAsset,
  instrument: InstrumentId,
  market: ScheduledLeg['market'],
  positionId: string,
): void {
  if (leg.asset !== asset || leg.instrument !== instrument || leg.market !== market) {
    throw new Error(`Position ${positionId} has invalid ${instrument} leg identity`);
  }
  finite(leg.signedUnits, `Position ${positionId} units`);
  if (leg.signedUnits === 0) throw new Error(`Position ${positionId} units cannot be zero`);
  positive(leg.entryReferencePrice, `Position ${positionId} entry price`);
}

function validatePositionAgainstTrial(
  position: Readonly<ScheduledPosition>,
  trial: Readonly<FrozenTrialConfig>,
  data: Readonly<ValidatedFamilyData>,
  window: Readonly<TrialWindow>,
): void {
  if (position.trialId !== trial.trialId || position.strategy !== trial.id) {
    throw new Error(`Position ${position.id} does not belong to ${trial.trialId}`);
  }
  if (!Number.isSafeInteger(position.signalIndex) || position.signalIndex < 0) {
    throw new Error(`Position ${position.id} signal index is invalid`);
  }
  assertAlignedTime(position.decisionTime, `Position ${position.id} decision`);
  assertAlignedTime(position.entryTime, `Position ${position.id} entry`);
  assertAlignedTime(position.exitTime, `Position ${position.id} exit`);
  const expectedEntryTime = position.decisionTime
    + (trial.executionDelayBars - 1) * FOUR_HOUR_MS;
  const expectedExitTime = expectedEntryTime + trial.holdBars * FOUR_HOUR_MS;
  if (position.entryTime !== expectedEntryTime || position.exitTime !== expectedExitTime) {
    throw new Error(`Position ${position.id} violates frozen decision, execution, or holding chronology`);
  }
  const expectedId = `${trial.trialId}:${position.asset}:${position.decisionTime}`;
  if (position.id !== expectedId) throw new Error(`Position ${position.id} is not canonically identified`);
  if (position.entryTime < window.startTime
    || position.exitTime >= window.endTime
    || position.exitTime <= position.entryTime) {
    throw new Error(`Position ${position.id} is outside the replay window`);
  }

  const allowedAssets = new Set<PerpAsset>([
    ...trial.primaryAssets,
    ...trial.exploratoryAssets,
  ]);
  if (!allowedAssets.has(position.asset)) {
    throw new Error(`Position ${position.id} uses an asset outside ${trial.id}`);
  }
  const signalCandles = data.candles[position.asset];
  const signalCandle = signalCandles?.[position.signalIndex];
  validateCandle(
    signalCandle,
    position.asset,
    position.decisionTime - FOUR_HOUR_MS,
  );

  if (trial.id === 'H2') {
    if ((position.asset !== 'BTC' && position.asset !== 'ETH') || position.legs.length !== 2) {
      throw new Error(`Position ${position.id} is not an atomic H2 carry pair`);
    }
    const spot = position.legs[0];
    const perp = position.legs[1];
    const spotInstrument = position.asset === 'BTC' ? 'UBTC-SPOT' : 'UETH-SPOT';
    assertLegIdentity(spot, position.asset, spotInstrument, 'spot', position.id);
    assertLegIdentity(perp, position.asset, perpInstrument(position.asset), 'perp', position.id);
    if (!(spot.signedUnits > 0) || perp.signedUnits !== -spot.signedUnits) {
      throw new Error(`Position ${position.id} is not an equal-unit long-spot/short-perp pair`);
    }
    const expectedUnits = Math.min(
      trial.perLegNotionalCap / spot.entryReferencePrice,
      trial.perLegNotionalCap / perp.entryReferencePrice,
    );
    if (!equalWithinFrozenTolerance(spot.signedUnits, expectedUnits)) {
      throw new Error(`Position ${position.id} violates frozen H2 quantity economics`);
    }
  } else {
    if (position.legs.length !== 1) {
      throw new Error(`Position ${position.id} must contain one directional perpetual leg`);
    }
    assertLegIdentity(
      position.legs[0],
      position.asset,
      perpInstrument(position.asset),
      'perp',
      position.id,
    );
    const frozenNotional = position.asset === 'HYPE'
      ? trial.exploratoryNotional
      : trial.primaryNotional;
    const expectedAbsoluteUnits = frozenNotional / position.legs[0].entryReferencePrice;
    if (!equalWithinFrozenTolerance(Math.abs(position.legs[0].signedUnits), expectedAbsoluteUnits)) {
      throw new Error(`Position ${position.id} violates frozen ${trial.id} quantity economics`);
    }
  }

  const entryGross = positive(position.entryGross, `Position ${position.id} entry gross`);
  let computedGross = 0;
  for (const leg of position.legs) {
    const candle = findCandle(data, leg.instrument, position.entryTime);
    if (candle.open !== leg.entryReferencePrice) {
      throw new Error(`Position ${position.id} reference price does not match immutable candle`);
    }
    computedGross += Math.abs(leg.signedUnits) * leg.entryReferencePrice;
  }
  finite(computedGross, `Position ${position.id} computed entry gross`);
  if (!equalWithinFrozenTolerance(entryGross, computedGross)) {
    throw new Error(`Position ${position.id} entry gross is inconsistent`);
  }
}

function compareScheduledPositions(
  left: Readonly<ScheduledPosition>,
  right: Readonly<ScheduledPosition>,
): number {
  if (left.entryTime !== right.entryTime) return left.entryTime - right.entryTime;
  if (left.asset !== right.asset) return ASSET_ORDER[left.asset] - ASSET_ORDER[right.asset];
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function validateReplayStop(stop: Readonly<ReplayStop>, window: Readonly<TrialWindow>): void {
  assertAlignedTime(stop.time, 'Shared stop');
  if (stop.phase === 'shared_stop') throw new Error('A shared stop cannot target the shared_stop phase');
  const expectedReference = stop.phase === 'completed_close' ? 'close' : 'open';
  if (stop.reference !== expectedReference) throw new Error('Shared stop reference does not match its phase');
  if (stop.time < window.startTime || stop.time > window.endTime) {
    throw new Error('Shared stop is outside the replay window');
  }
  if (stop.phase === 'completed_close' && stop.time === window.startTime) {
    throw new Error('A completed-close shared stop cannot occur at the window anchor');
  }
  if (stop.phase !== 'completed_close' && stop.time === window.endTime) {
    throw new Error('An open or execution shared stop cannot occur at the exclusive end');
  }
  if (stop.truncateSameBoundaryEntries !== undefined
    && typeof stop.truncateSameBoundaryEntries !== 'boolean') {
    throw new Error('Shared-stop truncation mode must be boolean');
  }
  if ((stop.phase === 'completed_close' || stop.phase === 'current_open')
    && stop.truncateSameBoundaryEntries === false) {
    throw new Error('A pre-execution shared stop must truncate same-boundary entries');
  }
}

export class FourHourLedgerMachine {
  readonly trialId: string;
  readonly costCase: CostCase;
  readonly boundaryFunding: 'exclude' | 'adverse_debits';
  readonly initialNav: number;

  private readonly data: Readonly<ValidatedFamilyData>;
  private readonly window: Readonly<TrialWindow>;
  private readonly costs: Readonly<ExecutionCostRates>;
  private readonly trial: Readonly<FrozenTrialConfig>;
  private readonly open = new Map<string, PositionAccounting>();
  private readonly pnlByAssetState = emptyAssetPnl();
  private readonly navPointState: TimedNav[] = [];
  private readonly dailyNavState: TimedNav[] = [];
  private readonly episodeState: EpisodePnl[] = [];
  private readonly completedState: CompletedPosition[] = [];
  private readonly eventState: LedgerEvent[] = [];
  private readonly boundaryPositions: readonly ScheduledPosition[];
  private readonly fundingIndex = new Map<PerpAsset, Map<number, HourlyFunding>>();

  private cashState: number;
  private marks = new Map<InstrumentId, number>();
  private eventSequence = 0;
  private lastBoundary = -Infinity;
  private batch: BatchState | null = null;
  private episodeStart: { time: number; nav: number } | null = null;
  private pricePnlState = 0;
  private fundingState = 0;
  private feesState = 0;
  private slippageState = 0;
  private turnoverState = 0;
  private maxGrossState = 0;
  private maxGrossToNavState = 0;
  private maxLongState = 0;
  private maxShortState = 0;
  private terminationState: LedgerTermination | null = null;

  constructor(input: ReplayScheduleInput) {
    this.trialId = input.schedule.trialId;
    this.trial = frozenTrialForId(this.trialId);
    this.data = input.data;
    this.window = input.window;
    this.costs = input.costs;
    this.costCase = costCase(input.costs);
    this.boundaryFunding = input.boundaryFunding ?? 'exclude';
    this.initialNav = INITIAL_NAV;
    this.cashState = this.initialNav;
    this.boundaryPositions = [...input.schedule.positions];
    for (const asset of ['BTC', 'ETH', 'HYPE'] as const) {
      const records = input.data.funding[asset];
      if (!records) continue;
      const index = new Map<number, HourlyFunding>();
      for (const record of records) {
        if (record.coin !== asset
          || !Number.isInteger(record.time)
          || record.time % HOUR_MS !== 0
          || !Number.isFinite(record.rate)
          || index.has(record.time)) {
          throw new Error(`Invalid or duplicate ${asset} funding record`);
        }
        index.set(record.time, record);
      }
      this.fundingIndex.set(asset, index);
    }
    assertAlignedTime(this.window.startTime, 'Window start');
    assertAlignedTime(this.window.endTime, 'Window end');
    if (!(this.window.endTime > this.window.startTime)) throw new Error('Replay window is empty');
    this.recordNav(this.window.startTime, 'anchor');
    this.recordEvent(this.window.startTime, 'anchor', 'anchor');
    this.dailyNavState.push({ time: this.window.startTime, nav: this.initialNav });
  }

  get nav(): number {
    let value = this.cashState;
    for (const accounting of this.open.values()) {
      for (const leg of accounting.position.legs) {
        const mark = this.marks.get(leg.instrument);
        if (mark === undefined) throw new Error(`Missing mark for ${leg.instrument}`);
        if (leg.market === 'spot') value += leg.signedUnits * mark;
        else value += leg.signedUnits * (mark - leg.entryReferencePrice);
      }
    }
    return finite(value, 'NAV');
  }

  get cash(): number { return this.cashState; }
  get terminated(): boolean { return this.terminationState !== null; }
  get termination(): LedgerTermination | null { return this.terminationState; }
  get openPositionIds(): readonly string[] { return [...this.open.keys()]; }

  hasOpenAsset(asset: PerpAsset): boolean {
    return [...this.open.values()].some((accounting) => accounting.position.asset === asset);
  }

  markedGross(): number {
    let gross = 0;
    for (const accounting of this.open.values()) {
      for (const leg of accounting.position.legs) {
        const mark = this.marks.get(leg.instrument);
        if (mark === undefined) throw new Error(`Missing mark for ${leg.instrument}`);
        gross += Math.abs(leg.signedUnits) * mark;
      }
    }
    return finite(gross, 'Marked gross');
  }

  completeBar(boundary: number): void {
    this.assertBoundary(boundary);
    if (this.terminated) return;
    const barOpen = boundary - FOUR_HOUR_MS;
    const fundingFlows: Array<{
      time: number;
      position: PositionAccounting | null;
      boundaryPositionId?: string;
      asset: PerpAsset;
      instrument: InstrumentId;
      amount: number;
      rate: number;
      proxy: number;
      kind: 'funding' | 'boundary_funding_debit';
    }> = [];

    for (const accounting of this.open.values()) {
      for (const leg of accounting.position.legs) {
        const candle = findCandle(this.data, leg.instrument, barOpen);
        this.marks.set(leg.instrument, candle.close);
        if (leg.market !== 'perp') continue;
        for (const record of this.fundingRecordsForBar(leg.asset, barOpen)) {
          if (record.time <= accounting.position.entryTime
            || record.time >= accounting.position.exitTime) continue;
          const signOnly = -leg.signedUnits * record.rate;
          const proxy = signOnly > 0 ? candle.low : candle.high;
          const amount = signOnly === 0 ? 0 : signOnly * proxy;
          fundingFlows.push({
            time: record.time,
            position: accounting,
            asset: leg.asset,
            instrument: leg.instrument,
            amount,
            rate: record.rate,
            proxy,
            kind: 'funding',
          });
        }
      }
    }

    if (this.boundaryFunding === 'adverse_debits') {
      for (const position of this.boundaryPositions) {
        for (const boundaryTime of [position.entryTime, position.exitTime]) {
          if (boundaryTime < barOpen || boundaryTime >= boundary) continue;
          for (const leg of position.legs) {
            if (leg.market !== 'perp') continue;
            const records = this.fundingRecordsForBar(leg.asset, barOpen);
            const record = records.find((candidate) => candidate.time === boundaryTime);
            if (!record) throw new Error(`Missing boundary funding for ${leg.asset} at ${boundaryTime}`);
            const candle = findCandle(this.data, leg.instrument, barOpen);
            const flow = -leg.signedUnits * candle.high * record.rate;
            if (flow < 0) {
              fundingFlows.push({
                time: boundaryTime,
                position: null,
                boundaryPositionId: position.id,
                asset: leg.asset,
                instrument: leg.instrument,
                amount: flow,
                rate: record.rate,
                proxy: candle.high,
                kind: 'boundary_funding_debit',
              });
            }
          }
        }
      }
    }

    fundingFlows.sort((left, right) => (
      left.time - right.time
      || ASSET_ORDER[left.asset] - ASSET_ORDER[right.asset]
      || INSTRUMENT_ORDER[left.instrument] - INSTRUMENT_ORDER[right.instrument]
      || (left.position?.position.id ?? left.boundaryPositionId ?? '')
        .localeCompare(right.position?.position.id ?? right.boundaryPositionId ?? '')
    ));
    for (const flow of fundingFlows) {
      this.cashState += flow.amount;
      this.fundingState += flow.amount;
      this.pnlByAssetState[flow.asset].funding += flow.amount;
      if (flow.position) flow.position.funding += flow.amount;
      else if (flow.boundaryPositionId) {
        const openAccounting = this.open.get(flow.boundaryPositionId);
        if (openAccounting) {
          openAccounting.funding += flow.amount;
        } else {
          const completed = this.completedState.find((item) => item.id === flow.boundaryPositionId);
          if (!completed) throw new Error(`Boundary funding references unknown ${flow.boundaryPositionId}`);
          completed.funding += flow.amount;
          completed.adjustedPnl += flow.amount;
          if (!this.episodeStart || flow.time < this.episodeStart.time) {
            const closedEpisode = [...this.episodeState]
              .reverse()
              .find((episode) => episode.startTime <= flow.time && flow.time <= episode.endTime);
            if (!closedEpisode) throw new Error('Boundary debit could not be assigned to an exposure episode');
            closedEpisode.pnl += flow.amount;
          }
        }
      }
      this.recordEvent(boundary, 'completed_close', flow.kind, {
        positionId: flow.position?.position.id ?? flow.boundaryPositionId,
        asset: flow.asset,
        instrument: flow.instrument,
        amount: flow.amount,
        fundingTime: flow.time,
        fundingRate: flow.rate,
        oracleProxy: flow.proxy,
        boundaryPositionId: flow.boundaryPositionId,
      });
    }
    this.refreshExposureExtrema();
    this.recordNav(boundary, 'completed_close');
    this.recordEvent(boundary, 'completed_close', 'mark');
    if (this.nav <= 0) this.forceTerminate(boundary, 'completed_close', 'close', 'non_positive_nav');
  }

  recordDailySample(boundary: number): void {
    if (this.terminated) return;
    if (boundary === this.window.startTime || boundary % (6 * FOUR_HOUR_MS) !== 0) return;
    const last = this.dailyNavState.at(-1);
    if (last && boundary <= last.time) throw new Error('Daily NAV samples are not increasing');
    this.dailyNavState.push({ time: boundary, nav: this.nav });
    this.recordEvent(boundary, 'daily_sample', 'daily_sample');
  }

  revalueToOpen(boundary: number): void {
    this.assertBoundary(boundary);
    if (this.terminated) return;
    for (const accounting of this.open.values()) {
      for (const leg of accounting.position.legs) {
        const candle = findCandle(this.data, leg.instrument, boundary);
        this.marks.set(leg.instrument, candle.open);
      }
    }
    this.refreshExposureExtrema();
    this.recordNav(boundary, 'current_open');
    this.recordEvent(boundary, 'current_open', 'mark');
    if (this.nav <= 0) this.forceTerminate(boundary, 'current_open', 'open', 'non_positive_nav');
  }

  beginExecutionBatch(time: number): void {
    if (this.terminated) return;
    if (this.batch) throw new Error('Execution batch is already open');
    this.batch = { time, grossBefore: this.markedGross(), navBefore: this.nav };
  }

  exitPosition(positionId: string, time: number, forced = false): void {
    if (this.terminated && !forced) return;
    const accounting = this.open.get(positionId);
    if (!accounting) throw new Error(`Cannot exit unopened position ${positionId}`);
    let positionPricePnl = 0;
    const beforeFees = accounting.fees;
    const beforeSlippage = accounting.slippage;
    for (const leg of accounting.position.legs) {
      const reference = this.marks.get(leg.instrument);
      if (reference === undefined) throw new Error(`Missing exit mark for ${leg.instrument}`);
      const executionCost = executionCostForLeg(leg, reference, this.costs);
      const pricePnl = leg.signedUnits * (reference - leg.entryReferencePrice);
      if (leg.market === 'spot') this.cashState += leg.signedUnits * reference;
      else this.cashState += pricePnl;
      this.cashState -= executionCost.total;
      this.pricePnlState += pricePnl;
      this.feesState += executionCost.fee;
      this.slippageState += executionCost.slippage;
      this.turnoverState += executionCost.notional;
      positionPricePnl += pricePnl;
      accounting.fees += executionCost.fee;
      accounting.slippage += executionCost.slippage;
      const sleeve = this.pnlByAssetState[leg.asset];
      sleeve.pricePnl += pricePnl;
      sleeve.fees += executionCost.fee;
      sleeve.slippage += executionCost.slippage;
      this.recordEvent(time, 'exit', 'exit', {
        positionId,
        asset: leg.asset,
        instrument: leg.instrument,
        amount: pricePnl - executionCost.total,
      });
    }
    this.open.delete(positionId);
    const adjustedPnl = positionPricePnl + accounting.funding - accounting.fees - accounting.slippage;
    this.completedState.push({
      id: positionId,
      asset: accounting.position.asset,
      entryTime: accounting.position.entryTime,
      exitTime: time,
      forced,
      pricePnl: positionPricePnl,
      funding: accounting.funding,
      fees: accounting.fees,
      slippage: accounting.slippage,
      adjustedPnl,
    });
    finite(beforeFees + beforeSlippage + adjustedPnl, 'Completed position accounting');
  }

  enterPosition(position: Readonly<ScheduledPosition>, time: number): void {
    if (this.terminated) return;
    this.validatePosition(position);
    if (position.entryTime !== time) throw new Error(`Position ${position.id} entered at wrong time`);
    if (this.open.has(position.id)) throw new Error(`Duplicate open position ${position.id}`);
    if (this.hasOpenAsset(position.asset)) throw new Error(`Overlapping ${position.asset} position`);
    const accounting: PositionAccounting = {
      position: { ...position, legs: position.legs.map((leg) => ({ ...leg })) },
      funding: 0,
      fees: 0,
      slippage: 0,
    };
    for (const leg of position.legs) {
      const candle = findCandle(this.data, leg.instrument, time);
      if (candle.open !== leg.entryReferencePrice) {
        throw new Error(`Position ${position.id} reference price does not match immutable candle`);
      }
      this.marks.set(leg.instrument, candle.open);
      const executionCost = executionCostForLeg(leg, candle.open, this.costs);
      if (leg.market === 'spot') this.cashState -= leg.signedUnits * candle.open;
      this.cashState -= executionCost.total;
      this.feesState += executionCost.fee;
      this.slippageState += executionCost.slippage;
      this.turnoverState += executionCost.notional;
      accounting.fees += executionCost.fee;
      accounting.slippage += executionCost.slippage;
      const sleeve = this.pnlByAssetState[leg.asset];
      sleeve.fees += executionCost.fee;
      sleeve.slippage += executionCost.slippage;
      this.recordEvent(time, 'entry', 'entry', {
        positionId: position.id,
        asset: leg.asset,
        instrument: leg.instrument,
        amount: -executionCost.total,
      });
    }
    this.open.set(position.id, accounting);
  }

  /**
   * Exit costs are part of the execution batch. If those costs exhaust NAV, settle
   * the batch and terminate before any candidate admission or entry can run.
   */
  terminateExecutionBatchIfNonPositive(time: number): boolean {
    if (this.terminated) return true;
    if (!this.batch || this.batch.time !== time) throw new Error('No matching execution batch');
    if (this.nav > 0) return false;
    this.finishExecutionBatch(time);
    return true;
  }

  finishExecutionBatch(time: number): void {
    if (this.terminated) {
      this.batch = null;
      return;
    }
    if (!this.batch || this.batch.time !== time) throw new Error('No matching execution batch');
    this.refreshExposureExtrema();
    this.recordNav(time, 'post_execution');
    this.recordEvent(time, 'post_execution', 'mark');
    const grossAfter = this.markedGross();
    if (this.batch.grossBefore === 0 && grossAfter > 0) {
      this.episodeStart = { time, nav: this.batch.navBefore };
    } else if (this.batch.grossBefore > 0 && grossAfter === 0) {
      this.closeEpisode(time, this.nav);
    }
    this.batch = null;
    if (this.nav <= 0) this.forceTerminate(time, 'execution_batch', 'open', 'non_positive_nav');
  }

  forceSharedStop(stop: Readonly<ReplayStop>): void {
    if (this.terminated) return;
    this.forceTerminate(stop.time, 'shared_stop', stop.reference, 'shared_cost_case');
  }

  finalize(truncatedPositionIds: readonly string[] = []): LedgerResult {
    if (this.open.size > 0 && !this.terminated) throw new Error('Replay ended with open positions');
    for (const asset of Object.keys(this.pnlByAssetState) as PerpAsset[]) {
      const sleeve = this.pnlByAssetState[asset];
      sleeve.adjustedPnl = sleeve.pricePnl + sleeve.funding - sleeve.fees - sleeve.slippage;
      Object.values(sleeve).forEach((value) => finite(value, `${asset} PnL`));
    }
    const endingNav = this.nav;
    const result: LedgerResult = {
      trialId: this.trialId,
      costCase: this.costCase,
      boundaryFunding: this.boundaryFunding,
      initialNav: this.initialNav,
      endingNav,
      adjustedPnl: endingNav - this.initialNav,
      cash: this.cashState,
      pricePnl: this.pricePnlState,
      funding: this.fundingState,
      fees: this.feesState,
      slippage: this.slippageState,
      turnover: this.turnoverState,
      navPoints: this.navPointState.map((point) => ({ ...point })),
      dailyNav: this.dailyNavState.map((point) => ({ ...point })),
      episodes: this.episodeState.map((episode) => ({ ...episode })),
      completedPositions: this.completedState.map((position) => ({ ...position })),
      truncatedPositionIds: [...truncatedPositionIds],
      pnlByAsset: {
        BTC: { ...this.pnlByAssetState.BTC },
        ETH: { ...this.pnlByAssetState.ETH },
        HYPE: { ...this.pnlByAssetState.HYPE },
      },
      maximumMarkedGross: this.maxGrossState,
      maximumGrossToNav: this.maxGrossToNavState,
      maximumLongGross: this.maxLongState,
      maximumShortGross: this.maxShortState,
      events: this.eventState.map((event) => ({ ...event })),
      termination: this.terminationState ? { ...this.terminationState } : null,
    };
    Object.values({
      endingNav: result.endingNav,
      adjustedPnl: result.adjustedPnl,
      cash: result.cash,
      pricePnl: result.pricePnl,
      funding: result.funding,
      fees: result.fees,
      slippage: result.slippage,
      turnover: result.turnover,
    }).forEach((value) => finite(value, 'Ledger result'));
    return result;
  }

  private assertBoundary(boundary: number): void {
    assertAlignedTime(boundary, 'Ledger boundary');
    if (boundary < this.window.startTime || boundary > this.window.endTime) {
      throw new Error('Ledger boundary is outside the replay window');
    }
    if (boundary < this.lastBoundary) throw new Error('Ledger boundaries are not chronological');
    this.lastBoundary = boundary;
  }

  private validatePosition(position: Readonly<ScheduledPosition>): void {
    validatePositionAgainstTrial(position, this.trial, this.data, this.window);
  }

  private fundingRecordsForBar(asset: PerpAsset, barOpen: number): readonly HourlyFunding[] {
    const index = this.fundingIndex.get(asset);
    if (!index) throw new Error(`Missing funding series for ${asset}`);
    const result: HourlyFunding[] = [];
    for (let offset = 0; offset < 4; offset += 1) {
      const expectedTime = barOpen + offset * HOUR_MS;
      const record = index.get(expectedTime);
      if (!record) throw new Error(`Incomplete ${asset} funding interval at ${barOpen}`);
      result.push(record);
    }
    return result;
  }

  private refreshExposureExtrema(): void {
    let gross = 0;
    let long = 0;
    let short = 0;
    for (const accounting of this.open.values()) {
      for (const leg of accounting.position.legs) {
        const mark = this.marks.get(leg.instrument);
        if (mark === undefined) throw new Error(`Missing mark for ${leg.instrument}`);
        const signedNotional = leg.signedUnits * mark;
        gross += Math.abs(signedNotional);
        if (signedNotional > 0) long += signedNotional;
        else short += Math.abs(signedNotional);
      }
    }
    const nav = this.nav;
    this.maxGrossState = Math.max(this.maxGrossState, gross);
    this.maxLongState = Math.max(this.maxLongState, long);
    this.maxShortState = Math.max(this.maxShortState, short);
    if (nav > 0) this.maxGrossToNavState = Math.max(this.maxGrossToNavState, gross / nav);
  }

  private forceTerminate(
    time: number,
    phase: LedgerTermination['phase'],
    reference: LedgerTermination['reference'],
    reason: LedgerTermination['reason'],
  ): void {
    if (this.terminationState) return;
    const navBeforeClose = this.nav;
    if (this.batch === null) {
      this.batch = { time, grossBefore: this.markedGross(), navBefore: navBeforeClose };
    }
    const openIds = [...this.open.keys()];
    for (const id of openIds) this.exitPosition(id, time, true);
    if (this.episodeStart) this.closeEpisode(time, this.nav);
    this.terminationState = { time, phase, reason, reference, navBeforeClose };
    this.recordNav(time, 'termination');
    this.recordEvent(time, 'termination', 'termination', { amount: this.nav });
    this.batch = null;
  }

  private closeEpisode(time: number, nav: number): void {
    if (!this.episodeStart) throw new Error('Cannot close an episode that did not start');
    this.episodeState.push({
      startTime: this.episodeStart.time,
      endTime: time,
      pnl: finite(nav - this.episodeStart.nav, 'Episode PnL'),
    });
    this.episodeStart = null;
  }

  private recordNav(time: number, phase: LedgerPhase): void {
    const nav = this.nav;
    this.navPointState.push({ time, nav });
    // Phase is intentionally carried by the event stream; NAV points remain metric-compatible.
    void phase;
  }

  private recordEvent(
    time: number,
    phase: LedgerPhase,
    kind: LedgerEventKind,
    detail: Omit<LedgerEvent, 'sequence' | 'time' | 'phase' | 'kind' | 'nav'> = {},
  ): void {
    this.eventState.push({
      sequence: this.eventSequence,
      time,
      phase,
      kind,
      nav: this.nav,
      ...detail,
    });
    this.eventSequence += 1;
  }
}

function validateSchedule(input: Readonly<ReplayScheduleInput>): void {
  const { schedule } = input;
  const trial = frozenTrialForId(schedule.trialId);
  if (input.sharedStop) validateReplayStop(input.sharedStop, input.window);
  const ids = new Set<string>();
  const lastExitByAsset = new Map<PerpAsset, number>();
  let previous: ScheduledPosition | undefined;
  for (const position of schedule.positions) {
    if (ids.has(position.id)) throw new Error(`Duplicate scheduled position ${position.id}`);
    validatePositionAgainstTrial(position, trial, input.data, input.window);
    if (previous && compareScheduledPositions(previous, position) > 0) {
      throw new Error('Schedule is not in canonical chronological order');
    }
    const lastExit = lastExitByAsset.get(position.asset);
    if (lastExit !== undefined && position.entryTime <= lastExit) {
      throw new Error(`Schedule contains overlapping or same-boundary ${position.asset} positions`);
    }
    ids.add(position.id);
    lastExitByAsset.set(position.asset, position.exitTime);
    previous = position;
  }
}

function shouldStopAt(
  stop: Readonly<ReplayStop> | undefined,
  time: number,
  phase: LedgerTermination['phase'],
): boolean {
  return Boolean(stop && stop.time === time && stop.phase === phase);
}

export function replayAcceptedSchedule(input: ReplayScheduleInput): LedgerResult {
  validateSchedule(input);
  const machine = new FourHourLedgerMachine(input);
  const entries = new Map<number, ScheduledPosition[]>();
  const exits = new Map<number, ScheduledPosition[]>();
  for (const position of input.schedule.positions) {
    const atEntry = entries.get(position.entryTime) ?? [];
    atEntry.push(position);
    entries.set(position.entryTime, atEntry);
    const atExit = exits.get(position.exitTime) ?? [];
    atExit.push(position);
    exits.set(position.exitTime, atExit);
  }
  for (const positions of entries.values()) positions.sort((a, b) => ASSET_ORDER[a.asset] - ASSET_ORDER[b.asset]);
  for (const positions of exits.values()) positions.sort((a, b) => ASSET_ORDER[a.asset] - ASSET_ORDER[b.asset]);

  const entered = new Set<string>();
  for (let boundary = input.window.startTime; boundary <= input.window.endTime; boundary += FOUR_HOUR_MS) {
    if (machine.terminated) break;
    if (boundary > input.window.startTime) {
      machine.completeBar(boundary);
      if (machine.terminated) break;
      if (shouldStopAt(input.sharedStop, boundary, 'completed_close')) {
        machine.forceSharedStop(input.sharedStop!);
        break;
      }
      machine.recordDailySample(boundary);
    }
    if (boundary === input.window.endTime) break;
    machine.revalueToOpen(boundary);
    if (machine.terminated) break;
    if (shouldStopAt(input.sharedStop, boundary, 'current_open')) {
      machine.forceSharedStop(input.sharedStop!);
      break;
    }
    machine.beginExecutionBatch(boundary);
    for (const position of exits.get(boundary) ?? []) {
      if (machine.openPositionIds.includes(position.id)) machine.exitPosition(position.id, boundary);
    }
    if (machine.terminateExecutionBatchIfNonPositive(boundary)) break;
    if (shouldStopAt(input.sharedStop, boundary, 'execution_batch')
      && input.sharedStop?.truncateSameBoundaryEntries === true) {
      machine.forceSharedStop(input.sharedStop);
      break;
    }
    for (const position of entries.get(boundary) ?? []) {
      machine.enterPosition(position, boundary);
      entered.add(position.id);
    }
    machine.finishExecutionBatch(boundary);
    if (machine.terminated) break;
    if (shouldStopAt(input.sharedStop, boundary, 'execution_batch')) {
      machine.forceSharedStop(input.sharedStop!);
      break;
    }
  }

  const truncated = machine.terminated
    ? input.schedule.positions
      .filter((position) => !entered.has(position.id))
      .map((position) => position.id)
    : [];
  return machine.finalize(truncated);
}

export function replayAcceptedCostCases(
  input: Omit<ReplayScheduleInput, 'costs' | 'boundaryFunding' | 'sharedStop'>,
): CostCaseReplay {
  const stress = replayAcceptedSchedule({ ...input, costs: STRESS_COSTS, boundaryFunding: 'exclude' });
  const sharedStop: ReplayStop | undefined = stress.termination
    ? {
      time: stress.termination.time,
      phase: stress.termination.phase === 'shared_stop' ? 'execution_batch' : stress.termination.phase,
      reference: stress.termination.reference,
      truncateSameBoundaryEntries: stress.termination.phase !== 'execution_batch'
        || !stress.events.some((event) => (
          event.time === stress.termination!.time && event.kind === 'entry'
        )),
    }
    : undefined;
  const base = replayAcceptedSchedule({
    ...input,
    costs: BASE_COSTS,
    boundaryFunding: 'exclude',
    sharedStop,
  });
  return { base, stress };
}

export function replayAdverseBoundarySchedule(
  input: Omit<ReplayScheduleInput, 'costs' | 'boundaryFunding' | 'sharedStop'>,
): LedgerResult {
  return replayAcceptedSchedule({
    ...input,
    costs: STRESS_COSTS,
    boundaryFunding: 'adverse_debits',
  });
}
