/**
 * Adapter: official Tailwind sorter → core `SortFn`.
 *
 * Kept separate from the core so the lexer/transformer stay dependency-free and testable with any injected sorter.
 *
 * @see transform.ts - consumes the `SortFn` produced here.
 */

import type { SortFn } from './transform.ts';

/**
 * Options for constructing the official Tailwind sorter.
 */
export interface SorterOptions {
    /**
     * Tailwind v4 CSS entry point.
     */
    stylesheet: string;
    /**
     * Base directory for resolving relative paths. Default: `cwd`.
     */
    base?: string;
}

/**
 * Create a `SortFn` backed by the official `prettier-plugin-tailwindcss` sorting engine,
 * configured with the project's Tailwind v4 stylesheet so custom tokens and classes sort correctly.
 *
 * Requires `prettier-plugin-tailwindcss` >= 0.8 (the `/sorter` entrypoint).
 *
 * @param opts Stylesheet and path resolution options.
 * @returns A synchronous `SortFn` for use with `transform()`.
 */
export async function createTailwindSortFn(opts: SorterOptions): Promise<SortFn> {
    // Dynamic import so the core package works without the dependency installed.
    const { createSorter } = await import('prettier-plugin-tailwindcss/sorter');

    const sorter = await createSorter({
        base: opts.base ?? process.cwd(),
        stylesheetPath: opts.stylesheet,
    });

    return (classes: string[]) => sorter.sortClassLists([classes])[0];
}
