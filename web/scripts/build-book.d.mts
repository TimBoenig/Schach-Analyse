// Types for build-book.mjs, so tests can build a book from fixture TSVs.
export function bookKey(fen: string): string;
export function buildBookData(tsvDir: string): Record<string, [eco: string, name: string, children: string[]]>;
