import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveYandexDiskMediaUrl } from "./yandex-disk.js";

const publicUrl = "https://disk.yandex.ru/i/mkcCJXbMfEzTkw";
const directUrl = "https://downloader.disk.yandex.ru/disk/test";

afterEach(() => vi.unstubAllGlobals());

function mockApi(metadata: object, download: object = { href: directUrl }) {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify(metadata), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify(download), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("Yandex Disk public file resolver", () => {
  it("resolves an allowed public image after checking metadata", async () => {
    const fetchMock = mockApi({ type: "file", name: "picture.png", mime_type: "image/png", size: 1_759_156 });
    expect((await resolveYandexDiskMediaUrl(new URL(publicUrl), 30_000_000, 150_000_000)).toString()).toBe(directUrl);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0].searchParams.get("public_key")).toBe(publicUrl);
  });

  it("uses the canonical public key for yadi.sk links with tracking", async () => {
    const fetchMock = mockApi({ type: "file", name: "picture.png", mime_type: "image/png", size: 100 });
    await resolveYandexDiskMediaUrl(new URL("https://yadi.sk/i/mkcCJXbMfEzTkw/?utm_source=chat"), 30_000_000, 150_000_000);
    expect(fetchMock.mock.calls[0]?.[0].searchParams.get("public_key")).toBe(publicUrl);
  });

  it("allows a video within the video byte limit", async () => {
    mockApi({ type: "file", name: "clip.mp4", mime_type: "video/mp4", size: 100_000_000 });
    await expect(resolveYandexDiskMediaUrl(new URL(publicUrl), 30_000_000, 150_000_000)).resolves.toHaveProperty("hostname", "downloader.disk.yandex.ru");
  });

  it.each([
    [{ type: "dir", name: "folder", size: 100 }, "not a file"],
    [{ type: "file", name: "report.pdf", mime_type: "application/pdf", size: 100 }, "unsupported"],
    [{ type: "file", name: "picture.svg", mime_type: "image/svg+xml", size: 100 }, "unsupported"],
    [{ type: "file", name: "picture.png", mime_type: "image/svg+xml", size: 100 }, "unsupported"],
    [{ type: "file", name: "large.png", mime_type: "image/png", size: 31_000_000 }, "too large"],
    [{ type: "file", name: "large.mp4", mime_type: "video/mp4", size: 151_000_000 }, "too large"],
  ])("rejects unsupported resource %j before getting a download link", async (metadata, message) => {
    const fetchMock = mockApi(metadata);
    await expect(resolveYandexDiskMediaUrl(new URL(publicUrl), 30_000_000, 150_000_000)).rejects.toThrow(message);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an unexpected download host", async () => {
    mockApi({ type: "file", name: "picture.png", mime_type: "image/png", size: 100 }, { href: "http://127.0.0.1/private" });
    await expect(resolveYandexDiskMediaUrl(new URL(publicUrl), 30_000_000, 150_000_000)).rejects.toThrow("download URL");
  });
});
