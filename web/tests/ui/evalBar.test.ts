import { describe, expect, it } from "vitest";

import { heldEval } from "../../src/ui/AnalysisView";

describe("heldEval", () => {
  it("keeps the last settled value while the engine computes the new position", () => {
    const last = { wc: 0.8, label: "+2.1" };
    expect(heldEval(last, { wc: null, label: "…" }, true)).toBe(last);
  });

  it("shows the new value once it arrives, and the neutral value when nothing was ever shown", () => {
    const now = { wc: 0.3, label: "-1.0" };
    expect(heldEval({ wc: 0.8, label: "+2.1" }, now, false)).toBe(now);
    expect(heldEval(null, { wc: null, label: "…" }, true)).toEqual({ wc: null, label: "…" });
  });
});
