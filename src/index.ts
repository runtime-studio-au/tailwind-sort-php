/**
 * Public API for `@runtimestudio/tailwind-sort-php`.
 *
 * Tailwind CSS class sorting for mixed PHP/HTML templates. The core is dependency-free;
 * the official sorting engine is wired in via `createTailwindSortFn()` or any custom `SortFn`.
 *
 * @file Package entry point.
 * @see cli.ts - command-line interface built on this API.
 */

export { transform, type SortFn, type TransformOptions } from './transform.ts';
export { findIslands, type Island, type IslandOptions } from './islands.ts';
export { maskIslands, findClassAttributes, type ClassAttr, type HtmlScanOptions } from './html.ts';
export { createTailwindSortFn, type SorterOptions } from './sorter.ts';
