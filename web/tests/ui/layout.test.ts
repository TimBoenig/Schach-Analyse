import { describe, expect, it } from "vitest";

import { AREAS, areaOf, MAIN_AREAS, subPageOf } from "../../src/ui/Layout";
import { parseHash } from "../../src/ui/router";

describe("information architecture", () => {
  it("files every page under exactly one area, so the nav always marks where you are", () => {
    const hashes = [
      "#/", "#/partien", "#/import", "#/analyse/abc/3", "#/brett", "#/profil", "#/einblicke", "#/zuege",
      "#/eroeffnungen", "#/training", "#/training/uebungen/chance", "#/training/fortschritt", "#/spieler",
      "#/spieler/rangliste", "#/spieler/max-2", "#/einstellungen", "#/einstellungen/analyse", "#/einstellungen/daten", "#/konto",
    ];
    for (const h of hashes) {
      const r = parseHash(h);
      const owners = AREAS.flatMap((a) => a.sub.filter((s) => s.match(r)).map((s) => `${a.id}/${s.label}`));
      expect(owners, h).toHaveLength(1);
    }
    expect(areaOf(parseHash("#/zuege")).id).toBe("stats");
    expect(subPageOf(parseHash("#/spieler/max-2"))?.label).toBe("Gegner & Freunde");
    expect(areaOf(parseHash("#/konto")).id).toBe("settings");
    // No separate "Analyse" entry: an opened game belongs to the game list.
    expect(subPageOf(parseHash("#/analyse/abc"))?.label).toBe("Alle Partien");
    expect(AREAS.find((a) => a.id === "games")?.sub.map((s) => s.label)).toEqual(["Alle Partien", "Analysebrett"]);
  });

  it("keeps the phone tab bar to five areas", () => {
    expect(MAIN_AREAS.map((a) => a.label)).toEqual(["Start", "Partien", "Statistik", "Training", "Spieler"]);
  });
});
