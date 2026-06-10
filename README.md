# @runtimestudio/tailwind-sort-php

Tailwind CSS class sorting for **mixed PHP/HTML templates** — the WordPress template-partial case that
`@prettier/plugin-php` + `prettier-plugin-tailwindcss` can't handle.

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

## Requirements

- **Bun**, or **Node ≥ 22.18** (native TypeScript type-stripping) — both run the CLI and the programmatic API.
- `prettier` ≥ 3 and `prettier-plugin-tailwindcss` ≥ 0.8 (peer dependencies).

## Install

```sh
bun add -D @runtimestudio/tailwind-sort-php prettier prettier-plugin-tailwindcss
```

## Setup

Point Prettier at your Tailwind v4 entry stylesheet so both `prettier-plugin-tailwindcss` and this tool share one
vocabulary. In `prettier.config.mjs`:

```js
export default {
  plugins: ['prettier-plugin-tailwindcss'],
  tailwindStylesheet: './resources/css/main.css',
};
```

`tailwindStylesheet` is resolved relative to the config file, so the path matches what the official plugin uses. With
this in place, the CLI needs no flags.

## Usage

```sh
# sort every .php file under the cwd (stylesheet read from your Prettier config)
bunx tailwind-sort-php

# specific globs
bunx tailwind-sort-php "template-parts/**/*.php" "*.php"

# CI / pre-commit — write nothing, exit 1 if anything is unsorted
bunx tailwind-sort-php --check

# explicit stylesheet (overrides the Prettier config)
bunx tailwind-sort-php --stylesheet ./resources/css/main.css
```

### Options

| Flag                  | Description                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| `--stylesheet <path>` | Tailwind v4 CSS entry. Defaults to `tailwindStylesheet` from your Prettier config.                |
| `--attr <name>`       | Extra attribute to sort (repeatable). Merged with `tailwindAttributes` from your Prettier config. |
| `--check`             | Don't write; exit 1 if any file needs sorting.                                                    |
| `--no-short-tags`     | Don't treat bare `<?` as a PHP open tag.                                                          |

Default globs are all `.php` files under the cwd; `node_modules`, `vendor`, `dist`, and `.git` are always skipped.

## How it handles mixed templates

PHP islands inside a class attribute are treated as opaque atoms that never move. Static text between islands is sorted
independently — the same model the official plugin uses for `${}` interpolations in template literals.

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
- `<script>`/`<style>` content, HTML comments, and `echo '<div class="...">'` strings are left alone (sorting
  `class="..."` inside PHP string literals could be added later as an opt-in)

## Programmatic API

The core is dependency-free and accepts any sort function, so you can use it without the official sorter (e.g., in
tests):

```ts
import { transform, createTailwindSortFn } from '@runtimestudio/tailwind-sort-php';

const sortFn = await createTailwindSortFn({ stylesheet: './resources/css/main.css' });
const out = transform(source, sortFn);
```

## Known limitations

- Complex string interpolation containing double quotes (`"{$arr["key"]}"`) can desync the PHP string lexer in rare
  cases. Use `{$arr['key']}` style or extract to a variable.
- Unquoted attribute values (`class=foo`) are skipped.
- Alpine `:class` / object syntax is not parsed (skipped unless added via `--attr`, which treats the value as plain
  classes).
- Whitespace inside multi-line class attributes is normalized to single spaces (matches Prettier behavior).

## Development

```sh
bun test                       # or: node --test "test/*.test.ts"
```

41 tests, zero dependencies — the sorter is injected (`SortFn`), so tests run with a mock alphabetical sorter and the
official sorter is only loaded by the CLI.

## License

MIT © Runtime Studio
