/**
 * PHP island detection.
 *
 * Scans the raw template source and returns the byte ranges of all PHP "islands"
 * (`<?php ... ?>`, `<?= ... ?>`, and optionally short `<? ... ?>`).
 *
 * The closing `?>` is found with a real PHP string/comment lexer, so a `?>` inside a string literal, heredoc/nowdoc,
 * or block comment does NOT close the island — whereas one inside a `//` or `#` line comment closes it (PHP quirk).
 *
 * @file First pass of the two-pass lexer.
 * @see html.ts - second pass; consumes islands via `maskIslands()`.
 */

/**
 * A contiguous region of PHP code within a mixed template source.
 */
export interface Island {
  /**
   * Inclusive start offset of `<?`.
   */
  start: number;
  /**
   * Exclusive end offset (just past `?>`, or EOF).
   */
  end: number;
}

/**
 * Options controlling PHP open-tag recognition.
 */
export interface IslandOptions {
  /**
   * Treat bare `<?` as a PHP open tag (short_open_tag).
   * Default true, with a guard so `<?xml` is never treated as PHP.
   */
  shortOpenTags?: boolean;
}

const isIdentStart = (c: string) => /[A-Za-z_\u0080-\uffff]/.test(c);
const isIdent = (c: string) => /[A-Za-z0-9_\u0080-\uffff]/.test(c);

/**
 * Find every PHP island in a mixed PHP/HTML template source.
 *
 * Islands are returned in document order and never overlap.
 * All offsets index into the original (unmodified) source string.
 *
 * @param src  Raw template source (mixed PHP/HTML).
 * @param opts Open-tag recognition options.
 * @returns Ordered, non-overlapping island ranges.
 *
 * @example
 * const islands = findIslands('<p><?= $x ?></p>');
 * // [{ start: 3, end: 12 }]
 */
export function findIslands(src: string, opts: IslandOptions = {}): Island[] {
  const shortTags = opts.shortOpenTags !== false;
  const islands: Island[] = [];
  const len = src.length;
  let i = 0;

  while (i < len) {
    const open = src.indexOf('<?', i);
    if (open === -1) break;

    // Classify the open tag.
    const after = src.slice(open + 2, open + 6).toLowerCase();
    let bodyStart: number;
    if (after.startsWith('php') && (open + 5 >= len || !isIdent(src[open + 5]))) {
      bodyStart = open + 5;
    } else if (src[open + 2] === '=') {
      bodyStart = open + 3;
    } else if (shortTags && !after.startsWith('xml')) {
      bodyStart = open + 2;
    } else {
      i = open + 2; // not a PHP tag (e.g. `<?xml`) — keep scanning
      continue;
    }

    const end = scanPhpBody(src, bodyStart);
    islands.push({ start: open, end });
    i = end;
  }

  return islands;
}

/**
 * Scan PHP code starting at `i`, returning the offset just past the closing `?>`,
 * or `src.length` if the file ends in PHP mode.
 */
function scanPhpBody(src: string, i: number): number {
  const len = src.length;

  while (i < len) {
    const c = src[i];

    // Possible close tag.
    if (c === '?' && src[i + 1] === '>') return i + 2;

    // Single-quoted string.
    if (c === "'") {
      i = scanQuoted(src, i + 1, "'");
      continue;
    }

    // Double-quoted string.
    // Limitation: nested double quotes in complex `{$a["k"]}` interpolation can desync the lexer (documented).
    if (c === '"') {
      i = scanQuoted(src, i + 1, '"');
      continue;
    }

    // Backtick (shell exec) string — same escaping rules.
    if (c === '`') {
      i = scanQuoted(src, i + 1, '`');
      continue;
    }

    // Comments.
    if (c === '/' && src[i + 1] === '/') {
      i = scanLineComment(src, i + 2);
      if (src.startsWith('?>', i)) return i + 2;
      continue;
    }
    if (c === '#') {
      // PHP 8 attribute `#[...]` is not a comment.
      if (src[i + 1] === '[') {
        i += 2;
        continue;
      }
      i = scanLineComment(src, i + 1);
      if (src.startsWith('?>', i)) return i + 2;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i + 2);
      i = close === -1 ? len : close + 2;
      continue;
    }

    // Heredoc / nowdoc.
    if (c === '<' && src[i + 1] === '<' && src[i + 2] === '<') {
      const here = scanHeredoc(src, i + 3);
      if (here !== -1) {
        i = here;
        continue;
      }
    }

    i++;
  }

  return len; // file ends while still in PHP mode
}

/**
 * Scan a quoted string body; `i` is just past the open quote.
 * Returns offset just past the closing quote (or EOF).
 */
function scanQuoted(src: string, i: number, quote: string): number {
  const len = src.length;
  while (i < len) {
    const c = src[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === quote) return i + 1;
    i++;
  }
  return len;
}

/**
 * Scan a `//` or `#` line comment body, which ends at a newline or at `?>`.
 * Returns the offset past a consumed newline, or the offset of an unconsumed `?>`
 * (left for the caller, since `?>` closes both the comment and the island).
 */
function scanLineComment(src: string, i: number): number {
  const len = src.length;
  while (i < len) {
    if (src[i] === '\n') return i + 1;
    if (src[i] === '?' && src[i + 1] === '>') return i;
    i++;
  }
  return len;
}

/**
 * Scan a heredoc/nowdoc; `i` is just past `<<<`.
 * Returns the offset past the closing identifier line, or -1 if `<<<` isn't followed by a valid heredoc identifier.
 */
function scanHeredoc(src: string, i: number): number {
  const len = src.length;
  // Optional whitespace (PHP allows spaces/tabs after `<<<`).
  while (i < len && (src[i] === ' ' || src[i] === '\t')) i++;

  // Optional quote around the identifier.
  let quote = '';
  if (src[i] === "'" || src[i] === '"') {
    quote = src[i];
    i++;
  }

  if (i >= len || !isIdentStart(src[i])) return -1;
  const idStart = i;
  while (i < len && isIdent(src[i])) i++;
  const id = src.slice(idStart, i);

  if (quote) {
    if (src[i] !== quote) return -1;
    i++;
  }

  // After the identifier, the line must end immediately — PHP disallows trailing whitespace,
  // but we tolerate `\r` so `\r\n` endings still work.
  while (i < len && src[i] === '\r') i++;
  if (src[i] !== '\n') return -1;
  i++;

  // Find a line that starts with optional indentation,
  // then the identifier followed by a non-identifier character
  // (PHP 7.3 flexible syntax).
  while (i < len) {
    let j = i;
    while (j < len && (src[j] === ' ' || src[j] === '\t')) j++;
    if (src.startsWith(id, j)) {
      const k = j + id.length;
      if (k >= len || !isIdent(src[k])) return k;
    }
    const nl = src.indexOf('\n', i);
    if (nl === -1) return len;
    i = nl + 1;
  }
  return len;
}
