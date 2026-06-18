/**
 * Tests for the PHP string-declaration sorter.
 *
 * Uses a mock alphabetical sorter; the real Tailwind order is covered by the integration suite.
 * Exercises the array key/value rule, scalar/property/variable declarations, nested and list-style arrays,
 * non-string elements, the off-by-default guarantee, concat/interpolation skipping, and idempotency.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// noinspection ES6PreferShortImport
import { transform } from '../src/transform.ts';

const alpha = (classes: string[]) => [...classes].sort();

// PHP-string sorting is opt-in per file.
const run = (src: string) => transform(src, alpha, { sortPhpStrings: true });
const runOff = (src: string) => transform(src, alpha, {});

test('1. anchor: array values sorted, keys byte-identical', () => {
  const src = [
    `<?php`,
    `return array(`,
    `    'primary'   => 'text-white px-4 bg-blue-600 rounded py-2',`,
    `    'secondary' => 'text-gray-900 px-4 bg-gray-100 rounded py-2',`,
    `    'wide'      => 'text-white px-4 bg-blue-600 rounded w-[200px]',`,
    `);`,
  ].join('\n');
  // Keys (and their alignment) untouched; only the values are reordered alphabetically (mock).
  const expected = [
    `<?php`,
    `return array(`,
    `    'primary'   => 'bg-blue-600 px-4 py-2 rounded text-white',`,
    `    'secondary' => 'bg-gray-100 px-4 py-2 rounded text-gray-900',`,
    `    'wide'      => 'bg-blue-600 px-4 rounded text-white w-[200px]',`,
    `);`,
  ].join('\n');
  assert.equal(run(src), expected);
});

test('2. scalar const string value sorted', () => {
  assert.equal(
    run(`<?php const CARD = 'rounded border bg-white p-4';`),
    `<?php const CARD = 'bg-white border p-4 rounded';`,
  );
});

test('3. static / property / plain variable assignment sorted', () => {
  assert.equal(run(`<?php static $x = 'z-10 flex';`), `<?php static $x = 'flex z-10';`);
  assert.equal(run(`<?php private string $btn = 'z-10 flex';`), `<?php private string $btn = 'flex z-10';`);
  assert.equal(run(`<?php $x = 'z-10 flex';`), `<?php $x = 'flex z-10';`);
});

test('4. nested array — values at all depths sorted, keys untouched', () => {
  const src = `<?php $x = array('outer' => array('inner' => 'z-10 flex p-4'));`;
  assert.equal(run(src), `<?php $x = array('outer' => array('inner' => 'flex p-4 z-10'));`);
});

test('5. non-string array elements skipped without error', () => {
  const src = `<?php $x = array('z-10 flex', 42, true, null, FOO_CONST);`;
  assert.equal(run(src), `<?php $x = array('flex z-10', 42, true, null, FOO_CONST);`);
});

test('6. list-style array (no =>) values sorted', () => {
  assert.equal(run(`<?php $x = ['z-10 flex', 'b a'];`), `<?php $x = ['flex z-10', 'a b'];`);
});

test('7. file NOT opted in → byte-identical (off-by-default guarantee)', () => {
  const src = `<?php const CARD = 'rounded border bg-white';`;
  assert.equal(runOff(src), src);
});

test('8. double-quoted value with no interpolation is sorted', () => {
  assert.equal(run(`<?php $x = "z-10 flex p-4";`), `<?php $x = "flex p-4 z-10";`);
});

test('9. concatenated string literal → skipped, byte-identical', () => {
  const a = `<?php $x = 'btn-' . $variant;`;
  assert.equal(run(a), a);
  const b = `<?php $x = $prefix . 'z-10 flex';`;
  assert.equal(run(b), b);
  const c = `<?php const X = 'z-10 flex ' . OTHER;`;
  assert.equal(run(c), c);
});

test('10. interpolated double-quoted string → skipped, byte-identical', () => {
  const a = `<?php $x = "p-4 {$dynamic} flex";`;
  assert.equal(run(a), a);
  const b = `<?php $x = "p-4 $dynamic flex";`;
  assert.equal(run(b), b);
});

test('11. string with a backslash escape → skipped, byte-identical', () => {
  const src = `<?php $x = 'content-[\\'x\\'] flex';`;
  assert.equal(run(src), src);
});

test('12. already-sorted value → no change', () => {
  const src = `<?php const X = 'flex z-10';`;
  assert.equal(run(src), src);
});

test('13. single-class value left byte-identical', () => {
  const src = `<?php const CARD = 'rounded';`;
  assert.equal(run(src), src);
});

test('14. heredoc / nowdoc content is never harvested', () => {
  const src = `<?php $x = <<<EOT\nz-10 flex p-4\nEOT;\n`;
  assert.equal(run(src), src);
});

test('15. mixed file: HTML class attrs AND PHP declarations both sorted', () => {
  const src = `<?php const CARD = 'z-10 flex'; ?><div class="b a">`;
  assert.equal(run(src), `<?php const CARD = 'flex z-10'; ?><div class="a b">`);
});

test('16. safety contract: an opted-in file sorts EVERY string value, even non-class ones', () => {
  // The tool does not judge whether a string "looks like" classes; safety comes from the dev only pointing
  // `tailwindPhpSources` at class-string holder files. With the flag ON, this non-class echo string IS reordered.
  const src = `<?php echo '<div class="z a">'; ?>`;
  assert.equal(run(src), `<?php echo '<div a"> class="z'; ?>`);
  // With the flag OFF (default), the same string is byte-identical — the off-by-default guarantee.
  assert.equal(runOff(src), src);
});

test('17. idempotent: running twice changes nothing', () => {
  const src = [
    `<?php`,
    `return array(`,
    `    'primary'   => 'rounded bg-blue-600 px-4',`,
    `    'secondary' => 'rounded bg-gray-100 px-4',`,
    `);`,
  ].join('\n');
  const once = run(src);
  assert.equal(run(once), once);
});

test('18. const value that is an array key elsewhere is still position-classified', () => {
  // A string used as a key (`'a b' => ...`) is never sorted even though it contains spaces.
  const src = `<?php $x = array('z a' => 'd c');`;
  assert.equal(run(src), `<?php $x = array('z a' => 'c d');`);
});
