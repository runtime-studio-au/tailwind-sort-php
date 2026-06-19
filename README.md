# Tailwind CSS Class Sorter for PHP

[![npm version](https://img.shields.io/npm/v/@runtimestudio/tailwind-sort-php)](https://www.npmjs.com/package/@runtimestudio/tailwind-sort-php)
[![License: MIT](https://img.shields.io/npm/l/@runtimestudio/tailwind-sort-php)](LICENSE)

`@runtimestudio/tailwind-sort-php` sorts Tailwind CSS classes in **plain PHP files, WordPress themes and plugins, and
mixed PHP/HTML templates** — the case `prettier-plugin-tailwindcss` can't parse and `@prettier/plugin-php` mangles.

`prettier-plugin-tailwindcss` sorts classes beautifully, but it can't parse files that interleave PHP with HTML, and
`@prettier/plugin-php` reformats the entire PHP file as a side effect. This tool sorts **only** the class attribute
values, using a real PHP-aware lexer, and leaves everything else byte-identical.

- **Official sort order** — uses `prettier-plugin-tailwindcss/sorter`, so class order matches Prettier exactly,
  including your Tailwind v4 CSS-first config (`@theme` tokens, custom `@utility` classes).
- **Only rewrites class attribute values** — never reformats PHP, never touches whitespace outside attributes.
- **PHP-island aware** — a real lexer (not a regex) finds PHP regions first, so quotes and `?>` inside PHP strings,
  heredocs, and comments can't corrupt the HTML scan.
- **Zero-config** — reads `tailwindStylesheet` from your Prettier config, the same source of truth that
  `prettier-plugin-tailwindcss` uses.

## Contents

- [Requirements](#requirements) · [Install](#install) · [Setup](#setup) · [Usage](#usage)
- [Editor integration](#editor-integration) — sort-on-save & pre-commit gate
- [Sorting classes in PHP declarations](#sorting-classes-in-php-declarations) — the per-file opt-in
- [WordPress themes & plugins](#wordpress-themes--plugins)
- [How it handles mixed templates](#how-it-handles-mixed-templates) · [Programmatic API](#programmatic-api) · [Known limitations](#known-limitations)
- [Development](#development) · [License](#license)

## Requirements

- **Node ≥ 22.18**, or **Bun** — both run the CLI and the programmatic API.
- `prettier` ≥ 3 and `prettier-plugin-tailwindcss` ≥ 0.8 (peer dependencies).

## Install

```sh
# npm
npm install -D @runtimestudio/tailwind-sort-php prettier prettier-plugin-tailwindcss

# Bun
bun add -D @runtimestudio/tailwind-sort-php prettier prettier-plugin-tailwindcss
```

pnpm and yarn work the same (`pnpm add -D …` / `yarn add -D …`).

## Setup

Point Prettier at your Tailwind v4 entry stylesheet so both `prettier-plugin-tailwindcss` and this tool share one
vocabulary. Any config format Prettier supports works (`.prettierrc`, `prettier.config.js`, a `package.json`
`"prettier"` key, …) — the tool reads the resolved config, exactly like the plugin does. For example, in
`prettier.config.mjs`:

```js
export default {
    plugins: ['prettier-plugin-tailwindcss'],
    tailwindStylesheet: './resources/css/main.css',
};
```

`tailwindStylesheet` is resolved relative to the config file, so the path matches what the official plugin uses. With
this in place, the CLI needs no flags.

## Usage

Run with `npx` (Node ≥ 22.18) or `bunx` (Bun):

```sh
# sort every .php file under the cwd (stylesheet read from your Prettier config)
npx tailwind-sort-php

# specific globs
npx tailwind-sort-php "template-parts/**/*.php" "*.php"

# CI / pre-commit — write nothing, exit 1 if anything is unsorted
npx tailwind-sort-php --check

# explicit stylesheet (overrides the Prettier config)
npx tailwind-sort-php --stylesheet ./resources/css/main.css

# one-time: install the pre-commit hook (see "Pre-commit gate" below)
npx tailwind-sort-php init
```

### Options

| Flag                  | Description                                                                                                                                                                                    |
|-----------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `--stylesheet <path>` | Tailwind v4 CSS entry. Defaults to `tailwindStylesheet` from your Prettier config.                                                                                                             |
| `--attr <name>`       | Extra attribute to sort (repeatable). Merged with `tailwindAttributes` from your Prettier config.                                                                                              |
| `--php-source <glob>` | Also sort class strings in PHP declarations in matching files (repeatable). Merged with `tailwindPhpSources`. See [Sorting classes in PHP declarations](#sorting-classes-in-php-declarations). |
| `--check`             | Don't write; exit 1 if any file needs sorting.                                                                                                                                                 |
| `--no-short-tags`     | Don't treat bare `<?` as a PHP open tag.                                                                                                                                                       |

Default globs are all `.php` files under the cwd; `node_modules`, `vendor`, `dist`, and `.git` are always skipped.

## Editor integration

No IDE plugin is needed — two small setups cover the common workflows: sort-on-save and a pre-commit gate.

<details>
<summary><b>Sort on save</b> (PhpStorm / IntelliJ, VS Code) and a <b>pre-commit gate</b> — click to expand</summary>

### Sort on save (PhpStorm / IntelliJ)

Add a File Watcher (Settings → Tools → File Watchers → `+` → Custom):

- **File type:** PHP
- **Program:** `$ProjectFileDir$/node_modules/.bin/tailwind-sort-php`
- **Arguments:** `$FilePathRelativeToProjectRoot$`
- **Working directory:** `$ProjectFileDir$`

Untick "Auto-save edited files to trigger the watcher" so it runs on explicit save (~130 ms per file). The definition
lives in `.idea/watcherTasks.xml`, which you can commit to share it with your team.

### Sort on save (VS Code)

Install the [Run on Save](https://marketplace.visualstudio.com/items?itemName=emeraldwalk.RunOnSave) extension, then add
to `.vscode/settings.json`:

```json
{
    "emeraldwalk.runonsave": {
        "commands": [
            {
                "match": "\\.php$",
                "cmd": "${workspaceFolder}/node_modules/.bin/tailwind-sort-php ${relativeFile}"
            }
        ]
    }
}
```

### Pre-commit gate

Keep unsorted classes from landing regardless of the editor. One command installs a dependency-free Git hook at
`.githooks/pre-commit` and points `core.hooksPath` at it:

```sh
# check-and-fail (default): names the unsorted files and blocks the commit
npx tailwind-sort-php init

# auto-fix: sorts the staged files in place, then blocks the commit for review and re-staging
npx tailwind-sort-php init --fix
```

`init` is no-clobber by default: it refuses to overwrite a differing hook, repoint a `core.hooksPath` that's set
elsewhere (husky etc.), or disable hooks already living in `.git/hooks` — pass `--force` to override, `--dry-run` to
preview. Run it once per clone; commit the `.githooks/` directory to share the hook with your team.

Both variants check working-tree file contents, so with partial staging (`git add -p`) the hook can mis-report — and
under `--fix`, re-staging a fixed file can pull in unrelated unstaged hunks.

Wiring the gate into your own hook manager (husky, lefthook) instead? The staged-PHP check is this one-liner:

```sh
git diff --cached --name-only -z --diff-filter=ACMR -- '*.php' | xargs -0 ./node_modules/.bin/tailwind-sort-php --check
```

In CI there's no staged diff — just sweep the whole project with `npx tailwind-sort-php --check`.

</details>

## Sorting classes in PHP declarations

By default, the tool only sorts classes inside HTML `class="..."` attributes. Class strings declared in **PHP itself** —
constants, static properties, config arrays — sit inside PHP code the tool treats as opaque, so they're left alone.

Opt in **per file** by listing the files whose PHP string values are Tailwind class lists, via `tailwindPhpSources` in
your Prettier config (or the repeatable `--php-source <glob>` flag):

```js
export default {
    plugins: ['prettier-plugin-tailwindcss'],
    tailwindStylesheet: './resources/css/main.css',
    tailwindPhpSources: ['src/classes/*.php'],
};
```

With this set, every **string value** in a matched file is sorted with the exact same engine and order as the HTML
side. In `key => value` arrays only the **value** is sorted — keys are never touched:

```php
// before
public const array VARIANTS = array(
    'primary'   => 'text-white px-4 bg-blue-600 rounded py-2',
    'secondary' => 'text-gray-900 px-4 bg-gray-100 rounded py-2',
);

// after
public const array VARIANTS = array(
    'primary'   => 'rounded bg-blue-600 px-4 py-2 text-white',
    'secondary' => 'rounded bg-gray-100 px-4 py-2 text-gray-900',
);
```

Scalar declarations work the same way (`const string CARD = '...'`, `static $x = '...'`, `$x = '...'`), as do nested
and list-style arrays.

> **⚠️ Point `tailwindPhpSources` only at files whose string values are all Tailwind class lists.** The tool does
> **not** guess whether a string "looks like" classes — within a matched file it sorts **every** eligible string value.
> Aimed at a general file, it **will** reorder the words inside non-class strings (labels, URLs, SQL). This is a
> deliberate design contract, not a bug: safety comes from your file-level opt-in, which is why a dedicated
> directory of class-holder files (e.g. `src/classes/`) is the intended target.

The opt-in is **inert at runtime** — it lives in formatter config only, never in your source. Your PHP stays vanilla,
with zero coupling to this tool (no marker comments, no helper functions, no attributes).

**Skipped automatically** (left byte-identical, even in a matched file):

- Concatenated literals (`'btn-' . $variant`) — a fragment joined to dynamic code, unsafe to reorder.
- Interpolated double-quoted strings (`"p-4 {$dynamic} flex"`).
- Heredoc/nowdoc and backtick (shell-exec) strings, and strings containing escape sequences.

**Off by default:** without `tailwindPhpSources` (and `--php-source`), behavior is identical to 0.2.x — no PHP
declaration is ever touched.

## WordPress themes & plugins

Most WordPress sorting needs **no opt-in at all**. Template files and partials output markup, and the `class="..."`
in that markup is sorted by the default HTML pass — even when the value is interrupted by PHP:

```php
<article <?php post_class( 'z-10 flex' ); ?>>
  <h2 class="text-2xl font-bold <?= $featured ? 'text-amber-600' : '' ?> tracking-tight">
```

`tailwindPhpSources` is only for classes you store in **PHP values** — a variant map, a config array, theme defaults.
For that, **don't opt in a general partial.** Partials are full of non-class strings — `__()` translations,
`get_template_part()` names, query args, URLs — and an opted-in file sorts _every_ multi-word string value. The Tailwind
sorter leaves most prose alone (unknown words keep their order), but it **will** reorder any string containing words
that are also utilities (`grid`, `block`, `flex`, `hidden`, `container`, `table`, …), so `'Switch to grid view'`
becomes `'Switch to view grid'`.

Instead, keep class maps in a **dedicated file** whose every value is a class list, and opt in only that file:

```php
// inc/ui-classes.php   →   tailwindPhpSources: ['inc/ui-classes.php']
return array(
    'button' => array(
        'primary'   => 'rounded bg-blue-600 px-4 py-2 text-white',
        'secondary' => 'rounded bg-gray-100 px-4 py-2 text-gray-900',
    ),
    'card'   => 'rounded-lg border bg-white p-6 shadow-sm',
);
```

`require` that map from your partials. The map file is 100% class strings (safe to sort); the partials stay out of
`tailwindPhpSources` and get their markup sorted by the HTML pass as usual.

## How it handles mixed templates

PHP islands inside a class attribute are treated as opaque atoms that never move. Static text between islands is sorted
independently — the same model the official plugin uses for `${}` interpolations in template literals.

<details>
<summary>Glued-fragment pinning, whitespace handling, and the full edge-case list — click to expand</summary>

```php
<!-- before -->
<h2 class="text-2xl font-bold <?= $featured ? 'text-amber-600' : '' ?> tracking-tight leading-snug">

<!-- after -->
<h2 class="font-bold text-2xl <?= $featured ? 'text-amber-600' : '' ?> leading-snug tracking-tight">
```

Tokens **glued** to an island with no whitespace are fragments of a dynamically built class name. They are pinned in
place and excluded from sorting, and whitespace adjacent to islands is never added or removed:

```php
<div class="z-10 flex btn-<?= $variant ?>">   <!-- btn- stays last -->
<div class="btn<?= $mod ?>">                  <!-- untouched -->
```

Also handled correctly:

- `?>` inside PHP strings / heredocs / nowdocs / block comments (island continues)
- `?>` inside `//` and `#` line comments (island ends — genuine PHP behavior)
- `#[Attributes]`, `<?PHP` case-insensitivity, `<?xml` exclusion, files ending in PHP mode
- PHP islands as standalone attributes: `<div <?php post_class(); ?> class="...">`
- `<script>`/`<style>` content, HTML comments, and `echo '<div class="...">'` strings are left alone (to sort class
  strings declared in PHP, see [Sorting classes in PHP declarations](#sorting-classes-in-php-declarations))

</details>

## Programmatic API

The core is dependency-free and accepts any sort function, so you can use it without the official sorter (e.g., in
tests):

```ts
import { transform, createTailwindSortFn } from '@runtimestudio/tailwind-sort-php';

const sortFn = await createTailwindSortFn({ stylesheet: './resources/css/main.css' });
const out = transform(source, sortFn);
```

## Known limitations

<details>
<summary>Edge cases and unsupported syntax — click to expand</summary>

- Complex string interpolation containing double quotes (`"{$arr["key"]}"`) can desync the PHP string lexer in rare
  cases. Use `{$arr['key']}` style or extract to a variable.
- Unquoted attribute values (`class=foo`) are skipped.
- Alpine `:class` / object syntax is not parsed (skipped unless added via `--attr`, which treats the value as plain
  classes).
- Whitespace inside multi-line class attributes is normalized to single spaces (matches Prettier behavior).

</details>

## Development

```sh
bun test      # or: node --test "test/*.test.ts"
bun run build # compile src → dist (tsc); the published artifact
```

74 tests: 59 core tests that are dependency-free (the sorter is injected, so they run against a mock `SortFn`),
7 integration tests that exercise the real `prettier-plugin-tailwindcss` sorter and skip automatically when the
Tailwind toolchain isn't installed, and 8 `init` tests that run against throwaway git repositories and skip when
`git` is unavailable.

## License

[MIT](LICENSE) © Runtime Studio
