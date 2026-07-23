import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { canonicalJson, FROZEN_CONFIG, runFrozenResearch } from './kernel.js';
import {
  buildFrozenSnapshot,
  readFrozenSnapshot,
  snapshotSeries,
  writeSnapshot,
} from './hyperliquid.js';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const serverDirectory = path.resolve(moduleDirectory, '../..');
const repositoryDirectory = path.resolve(serverDirectory, '..');
const snapshotDirectory = path.join(serverDirectory, 'research-data');
const resultDirectory = path.join(serverDirectory, 'research-results');
const specificationPath = 'docs/specs/2026-07-22-deterministic-research-kernel.md';

function git(...args: string[]): string {
  return execFileSync('git', args, {
    cwd: repositoryDirectory,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function cleanRepositoryHead(): string {
  const status = git('status', '--porcelain', '--untracked-files=all');
  if (status !== '') {
    throw new Error('Research artifacts require a clean committed worktree');
  }
  return git('rev-parse', 'HEAD');
}

function assertRepositoryStillPinned(pinnedHead: string): void {
  if (cleanRepositoryHead() !== pinnedHead) {
    throw new Error('Repository HEAD changed during the research command');
  }
}

async function snapshotCommand(): Promise<void> {
  const pinnedHead = cleanRepositoryHead();
  const snapshot = await buildFrozenSnapshot();
  assertRepositoryStillPinned(pinnedHead);
  const outputPath = await writeSnapshot(snapshot, snapshotDirectory);
  process.stdout.write(`${canonicalJson({
    artifactSha256: snapshot.artifactSha256,
    dataSha256: snapshot.dataSha256,
    outputPath,
    trialId: snapshot.canonical.trialId,
  })}\n`);
}

async function buildReport() {
  const pinnedHead = cleanRepositoryHead();
  const snapshot = await readFrozenSnapshot(snapshotDirectory);
  const result = runFrozenResearch(snapshotSeries(snapshot));
  const canonical = {
    schemaVersion: 1,
    trialId: FROZEN_CONFIG.trialId,
    artifactIdentity: {
      codeCommit: pinnedHead,
      specificationCommit: git('log', '-1', '--format=%H', '--', specificationPath),
      snapshotArtifactSha256: snapshot.artifactSha256,
      snapshotDataSha256: snapshot.dataSha256,
    },
    data: {
      source: snapshot.canonical.source,
      requestedWindow: snapshot.canonical.requestedWindow,
      receivedWindows: {
        BTC: {
          firstOpenTime: snapshot.canonical.assets.BTC.candles[0].openTime,
          lastCloseTime: snapshot.canonical.assets.BTC.candles.at(-1)?.closeTime,
          rows: snapshot.canonical.assets.BTC.candles.length,
          pages: snapshot.canonical.assets.BTC.pages,
        },
        ETH: {
          firstOpenTime: snapshot.canonical.assets.ETH.candles[0].openTime,
          lastCloseTime: snapshot.canonical.assets.ETH.candles.at(-1)?.closeTime,
          rows: snapshot.canonical.assets.ETH.candles.length,
          pages: snapshot.canonical.assets.ETH.pages,
        },
      },
    },
    result,
  };
  assertRepositoryStillPinned(pinnedHead);
  return {
    reportSha256: sha256(canonicalJson(canonical)),
    canonical,
    pinnedHead,
  };
}

async function runCommand(writeArtifact: boolean): Promise<void> {
  const report = await buildReport();
  const serialized = `${canonicalJson(report)}\n`;
  if (writeArtifact) {
    await mkdir(resultDirectory, { recursive: true });
    const existing = (await readdir(resultDirectory))
      .filter((name) => name.startsWith(`${FROZEN_CONFIG.trialId}.`) && name.endsWith('.json'));
    if (existing.length > 0) {
      throw new Error(`Result already exists for trial ${FROZEN_CONFIG.trialId}`);
    }
    const outputPath = path.join(
      resultDirectory,
      `${FROZEN_CONFIG.trialId}.${report.reportSha256}.json`,
    );
    assertRepositoryStillPinned(report.pinnedHead);
    await writeFile(outputPath, serialized, { encoding: 'utf8', flag: 'wx' });
    process.stdout.write(`${canonicalJson({
      outputPath,
      reportSha256: report.reportSha256,
      screenVerdict: report.canonical.result.screenVerdict,
    })}\n`);
    return;
  }
  assertRepositoryStillPinned(report.pinnedHead);
  process.stdout.write(serialized);
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'run';
  if (command === 'snapshot') {
    await snapshotCommand();
    return;
  }
  if (command === 'run') {
    await runCommand(false);
    return;
  }
  if (command === 'report') {
    await runCommand(true);
    return;
  }
  throw new Error(`Unknown research command: ${command}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${canonicalJson({ error: message, screenVerdict: 'ERROR' })}\n`);
  process.exitCode = 1;
});
