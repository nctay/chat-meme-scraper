import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ sendPhoto: vi.fn() }));

vi.mock("grammy", () => ({
  Bot: class {
    api = apiMock;
  },
  InputFile: class {},
}));

vi.mock("../env.js", () => ({
  env: { TELEGRAM_BOT_TOKEN: "token", TELEGRAM_STORAGE_CHAT_ID: "-100storage" },
  privateStreamerLogins: new Set<string>(),
}));

vi.mock("../prisma.js", () => ({ prisma: {} }));

vi.mock("./rate-limit.js", () => ({
  SerialRateLimiter: class {
    schedule<T>(task: () => Promise<T>): Promise<T> {
      return task();
    }
  },
  withTelegramRetry: vi.fn(),
}));

describe("Telegram media spoilers", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    apiMock.sendPhoto.mockResolvedValue({
      chat: { id: -100 },
      message_id: 1,
      photo: [{ file_id: "file", file_unique_id: "unique" }],
    });
  });

  it("hides w.tv media behind a Telegram spoiler", async () => {
    const { storeTelegramMedia } = await import("./telegram-storage.js");

    await storeTelegramMedia("/dev/null", "image/jpeg", "image", {
      originalUrl: "https://example.com/image.jpg",
      normalizedUrl: "https://example.com/image.jpg",
      sha256: "hash",
      streamerLogin: "streamer",
      streamerDisplayName: "Streamer",
      streamStartedAt: new Date("2026-09-07T18:00:00Z"),
      streamSessionId: "session",
      assetId: "asset",
      authorName: "Viewer",
      messageText: "https://example.com/image.jpg",
      skipTelegramPublic: false,
      telegramHasSpoiler: true,
    });

    expect(apiMock.sendPhoto).toHaveBeenCalledWith(
      "-100storage",
      expect.anything(),
      expect.objectContaining({ has_spoiler: true }),
    );
  });
});
