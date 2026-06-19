/**
 * Tests for the core transform (`src/transform.ts`).
 *
 * Exercises class-attribute rewriting with a mock alphabetical sorter: quote styles and multiline normalization,
 * island handling (segments sorted independently, glued fragments pinned, no whitespace invented), untouched zones
 * (PHP echo strings, script and style content, HTML comments), custom attribute lists and idempotency.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// noinspection ES6PreferShortImport
import { transform } from '../src/transform.ts';

// Mock sorter: plain alphabetical. The real sorter is injected at runtime;
// the core only cares that *some* deterministic ordering is applied.
const alpha = (classes: string[]) => [...classes].sort();

const run = (src: string, opts?: any) => transform(src, alpha, opts);

test('sorts a simple class attribute', () => {
    assert.equal(run(`<div class="z-10 bg-red-500 mt-4">`), `<div class="bg-red-500 mt-4 z-10">`);
});

test('single-quoted attribute', () => {
    assert.equal(run(`<div class='b a'>`), `<div class='a b'>`);
});

test('className attribute', () => {
    assert.equal(run(`<div className="b a">`), `<div className="a b">`);
});

test('multiline value is normalized to single spaces', () => {
    assert.equal(run(`<div class="b\n   a\n  c">`), `<div class="a b c">`);
});

test('single class left untouched', () => {
    const src = `<div class="only">`;
    assert.equal(run(src), src);
});

test('island in the middle: segments sort independently, spaces kept', () => {
    assert.equal(run(`<div class="z a <?php echo $x; ?> d c">`), `<div class="a z <?php echo $x; ?> c d">`);
});

test('attached fragment after sorted run is pinned (trailing)', () => {
    assert.equal(run(`<div class="z a btn-<?= $variant ?>">`), `<div class="a z btn-<?= $variant ?>">`);
});

test('attached fragment before run is pinned (leading)', () => {
    assert.equal(run(`<div class="<?= $v ?>-suffix z a">`), `<div class="<?= $v ?>-suffix a z">`);
});

test('fragment glued on both sides stays intact', () => {
    const src = `<div class="pre-<?= $v ?>-post">`;
    assert.equal(run(src), src);
});

test('no space invented around glued islands', () => {
    const src = `<div class="btn<?= $mod ?>">`;
    assert.equal(run(src), src);
});

test('whitespace-only run between islands preserved as one space', () => {
    assert.equal(run(`<div class="<?= $a ?>   <?= $b ?>">`), `<div class="<?= $a ?> <?= $b ?>">`);
});

test('attribute value that is only an island', () => {
    const src = `<div class="<?php echo esc_attr($classes); ?>">`;
    assert.equal(run(src), src);
});

test('quotes inside island do not break attribute detection', () => {
    assert.equal(
        run(`<div class="z a <?php echo $cond ? 'x' : "y"; ?> c b">`),
        `<div class="a z <?php echo $cond ? 'x' : "y"; ?> b c">`,
    );
});

test('island containing ?> in a string, inside an attribute', () => {
    assert.equal(run(`<div class="b a <?= $x ? '?>' : '' ?>">`), `<div class="a b <?= $x ? '?>' : '' ?>">`);
});

test('class attribute echoed entirely from PHP is not touched', () => {
    const src = `<?php echo '<div class="z a">'; ?>`;
    assert.equal(run(src), src);
});

test('script content is not touched', () => {
    const src = `<script>const h = '<div class="z a">';</script><div class="b a">`;
    assert.equal(run(src), `<script>const h = '<div class="z a">';</script><div class="a b">`);
});

test('style content is not touched', () => {
    const src = `<style>/* class="z a" */</style><p class="b a">`;
    assert.equal(run(src), `<style>/* class="z a" */</style><p class="a b">`);
});

test('HTML comments are not touched', () => {
    const src = `<!-- <div class="z a"> --><div class="b a">`;
    assert.equal(run(src), `<!-- <div class="z a"> --><div class="a b">`);
});

test("script tag's own attributes ARE processed", () => {
    assert.equal(run(`<script class="z a" src="x.js"></script>`), `<script class="a z" src="x.js"></script>`);
});

test('island as a standalone attribute inside a tag', () => {
    assert.equal(
        run(`<div <?php language_attributes(); ?> class="z a">`),
        `<div <?php language_attributes(); ?> class="a z">`,
    );
});

test('non-class attributes untouched', () => {
    const src = `<div data-classes="z a" title="b a">`;
    assert.equal(run(src), src);
});

test('custom attribute list', () => {
    assert.equal(run(`<div x-class="b a">`, { attributes: ['class', 'x-class'] }), `<div x-class="a b">`);
});

test('unquoted attribute values are skipped', () => {
    const src = `<div class=b-a>`;
    assert.equal(run(src), src);
});

test('realistic WordPress partial', () => {
    const src = [
        `<?php /** Template part ?> tricky */ ?>`,
        `<article id="post-<?php the_ID(); ?>" <?php post_class('z-10 flex'); ?>>`,
        `  <header class="mb-8 flex items-center gap-4 border-b">`,
        `    <h2 class="text-2xl font-bold <?= $featured ? 'text-amber-600' : 'text-gray-900' ?> tracking-tight leading-snug">`,
        `      <a href="<?php the_permalink(); ?>" class="hover:underline focus:outline-none">`,
        `    </h2>`,
        `  </header>`,
        `</article>`,
    ].join('\n');
    const out = run(src);
    // Mock sorts alphabetically; check a couple of lines.
    assert.match(out, /class="border-b flex gap-4 items-center mb-8"/);
    assert.match(
        out,
        /class="font-bold text-2xl <\?= \$featured \? 'text-amber-600' : 'text-gray-900' \?> leading-snug tracking-tight"/,
    );
    assert.match(out, /class="focus:outline-none hover:underline"/);
});

test('idempotent: running twice changes nothing', () => {
    const src = `<div class="z a <?= $x ?> d c">`;
    const once = run(src);
    assert.equal(run(once), once);
});
