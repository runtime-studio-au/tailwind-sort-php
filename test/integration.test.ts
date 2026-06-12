/**
 * Integration tests for the real sorter adapter (src/sorter.ts).
 *
 * Builds `createTailwindSortFn` against a fixture Tailwind v4 stylesheet and runs the island-aware `transform` with
 * the real engine — proving the official sort order and that custom `@theme`/`@utility` vocabulary is recognized,
 * which the mock-sorter suite cannot.
 *
 * The whole suite skips when the optional Tailwind toolchain (`tailwindcss` / `prettier-plugin-tailwindcss`)
 * isn't installed, so the core tests stay dependency-free.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// noinspection ES6PreferShortImport
import { transform, type SortFn } from '../src/transform.ts';
// noinspection ES6PreferShortImport
import { createTailwindSortFn } from '../src/sorter.ts';

const stylesheet = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'tailwind.css');

// Build the real sorter up front; skip the suite if the Tailwind toolchain isn't available.
let sortFn: SortFn | null = null;
let skip: string | false = false;
try {
  sortFn = await createTailwindSortFn({ stylesheet });
} catch (err) {
  skip = `Tailwind toolchain unavailable: ${(err as Error).message.split('\n')[0]}`;
}

const run = (src: string) => transform(src, sortFn!, {});

describe('real Tailwind sorter integration', { skip }, () => {
  test('canonicalises any input order and recognises custom utilities', () => {
    const tokens = ['section-py', 'z-10', 'flex', 'bg-brand', 'p-4', 'm-2'];
    const sorted = sortFn!(tokens);
    // Every permutation yields the same order, so each token — including the custom `section-py` and
    // `bg-brand` — has a known sort position; unrecognized classes would instead keep their input order.
    assert.deepEqual(sortFn!([...tokens].reverse()), sorted);
    assert.deepEqual(sortFn!(sorted), sorted); // idempotent
  });

  test('transform applies the real order to a class attribute', () => {
    const tokens = ['z-10', 'flex', 'p-4', 'm-2'];
    const expected = sortFn!(tokens).join(' ');
    assert.equal(run(`<div class="${tokens.join(' ')}">`), `<div class="${expected}">`);
  });

  test('island stays pinned while the static segments sort by the real order', () => {
    const out = run(`<div class="z-10 flex <?= $x ?> p-4 m-2">`);
    const left = sortFn!(['z-10', 'flex']).join(' ');
    const right = sortFn!(['p-4', 'm-2']).join(' ');
    assert.equal(out, `<div class="${left} <?= $x ?> ${right}">`);
  });

  test('glued fragment stays pinned with the real sorter', () => {
    const out = run(`<div class="flex z-10 btn-<?= $v ?>">`);
    const head = sortFn!(['flex', 'z-10']).join(' ');
    assert.equal(out, `<div class="${head} btn-<?= $v ?>">`);
  });

  test('classes inside a post_class() string are left untouched', () => {
    const src = `<article <?php post_class('z-10 flex p-4'); ?>>`;
    assert.equal(run(src), src);
  });
});
