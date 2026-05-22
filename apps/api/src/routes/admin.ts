import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { clearSession, createSession, currentAdmin, requireAdmin, verifyPassword } from "../auth.js";
import { env } from "../env.js";
import { prisma } from "../prisma.js";
import { deleteObject } from "../s3.js";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.post("/admin/login", async (request, reply) => {
    const body = loginSchema.parse(request.body);
    if (body.username !== env.ADMIN_USERNAME || !verifyPassword(body.password, env.ADMIN_PASSWORD_HASH)) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }
    createSession(reply, body.username);
    return { ok: true };
  });

  app.post("/admin/logout", async (_request, reply) => {
    clearSession(reply);
    return { ok: true };
  });

  app.addHook("preHandler", async (request, reply) => {
    if (request.url.startsWith("/admin/login") || request.url.startsWith("/admin/logout")) return;
    await requireAdmin(request, reply);
  });

  app.get("/admin/me", async (request) => ({ username: currentAdmin(request) }));

  app.get("/admin/dashboard", async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [streamers, activeSessions, failedJobs, storedAssets, blockedPosts, recentErrors] = await Promise.all([
      prisma.streamer.findMany({ orderBy: { displayName: "asc" } }),
      prisma.streamSession.count({ where: { status: "live" } }),
      prisma.downloadJob.count({ where: { status: "failed" } }),
      prisma.asset.count({ where: { status: "stored", visibility: "public" } }),
      prisma.chatPost.count({ where: { status: "blocked" } }),
      prisma.downloadJob.findMany({
        where: { status: "failed" },
        orderBy: { updatedAt: "desc" },
        take: 10,
      }),
    ]);

    const bytesToday = await prisma.asset.aggregate({
      where: { status: "stored", createdAt: { gte: today } },
      _sum: { byteSize: true },
    });

    return {
      streamers,
      activeSessions,
      failedJobs,
      storedAssets,
      blockedPosts,
      bytesToday: bytesToday._sum.byteSize?.toString() ?? "0",
      recentErrors,
    };
  });

  app.get("/admin/assets", async (request) => {
    const query = request.query as { status?: string; visibility?: string; type?: string };
    const assets = await prisma.asset.findMany({
      where: {
        ...(query.status ? { status: query.status as never } : {}),
        ...(query.visibility ? { visibility: query.visibility as never } : {}),
        ...(query.type ? { mediaType: query.type as never } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        posts: {
          take: 1,
          orderBy: { postedAt: "asc" },
          include: { streamSession: { include: { streamer: true } } },
        },
      },
    });

    return assets.map((asset) => ({
      ...asset,
      byteSize: asset.byteSize?.toString() ?? null,
    }));
  });

  app.post("/admin/assets/:id/hide", async (request) => {
    const { id } = request.params as { id: string };
    const admin = currentAdmin(request);
    const asset = await prisma.asset.update({ where: { id }, data: { visibility: "hidden" } });
    await audit(admin, "asset_hide", "asset", id, { publicUrl: asset.publicUrl });
    return asset;
  });

  app.post("/admin/assets/:id/restore", async (request) => {
    const { id } = request.params as { id: string };
    const admin = currentAdmin(request);
    const asset = await prisma.asset.update({ where: { id }, data: { visibility: "public" } });
    await audit(admin, "asset_restore", "asset", id, {});
    return asset;
  });

  app.post("/admin/assets/:id/delete", async (request) => {
    const { id } = request.params as { id: string };
    const body = z.object({ reason: z.string().min(1).default("moderation") }).parse(request.body ?? {});
    const admin = currentAdmin(request);
    const asset = await prisma.asset.findUniqueOrThrow({ where: { id } });

    if (asset.s3Key) {
      await deleteObject(asset.s3Key);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const deleted = await tx.asset.update({
        where: { id },
        data: {
          status: "deleted",
          visibility: "hidden",
          publicUrl: null,
          deletedAt: new Date(),
          deletedBy: admin,
          deleteReason: body.reason,
        },
      });

      await tx.blockedMedia.upsert({
        where: { normalizedUrl: asset.normalizedUrl },
        create: {
          normalizedUrl: asset.normalizedUrl,
          sha256: asset.sha256,
          reason: body.reason,
          sourceAssetId: asset.id,
        },
        update: {
          sha256: asset.sha256,
          reason: body.reason,
          sourceAssetId: asset.id,
        },
      });

      await tx.adminAuditLog.create({
        data: {
          adminUsername: admin,
          action: "asset_delete_permanent",
          entityType: "asset",
          entityId: id,
          metadata: { reason: body.reason, s3Key: asset.s3Key },
        },
      });

      return deleted;
    });

    return updated;
  });

  app.get("/admin/jobs/failed", async () => {
    return prisma.downloadJob.findMany({
      where: { status: "failed" },
      orderBy: { updatedAt: "desc" },
      take: 100,
      include: { chatPost: true, asset: true },
    });
  });

  app.post("/admin/jobs/:id/retry", async (request) => {
    const { id } = request.params as { id: string };
    const admin = currentAdmin(request);
    const job = await prisma.downloadJob.update({
      where: { id },
      data: { status: "pending", attempts: 0, nextRetryAt: null, lastError: null },
    });
    await audit(admin, "download_job_retry", "download_job", id, {});
    return job;
  });
}

async function audit(adminUsername: string, action: string, entityType: string, entityId: string, metadata: object): Promise<void> {
  await prisma.adminAuditLog.create({ data: { adminUsername, action, entityType, entityId, metadata } });
}
