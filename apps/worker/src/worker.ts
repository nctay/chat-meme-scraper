import { cleanupExpiredChatMessages, ensureChatConnected, ensureEventSubConnected, pollTwitchStreams } from "./services/twitch.js";
import { pollWtvStreams } from "./services/wtv.js";
import { processDownloadQueue } from "./services/downloader.js";
import { prisma } from "./prisma.js";

let shuttingDown = false;

async function tick(): Promise<void> {
  ensureEventSubConnected();
  void ensureChatConnected().catch((error) => console.error("[tick] chat failed", error));
  const results = await Promise.allSettled([pollTwitchStreams(), pollWtvStreams(), processDownloadQueue(), cleanupExpiredChatMessages()]);
  for (const result of results) {
    if (result.status === "rejected") console.error("[tick] task failed", result.reason);
  }
}

async function loop(): Promise<void> {
  while (!shuttingDown) {
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
}

process.on("SIGINT", () => {
  shuttingDown = true;
});
process.on("SIGTERM", () => {
  shuttingDown = true;
});

await loop();
await prisma.$disconnect();
