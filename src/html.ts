/**
 * HTML attribute scanner — the second pass of the two-pass lexer.
 *
 * Operates on a "masked" copy of the source in which every PHP island byte has been replaced with `\x00`
 * (offsets preserved). This means:
 *   - quotes/angle brackets inside PHP can never confuse the HTML scan
 *   - islands inside a tag read as attribute separators
 *   - islands inside a quoted attribute value read as opaque atoms
 *
 * Skips HTML comments, doctype/CDATA, and the raw-text content of `script`/`style`/`textarea`/`title` elements —
 * their content may contain strings like `class="..."` that must not be touched.
 *
 * @see islands.ts - first pass; produces the islands consumed here.
 */

import type { Island } from './islands.ts';

/**
 * Location of a sortable class attribute value within the source.
 */
export interface ClassAttr {
    /**
     * Attribute name as written (e.g. `class`, `className`).
     */
    name: string;
    /**
     * Offset of the first character inside the quotes.
     */
    valueStart: number;
    /**
     * Offset just past the last character inside the quotes (exclusive).
     */
    valueEnd: number;
}

/**
 * Options controlling which attributes are collected.
 */
export interface HtmlScanOptions {
    /**
     * Lowercase attribute names to collect; default `['class', 'classname']`.
     */
    attributes?: string[];
}

const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'title']);
const NUL = '\x00';

/**
 * Produce a copy of the source with every island byte replaced by `\x00`.
 *
 * Length and offsets are preserved, so positions found in the masked string map 1:1 back to the original source.
 *
 * @param src     Original template source.
 * @param islands Island ranges from `findIslands()`.
 * @returns Masked source of identical length.
 */
export function maskIslands(src: string, islands: Island[]): string {
    if (islands.length === 0) return src;
    let out = '';
    let pos = 0;
    for (const isl of islands) {
        out += src.slice(pos, isl.start);
        out += NUL.repeat(isl.end - isl.start);
        pos = isl.end;
    }
    out += src.slice(pos);
    return out;
}

/**
 * Locate every sortable class attribute in an island-masked source.
 *
 * @param masked Source pre-processed by `maskIslands()`.
 * @param opts   Attribute collection options.
 * @returns Attribute value locations in document order. Offsets index into the original source.
 */
export function findClassAttributes(masked: string, opts: HtmlScanOptions = {}): ClassAttr[] {
    const wanted = new Set((opts.attributes ?? ['class', 'classname']).map((a) => a.toLowerCase()));
    const out: ClassAttr[] = [];
    const len = masked.length;
    let i = 0;

    while (i < len) {
        const lt = masked.indexOf('<', i);
        if (lt === -1) break;

        // HTML comment.
        if (masked.startsWith('<!--', lt)) {
            const close = masked.indexOf('-->', lt + 4);
            i = close === -1 ? len : close + 3;
            continue;
        }

        // Doctype / CDATA / other declarations.
        if (masked[lt + 1] === '!') {
            const close = masked.indexOf('>', lt + 2);
            i = close === -1 ? len : close + 1;
            continue;
        }

        // Closing tag.
        if (masked[lt + 1] === '/') {
            const close = masked.indexOf('>', lt + 2);
            i = close === -1 ? len : close + 1;
            continue;
        }

        // Opening tag?
        if (lt + 1 < len && /[A-Za-z]/.test(masked[lt + 1])) {
            let j = lt + 1;
            while (j < len && /[A-Za-z0-9:-]/.test(masked[j])) j++;
            const tagName = masked.slice(lt + 1, j).toLowerCase();

            j = scanTagAttributes(masked, j, wanted, out);

            // Skip raw-text element content up to its closing tag.
            if (RAW_TEXT_TAGS.has(tagName)) {
                const closer = `</${tagName}`;
                const idx = masked.toLowerCase().indexOf(closer, j);
                j = idx === -1 ? len : idx;
            }
            i = j;
            continue;
        }

        i = lt + 1;
    }

    return out;
}

const isTagWs = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === NUL;

/**
 * Parse attributes from just past the tag name to just past `>`.
 * Returns the offset after `>` (or EOF). Pushes matches into `out`.
 */
function scanTagAttributes(masked: string, i: number, wanted: Set<string>, out: ClassAttr[]): number {
    const len = masked.length;

    while (i < len) {
        while (i < len && isTagWs(masked[i])) i++;
        if (i >= len) return len;

        const c = masked[i];
        if (c === '>') return i + 1;
        if (c === '/') {
            i++;
            continue;
        }

        // Attribute name.
        const nameStart = i;
        while (i < len && !isTagWs(masked[i]) && masked[i] !== '=' && masked[i] !== '>' && masked[i] !== '/') i++;
        const name = masked.slice(nameStart, i);
        if (name.length === 0) {
            i++;
            continue;
        }

        while (i < len && isTagWs(masked[i])) i++;
        if (masked[i] !== '=') continue; // boolean attribute

        i++;
        while (i < len && isTagWs(masked[i])) i++;

        const q = masked[i];
        if (q === '"' || q === "'") {
            const valueStart = i + 1;
            const close = masked.indexOf(q, valueStart);
            const valueEnd = close === -1 ? len : close;
            if (wanted.has(name.toLowerCase())) {
                out.push({ name, valueStart, valueEnd });
            }
            i = valueEnd + 1;
        } else {
            // Unquoted value — read it but never rewrite (too risky to widen).
            while (i < len && !isTagWs(masked[i]) && masked[i] !== '>') i++;
        }
    }

    return len;
}
