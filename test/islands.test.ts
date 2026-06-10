/**
 * Tests for the PHP island lexer (`src/islands.ts`).
 *
 * Verifies island boundary detection across short tags and the `<?xml` exclusion, closing `?>`
 * sequences inside strings, heredocs/nowdocs and comments (block vs. line), `#[Attributes]`,
 * case-insensitive open tags, multiple islands and files that end in PHP mode.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// noinspection ES6PreferShortImport
import { findIslands } from '../src/islands.ts';

const spans = (src: string, opts?: any) => findIslands(src, opts).map((i) => src.slice(i.start, i.end));

test('basic <?php ?> island', () => {
  assert.deepEqual(spans(`a <?php echo 1; ?> b`), [`<?php echo 1; ?>`]);
});

test('echo tag <?= ?>', () => {
  assert.deepEqual(spans(`<p><?= $x ?></p>`), [`<?= $x ?>`]);
});

test('short open tag enabled by default, <?xml excluded', () => {
  assert.deepEqual(spans(`<? echo 1; ?><?xml version="1.0"?>`), [`<? echo 1; ?>`]);
});

test('short tags can be disabled', () => {
  assert.deepEqual(spans(`<? echo 1; ?>`, { shortOpenTags: false }), []);
});

test('?> inside single-quoted string does not close island', () => {
  assert.deepEqual(spans(`<?php echo 'a ?> b'; ?>x`), [`<?php echo 'a ?> b'; ?>`]);
});

test('?> inside double-quoted string does not close island', () => {
  assert.deepEqual(spans(`<?php echo "a ?> b"; ?>x`), [`<?php echo "a ?> b"; ?>`]);
});

test('escaped quote inside string', () => {
  assert.deepEqual(spans(`<?php echo 'it\\'s ?>'; ?>x`), [`<?php echo 'it\\'s ?>'; ?>`]);
});

test('?> inside block comment does not close island', () => {
  assert.deepEqual(spans(`<?php /* ?> */ echo 1; ?>x`), [`<?php /* ?> */ echo 1; ?>`]);
});

test('?> inside // line comment DOES close island (PHP quirk)', () => {
  assert.deepEqual(spans(`<?php // close ?> after`), [`<?php // close ?>`]);
});

test('?> inside # line comment DOES close island', () => {
  assert.deepEqual(spans(`<?php # close ?> after`), [`<?php # close ?>`]);
});

test('#[Attribute] is not treated as a comment', () => {
  const src = `<?php #[Foo('?>')] class A {} ?>x`;
  assert.deepEqual(spans(src), [`<?php #[Foo('?>')] class A {} ?>`]);
});

test('?> inside heredoc does not close island', () => {
  const src = `<?php $s = <<<EOT\nhello ?> world\nEOT;\necho $s; ?>x`;
  assert.deepEqual(spans(src), [src.slice(0, src.length - 1)]);
});

test('?> inside nowdoc does not close island', () => {
  const src = `<?php $s = <<<'EOT'\n?>\nEOT;\n?>x`;
  assert.deepEqual(spans(src), [src.slice(0, src.length - 1)]);
});

test('file ending in PHP mode (no closing tag)', () => {
  const src = `<div></div>\n<?php\nfunction f() { return 1; }\n`;
  const isl = findIslands(src);
  assert.equal(isl.length, 1);
  assert.equal(isl[0].end, src.length);
});

test('multiple islands', () => {
  const src = `<?php a(); ?> mid <?= $b ?> end`;
  assert.deepEqual(spans(src), [`<?php a(); ?>`, `<?= $b ?>`]);
});

test('case-insensitive open tag', () => {
  assert.deepEqual(spans(`<?PHP echo 1; ?>`), [`<?PHP echo 1; ?>`]);
});
