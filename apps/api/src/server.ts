import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { adminRoutes } from "./routes/admin.js";
import { publicRoutes } from "./routes/public.js";
import { env } from "./env.js";
import { prisma } from "./prisma.js";

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: env.PUBLIC_APP_URL,
  credentials: true,
});
await app.register(cookie);
await app.register(publicRoutes, { prefix: "/api" });
await app.register(adminRoutes, { prefix: "/api" });

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  const normalized = error instanceof Error ? error : new Error(String(error));
  const maybeStatus = normalized as Error & { statusCode?: number };
  const status = typeof maybeStatus.statusCode === "number" ? maybeStatus.statusCode : 500;
  reply.code(status).send({ error: status === 500 ? "Internal server error" : normalized.message });
});

const close = async () => {
  await app.close();
  await prisma.$disconnect();
};

process.on("SIGINT", close);
process.on("SIGTERM", close);

await app.listen({ host: "0.0.0.0", port: env.PORT });
