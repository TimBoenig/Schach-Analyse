// Route-level code splitting. A page's code is only downloaded when it is
// opened, which keeps the first load small; the service worker has every chunk
// cached after the first visit, so later page changes stay instant and work
// offline. No Suspense: a small state machine keeps the bundle free of preact/compat.
import type { ComponentType, JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import { t } from "../i18n";

type Loader<P> = () => Promise<ComponentType<P>>;

const preloaders: (() => void)[] = [];

/** Wraps a dynamic import into a component; the page shows a skeleton while its chunk loads. */
export function lazyView<P extends object>(load: Loader<P>): ComponentType<P> {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<ComponentType<P>> | null = null;
  const start = () =>
    (pending ??= load().then(
      (c) => (loaded = c),
      (e) => {
        // Allow a retry (the connection may have dropped while loading).
        pending = null;
        throw e;
      },
    ));
  preloaders.push(() => void start().catch(() => undefined));

  return function LazyView(props: P): JSX.Element {
    const [view, setView] = useState<ComponentType<P> | null>(() => loaded);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
      if (view) return;
      let alive = true;
      setFailed(false);
      start().then(
        (c) => alive && setView(() => c),
        () => alive && setFailed(true),
      );
      return () => {
        alive = false;
      };
    }, [view]);
    if (view) {
      const View = view;
      return <View {...props} />;
    }
    if (failed)
      return (
        <div class="card notice" role="alert">
          <p>{t("Diese Seite konnte nicht geladen werden. Prüfe die Verbindung und versuche es noch einmal.")}</p>
          <button class="btn" onClick={() => location.reload()}>
            {t("Neu laden")}
          </button>
        </div>
      );
    return <div class="skeleton span-12" style={{ height: "240px" }} aria-busy="true" />;
  };
}

/**
 * Loads every page chunk in the background, so no later page change waits for
 * the network. It starts only after the first screen has had time to draw
 * (and the data to load), then waits for an idle moment, so it never competes
 * with what the person is looking at.
 */
export function preloadViews(delayMs = 3500): () => void {
  const run = () => preloaders.forEach((p) => p());
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
  let idle: number | undefined;
  const timer = window.setTimeout(() => {
    if (w.requestIdleCallback) idle = w.requestIdleCallback(run, { timeout: 8000 });
    else run();
  }, delayMs);
  return () => {
    window.clearTimeout(timer);
    if (idle !== undefined) w.cancelIdleCallback?.(idle);
  };
}
