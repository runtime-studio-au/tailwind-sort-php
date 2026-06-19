/**
 * PHP string-literal harvester — the optional third pass.
 *
 * Given the source and the PHP islands already found by `findIslands()`, this locates the byte ranges of every
 * string literal *value* inside PHP code that is eligible for class sorting, applying these structural rules:
 *
 *   - Only the *value* of a `key => value` pair is eligible; array keys are never sorted.
 *   - Bare list-style elements (`['a', 'b']`) and scalar assignments (`const X = '...'`) are values.
 *   - Strings that are part of a concatenation expression (`'btn-' . $v`) are skipped — a literal joined to dynamic
 *     code may be a partial class fragment, and reordering it would corrupt the rendered string.
 *   - Double-quoted strings containing interpolation (`"p-4 {$x}"`) are skipped, mirroring the HTML side's
 *     conservatism around dynamic content.
 *   - Strings whose body contains a backslash escape are skipped, so escape sequences can never be mangled.
 *   - Heredoc/nowdoc and backtick (shell-exec) strings are never harvested.
 *
 * This pass is opt-in per file (the caller decides which files are class-string holders); it does NOT judge whether
 * a given string "looks like" Tailwind classes — within a matched file, every eligible value is sorted.
 *
 * @see islands.ts   - first pass; produces the islands consumed here.
 * @see transform.ts - splices the sorted strings back via the shared byte-replacement path.
 */

import type { Island } from './islands.ts';

/**
 * Inner byte range of a sortable string literal — the span *between* the quotes, in original-source offsets.
 */
export interface PhpStringRange {
    /**
     * Offset of the first character inside the quotes.
     */
    start: number;
    /**
     * Offset just past the last character inside the quotes (exclusive).
     */
    end: number;
}

const isIdentStart = (c: string) => /[A-Za-z_-￿]/.test(c);
const isIdent = (c: string) => /[A-Za-z0-9_-￿]/.test(c);

interface Token {
    kind: 'string' | 'arrow' | 'dot' | 'other';
    /**
     * For `string` tokens: inner range and whether it must be skipped.
     */
    start?: number;
    end?: number;
    skip?: boolean;
}

/**
 * Find every sortable string-literal value within the given PHP islands.
 *
 * @param src     Original template source.
 * @param islands Island ranges from `findIslands()`.
 * @returns Inner ranges of eligible string values, in document order.
 *
 * @example
 * const islands = findIslands(`<?php $x = 'z a'; ?>`);
 * findSortablePhpStrings(`<?php $x = 'z a'; ?>`, islands); // [{ start: 11, end: 14 }]
 */
export function findSortablePhpStrings(src: string, islands: Island[]): PhpStringRange[] {
    const ranges: PhpStringRange[] = [];
    for (const isl of islands) {
        const tokens = tokenizeIsland(src, isl.start, isl.end);
        for (let k = 0; k < tokens.length; k++) {
            const token = tokens[k];
            if (token.kind !== 'string' || token.skip) continue;

            const next = tokens[k + 1];
            const prev = tokens[k - 1];

            // Array key (`'left' => ...`) — never sorted.
            if (next && next.kind === 'arrow') continue;
            // Part of a concatenation expression (`'btn-' . $v` / `$v . 'suffix'`).
            if ((next && next.kind === 'dot') || (prev && prev.kind === 'dot')) continue;

            ranges.push({ start: token.start!, end: token.end! });
        }
    }
    return ranges;
}

/**
 * Tokenize one PHP island into the minimal token stream needed for value classification: string literals
 * (with their inner range and a skip flag), the `=>` arrow, the `.` concatenation operator, and a coalesced `other`
 * marker for everything else. Whitespace and comments are dropped so adjacency is judged across them.
 */
function tokenizeIsland(src: string, start: number, end: number): Token[] {
    const tokens: Token[] = [];
    const pushOther = () => {
        if (tokens.length === 0 || tokens[tokens.length - 1].kind !== 'other') tokens.push({ kind: 'other' });
    };

    let i = start;
    while (i < end) {
        const c = src[i];

        // Whitespace.
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v') {
            i++;
            continue;
        }

        // Line comments (`//`, `#`) — but `#[` opens a PHP 8 attribute, which is code.
        if (c === '/' && src[i + 1] === '/') {
            i = skipLineComment(src, i + 2, end);
            continue;
        }
        if (c === '#' && src[i + 1] !== '[') {
            i = skipLineComment(src, i + 1, end);
            continue;
        }

        // Block comment.
        if (c === '/' && src[i + 1] === '*') {
            const close = src.indexOf('*/', i + 2);
            i = close === -1 || close + 2 > end ? end : close + 2;
            continue;
        }

        // Heredoc / nowdoc — never harvested; skip the whole construct.
        if (c === '<' && src[i + 1] === '<' && src[i + 2] === '<') {
            const here = skipHeredoc(src, i + 3, end);
            if (here !== -1) {
                i = here;
                pushOther();
                continue;
            }
        }

        // Quoted strings.
        if (c === "'") {
            const close = scanQuoted(src, i + 1, "'", end);
            const inner = src.slice(i + 1, close);
            tokens.push({ kind: 'string', start: i + 1, end: close, skip: inner.includes('\\') });
            i = close + 1;
            continue;
        }
        if (c === '"') {
            const close = scanQuoted(src, i + 1, '"', end);
            const inner = src.slice(i + 1, close);
            // Skip interpolation (any unescaped `$`) and escapes.
            tokens.push({ kind: 'string', start: i + 1, end: close, skip: hasInterpolationOrEscape(inner) });
            i = close + 1;
            continue;
        }
        if (c === '`') {
            // Shell-exec string — never a class list.
            i = scanQuoted(src, i + 1, '`', end) + 1;
            pushOther();
            continue;
        }

        // Operators that matter for classification.
        if (c === '=' && src[i + 1] === '>') {
            tokens.push({ kind: 'arrow' });
            i += 2;
            continue;
        }
        if (c === '.') {
            tokens.push({ kind: 'dot' });
            i++;
            continue;
        }

        // Everything else (identifiers, punctuation, the `<?php`/`?>` tags themselves).
        pushOther();
        if (isIdentStart(c)) {
            i++;
            while (i < end && isIdent(src[i])) i++;
        } else {
            i++;
        }
    }

    return tokens;
}

/**
 * Scan a quoted string body; `i` is just past the open quote. Returns the offset of the closing quote (or `end`).
 */
function scanQuoted(src: string, i: number, quote: string, end: number): number {
    while (i < end) {
        const c = src[i];
        if (c === '\\') {
            i += 2;
            continue;
        }
        if (c === quote) return i;
        i++;
    }
    return end;
}

/**
 * Skip a `//`/`#` line comment body, ending at a newline or `?>`. Returns the offset to resume scanning from.
 */
function skipLineComment(src: string, i: number, end: number): number {
    while (i < end) {
        if (src[i] === '\n') return i + 1;
        if (src[i] === '?' && src[i + 1] === '>') return i;
        i++;
    }
    return end;
}

/**
 * True if a double-quoted body contains interpolation (an unescaped `$`) or any escape sequence.
 */
function hasInterpolationOrEscape(body: string): boolean {
    for (let i = 0; i < body.length; i++) {
        const c = body[i];
        if (c === '\\') return true;
        if (c === '$') return true;
    }
    return false;
}

/**
 * Skip a heredoc/nowdoc; `i` is just past `<<<`. Returns the offset past the closing identifier line,
 * or -1 if `<<<` isn't followed by a valid heredoc identifier. Mirrors the boundary rules of the island lexer.
 */
function skipHeredoc(src: string, i: number, end: number): number {
    while (i < end && (src[i] === ' ' || src[i] === '\t')) i++;

    let quote = '';
    if (src[i] === "'" || src[i] === '"') {
        quote = src[i];
        i++;
    }

    if (i >= end || !isIdentStart(src[i])) return -1;
    const idStart = i;
    while (i < end && isIdent(src[i])) i++;
    const id = src.slice(idStart, i);

    if (quote) {
        if (src[i] !== quote) return -1;
        i++;
    }

    while (i < end && src[i] === '\r') i++;
    if (src[i] !== '\n') return -1;
    i++;

    while (i < end) {
        let j = i;
        while (j < end && (src[j] === ' ' || src[j] === '\t')) j++;
        if (src.startsWith(id, j)) {
            const k = j + id.length;
            if (k >= end || !isIdent(src[k])) return k;
        }
        const nl = src.indexOf('\n', i);
        if (nl === -1 || nl >= end) return end;
        i = nl + 1;
    }
    return end;
}
