import {
  FOUR_HOUR_MS,
  type AcceptedSchedule,
  type CarrySignal,
  type PerpAsset,
  type ScheduledLeg,
  type ScheduledPosition,
  type SkippedSignal,
  type StrategySignal,
  type TrialWindow,
  type ValidatedFamilyData,
} from './contracts.js';
import {
  STRESS_COSTS,
  TRIAL_BY_ID,
  type FrozenTrialConfig,
} from './frozenTrials.js';
import {
  FourHourLedgerMachine,
  entryCostsForPosition,
  instrumentSymbol,
  type LedgerResult,
} from './ledger.js';

export type PortfolioKind = 'primary' | 'exploratory';

export interface BuildAcceptedScheduleInput {
  trial: Readonly<FrozenTrialConfig>;
  portfolio: PortfolioKind;
  signals: readonly StrategySignal[];
  data: Readonly<ValidatedFamilyData>;
  window: Readonly<TrialWindow>;
}

export interface BuildAcceptedScheduleResult {
  schedule: AcceptedSchedule;
  stressController: LedgerResult;
}

export interface StressAdmissionSnapshot {
  stressNavBeforeBatch: number;
  retainedMarkedGross: number;
  entryGrossCap: number;
}

export interface StressAdmissionDecision {
  admitted: ScheduledPosition[];
  rejected: Array<{
    position: ScheduledPosition;
    reason: 'capacity' | 'non_positive_nav';
  }>;
  projectedStressNav: number;
  admittedEntryGross: number;
  admittedEntryCosts: number;
}

const ASSET_ORDER: Readonly<Record<PerpAsset, number>> = Object.freeze({ BTC: 0, ETH: 1, HYPE: 2 });

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function finitePositive(value: number, label: string): number {
  if (!Number.isFinite(value) || !(value > 0)) throw new Error(`${label} must be finite and positive`);
  return value;
}

function finiteDerived(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}

function candleOpen(
  data: Readonly<ValidatedFamilyData>,
  symbol: 'BTC' | 'ETH' | 'HYPE' | '@142' | '@151',
  time: number,
): number {
  const candles = data.candles[symbol];
  if (!candles) throw new Error(`Missing ${symbol} candle series`);
  let low = 0;
  let high = candles.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const candle = candles[middle];
    if (candle.openTime === time) {
      if (candle.symbol !== symbol
        || candle.closeTime !== time + FOUR_HOUR_MS - 1
        || !Number.isFinite(candle.open)
        || !(candle.open > 0)) {
        throw new Error(`Invalid ${symbol} entry candle at ${time}`);
      }
      return candle.open;
    }
    if (candle.openTime < time) low = middle + 1;
    else high = middle - 1;
  }
  throw new Error(`Missing ${symbol} entry candle at ${time}`);
}

function perpInstrument(asset: PerpAsset): 'BTC-PERP' | 'ETH-PERP' | 'HYPE-PERP' {
  if (asset === 'BTC') return 'BTC-PERP';
  if (asset === 'ETH') return 'ETH-PERP';
  return 'HYPE-PERP';
}

function h2SpotLeg(
  signal: Readonly<CarrySignal>,
  signedUnits: number,
  referencePrice: number,
): ScheduledLeg {
  return {
    instrument: signal.asset === 'BTC' ? 'UBTC-SPOT' : 'UETH-SPOT',
    market: 'spot',
    asset: signal.asset,
    signedUnits,
    entryReferencePrice: referencePrice,
  };
}

function validateSignalTiming(
  signal: Readonly<StrategySignal>,
  trial: Readonly<FrozenTrialConfig>,
): { entryTime: number; exitTime: number } {
  if (signal.strategy !== trial.id) throw new Error('Signal does not belong to the frozen trial');
  if (!Number.isInteger(signal.signalIndex)
    || !Number.isInteger(signal.entryIndex)
    || !Number.isInteger(signal.exitIndex)
    || signal.entryIndex - signal.signalIndex !== trial.executionDelayBars
    || signal.exitIndex - signal.entryIndex !== trial.holdBars
    || !Number.isInteger(signal.decisionTime)
    || signal.decisionTime % FOUR_HOUR_MS !== 0) {
    throw new Error(`Invalid ${trial.id} signal chronology`);
  }
  // A completed-bar decision is stamped at its close. t+2 therefore opens one bar later.
  const entryTime = signal.decisionTime + (trial.executionDelayBars - 1) * FOUR_HOUR_MS;
  const exitTime = entryTime + trial.holdBars * FOUR_HOUR_MS;
  return { entryTime, exitTime };
}

export function scheduledPositionFromSignal(
  signal: Readonly<StrategySignal>,
  trial: Readonly<FrozenTrialConfig>,
  data: Readonly<ValidatedFamilyData>,
): ScheduledPosition {
  const { entryTime, exitTime } = validateSignalTiming(signal, trial);
  const perpId = perpInstrument(signal.asset);
  const perpPrice = candleOpen(data, instrumentSymbol(perpId), entryTime);
  let legs: ScheduledLeg[];
  if (signal.strategy === 'H2') {
    if (trial.id !== 'H2' || (signal.asset !== 'BTC' && signal.asset !== 'ETH')) {
      throw new Error('H2 supports only BTC and ETH carry pairs');
    }
    const spotSymbol = trial.spotSymbols[signal.asset];
    const spotPrice = candleOpen(data, spotSymbol, entryTime);
    const units = Math.min(
      trial.perLegNotionalCap / spotPrice,
      trial.perLegNotionalCap / perpPrice,
    );
    finitePositive(units, 'H2 common units');
    legs = [
      h2SpotLeg(signal, units, spotPrice),
      {
        instrument: perpId,
        market: 'perp',
        asset: signal.asset,
        signedUnits: -units,
        entryReferencePrice: perpPrice,
      },
    ];
  } else {
    if (trial.id === 'H2') throw new Error('Directional signal cannot use H2 economics');
    const notional = signal.asset === 'HYPE'
      ? trial.exploratoryNotional
      : trial.primaryNotional;
    const units = signal.direction * notional / perpPrice;
    finitePositive(Math.abs(units), 'Directional units');
    legs = [{
      instrument: perpId,
      market: 'perp',
      asset: signal.asset,
      signedUnits: units,
      entryReferencePrice: perpPrice,
    }];
  }
  const entryGross = legs.reduce(
    (sum, leg) => sum + Math.abs(leg.signedUnits) * leg.entryReferencePrice,
    0,
  );
  finitePositive(entryGross, 'Scheduled entry gross');
  return {
    id: `${trial.trialId}:${signal.asset}:${signal.decisionTime}`,
    trialId: trial.trialId,
    strategy: trial.id,
    asset: signal.asset,
    signalIndex: signal.signalIndex,
    decisionTime: signal.decisionTime,
    entryTime,
    exitTime,
    entryGross,
    legs,
  };
}

/**
 * Frozen doubled-cost batch controller. Candidate prices and units are already fixed;
 * rejection never resizes or queues a position.
 */
export function decideStressAdmissions(
  candidates: readonly ScheduledPosition[],
  snapshot: Readonly<StressAdmissionSnapshot>,
): StressAdmissionDecision {
  const navBefore = finitePositive(snapshot.stressNavBeforeBatch, 'Stress NAV before batch');
  if (!Number.isFinite(snapshot.retainedMarkedGross) || snapshot.retainedMarkedGross < 0) {
    throw new Error('Retained marked gross must be finite and non-negative');
  }
  const cap = finitePositive(snapshot.entryGrossCap, 'Entry gross cap');
  const ordered = [...candidates].sort((left, right) => (
    ASSET_ORDER[left.asset] - ASSET_ORDER[right.asset]
    || compareOrdinal(left.id, right.id)
  ));
  const admitted: ScheduledPosition[] = [];
  const rejected: StressAdmissionDecision['rejected'] = [];
  let admittedEntryCosts = 0;
  let admittedEntryGross = 0;
  for (const candidate of ordered) {
    const candidateGross = finitePositive(candidate.entryGross, `${candidate.id} entry gross`);
    const entryCosts = entryCostsForPosition(candidate, STRESS_COSTS);
    const candidateCost = finiteDerived(entryCosts.total, `${candidate.id} entry cost`);
    const computedGross = finiteDerived(entryCosts.notional, `${candidate.id} computed gross`);
    if (Math.abs(computedGross - candidateGross) > Math.max(1, computedGross) * 1e-12) {
      throw new Error(`${candidate.id} entry gross is inconsistent`);
    }
    const projectedStressNav = finiteDerived(
      navBefore - admittedEntryCosts - candidateCost,
      `${candidate.id} projected stress NAV`,
    );
    const nextGross = finiteDerived(
      admittedEntryGross + candidateGross,
      `${candidate.id} next admitted gross`,
    );
    const grossAfterCandidate = finiteDerived(
      snapshot.retainedMarkedGross + nextGross,
      `${candidate.id} retained plus admitted gross`,
    );
    if (!(projectedStressNav > 0)) {
      rejected.push({ position: candidate, reason: 'non_positive_nav' });
      continue;
    }
    if (grossAfterCandidate > Math.min(cap, projectedStressNav)) {
      rejected.push({ position: candidate, reason: 'capacity' });
      continue;
    }
    admitted.push(candidate);
    admittedEntryCosts = finiteDerived(
      admittedEntryCosts + candidateCost,
      'Admitted entry costs',
    );
    admittedEntryGross = nextGross;
  }
  const projectedStressNav = finiteDerived(
    navBefore - admittedEntryCosts,
    'Projected stress NAV after admissions',
  );
  return {
    admitted,
    rejected,
    projectedStressNav,
    admittedEntryGross,
    admittedEntryCosts,
  };
}

function allowedAssets(
  trial: Readonly<FrozenTrialConfig>,
  portfolio: PortfolioKind,
): readonly PerpAsset[] {
  if (portfolio === 'primary') return trial.primaryAssets;
  if (trial.id === 'H2') throw new Error('H2 has no exploratory portfolio');
  return trial.exploratoryAssets;
}

function skipped(signal: StrategySignal, reason: SkippedSignal['reason']): SkippedSignal {
  return {
    strategy: signal.strategy,
    asset: signal.asset,
    decisionTime: signal.decisionTime,
    reason,
  };
}

function indexSignals(
  input: Readonly<BuildAcceptedScheduleInput>,
  assets: readonly PerpAsset[],
): Map<number, StrategySignal[]> {
  const allowed = new Set<PerpAsset>(assets);
  const byDecision = new Map<number, StrategySignal[]>();
  const seen = new Set<string>();
  for (const signal of input.signals) {
    if (signal.strategy !== input.trial.id) throw new Error('Mixed strategy signals are prohibited');
    if (!allowed.has(signal.asset)) throw new Error(`${signal.asset} is outside the selected portfolio`);
    validateSignalTiming(signal, input.trial);
    const signalCandle = input.data.candles[signal.asset]?.[signal.signalIndex];
    if (!signalCandle
      || signalCandle.symbol !== signal.asset
      || signalCandle.interval !== '4h'
      || signalCandle.openTime !== signal.decisionTime - FOUR_HOUR_MS
      || signalCandle.closeTime !== signal.decisionTime - 1) {
      throw new Error(`${input.trial.id} ${signal.asset} signal index/time binding is invalid`);
    }
    const key = `${signal.asset}:${signal.decisionTime}`;
    if (seen.has(key)) throw new Error(`Duplicate signal ${key}`);
    seen.add(key);
    if (signal.decisionTime < input.window.startTime || signal.decisionTime >= input.window.endTime) continue;
    const values = byDecision.get(signal.decisionTime) ?? [];
    values.push(signal);
    byDecision.set(signal.decisionTime, values);
  }
  for (const values of byDecision.values()) {
    values.sort((left, right) => (
      ASSET_ORDER[left.asset] - ASSET_ORDER[right.asset]
      || left.signalIndex - right.signalIndex
    ));
  }
  return byDecision;
}

/**
 * Produces the one canonical schedule using the stress ledger as controller. Base and
 * adverse-boundary ledgers must replay this returned schedule without regenerating units.
 */
export function buildAcceptedSchedule(
  input: Readonly<BuildAcceptedScheduleInput>,
): BuildAcceptedScheduleResult {
  if (input.trial === undefined || input.trial !== TRIAL_BY_ID[input.trial.id]) {
    throw new Error('The canonical frozen trial object is required');
  }
  const assets = allowedAssets(input.trial, input.portfolio);
  if (assets.length === 0) throw new Error('Selected portfolio has no assets');
  const signalIndex = indexSignals(input, assets);
  const schedule: AcceptedSchedule = { trialId: input.trial.trialId, positions: [], skipped: [] };
  const controllerInput = {
    schedule,
    data: input.data,
    window: input.window,
    costs: STRESS_COSTS,
    boundaryFunding: 'exclude' as const,
  };
  const machine = new FourHourLedgerMachine(controllerInput);
  const pending = new Map<PerpAsset, { signal: StrategySignal; position: ScheduledPosition }>();

  for (let boundary = input.window.startTime; boundary <= input.window.endTime; boundary += FOUR_HOUR_MS) {
    if (boundary > input.window.startTime && !machine.terminated) {
      machine.completeBar(boundary);
      if (!machine.terminated) machine.recordDailySample(boundary);
    }

    const decisions = signalIndex.get(boundary) ?? [];
    for (const signal of decisions) {
      if (machine.terminated) {
        schedule.skipped.push(skipped(signal, 'non_positive_nav'));
        continue;
      }
      if (pending.has(signal.asset) || machine.hasOpenAsset(signal.asset)) {
        schedule.skipped.push(skipped(signal, 'pending_or_open'));
        continue;
      }
      const timing = validateSignalTiming(signal, input.trial);
      if (timing.exitTime >= input.window.endTime) {
        schedule.skipped.push(skipped(signal, 'window_end'));
        continue;
      }
      const position = scheduledPositionFromSignal(signal, input.trial, input.data);
      pending.set(signal.asset, { signal, position });
    }

    if (boundary === input.window.endTime || machine.terminated) continue;
    machine.revalueToOpen(boundary);
    if (machine.terminated) continue;
    machine.beginExecutionBatch(boundary);
    for (const id of machine.openPositionIds) {
      const position = schedule.positions.find((candidate) => candidate.id === id);
      if (!position) throw new Error(`Controller lost scheduled position ${id}`);
      if (position.exitTime === boundary) machine.exitPosition(id, boundary);
    }
    if (machine.terminateExecutionBatchIfNonPositive(boundary)) continue;
    const candidates = [...pending.values()]
      .filter(({ position }) => position.entryTime === boundary)
      .map(({ position }) => position);
    const admission = decideStressAdmissions(candidates, {
      stressNavBeforeBatch: machine.nav,
      retainedMarkedGross: machine.markedGross(),
      entryGrossCap: input.trial.entryGrossCap,
    });
    for (const rejection of admission.rejected) {
      const item = pending.get(rejection.position.asset);
      if (!item || item.position.id !== rejection.position.id) {
        throw new Error('Admission rejected an unknown pending position');
      }
      schedule.skipped.push(skipped(item.signal, rejection.reason));
      pending.delete(rejection.position.asset);
    }
    for (const position of admission.admitted) {
      machine.enterPosition(position, boundary);
      schedule.positions.push(position);
      pending.delete(position.asset);
    }
    machine.finishExecutionBatch(boundary);
  }

  if (machine.terminated) {
    for (const item of pending.values()) schedule.skipped.push(skipped(item.signal, 'non_positive_nav'));
  } else if (pending.size > 0) {
    throw new Error('Schedule ended with unresolved pending entries');
  }
  schedule.positions.sort((left, right) => (
    left.entryTime - right.entryTime
    || ASSET_ORDER[left.asset] - ASSET_ORDER[right.asset]
    || compareOrdinal(left.id, right.id)
  ));
  schedule.skipped.sort((left, right) => (
    left.decisionTime - right.decisionTime
    || ASSET_ORDER[left.asset] - ASSET_ORDER[right.asset]
    || compareOrdinal(left.reason, right.reason)
  ));
  return { schedule, stressController: machine.finalize() };
}
