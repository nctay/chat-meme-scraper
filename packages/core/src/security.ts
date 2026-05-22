import ipaddr from "ipaddr.js";

export function isPrivateIp(address: string): boolean {
  try {
    const parsed = ipaddr.parse(address);
    const range = parsed.range();
    return !["unicast"].includes(range);
  } catch {
    return true;
  }
}

export function assertSafeResolvedAddress(address: string): void {
  if (isPrivateIp(address)) {
    throw new Error(`Unsafe private/local address rejected: ${address}`);
  }
}

export function assertSafeUrl(url: URL): void {
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`Unsupported protocol: ${url.protocol}`);
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("Localhost URLs are not allowed");
  }

  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(":")) {
    assertSafeResolvedAddress(hostname);
  }
}
