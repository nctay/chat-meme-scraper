import type { FastifyInstance } from "fastify";
import { prisma } from "../prisma.js";

export async function publicRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({ ok: true }));

  app.get("/streamers", async () => {
    return prisma.streamer.findMany({
      where: { enabled: true },
      orderBy: { displayName: "asc" },
      select: {
        id: true,
        login: true,
        displayName: true,
        lastStatus: true,
        lastCheckedAt: true,
        _count: { select: { sessions: true } },
      },
    });
  });

  app.get("/streams", async (request) => {
    const { streamerId } = request.query as { streamerId?: string };
    return prisma.streamSession.findMany({
      where: streamerId ? { streamerId } : undefined,
      orderBy: { startedAt: "desc" },
      take: 100,
      include: {
        streamer: { select: { login: true, displayName: true } },
        _count: { select: { posts: true } },
      },
    });
  });

  app.get("/streams/:id/timeline", async (request) => {
    const { id } = request.params as { id: string };
    const { type } = request.query as { type?: "image" | "video" };

    const posts = await prisma.chatPost.findMany({
      where: {
        streamSessionId: id,
        status: "stored",
        asset: {
          status: "stored",
          visibility: "public",
          ...(type ? { mediaType: type } : {}),
        },
      },
      orderBy: { postedAt: "asc" },
      include: {
        asset: true,
      },
    });

    return posts.map((post) => ({
      ...post,
      asset: post.asset ? { ...post.asset, byteSize: post.asset.byteSize?.toString() ?? null } : null,
    }));
  });
}
