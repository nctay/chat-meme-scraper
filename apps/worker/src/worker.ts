import { cleanupExpiredChatMessages, ensureChatConnected, ensureEventSubConnected, pollTwitchStreams } from "./services/twitch.js";
import { pollWtvStreams } from "./services/wtv.js";
import { processDownloadQueue } from "./services/downloader.js";
import { prisma } from "./prisma.js";

let shuttingDown = false;
let downloadTask: Promise<void> | null = null;

async function tick(): Promise<void> {
  ensureEventSubConnected();
  void ensureChatConnected().catch((error) => console.error("[tick] chat failed", error));
  downloadTask ??= processDownloadQueue()
    .catch((error) => console.error("[tick] downloads failed", error))
    .finally(() => {
      downloadTask = null;
    });
  const results = await Promise.allSettled([pollTwitchStreams(), pollWtvStreams(), cleanupExpiredChatMessages()]);
  for (const result of results) {
    if (result.status === "rejected") console.error("[tick] task failed", result.reason);
  }
}

async function loop(): Promise<void> {
  while (!shuttingDown) {
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}

process.on("SIGINT", () => {
  shuttingDown = true;
});
process.on("SIGTERM", () => {
  shuttingDown = true;
});

await loop();
await downloadTask;
await prisma.$disconnect();
