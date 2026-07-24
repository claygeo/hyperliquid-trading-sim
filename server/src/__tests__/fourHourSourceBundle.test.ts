import path from 'node:path';
import { execFileSync } from 'node:child_process';

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

  /*
   * The composition below is the exact wiring production uses. Testing the reader and
   * the collector separately left the one path that produces the permanent evaluator
   * pin unexercised end to end.
   */
  test('the production composition yields the full 18-file bundle with a stable hash', async () => {
    const bundle = await collectEvaluatorSourceBundle(
      REPOSITORY_ROOT,
      createGitSourceReader(REPOSITORY_ROOT),
    );
    expect(bundle).toHaveLength(18);

    const again = await collectEvaluatorSourceBundle(
      REPOSITORY_ROOT,
      createGitSourceReader(REPOSITORY_ROOT),
    );
    expect(calculateSourceBundleSha256(bundle)).toBe(calculateSourceBundleSha256(again));
  });

  /*
   * Asserting flat equality here would be flaky: during development the worktree
   * legitimately differs from HEAD. The invariant that actually holds at all times is
   * that the ONLY files whose bytes differ between the two readers are files git itself
   * reports as modified. On a clean worktree that set is empty and the hashes match,
   * which is the property the canonical snapshot depends on.
   */
  test('git and disk bundles differ only where git reports a modification', async () => {
    const status = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
      cwd: REPOSITORY_ROOT, encoding: 'utf8',
    });
    const dirty = new Set(
      status.split('\n')
        .map((line) => line.slice(3).trim())
        .filter((p) => p !== ''),
    );

    const fromGit = await collectEvaluatorSourceBundle(
      REPOSITORY_ROOT, createGitSourceReader(REPOSITORY_ROOT),
    );
    const fromDisk = await collectEvaluatorSourceBundle(
      REPOSITORY_ROOT, createDiskSourceReader(REPOSITORY_ROOT),
    );

    const gitBytes = new Map(fromGit.map((f) => [f.relativePath, f.bytes]));
    const divergent = fromDisk
      .filter((f) => gitBytes.get(f.relativePath) !== f.bytes)
      .map((f) => f.relativePath);

    for (const p of divergent) expect(dirty.has(p)).toBe(true);

    if (dirty.size === 0) {
      expect(calculateSourceBundleSha256(fromGit)).toBe(calculateSourceBundleSha256(fromDisk));
    }
  });

  /*
   * `git ls-tree` exits 0 with empty output when a pathspec matches nothing. Without an
   * explicit guard that silently produces a bundle covering only the four fixed files,
   * pinning an evaluator it does not contain - the same bricking class the git reader
   * exists to prevent, re-entered through a different door.
   */
  test('a missing evaluator surface fails closed instead of yielding an empty listing', async () => {
    await expect(createGitSourceReader(REPOSITORY_ROOT).list(`${SURFACE}GONE`))
      .rejects.toThrow(/absent from HEAD/u);
  });

  test('an empty listing is refused by the collector as well as the reader', async () => {
    const reader: EvaluatorSourceReader = {
      list: async () => [],
      read: async () => '{}\n',
    };
    await expect(collectEvaluatorSourceBundle(REPOSITORY_ROOT, reader))
      .rejects.toThrow(/pins no evaluator/u);
  });
});
