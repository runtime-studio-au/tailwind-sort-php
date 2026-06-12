/**
 * Tests for the `init` subcommand (`src/init.ts`).
 *
 * Each test creates a throwaway git repository and runs the CLI as a subprocess, asserting on the files, config,
 * exit codes, and refusal messages it produces. Global/system git config is masked so a user-level `core.hooksPath`
 * can't change behavior. Skips when `git` isn't available.
 */

import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { devNull, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.ts');
const env = { ...process.env, GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_SYSTEM: devNull };

// Probe for git up front; skip the suite when it isn't installed.
let skip: string | false = false;
try {
  execFileSync('git', ['--version'], { stdio: 'ignore' });
} catch {
  skip = 'git unavailable';
}

const repos: string[] = [];
after(async () => {
  await Promise.all(repos.map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * Create a fresh throwaway git repository, remembered for cleanup.
 *
 * @returns Absolute path of the new repository.
 */
async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tsp-init-'));
  repos.push(dir);
  execFileSync('git', ['init', '-q'], { cwd: dir, env });
  return dir;
}

/**
 * Run `tailwind-sort-php init` in a directory via the same runtime executing this test.
 *
 * @param cwd Directory to run in.
 * @param args Extra arguments after `init`.
 * @returns Exit code plus combined stdout/stderr.
 */
function runInit(cwd: string, ...args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [cliPath, 'init', ...args], {
      cwd,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/**
 * Read the repository-local `core.hooksPath`; throws when unset.
 *
 * @param cwd Repository to query.
 * @returns The configured hooks path.
 */
const hooksPath = (cwd: string) =>
  execFileSync('git', ['config', '--get', 'core.hooksPath'], { cwd, env, encoding: 'utf8' }).trim();

describe('init subcommand', { skip }, () => {
  test('installs the check hook and sets core.hooksPath in a fresh repo', async () => {
    const dir = await makeRepo();
    const { code, out } = runInit(dir);
    assert.equal(code, 0);
    assert.match(out, /installed \.githooks\/pre-commit \(check variant\)/);
    const hookFile = join(dir, '.githooks', 'pre-commit');
    const hook = await readFile(hookFile, 'utf8');
    assert.match(hook, /^#!\/bin\/sh\n/);
    assert.match(hook, /--check/);
    assert.ok((await stat(hookFile)).mode & 0o111, 'hook is executable');
    assert.equal(hooksPath(dir), '.githooks');
  });

  test('is idempotent: a second run is a no-op', async () => {
    const dir = await makeRepo();
    runInit(dir);
    const { code, out } = runInit(dir);
    assert.equal(code, 0);
    assert.match(out, /already installed/);
  });

  test('--fix installs the auto-fix variant', async () => {
    const dir = await makeRepo();
    const { code, out } = runInit(dir, '--fix');
    assert.equal(code, 0);
    assert.match(out, /fix variant/);
    const hook = await readFile(join(dir, '.githooks', 'pre-commit'), 'utf8');
    assert.match(hook, /Review the changes, re-stage, and commit again/);
  });

  test('switching variants is refused without --force, then overwrites with it', async () => {
    const dir = await makeRepo();
    runInit(dir);
    const refused = runInit(dir, '--fix');
    assert.equal(refused.code, 1);
    assert.match(refused.out, /check variant/);
    assert.match(refused.out, /--force/);
    const forced = runInit(dir, '--fix', '--force');
    assert.equal(forced.code, 0);
    const hook = await readFile(join(dir, '.githooks', 'pre-commit'), 'utf8');
    assert.match(hook, /Review the changes, re-stage, and commit again/);
  });

  test('refuses when .git/hooks contains live hooks, proceeds with --force', async () => {
    const dir = await makeRepo();
    await mkdir(join(dir, '.git', 'hooks'), { recursive: true });
    await writeFile(join(dir, '.git', 'hooks', 'pre-push'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const refused = runInit(dir);
    assert.equal(refused.code, 1);
    assert.match(refused.out, /pre-push/);
    const forced = runInit(dir, '--force');
    assert.equal(forced.code, 0);
    assert.equal(hooksPath(dir), '.githooks');
  });

  test('refuses when core.hooksPath points elsewhere', async () => {
    const dir = await makeRepo();
    execFileSync('git', ['config', 'core.hooksPath', '.husky'], { cwd: dir, env });
    const { code, out } = runInit(dir);
    assert.equal(code, 1);
    assert.match(out, /\.husky/);
  });

  test('--dry-run prints planned actions without writing anything', async () => {
    const dir = await makeRepo();
    const { code, out } = runInit(dir, '--dry-run');
    assert.equal(code, 0);
    assert.match(out, /would install/);
    assert.match(out, /would set core\.hooksPath/);
    await assert.rejects(stat(join(dir, '.githooks', 'pre-commit')));
    assert.throws(() => hooksPath(dir)); // config is still unset
  });

  test('fails outside a git repository', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tsp-norepo-'));
    repos.push(dir);
    const { code, out } = runInit(dir);
    assert.equal(code, 1);
    assert.match(out, /Not a git repository/);
  });
});
