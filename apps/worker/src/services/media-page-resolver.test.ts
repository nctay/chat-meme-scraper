import { describe, expect, it } from "vitest";
import { extractPostimageDirectImageUrl, isResolvableMediaPageUrl } from "./media-page-resolver.js";

describe("media page resolver", () => {
  it("extracts Postimages direct image URLs from og:image", () => {
    const pageUrl = new URL("https://postimg.cc/Z0s0qgxY");
    const html = '<meta property="og:image" content="https://i.postimg.cc/pXRjsM9j/izobrazenie.png">';

    expect(extractPostimageDirectImageUrl(html, pageUrl)?.toString()).toBe("https://i.postimg.cc/pXRjsM9j/izobrazenie.png");
  });

  it("falls back to the direct input and decodes HTML entities", () => {
    const pageUrl = new URL("https://postimg.cc/Z0s0qgxY");
    const html = '<input type="text" id="direct" value="https://i.postimg.cc/pXRjsM9j/izobrazenie.png?x=1&amp;y=2">';

    expect(extractPostimageDirectImageUrl(html, pageUrl)?.toString()).toBe("https://i.postimg.cc/pXRjsM9j/izobrazenie.png?x=1&y=2");
  });

  it("recognizes Postimages pages as resolvable media pages", () => {
    expect(isResolvableMediaPageUrl("https://postimg.cc/Z0s0qgxY")).toBe(true);
    expect(isResolvableMediaPageUrl("https://example.com/Z0s0qgxY")).toBe(false);
  });
});
