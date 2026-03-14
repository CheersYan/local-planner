import type { BlackoutLocator } from "@/lib/ai/command-schema";
import type { BlackoutPreview } from "./types";

const isoDatePart = (value: string): string => value.slice(0, 10);

export class BlackoutMatchError extends Error {
  candidates: BlackoutPreview[];
  code: "not_found" | "ambiguous";

  constructor(message: string, options: { candidates?: BlackoutPreview[]; code?: "not_found" | "ambiguous" } = {}) {
    super(message);
    this.candidates = options.candidates ?? [];
    this.code = options.code ?? "not_found";
  }
}

const matchByRange = (
  blackouts: BlackoutPreview[],
  startDate: string,
  endDate: string,
): BlackoutPreview | null => {
  const candidates = blackouts.filter(
    (window) => isoDatePart(window.start) === startDate && isoDatePart(window.end) === endDate,
  );

  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    throw new BlackoutMatchError("Blackout date range is ambiguous", {
      candidates,
      code: "ambiguous",
    });
  }

  return null;
};

export const matchBlackout = (blackouts: BlackoutPreview[], locator: BlackoutLocator): BlackoutPreview => {
  if (blackouts.length === 0) {
    throw new BlackoutMatchError("No blackout windows found");
  }

  if (locator.blackoutId) {
    const hit = blackouts.find((window) => window.id === locator.blackoutId);
    if (hit) return hit;
    throw new BlackoutMatchError("Blackout not found by blackoutId");
  }

  if (locator.startDate && locator.endDate) {
    const hit = matchByRange(blackouts, locator.startDate, locator.endDate);
    if (hit) return hit;
  }

  if (locator.fuzzyReason) {
    const needle = locator.fuzzyReason.toLowerCase();
    const candidates = blackouts.filter((window) => window.reason.toLowerCase().includes(needle));
    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) {
      throw new BlackoutMatchError("Blackout reason is ambiguous", {
        candidates,
        code: "ambiguous",
      });
    }
  }

  throw new BlackoutMatchError("Blackout not found");
};

export const toBlackoutPreview = (window: {
  id: string;
  start: Date | string;
  end: Date | string;
  reason: string;
}): BlackoutPreview => ({
  id: window.id,
  start: typeof window.start === "string" ? window.start : window.start.toISOString(),
  end: typeof window.end === "string" ? window.end : window.end.toISOString(),
  reason: window.reason,
});
