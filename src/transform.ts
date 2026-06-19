/**
 * Core transform: given template source and a sort function,
 * rewrite all class attribute values with sorted Tailwind classes.
 *
 * Island-aware rules inside an attribute value:
 *   - PHP islands are opaque atoms that never move.
 *   - Static text is split into runs between islands; each run's classes are sorted independently
 *     (mirrors how the official Prettier plugin treats `${}` interpolations in template literals).
 *   - A token with no whitespace between it and an adjacent island is a *fragment* of a dynamically
 *     built class (`btn-<?= $v ?>`); it is pinned in place and excluded from sorting.
 *   - Whitespace adjacent to islands is preserved as a single space — never removed
 *     (removal would concatenate classes at render time) and never invented
 *     (insertion would split an intentional fragment).
 *
 * @see islands.ts - pass 1 (PHP island detection).
 * @see html.ts    - pass 2 (attribute location).
 * @see sorter.ts  - adapter producing the injected `SortFn`.
 */

import { findIslands, type Island, type IslandOptions } from './islands.ts';
import { maskIslands, findClassAttributes, type HtmlScanOptions } from './html.ts';
import { findSortablePhpStrings } from './php-strings.ts';

/**
 * Sorting strategy injected by the caller. Receives the class tokens of a single static run;
 * returns them in sorted order. Must be pure and synchronous; must not add or remove tokens.
 */
export type SortFn = (classes: string[]) => string[];

/**
 * Combined options for all lexer passes.
 */
export interface TransformOptions extends IslandOptions, HtmlScanOptions {
    /**
     * Sort classes in PHP string-literal values too. Off by default; see `php-strings.ts` for eligibility.
     */
    sortPhpStrings?: boolean;
}

/**
 * Rewrite all class attribute values in the template source with sorted classes.
 * Everything outside class attribute values is byte-identical in the result; the function is idempotent.
 *
 * @param src    Raw template source (mixed PHP/HTML).
 * @param sortFn Injected sorting strategy (see `createTailwindSortFn()`).
 * @param opts   Lexer options.
 * @returns The rewritten source.
 *
 * @example
 * transform('<div class="z-10 mt-4 <?= $x ?> b a">', sortFn);
 * // '<div class="mt-4 z-10 <?= $x ?> a b">'
 */
export function transform(src: string, sortFn: SortFn, opts: TransformOptions = {}): string {
    const islands = findIslands(src, opts);
    const masked = maskIslands(src, islands);
    const attrs = findClassAttributes(masked, opts);

    // Collect every edit as a {start, end, text} range, then apply them back-to-front so offsets stay valid.
    // HTML class-attribute values live outside islands; PHP string values live inside them, so the two sets of
    // ranges never overlap.
    const edits: { start: number; end: number; text: string }[] = [];

    for (const { valueStart, valueEnd } of attrs) {
        const original = src.slice(valueStart, valueEnd);
        const inner = islands.filter((isl) => isl.start >= valueStart && isl.end <= valueEnd);
        const rewritten = rewriteValue(original, valueStart, inner, sortFn);
        if (rewritten !== original) edits.push({ start: valueStart, end: valueEnd, text: rewritten });
    }

    if (opts.sortPhpStrings) {
        for (const { start, end } of findSortablePhpStrings(src, islands)) {
            const original = src.slice(start, end);
            const tokens = original.split(/\s+/).filter(Boolean);
            if (tokens.length < 2) continue; // nothing to reorder; leave byte-identical
            const rewritten = sortFn(tokens).join(' ');
            if (rewritten !== original) edits.push({ start, end, text: rewritten });
        }
    }

    edits.sort((a, b) => b.start - a.start);
    let out = src;
    for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
    return out;
}

interface Part {
    type: 'static' | 'island';
    text: string;
}

function rewriteValue(value: string, base: number, islands: Island[], sortFn: SortFn): string {
    // Build alternating static/island parts.
    const parts: Part[] = [];
    let pos = 0;
    for (const isl of islands) {
        const s = isl.start - base;
        const e = isl.end - base;
        parts.push({ type: 'static', text: value.slice(pos, s) });
        parts.push({ type: 'island', text: value.slice(s, e) });
        pos = e;
    }
    parts.push({ type: 'static', text: value.slice(pos) });

    let out = '';
    for (let p = 0; p < parts.length; p++) {
        const part = parts[p];
        if (part.type === 'island') {
            out += part.text;
            continue;
        }

        const prevIsIsland = p > 0;
        const nextIsIsland = p < parts.length - 1;
        const t = part.text;

        const hasLeadingWs = /^\s/.test(t);
        const hasTrailingWs = /\s$/.test(t);
        const tokens = t.split(/\s+/).filter(Boolean);

        // Whitespace-only run between islands → preserve a single space.
        if (tokens.length === 0) {
            if (t.length > 0 && prevIsIsland && nextIsIsland) out += ' ';
            continue;
        }

        const pinStart = prevIsIsland && !hasLeadingWs;
        const pinEnd = nextIsIsland && !hasTrailingWs;

        let head: string[] = [];
        let tail: string[] = [];
        let middle: string[];

        if (pinStart && pinEnd && tokens.length === 1) {
            // Single fragment glued to islands on both sides.
            middle = [];
            head = [tokens[0]];
        } else {
            const from = pinStart ? 1 : 0;
            const to = pinEnd ? tokens.length - 1 : tokens.length;
            if (pinStart) head = [tokens[0]];
            if (pinEnd) tail = [tokens[tokens.length - 1]];
            middle = tokens.slice(from, to);
        }

        const sorted = middle.length > 1 ? sortFn(middle) : middle;
        const joined = [...head, ...sorted, ...tail].join(' ');

        const prefix = prevIsIsland && hasLeadingWs ? ' ' : '';
        const suffix = nextIsIsland && hasTrailingWs ? ' ' : '';
        out += prefix + joined + suffix;
    }

    return out;
}
