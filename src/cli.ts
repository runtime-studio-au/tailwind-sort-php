#!/usr/bin/env node
/**
 * tailwind-sort-php CLI
 *
 * Usage:
 *   tailwind-sort-php [options] [glob ...]
 *   tailwind-sort-php init [--fix] [--force] [--dry-run]
 *
 * Options:
 *   --stylesheet <path> Tailwind v4 CSS entry
 *   --attr <name> Extra attribute to sort (repeatable)
 *   --php-source <glob> Also sort class strings in PHP declarations in matching files (repeatable)
 *   --check Don't write; exit 1 if any file needs sorting
 *   --no-short-tags Don't treat bare `<?` as a PHP open tag
 *
 * Defaults to all `.php` files under `cwd` when no globs are given.
 * Skips `node_modules`, `vendor`, `dist` and `.git`. The `init` subcommand installs the pre-commit hook; see `init.ts`.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { transform, type TransformOptions } from './transform.ts';
import { createTailwindSortFn } from './sorter.ts';
import { runInit } from './init.ts';

const IGNORE = ['node_modules', 'vendor', 'dist', '.git'];

interface Cli {
  globs: string[];
  stylesheet?: string;
  attrs: string[];
  phpSources: string[];
  check: boolean;
  shortTags: boolean;
}

/**
 * Parse command-line arguments.
 *
 * @param argv Arguments after the runtime and script path.
 * @returns Parsed CLI options with defaults applied.
 */
function parseArgs(argv: string[]): Cli {
  const cli: Cli = {
    globs: [],
    attrs: ['class', 'className'],
    phpSources: [],
    check: false,
    shortTags: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') cli.check = true;
    else if (a === '--no-short-tags') cli.shortTags = false;
    else if (a === '--stylesheet') cli.stylesheet = argv[++i];
    else if (a === '--attr') cli.attrs.push(argv[++i]);
    else if (a === '--php-source') cli.phpSources.push(argv[++i]);
    else if (a.startsWith('--')) {
      console.error(`Unknown option: ${a}`);
      process.exit(2);
    } else cli.globs.push(a);
  }
  if (cli.globs.length === 0) cli.globs.push('**/*.php');
  return cli;
}

/**
 * Yield file paths matching the given globs, using `Bun.Glob` under Bun and `node:fs` glob (Node >= 22) otherwise.
 *
 * @param globs Glob patterns relative to `cwd`.
 */
async function* scanFiles(globs: string[]): AsyncGenerator<string> {
  if (typeof (globalThis as any).Bun !== 'undefined') {
    const { Glob } = await import('bun');
    for (const pattern of globs) {
      for await (const f of new Glob(pattern).scan('.')) yield f;
    }
  } else {
    const { glob } = await import('node:fs/promises');
    for (const pattern of globs) {
      for await (const f of glob(pattern)) yield f as string;
    }
  }
}

/**
 * Whether a path falls inside an always-ignored directory.
 *
 * @param file Path to test, relative to `cwd`.
 * @returns True when the path is inside an ignored directory and should be skipped.
 */
const ignored = (file: string) => IGNORE.some((d) => file.includes(`${d}/`) || file.startsWith(d));

/**
 * Best-effort read of the project's resolved Prettier config, so this tool shares one source of truth with
 * `prettier-plugin-tailwindcss`. Picks up `tailwindStylesheet` (resolved relative to the config file) and
 * `tailwindAttributes` (merged into the attribute list).
 *
 * @returns The resolved stylesheet path and attributes, or an empty object if none are available.
 */
async function fromPrettierConfig(): Promise<{
  stylesheet?: string;
  attributes?: string[];
  phpSources?: string[];
}> {
  try {
    const prettier = await import('prettier');
    const { dirname, resolve } = await import('node:path');
    const configFile = await prettier.resolveConfigFile();
    if (!configFile) return {};
    const cfg = (await prettier.resolveConfig(configFile)) as Record<string, unknown> | null;
    if (!cfg) return {};
    const out: { stylesheet?: string; attributes?: string[]; phpSources?: string[] } = {};
    if (typeof cfg.tailwindStylesheet === 'string') {
      out.stylesheet = resolve(dirname(configFile), cfg.tailwindStylesheet);
    }
    if (Array.isArray(cfg.tailwindAttributes)) {
      out.attributes = cfg.tailwindAttributes.filter((a): a is string => typeof a === 'string' && !a.startsWith('/'));
    }
    if (Array.isArray(cfg.tailwindPhpSources)) {
      out.phpSources = cfg.tailwindPhpSources.filter((p): p is string => typeof p === 'string');
    }
    return out;
  } catch {
    return {}; // prettier not installed or config unreadable — flags only
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === 'init') return runInit(argv.slice(1));

  const cli = parseArgs(argv);

  const pc = await fromPrettierConfig();
  const stylesheet = cli.stylesheet ?? pc.stylesheet;
  if (!stylesheet) {
    console.error(
      'No Tailwind stylesheet found. Pass --stylesheet <path> or set ' +
        '`tailwindStylesheet` in your Prettier config.',
    );
    process.exit(2);
  }
  if (pc.attributes) {
    for (const a of pc.attributes) {
      if (!cli.attrs.includes(a)) cli.attrs.push(a);
    }
  }

  const sortFn = await createTailwindSortFn({ stylesheet });
  const opts: TransformOptions = {
    attributes: cli.attrs,
    shortOpenTags: cli.shortTags,
  };

  // Pre-scan the opt-in `tailwindPhpSources` globs; a file gets `sortPhpStrings` only if it matches one.
  const phpSources = [...cli.phpSources, ...(pc.phpSources ?? [])];
  const phpSourceFiles = new Set<string>();
  for await (const file of scanFiles(phpSources)) {
    if (!ignored(file)) phpSourceFiles.add(file);
  }

  let scanned = 0;
  let changed = 0;
  const seen = new Set<string>();

  // Include php-source files so a designated holder is sorted even outside the main globs; `seen` dedupes.
  for await (const file of scanFiles([...cli.globs, ...phpSources])) {
    if (ignored(file) || seen.has(file)) continue;
    seen.add(file);
    scanned++;
    const src = await readFile(file, 'utf8');
    const out = transform(src, sortFn, { ...opts, sortPhpStrings: phpSourceFiles.has(file) });
    if (out !== src) {
      changed++;
      if (cli.check) {
        console.log(`needs sorting: ${file}`);
      } else {
        await writeFile(file, out);
        console.log(`sorted: ${file}`);
      }
    }
  }

  console.log(`${scanned} file(s) scanned, ${changed} ${cli.check ? 'need(s) sorting' : 'updated'}`);
  if (cli.check && changed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
