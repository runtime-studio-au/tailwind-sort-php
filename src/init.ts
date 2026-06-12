/**
 * tailwind-sort-php init
 *
 * Installs the pre-commit hook: writes `.githooks/pre-commit` and points `core.hooksPath` at it.
 * No-clobber unless `--force`; `--fix` installs the auto-fixing variant; `--dry-run` previews.
 */

import { execFileSync } from 'node:child_process';
import { chmod, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const HOOKS_DIR = '.githooks';
const HOOK_PATH = `${HOOKS_DIR}/pre-commit`;

/**
 * Check-and-fail hook (default): names the unsorted files and blocks the commit; never writes.
 */
const HOOK_CHECK = `#!/bin/sh
# Block commits with unsorted Tailwind classes in staged PHP files. Installed by \`tailwind-sort-php init\`.
# Note: checks working-tree file contents, so partial staging (\`git add -p\`) can mis-report; see README.
sorter=./node_modules/.bin/tailwind-sort-php
[ -x "$sorter" ] || exit 0
git diff --cached --name-only --diff-filter=ACMR -- '*.php' | grep -q . || exit 0
if git diff --cached --name-only -z --diff-filter=ACMR -- '*.php' | xargs -0 "$sorter" --check; then
  exit 0
fi
echo >&2
echo "Unsorted Tailwind classes in staged PHP (see above)." >&2
echo "Fix with: npx tailwind-sort-php (or: bunx tailwind-sort-php), then re-stage." >&2
exit 1
`;

/**
 * Auto-fix hook (--fix): sorts the staged files in place, then blocks the commit for review.
 */
const HOOK_FIX = `#!/bin/sh
# Sort Tailwind classes in staged PHP files, then abort the commit so the changes can be reviewed and re-staged.
# Rewrites working-tree files. Installed by \`tailwind-sort-php init --fix\`.
# Note: with partial staging (\`git add -p\`), re-staging can pull in unrelated unstaged hunks; see README.
sorter=./node_modules/.bin/tailwind-sort-php
[ -x "$sorter" ] || exit 0
git diff --cached --name-only --diff-filter=ACMR -- '*.php' | grep -q . || exit 0
if git diff --cached --name-only -z --diff-filter=ACMR -- '*.php' | xargs -0 "$sorter" --check >/dev/null 2>&1; then
  exit 0
fi
git diff --cached --name-only -z --diff-filter=ACMR -- '*.php' | xargs -0 "$sorter"
echo >&2
echo "Sorted Tailwind classes in staged PHP (see above)." >&2
echo "Review the changes, re-stage, and commit again." >&2
exit 1
`;

interface InitCli {
  fix: boolean;
  force: boolean;
  dryRun: boolean;
}

/**
 * Parse `init` subcommand arguments.
 *
 * @param argv Arguments after the `init` subcommand name.
 * @returns Parsed flags with defaults applied.
 */
function parseArgs(argv: string[]): InitCli {
  const cli: InitCli = { fix: false, force: false, dryRun: false };
  for (const a of argv) {
    if (a === '--fix') cli.fix = true;
    else if (a === '--force') cli.force = true;
    else if (a === '--dry-run') cli.dryRun = true;
    else {
      console.error(`Unknown init option: ${a}`);
      process.exit(2);
    }
  }
  return cli;
}

/**
 * Run a git command and capture its output.
 *
 * @param args Arguments passed to `git`.
 * @returns Trimmed stdout, or `null` when git exits non-zero (unset config, not a repo, …).
 */
function git(args: string[]): string | null {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/**
 * Print an error to stderr and exit with status 1.
 *
 * @param message Error text explaining why init refused to proceed.
 */
function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/**
 * Run the `init` subcommand: install the pre-commit hook and point `core.hooksPath` at it.
 *
 * @param argv Arguments after the `init` subcommand name.
 */
export async function runInit(argv: string[]): Promise<void> {
  const cli = parseArgs(argv);
  const hookBody = cli.fix ? HOOK_FIX : HOOK_CHECK;
  const variant = cli.fix ? 'fix' : 'check';

  // Anchor everything at the repository root: a relative `core.hooksPath` resolves there,
  // and the hook's `./node_modules/...` path assumes hooks run from it (they do, for pre-commit).
  const top = git(['rev-parse', '--show-toplevel']);
  if (top === null) fail('Not a git repository (or a bare one) — run init from inside a working tree.');
  const gitDir = git(['rev-parse', '--absolute-git-dir'])!;
  const hookAbs = join(top, HOOK_PATH);

  // Decide whether `core.hooksPath` needs to change. Repointing it makes git ignore `.git/hooks` entirely,
  // so refuse to silently disable hooks that already live there.
  const hooksPath = git(['config', '--get', 'core.hooksPath']);
  let setConfig = false;
  if (hooksPath === null) {
    const live = (await readdir(join(gitDir, 'hooks')).catch(() => [])).filter((f) => !f.endsWith('.sample'));
    if (live.length > 0 && !cli.force) {
      fail(
        `Found existing hook(s) in .git/hooks: ${live.join(', ')}.\n` +
          `Setting core.hooksPath would disable them. Move them into ${HOOKS_DIR}/ first, ` +
          'or re-run with --force to proceed anyway.',
      );
    }
    setConfig = true;
  } else if (hooksPath !== HOOKS_DIR) {
    if (!cli.force) {
      fail(
        `core.hooksPath is already set to "${hooksPath}" — add the hook there yourself, or re-run ` +
          `with --force to repoint it to ${HOOKS_DIR}. Hook body:\n\n${hookBody}`,
      );
    }
    setConfig = true;
  }

  // Decide whether the hook file needs writing; overwriting a differing hook needs --force.
  const current = await readFile(hookAbs, 'utf8').catch(() => null);
  let writeHook = current === null;
  let repairMode = false;
  if (current !== null && current !== hookBody) {
    if (!cli.force) {
      const installed =
        current === HOOK_CHECK ? 'the check variant' : current === HOOK_FIX ? 'the --fix variant' : 'a custom hook';
      fail(`${HOOK_PATH} already exists and differs (${installed} is installed). Re-run with --force to overwrite.`);
    }
    writeHook = true;
  }
  if (current === hookBody) {
    // Content is already right; still repair a missing executable bit, or git silently skips the hook.
    repairMode = ((await stat(hookAbs)).mode & 0o111) === 0;
  }

  const done: string[] = [];
  if (writeHook) {
    if (!cli.dryRun) {
      await mkdir(join(top, HOOKS_DIR), { recursive: true });
      await writeFile(hookAbs, hookBody);
      await chmod(hookAbs, 0o755);
    }
    done.push(
      cli.dryRun ? `would install ${HOOK_PATH} (${variant} variant)` : `installed ${HOOK_PATH} (${variant} variant)`,
    );
  }
  if (repairMode) {
    if (!cli.dryRun) await chmod(hookAbs, 0o755);
    done.push(cli.dryRun ? `would make ${HOOK_PATH} executable` : `made ${HOOK_PATH} executable`);
  }
  if (setConfig) {
    if (!cli.dryRun) git(['config', 'core.hooksPath', HOOKS_DIR]);
    done.push(cli.dryRun ? `would set core.hooksPath = ${HOOKS_DIR}` : `set core.hooksPath = ${HOOKS_DIR}`);
  }

  if (done.length === 0) {
    console.log(`Nothing to do — ${HOOK_PATH} (${variant} variant) is already installed.`);
    return;
  }
  for (const line of done) console.log(line);
}
