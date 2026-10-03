import { it, expect } from "vitest";
import {
  getSupportedTimezones,
  suggestedTimezone,
  previewReminder,
} from "./timezones";
it("S11 supported zones contain UTC/Pacific/Eastern and no duplicate", () => {
  const zones = getSupportedTimezones();
  expect(zones).toEqual(
    expect.arrayContaining(["UTC", "America/New_York", "America/Los_Angeles"]),
  );
  expect(new Set(zones).size).toBe(zones.length);
});
it("S13 supported detection or visible UTC fallback", () => {
  expect(suggestedTimezone("America/New_York", getSupportedTimezones())).toBe(
    "America/New_York",
  );
  expect(suggestedTimezone("Mars/Olympus", getSupportedTimezones())).toBe(
    "UTC",
  );
});
it("S14 fixed labeled example has selected zone", () =>
  expect(previewReminder("America/New_York")).toBe(
    "Example only · December 2, 2026 due date → October 3, 2026 at 09:00 (America/New_York).",
  ));
