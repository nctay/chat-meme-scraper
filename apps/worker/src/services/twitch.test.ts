import { describe, expect, it } from "vitest";
import { isIgnoredChatAuthor, isIgnoredChatCommand } from "./chat-filter.js";
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

describe("twitch chat command filtering", () => {
  it("ignores song request commands", () => {
    expect(isIgnoredChatCommand("!sr https://youtu.be/abc")).toBe(true);
    expect(isIgnoredChatCommand("  !SR")).toBe(true);
  });

  it("does not ignore regular messages that merely mention the command", () => {
    expect(isIgnoredChatCommand("look at this https://example.com/a.jpg !sr")).toBe(false);
    expect(isIgnoredChatCommand("!sra https://example.com/a.jpg")).toBe(false);
  });

  it("ignores Nightbot messages", () => {
    expect(isIgnoredChatAuthor("Nightbot")).toBe(true);
    expect(isIgnoredChatAuthor(" nightbot ")).toBe(true);
    expect(isIgnoredChatAuthor("RealViewer")).toBe(false);
  });
});
