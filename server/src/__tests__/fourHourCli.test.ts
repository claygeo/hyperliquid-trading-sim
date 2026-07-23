import {
  adjudicateFourHourResearch,
  evaluateFourHourResearch,
  executeFourHourCommand,
  FOUR_HOUR_AUTHORIZATION_BOUNDARY,
  FOUR_HOUR_FAMILY_LIMITATIONS,
  FOUR_HOUR_SNAPSHOT_FETCH_ORDER,
  preflightFourHourResearch,
  replayFourHourResearch,
  runFourHourCli,
  snapshotFourHourResearch,
  type FourHourCliDependencies,
  type FourHourCliPaths,
} from '../research/fourHour/cli.js';
import type {
  FamilyReportPayload,
  RetainedInitialTrialBatch,
  StoredFamilyReport,
  StoredFamilySnapshot,
  StoredTrialReport,
  TrialReportPayload,
} from '../research/fourHour/artifacts.js';
import type {
  CandleSeriesSnapshot,
  FundingSeriesSnapshot,
  MarketSymbol,
  PerpAsset,
} from '../research/fourHour/contracts.js';
import {
  FAMILY_ID,
  SPECIFICATION_COMMIT,
} from '../research/fourHour/frozenTrials.js';
import type { SpotMetadataResult } from '../research/fourHour/hyperliquid.js';
import {
  FROZEN_H1_FAMILY_INPUT,
  type H1FamilyInput,
} from '../research/fourHour/runner.js';

const HEAD = 'b'.repeat(40);
const SOURCE_HASH = 'c'.repeat(64);
const ARTIFACT_HASH = 'd'.repeat(64);
const DATA_HASH = 'e'.repeat(64);

interface Harness {
  dependencies: FourHourCliDependencies;
  paths: FourHourCliPaths;
  events: string[];
  state: {
    status: string;
    head: string;
    specificationCommit: string;
    sourceHash: string;
    reportJson: string;
    snapshotJson: string;
    ancestor: boolean;
    evaluationNonce: number;
    nondeterministicTrial: boolean;
    nondeterministicFamily: boolean;
    retainedBatch: RetainedInitialTrialBatch | null;
    retainedFamily: StoredFamilyReport | null;
  };
}

function h1Input(): H1FamilyInput {
  return {
    id: 'H1',
    trialId: FROZEN_H1_FAMILY_INPUT.trialId,
    reportSha256: FROZEN_H1_FAMILY_INPUT.reportSha256,
    snapshotArtifactSha256: FROZEN_H1_FAMILY_INPUT.snapshotArtifactSha256,
    snapshotDataSha256: FROZEN_H1_FAMILY_INPUT.snapshotDataSha256,
    codeCommit: FROZEN_H1_FAMILY_INPUT.codeCommit,
    specificationCommit: FROZEN_H1_FAMILY_INPUT.specificationCommit,
    dailyNavCount: FROZEN_H1_FAMILY_INPUT.dailyNavPoints,
    dailyReturnCount: FROZEN_H1_FAMILY_INPUT.adjacentReturns,
    dailyReturnsSha256: FROZEN_H1_FAMILY_INPUT.dailyReturnsSha256,
    familyDsrInputAvailable: true,
    unavailabilityReason: null,
    returns: Object.freeze(Array.from({ length: 359 }, () => 0)),
  };
}

function candleSnapshot(symbol: MarketSymbol): CandleSeriesSnapshot {
  return {
    symbol,
    startTime: 0,
    endTime: 1,
    expectedBars: 0,
    pages: [],
    candles: [],
  };
}

function fundingSnapshot(coin: PerpAsset): FundingSeriesSnapshot {
  return {
    coin,
    startTime: 0,
    endTime: 0,
    expectedHours: 0,
    pages: [],
    funding: [],
  };
}

function spotMetadata(): SpotMetadataResult {
  const token = {
    index: 1,
    name: 'USDC',
    szDecimals: 6,
    weiDecimals: 6,
    tokenId: 'token',
    isCanonical: true,
    evmContract: null,
    fullName: null,
  };
  const pair = (symbol: '@142' | '@151', index: number, baseName: 'UBTC' | 'UETH') => ({
    symbol,
    index,
    displayName: symbol === '@142' ? 'UBTC/USDC' as const : 'UETH/USDC' as const,
    baseTokenIndex: 2,
    quoteTokenIndex: 1,
    wrapperMultiplier: 1 as const,
    isCanonical: false as const,
    tokens: [{ ...token, index: 2, name: baseName, isCanonical: false }, { ...token }] as [
      typeof token,
      typeof token,
    ],
  });
  return {
    requestType: 'spotMeta',
    fetchedAt: '2026-07-23T00:00:00.000Z',
    rawResponseSha256: 'f'.repeat(64),
    pairs: {
      '@142': pair('@142', 142, 'UBTC'),
      '@151': pair('@151', 151, 'UETH'),
    },
  } as SpotMetadataResult;
}

function retainedSnapshot(): StoredFamilySnapshot {
  return {
    artifactSha256: '1'.repeat(64),
    dataSha256: DATA_HASH,
    canonical: {
      familyId: FAMILY_ID,
      specificationCommit: SPECIFICATION_COMMIT,
      evaluator: {
        codeCommit: HEAD,
        cleanWorktree: true,
        sourceBundleSha256: SOURCE_HASH,
      },
    },
  } as unknown as StoredFamilySnapshot;
}

function trialPayload(id: 'H2' | 'H3' | 'H4', nonce = 0): TrialReportPayload {
  return {
    schemaVersion: 1,
    kind: 'trial_metrics',
    familyId: FAMILY_ID,
    strategyId: id,
    trialId: `${id}-FOUR-HOUR-20260722-001`,
    status: 'COMPLETE',
    familyDecision: 'PENDING',
    historicalPromotionEligible: false,
    primary: null,
    exploratory: {
      asset: 'HYPE',
      classification: 'EXPLORATORY_ONLY',
      selectionEligible: false,
      historicalPromotionEligible: false,
      status: 'ERROR',
      fullHistory: null,
      holdout: null,
      error: { code: 'INVALID_INPUT', stage: 'signals', message: `fixture-${nonce}` },
    },
    gateMetrics: null,
    error: null,
    limitations: nonce === 0 ? ['fixture'] : [`fixture-${nonce}`],
  } as unknown as TrialReportPayload;
}

function familyPayload(limitations: readonly string[], nonce = 0): FamilyReportPayload {
  return {
    familyId: FAMILY_ID,
    familyGate: { verdict: 'REJECT', selectedTrial: null },
    selectedCandidate: null,
    hypeBoundary: {
      asset: 'HYPE',
      classification: 'EXPLORATORY_ONLY',
      selectionEligible: false,
      historicalPromotionEligible: false,
      liveTradingEligible: false,
    },
    forwardPaperBoundary: {
      numericalCandidate: null,
      admissionManifestRequired: true,
      paperJobAuthorized: false,
      walletAuthorized: false,
      liveTradingAuthorized: false,
    },
    limitations: nonce === 0 ? [...limitations] : [...limitations, `nonce-${nonce}`],
  } as unknown as FamilyReportPayload;
}

function storedReport(
  payload: TrialReportPayload,
  evaluator = { codeCommit: HEAD, cleanWorktree: true as const, sourceBundleSha256: SOURCE_HASH },
): StoredTrialReport {
  return {
    artifactSha256: payload.strategyId.toLowerCase().repeat(64).slice(0, 64),
    canonical: {
      trialId: payload.trialId,
      reportRevision: 1,
      supersedesArtifactSha256: null,
      revisionEvidence: null,
      evaluator,
      payload,
    },
  } as unknown as StoredTrialReport;
}

function retainedBatch(reports: readonly StoredTrialReport[]): RetainedInitialTrialBatch {
  return {
    manifest: {
      artifactSha256: '7'.repeat(64),
      canonical: {
        evaluator: {
          codeCommit: HEAD,
          cleanWorktree: true,
          sourceBundleSha256: SOURCE_HASH,
        },
      },
    } as RetainedInitialTrialBatch['manifest'],
    reports: reports as RetainedInitialTrialBatch['reports'],
  };
}

function harness(): Harness {
  const events: string[] = [];
  const state = {
    status: '',
    head: HEAD,
    specificationCommit: SPECIFICATION_COMMIT,
    sourceHash: SOURCE_HASH,
    reportJson: '{"report":true}',
    snapshotJson: '{"snapshot":true}',
    ancestor: true,
    evaluationNonce: 0,
    nondeterministicTrial: false,
    nondeterministicFamily: false,
    retainedBatch: null,
    retainedFamily: null,
  };
  const paths: FourHourCliPaths = {
    repositoryRoot: '/repository',
    h1ReportPath: '/repository/h1-report.json',
    h1SnapshotPath: '/repository/h1-snapshot.json',
    snapshotDirectory: '/repository/server/research-data',
    resultsDirectory: '/repository/server/research-results',
  };
  const dependencies: FourHourCliDependencies = {
    git: async (_root, args) => {
      const command = args.join(' ');
      events.push(`git:${command}`);
      if (args[0] === 'status') return state.status;
      if (args[0] === 'rev-parse') return state.head;
      if (args[0] === 'log') return state.specificationCommit;
      throw new Error(`Unexpected Git command ${command}`);
    },
    readText: async (filename) => {
      events.push(filename === paths.h1ReportPath ? 'read:h1-report' : 'read:h1-snapshot');
      return filename === paths.h1ReportPath ? state.reportJson : state.snapshotJson;
    },
    collectSourceBundle: async () => {
      events.push('source:collect');
      return [{ relativePath: 'server/src/research/fourHour/cli.ts', bytes: 'cli' }];
    },
    calculateSourceBundle: () => {
      events.push('source:hash');
      return state.sourceHash;
    },
    isCommitAncestor: async (_root, ancestor, descendant) => {
      events.push(`ancestor:${ancestor}:${descendant}`);
      return state.ancestor;
    },
    extractH1: () => {
      events.push('extract:h1');
      return h1Input();
    },
    fetchSpotMetadata: async () => {
      events.push('fetch:spotMeta');
      return spotMetadata();
    },
    fetchCandles: async (symbol) => {
      events.push(`fetch:candles:${symbol}`);
      return candleSnapshot(symbol);
    },
    fetchFunding: async (coin) => {
      events.push(`fetch:funding:${coin}`);
      return fundingSnapshot(coin);
    },
    buildSnapshot: (canonical) => {
      events.push('build:snapshot');
      return { artifactSha256: ARTIFACT_HASH, dataSha256: DATA_HASH, canonical };
    },
    writeSnapshot: async () => {
      events.push('write:snapshot');
      return '/repository/server/research-data/family.json';
    },
    readSnapshot: async () => {
      events.push('read:family-snapshot');
      return retainedSnapshot();
    },
    detachSnapshot: () => {
      events.push('detach:snapshot');
      return {} as never;
    },
    evaluateTrial: (_data, id) => {
      state.evaluationNonce += 1;
      events.push(`evaluate:${id}`);
      const nonce = state.nondeterministicTrial && state.evaluationNonce > 3
        ? state.evaluationNonce
        : 0;
      return trialPayload(id, nonce);
    },
    buildTrialReport: (draft) => {
      events.push(`build:trial:${draft.payload.strategyId}`);
      return storedReport(draft.payload, draft.evaluator);
    },
    readInitialBatch: async () => {
      events.push('read:initial-batch');
      return state.retainedBatch;
    },
    writeInitialBatch: async (reports) => {
      events.push('write:initial-batch');
      state.retainedBatch = retainedBatch(reports);
      return state.retainedBatch;
    },
    deriveFamilyPayload: (_evidence, _snapshot, limitations) => {
      events.push('derive:family');
      const count = events.filter((event) => event === 'derive:family').length;
      return familyPayload(limitations, state.nondeterministicFamily && count > 1 ? count : 0);
    },
    buildFamilyReport: (draft) => {
      events.push('build:family');
      return {
        artifactSha256: '8'.repeat(64),
        canonical: {
          trialId: FAMILY_ID,
          reportRevision: draft.reportRevision,
          supersedesArtifactSha256: draft.supersedesArtifactSha256,
          revisionEvidence: draft.revisionEvidence,
          evaluator: draft.evaluator,
          payload: draft.payload,
        },
      } as unknown as StoredFamilyReport;
    },
    readFamilyReport: async () => {
      events.push('read:family-report');
      if (state.retainedFamily === null) throw new Error('No retained family report');
      return state.retainedFamily;
    },
    writeFamilyReport: async (report) => {
      events.push('write:family-report');
      state.retainedFamily = report;
      return '/repository/server/research-results/family.json';
    },
  };
  return { dependencies, paths, events, state };
}

describe('four-hour CLI repository and H1 preflight', () => {
  it('pins the exact clean HEAD, frozen specification commit, source bundle, and H1 input', async () => {
    const test = harness();
    const result = await preflightFourHourResearch(test.dependencies, test.paths);

    expect(result.repository).toEqual({
      codeCommit: HEAD,
      specificationCommit: SPECIFICATION_COMMIT,
      cleanWorktree: true,
      sourceBundleSha256: SOURCE_HASH,
      sourceBundleFiles: 1,
    });
    expect(result.h1.dailyReturnCount).toBe(359);
    expect(test.events).toContain('extract:h1');
    expect(test.events.some((event) => event.startsWith('fetch:'))).toBe(false);
    expect(test.events.filter((event) => event.startsWith('git:status'))).toHaveLength(4);
  });

  it('fails before artifact reads or network when tracked, staged, or untracked status is nonempty', async () => {
    const test = harness();
    test.state.status = '?? untracked.txt';

    await expect(preflightFourHourResearch(test.dependencies, test.paths))
      .rejects.toThrow(/clean worktree/);
    expect(test.events).toEqual(['git:status --porcelain=v1 --untracked-files=all']);
  });

  it('requires the specification path itself to remain pinned to the preregistration commit', async () => {
    const test = harness();
    test.state.specificationCommit = 'a'.repeat(40);

    await expect(preflightFourHourResearch(test.dependencies, test.paths))
      .rejects.toThrow(SPECIFICATION_COMMIT);
    expect(test.events).not.toContain('source:collect');
    expect(test.events.some((event) => event.startsWith('fetch:'))).toBe(false);
  });

  it('fails closed on malformed retained JSON without extracting or fetching', async () => {
    const test = harness();
    test.state.reportJson = '{';

    await expect(preflightFourHourResearch(test.dependencies, test.paths))
      .rejects.toThrow('Retained frozen H1 report is not valid JSON');
    expect(test.events).not.toContain('extract:h1');
    expect(test.events.some((event) => event.startsWith('fetch:'))).toBe(false);
  });

  it('blocks the first request when evaluator bytes drift after H1 verification', async () => {
    const test = harness();
    test.dependencies.extractH1 = () => {
      test.events.push('extract:h1');
      test.state.sourceHash = '9'.repeat(64);
      return h1Input();
    };

    await expect(snapshotFourHourResearch(test.dependencies, test.paths))
      .rejects.toThrow(/source bundle changed/);
    expect(test.events.some((event) => event.startsWith('fetch:'))).toBe(false);
  });
});

describe('four-hour snapshot command', () => {
  it('fetches the exact source sequence serially and rechecks immediately before write', async () => {
    const test = harness();
    const result = await snapshotFourHourResearch(test.dependencies, test.paths);

    const fetches = test.events
      .filter((event) => event.startsWith('fetch:'))
      .map((event) => event.slice('fetch:'.length));
    expect(fetches).toEqual(FOUR_HOUR_SNAPSHOT_FETCH_ORDER);
    expect(test.events.indexOf('extract:h1')).toBeLessThan(test.events.indexOf('fetch:spotMeta'));
    expect(test.events[test.events.indexOf('fetch:spotMeta') - 1])
      .toBe('git:log -1 --format=%H -- docs/specs/2026-07-22-independent-4h-trials.md');
    expect(test.events[test.events.indexOf('write:snapshot') - 1])
      .toBe('git:log -1 --format=%H -- docs/specs/2026-07-22-independent-4h-trials.md');
    expect(result).toMatchObject({
      kind: 'four_hour_family_snapshot',
      familyId: FAMILY_ID,
      artifactSha256: ARTIFACT_HASH,
      dataSha256: DATA_HASH,
    });
  });

  it('does not issue later requests or write after a sequential fetch failure', async () => {
    const test = harness();
    test.dependencies.fetchCandles = async (symbol) => {
      test.events.push(`fetch:candles:${symbol}`);
      if (symbol === 'HYPE') throw new Error('malformed HYPE page');
      return candleSnapshot(symbol);
    };

    await expect(snapshotFourHourResearch(test.dependencies, test.paths))
      .rejects.toThrow('malformed HYPE page');
    expect(test.events.filter((event) => event.startsWith('fetch:'))).toEqual([
      'fetch:spotMeta',
      'fetch:candles:BTC',
      'fetch:candles:ETH',
      'fetch:candles:HYPE',
    ]);
    expect(test.events).not.toContain('write:snapshot');
  });

  it('rechecks the repository after fetching and blocks publication on any mutation', async () => {
    const test = harness();
    test.dependencies.fetchFunding = async (coin) => {
      test.events.push(`fetch:funding:${coin}`);
      if (coin === 'HYPE') test.state.status = ' M server/src/research/fourHour/cli.ts';
      return fundingSnapshot(coin);
    };

    await expect(snapshotFourHourResearch(test.dependencies, test.paths))
      .rejects.toThrow(/clean worktree/);
    expect(test.events).toContain('build:snapshot');
    expect(test.events).not.toContain('write:snapshot');
  });
});

describe('four-hour immutable evaluation orchestration', () => {
  it('evaluates every frozen trial twice from six detached inputs and atomically publishes ordered r1', async () => {
    const test = harness();
    const output = await evaluateFourHourResearch(test.dependencies, test.paths);

    expect(test.events.filter((event) => event === 'detach:snapshot')).toHaveLength(6);
    expect(test.events.filter((event) => event.startsWith('evaluate:'))).toEqual([
      'evaluate:H2', 'evaluate:H3', 'evaluate:H4',
      'evaluate:H2', 'evaluate:H3', 'evaluate:H4',
    ]);
    expect(test.events.filter((event) => event.startsWith('build:trial:'))).toEqual([
      'build:trial:H2', 'build:trial:H3', 'build:trial:H4',
    ]);
    expect(test.events).toContain('write:initial-batch');
    expect(output).toMatchObject({
      kind: 'four_hour_initial_evaluation',
      familyDecision: 'PENDING',
      authorization: FOUR_HOUR_AUTHORIZATION_BOUNDARY,
    });
  });

  it('attempts H2,H3,H4 before failing an evaluator exception and never publishes a partial batch', async () => {
    const test = harness();
    const original = test.dependencies.evaluateTrial;
    test.dependencies.evaluateTrial = (data, id) => {
      test.events.push(`attempt:${id}`);
      if (id === 'H2') throw new Error('H2 failure');
      return original(data, id);
    };

    await expect(evaluateFourHourResearch(test.dependencies, test.paths))
      .rejects.toThrow(/after attempting H2,H3,H4/);
    expect(test.events.filter((event) => event.startsWith('attempt:'))).toEqual([
      'attempt:H2', 'attempt:H3', 'attempt:H4',
    ]);
    expect(test.events).not.toContain('write:initial-batch');
  });

  it('rejects nondeterministic second-pass bytes before building or writing reports', async () => {
    const test = harness();
    test.state.nondeterministicTrial = true;

    await expect(evaluateFourHourResearch(test.dependencies, test.paths))
      .rejects.toThrow(/not byte-identical/);
    expect(test.events.some((event) => event.startsWith('build:trial:'))).toBe(false);
    expect(test.events).not.toContain('write:initial-batch');
  });

  it('requires source-bundle equality and recorded evaluator commit ancestry', async () => {
    const test = harness();
    test.state.ancestor = false;

    await expect(evaluateFourHourResearch(test.dependencies, test.paths))
      .rejects.toThrow(/not an ancestor/);
    expect(test.events.some((event) => event.startsWith('evaluate:'))).toBe(false);
    expect(test.events).not.toContain('write:initial-batch');
  });

  it('re-pins after report construction and blocks publication on a mutation race', async () => {
    const test = harness();
    const original = test.dependencies.buildTrialReport;
    test.dependencies.buildTrialReport = (draft, snapshot) => {
      const report = original(draft, snapshot);
      if (draft.payload.strategyId === 'H4') test.state.status = ' M evaluator.ts';
      return report;
    };

    await expect(evaluateFourHourResearch(test.dependencies, test.paths))
      .rejects.toThrow(/clean worktree/);
    expect(test.events).not.toContain('write:initial-batch');
  });
});

describe('four-hour adjudication and replay', () => {
  function seedBatch(test: Harness): void {
    test.state.retainedBatch = retainedBatch([
      storedReport(trialPayload('H2')),
      storedReport(trialPayload('H3')),
      storedReport(trialPayload('H4')),
    ]);
  }

  function seedFamily(test: Harness): void {
    test.state.retainedFamily = {
      artifactSha256: '8'.repeat(64),
      canonical: {
        trialId: FAMILY_ID,
        reportRevision: 1,
        supersedesArtifactSha256: null,
        revisionEvidence: null,
        evaluator: {
          codeCommit: HEAD,
          cleanWorktree: true,
          sourceBundleSha256: SOURCE_HASH,
        },
        payload: familyPayload(FOUR_HOUR_FAMILY_LIMITATIONS),
      },
    } as unknown as StoredFamilyReport;
  }

  it('will not adjudicate without the exact retained atomic initial batch', async () => {
    const test = harness();
    await expect(adjudicateFourHourResearch(test.dependencies, test.paths))
      .rejects.toThrow(/exact retained atomic/);
    expect(test.events).not.toContain('derive:family');
    expect(test.events).not.toContain('write:family-report');
  });

  it('reruns exact payloads, derives the frozen family twice, and publishes the family only afterward', async () => {
    const test = harness();
    seedBatch(test);
    const output = await adjudicateFourHourResearch(test.dependencies, test.paths);

    expect(test.events.filter((event) => event.startsWith('evaluate:'))).toHaveLength(6);
    expect(test.events.filter((event) => event === 'derive:family')).toHaveLength(2);
    expect(test.events.indexOf('write:family-report'))
      .toBeGreaterThan(test.events.lastIndexOf('derive:family'));
    expect(output).toMatchObject({
      kind: 'four_hour_family_adjudication',
      familyDecision: 'REJECT',
      selectedCandidate: null,
      authorization: FOUR_HOUR_AUTHORIZATION_BOUNDARY,
    });
  });

  it('rejects retained trial tampering and nondeterministic family derivation without writing', async () => {
    const tampered = harness();
    seedBatch(tampered);
    tampered.state.retainedBatch!.reports[1].canonical.payload.limitations.push('tampered');
    await expect(adjudicateFourHourResearch(tampered.dependencies, tampered.paths))
      .rejects.toThrow(/H3 retained report/);
    expect(tampered.events).not.toContain('write:family-report');

    const nondeterministic = harness();
    seedBatch(nondeterministic);
    nondeterministic.state.nondeterministicFamily = true;
    await expect(adjudicateFourHourResearch(nondeterministic.dependencies, nondeterministic.paths))
      .rejects.toThrow(/Family adjudication is not byte-identical/);
    expect(nondeterministic.events).not.toContain('write:family-report');
  });

  it('replay is writer-free and reproduces exact trial and family artifact bytes', async () => {
    const test = harness();
    seedBatch(test);
    seedFamily(test);
    const output = await replayFourHourResearch(test.dependencies, test.paths);

    expect(test.events).not.toContain('write:snapshot');
    expect(test.events).not.toContain('write:initial-batch');
    expect(test.events).not.toContain('write:family-report');
    expect(output).toMatchObject({
      kind: 'four_hour_read_only_replay',
      familyDecision: 'REJECT',
      byteIdentical: true,
      authorization: FOUR_HOUR_AUTHORIZATION_BOUNDARY,
    });
  });

  it('replay rejects frozen limitation or report hash drift and never repairs artifacts', async () => {
    const test = harness();
    seedBatch(test);
    seedFamily(test);
    test.state.retainedFamily!.canonical.payload.limitations = ['changed after adjudication'];

    await expect(replayFourHourResearch(test.dependencies, test.paths))
      .rejects.toThrow(/frozen adjudication limitations/);
    expect(test.events).not.toContain('write:family-report');
    expect(test.events).not.toContain('write:initial-batch');
  });
});

describe('four-hour command surface', () => {
  it('keeps H1 returns out of the JSON preflight summary', async () => {
    const test = harness();
    const output = await executeFourHourCommand('preflight', test.dependencies, test.paths);
    expect(JSON.stringify(output)).not.toContain('"returns"');
    expect(output).toMatchObject({ kind: 'four_hour_preflight', familyId: FAMILY_ID });
  });

  it.each(['--help', 'evaluate --force', '', 'unknown'])('fails closed on unknown commands and flag-like input: %s', async (command) => {
    const test = harness();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runFourHourCli(command, test.dependencies, test.paths, {
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value),
    });

    expect(exitCode).toBe(1);
    expect(stdout).toEqual([]);
    expect(JSON.parse(stderr.join(''))).toMatchObject({
      command,
      familyDecision: 'ERROR',
      authorization: FOUR_HOUR_AUTHORIZATION_BOUNDARY,
    });
    expect(test.events).toEqual([]);
  });

  it('serializes unknown thrown values as a deterministic fail-closed JSON error', async () => {
    const test = harness();
    test.dependencies.fetchSpotMetadata = async () => { throw 'secret-like unknown'; };
    const stderr: string[] = [];
    const exitCode = await runFourHourCli('snapshot', test.dependencies, test.paths, {
      stdout: () => undefined,
      stderr: (value) => stderr.push(value),
    });

    expect(exitCode).toBe(1);
    expect(JSON.parse(stderr.join(''))).toEqual({
      authorization: FOUR_HOUR_AUTHORIZATION_BOUNDARY,
      command: 'snapshot',
      error: 'Unclassified four-hour CLI failure',
      familyDecision: 'ERROR',
    });
  });
});
