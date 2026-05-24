import { describe, expect, it } from "vitest";
import { isWithinOfflineGrace } from "./stream-grace.js";

describe("twitch stream session grace", () => {
  it("keeps reconnects within thirty minutes in the same session", () => {
    expect(isWithinOfflineGrace(new Date("2026-05-24T10:00:00Z"), new Date("2026-05-24T10:30:00Z"))).toBe(true);
  });

  it("starts a new session after thirty minutes offline", () => {
    expect(isWithinOfflineGrace(new Date("2026-05-24T10:00:00Z"), new Date("2026-05-24T10:30:01Z"))).toBe(false);
  });

  it("does not treat never-ended sessions as grace reconnects", () => {
    expect(isWithinOfflineGrace(null, new Date("2026-05-24T10:00:00Z"))).toBe(false);
  });
});
