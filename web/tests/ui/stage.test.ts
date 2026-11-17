import { describe, expect, it } from "vitest";

import { PAGE_GUIDES } from "../../src/ui/stage/guides";
import { backStep, canAdvance, onboardPath, TOUR_STOPS, tourStop } from "../../src/ui/stage/script";
import { autoFree, closeStage, currentShow, markSeen, mergeSeen, onSeenChange, openStage, resetSeen, type SeenStore, seenList, subscribeStage, takeAuto, wasSeen } from "../../src/ui/stage/store";
import { AREAS } from "../../src/ui/Layout";
import { toHash } from "../../src/ui/router";

function memoryStore(initial: Record<string, string> = {}): SeenStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => void (data[k] = v),
    removeItem: (k) => void delete data[k],
  };
}

describe("stage store", () => {
  it("shows one show at a time and tells every listener", () => {
    const seen: (string | null)[] = [];
    const off = subscribeStage((s) => seen.push(s ? `${s.kind}:${s.subject ?? ""}` : null));
    openStage({ kind: "tour" });
    openStage({ kind: "page", subject: "profile" });
    expect(currentShow()).toEqual({ kind: "page", subject: "profile" });
    closeStage();
    closeStage();
    off();
    openStage({ kind: "tour" });
    closeStage();
    // Initial state, two opens, one close; the second close and everything after "off" stay silent.
    expect(seen).toEqual([null, "tour:", "page:profile", null]);
  });

  it("remembers what ran on this device and forgets it on reset", () => {
    const store = memoryStore();
    expect(wasSeen("onboarding", store)).toBe(false);
    markSeen("onboarding", store);
    markSeen("page:profile", store);
    markSeen("onboarding", store);
    expect(JSON.parse(store.data["schach.stage.seen"])).toEqual(["onboarding", "page:profile"]);
    expect(wasSeen("page:profile", store)).toBe(true);
    resetSeen(store);
    expect(wasSeen("onboarding", store)).toBe(false);
  });

  it.each([["not json"], ['{"a":1}'], ["[1,2]"]])("treats broken storage (%s) as nothing seen", (raw) => {
    const store = memoryStore({ "schach.stage.seen": raw });
    expect(wasSeen("onboarding", store)).toBe(false);
    markSeen("onboarding", store);
    expect(wasSeen("onboarding", store)).toBe(true);
  });

  it("works without any storage (private mode)", () => {
    expect(wasSeen("onboarding", null)).toBe(false);
    expect(() => markSeen("onboarding", null)).not.toThrow();
  });

  it("counts the first report and the analysis guide as one explanation", () => {
    const store = memoryStore();
    markSeen("report:first", store);
    expect(wasSeen("page:analysis", store)).toBe(true);
    const other = memoryStore();
    markSeen("page:analysis", other);
    expect(wasSeen("report:first", other)).toBe(true);
    // Unrelated pages stay on their own.
    markSeen("page:profile", other);
    expect(seenList(other)).toEqual(["page:analysis", "report:first", "page:profile"]);
  });

  it("reports each change for the synced copy, but not ids that came from it", () => {
    const store = memoryStore();
    const heard: string[][] = [];
    const off = onSeenChange((l) => heard.push(l));
    markSeen("page:games", store);
    markSeen("page:games", store);
    expect(mergeSeen(["page:games", "page:moves", "page:moves"], store)).toBe(true);
    expect(mergeSeen(["page:moves"], store)).toBe(false);
    resetSeen(store, memoryStore());
    off();
    markSeen("page:home", store);
    // One mark, nothing for the repeat or the merge, the reset, then silence after off().
    expect(heard).toEqual([["page:games"], []]);
    expect(seenList(store)).toEqual(["page:home"]);
  });
});

describe("one show by herself per visit", () => {
  it("lets Lucena open one thing unasked per session, and the reset frees it again", () => {
    const session = memoryStore();
    expect(autoFree(session)).toBe(true);
    expect(takeAuto(session)).toBe(true);
    // The next page guide of the same visit waits.
    expect(autoFree(session)).toBe(false);
    expect(takeAuto(session)).toBe(false);
    // A new visit (fresh session storage) may again.
    expect(takeAuto(memoryStore())).toBe(true);
    resetSeen(memoryStore(), session);
    expect(autoFree(session)).toBe(true);
  });

  it("falls back to this page load when session storage is blocked", () => {
    resetSeen(null, null);
    expect(takeAuto(null)).toBe(true);
    expect(autoFree(null)).toBe(false);
    resetSeen(null, null);
    expect(autoFree(null)).toBe(true);
  });
});

describe("first start", () => {
  it("fetches games only when there is an account to fetch from", () => {
    const tour = TOUR_STOPS.map((s) => `tour:${s.id}`);
    expect(onboardPath("chesscom")).toEqual(["hello", "site", "name", "import", "analysis", ...tour, "ready"]);
    expect(onboardPath("lichess")).toEqual(onboardPath("chesscom"));
    expect(onboardPath("none")).toEqual(["hello", "site", "nosite", ...tour, "ready"]);
    // Before the choice the progress line already shows the common case.
    expect(onboardPath(null)).toEqual(onboardPath("chesscom"));
  });

  it("holds the user on a step until it is answered", () => {
    const state = { pick: null, name: "", phase: "idle" } as const;
    expect(canAdvance("hello", state)).toBe(true);
    expect(canAdvance("site", state)).toBe(false);
    expect(canAdvance("site", { ...state, pick: "lichess" })).toBe(true);
    expect(canAdvance("name", { ...state, pick: "lichess", name: "   " })).toBe(false);
    expect(canAdvance("name", { ...state, pick: "lichess", name: " magnus " })).toBe(true);
    for (const phase of ["idle", "busy", "empty", "error"] as const) expect(canAdvance("import", { ...state, phase })).toBe(false);
    expect(canAdvance("import", { ...state, phase: "done" })).toBe(true);
  });

  it("never leads back into a running or finished download", () => {
    const path = onboardPath("chesscom");
    const at = (step: string) => path.indexOf(step as (typeof path)[number]);
    expect(backStep(path, 0, "idle")).toBeNull();
    expect(backStep(path, at("name"), "idle")).toBe(at("site"));
    expect(backStep(path, at("import"), "busy")).toBeNull();
    expect(backStep(path, at("import"), "error")).toBe(at("name"));
    expect(backStep(path, at("analysis"), "done")).toBeNull();
    expect(backStep(path, at("ready"), "done")).toBe(at("ready") - 1);
  });

  it("walks through every main area once, in the order of the navigation", () => {
    const areas = AREAS.filter((a) => a.id !== "home" && a.id !== "settings");
    expect(TOUR_STOPS.map((s) => s.id)).toEqual(areas.map((a) => a.id));
    // Each stop opens the first page of its area.
    expect(TOUR_STOPS.map((s) => toHash(s.go.route))).toEqual(areas.map((a) => toHash(a.sub[0].route)));
    expect(tourStop("tour:training")?.id).toBe("training");
    expect(tourStop("ready")).toBeUndefined();
  });

  it("names the guide of the page each stop opens, so it is not told twice", () => {
    // The first page of each area, by its guide: Partien, Überblick, Training (Heute), Gegner & Freunde.
    expect(TOUR_STOPS.map((s) => s.guide)).toEqual(["games", "profile", "training", "players"]);
    for (const s of TOUR_STOPS) expect(PAGE_GUIDES[s.guide], s.id).toBeDefined();
  });
});

describe("page guides", () => {
  it("has a guide with at least one step for every page, and every step says something", () => {
    for (const [id, guide] of Object.entries(PAGE_GUIDES)) {
      expect(guide.steps.length, id).toBeGreaterThan(0);
      for (const step of guide.steps) {
        expect(step.say.trim().length, id).toBeGreaterThan(0);
        expect(step.sub.trim().length, id).toBeGreaterThan(0);
      }
    }
  });
});
