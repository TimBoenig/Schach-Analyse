import { useEffect, useState } from "preact/hooks";

import { type BookData, loadBookData } from "../domain/book";

let book: BookData | null = null;

/** The opening tree, loaded once per session; null until it has arrived. */
export function useBook(): BookData | null {
  const [data, setData] = useState<BookData | null>(book);
  useEffect(() => {
    if (book) return;
    let alive = true;
    void loadBookData().then((d) => {
      book = d;
      if (alive) setData(d);
    });
    return () => {
      alive = false;
    };
  }, []);
  return data;
}
