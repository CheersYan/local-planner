import { describe, expect, it } from "vitest";

import { BlackoutMatchError, matchBlackout } from "../blackout-matcher";
import type { BlackoutPreview } from "../types";

const fixtures: BlackoutPreview[] = [
  {
    id: "blk-1",
    start: "2026-03-18T00:00:00Z",
    end: "2026-03-20T23:59:59Z",
    reason: "出差",
  },
  {
    id: "blk-2",
    start: "2026-03-22T00:00:00Z",
    end: "2026-03-22T23:59:59Z",
    reason: "家庭安排",
  },
  {
    id: "blk-3",
    start: "2026-03-25T00:00:00Z",
    end: "2026-03-25T23:59:59Z",
    reason: "出差复盘",
  },
];

describe("matchBlackout", () => {
  it("matches by blackoutId", () => {
    const hit = matchBlackout(fixtures, { blackoutId: "blk-2" });
    expect(hit.id).toBe("blk-2");
  });

  it("matches by exact date range", () => {
    const hit = matchBlackout(fixtures, { startDate: "2026-03-18", endDate: "2026-03-20" });
    expect(hit.id).toBe("blk-1");
  });

  it("matches by fuzzy reason when unique", () => {
    const hit = matchBlackout(fixtures, { fuzzyReason: "家庭" });
    expect(hit.id).toBe("blk-2");
  });

  it("returns structured ambiguity when fuzzy reason hits multiple", () => {
    expect(() => matchBlackout(fixtures, { fuzzyReason: "出差" })).toThrow(BlackoutMatchError);

    try {
      matchBlackout(fixtures, { fuzzyReason: "出差" });
    } catch (error) {
      expect(error).toBeInstanceOf(BlackoutMatchError);
      const matchError = error as BlackoutMatchError;
      expect(matchError.code).toBe("ambiguous");
      expect(matchError.candidates.length).toBe(2);
    }
  });
});
