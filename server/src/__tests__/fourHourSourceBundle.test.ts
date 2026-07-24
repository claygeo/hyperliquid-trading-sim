import path from 'node:path';

import {
  calculateSourceBundleSha256,
  collectEvaluatorSourceBundle,
  createDiskSourceReader,
  type EvaluatorSourceEntry,
  type EvaluatorSourceReader,
} from '../research/fourHour/artifacts.js';
import { createGitSourceReader } from '../research/fourHour/cli.js';

const REPOSITORY_ROOT = path.resolve(__dirname, '../../..');
const SURFACE = 'server/src/research/fourHour';

/**
 * Regression coverage for a defect that would have permanently bricked the research
 * family.
 *
 * The evaluator source bundle was read from the WORKING TREE. With core.autocrlf
 * enabled and no .gitattributes, git's clean filter strips CR before comparing, so
 * `git status` reported a clean worktree while three bundle files held CRLF on disk
 * and LF in the object database. That made sourceBundleSha256 a function of
 * (commit x local checkout normalization) rather than of the commit.
 *
 * Two failures followed. The one-shot canonical snapshot would seal a hash nobody
 * could reproduce from the commit, and any later checkout/stash/restore could
 * re-materialise the sources with different line endings, flipping the hash and making
 * assertEvaluatorCompatible permanently reject an already-fetched snapshot.
 */
describe('evaluator source bundle provenance', () => {
  test('git-blob reader yields the committed surface with no carriage returns', async () => {
    const reader = createGitSourceReader(REPOSITORY_ROOT);
    const entries = await reader.list(SURFACE);

    expect(entries.length).toBeGreaterThanOrEqual(14);
    for (const entry of entries) {
      expect(entry.relativePath.startsWith(`${SURFACE}/`)).toBe(true);
      expect(entry.isSymbolicLink).toBe(false);
      const bytes = await reader.read(entry.relativePath);
      // Committed bytes must be platform-independent, or the bundle hash is not a
      // function of the commit.
      expect(bytes).not.toMatch(/\r/u);
    }
  });

  test('git-blob reader is sorted and stable across calls', async () => {
    const reader = createGitSourceReader(REPOSITORY_ROOT);
    const first = (await reader.list(SURFACE)).map((e) => e.relativePath);
    const second = (await reader.list(SURFACE)).map((e) => e.relativePath);

    expect(first).toEqual(second);
    expect(first).toEqual([...first].sort());
  });

  test('the fixed bundle files are free of carriage returns in the object database', async () => {
    const reader = createGitSourceReader(REPOSITORY_ROOT);
    for (const relativePath of [
      'docs/specs/2026-07-22-independent-4h-trials.md',
      'server/package.json',
      'server/tsconfig.json',
      'server/jest.config.cjs',
    ]) {
      expect(await reader.read(relativePath)).not.toMatch(/\r/u);
    }
  });

  test('the bundle hash depends only on bytes, never on which reader supplied them', async () => {
    const files = new Map<string, string>([
      [`${SURFACE}/contracts.ts`, 'export const a = 1;\n'],
      [`${SURFACE}/runner.ts`, 'export const b = 2;\n'],
      ['docs/specs/2026-07-22-independent-4h-trials.md', '# spec\n'],
      ['server/package.json', '{}\n'],
      ['server/tsconfig.json', '{}\n'],
      ['server/jest.config.cjs', 'module.exports = {};\n'],
    ]);
    const makeReader = (order: 'forward' | 'reverse'): EvaluatorSourceReader => ({
      list: async () => {
        const entries: EvaluatorSourceEntry[] = [...files.keys()]
          .filter((p) => p.startsWith(`${SURFACE}/`))
          .map((relativePath) => ({ relativePath, isSymbolicLink: false }));
        return order === 'forward' ? entries : entries.reverse();
      },
      read: async (relativePath) => {
        const bytes = files.get(relativePath);
        if (bytes === undefined) throw new Error(`missing ${relativePath}`);
        return bytes;
      },
    });

    const forward = await collectEvaluatorSourceBundle(REPOSITORY_ROOT, makeReader('forward'));
    const reverse = await collectEvaluatorSourceBundle(REPOSITORY_ROOT, makeReader('reverse'));

    expect(calculateSourceBundleSha256(forward)).toBe(calculateSourceBundleSha256(reverse));
  });

  test('a symlink in the evaluator surface is refused rather than silently hashed', async () => {
    const reader: EvaluatorSourceReader = {
      list: async () => [
        { relativePath: `${SURFACE}/contracts.ts`, isSymbolicLink: false },
        { relativePath: `${SURFACE}/sneaky.ts`, isSymbolicLink: true },
      ],
      read: async () => 'export const a = 1;\n',
    };

    await expect(collectEvaluatorSourceBundle(REPOSITORY_ROOT, reader))
      .rejects.toThrow(/symlink/u);
  });

  test('a path escaping the evaluator surface is refused', async () => {
    const reader: EvaluatorSourceReader = {
      list: async () => [
        { relativePath: `${SURFACE}/../../../../etc/passwd`, isSymbolicLink: false },
      ],
      read: async () => 'root:x:0:0\n',
    };

    await expect(collectEvaluatorSourceBundle(REPOSITORY_ROOT, reader))
      .rejects.toThrow(/Invalid evaluator source path/u);
  });

  test('the disk reader still works, so fixture-based tests keep functioning', async () => {
    const entries = await createDiskSourceReader(REPOSITORY_ROOT).list(SURFACE);
    expect(entries.length).toBeGreaterThanOrEqual(14);
  });
});
