/**
 * SPA route watcher.
 *
 * sshxl.nl is a React app: internal navigation (e.g. "Terug naar overzicht")
 * swaps #react-content via the History API without a page load, so the
 * userscript manager never re-injects us. This watcher patches
 * history.pushState/replaceState, listens to popstate, and polls as a
 * fallback; on every path change it tears down per-route UI and re-runs the
 * router.
 */

import { pageKind } from "../data/page";
import type { PageKind } from "../data/page";

export interface RouteContext {
  /** Bump on every route change so in-flight async work can detect staleness. */
  epoch: number;
}

type RouteHandler = (kind: PageKind) => void | Promise<void>;

let currentPath = location.pathname;
let currentEpoch = 0;

/** True when this navigation happened after the handler was registered. */
export function isStale(epoch: number): boolean {
  return epoch !== currentEpoch;
}

export function currentRoute(): RouteContext {
  return { epoch: currentEpoch };
}

async function runRouter(handler: RouteHandler): Promise<void> {
  // Per-route UI is gone: the global hub (ui/Hub.tsx) is mounted ONCE at
  // startup and persists across SPA navigations. Only the epoch bumps here
  // so in-flight async route work can detect staleness.
  currentEpoch += 1;
  await handler(pageKind());
}

/** Re-run the router when the path changes; returns a disposer. */
export function watchRoutes(handler: RouteHandler): () => void {
  const maybeRun = (): void => {
    if (location.pathname === currentPath) return;
    currentPath = location.pathname;
    void runRouter(handler);
  };

  const wrap = (original: typeof history.pushState): typeof history.pushState =>
    function (this: History, ...args: Parameters<typeof history.pushState>) {
      const result = original.apply(this, args);
      maybeRun();
      return result;
    };

  const originalPush = history.pushState.bind(history);
  const originalReplace = history.replaceState.bind(history);
  history.pushState = wrap(originalPush);
  history.replaceState = wrap(originalReplace);
  window.addEventListener("popstate", maybeRun);

  // Fallback for navigation paths we cannot patch (meta refresh, location
  // assignment within SPA routers that bypass history wrappers).
  const poll = setInterval(maybeRun, 1000);

  void runRouter(handler);

  return () => {
    history.pushState = originalPush;
    history.replaceState = originalReplace;
    window.removeEventListener("popstate", maybeRun);
    clearInterval(poll);
  };
}
