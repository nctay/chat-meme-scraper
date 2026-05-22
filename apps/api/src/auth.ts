import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "./env.js";

const COOKIE_NAME = "archive_admin";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function sign(value: string): string {
  return crypto.createHmac("sha256", env.SESSION_SECRET).update(value).digest("hex");
}

export function hashPassword(password: string, salt = crypto.randomBytes(16).toString("hex")): string {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash?: string): boolean {
  if (!storedHash) return false;
  const [scheme, salt, expected] = storedHash.split(":");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(expected, "hex"), actual);
}

export function createSession(reply: FastifyReply, username: string): void {
  const expires = Date.now() + SESSION_TTL_MS;
  const payload = `${username}:${expires}`;
  reply.setCookie(COOKIE_NAME, `${payload}:${sign(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export function clearSession(reply: FastifyReply): void {
  reply.clearCookie(COOKIE_NAME, { path: "/" });
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const cookie = request.cookies[COOKIE_NAME];
  if (!cookie) {
    await reply.code(401).send({ error: "Unauthorized" });
    return;
  }

  const parts = cookie.split(":");
  const signature = parts.pop();
  const payload = parts.join(":");
  const [, expiresRaw] = parts;

  if (!signature || signature !== sign(payload) || Number(expiresRaw) < Date.now()) {
    await reply.code(401).send({ error: "Unauthorized" });
  }
}

export function currentAdmin(request: FastifyRequest): string {
  const cookie = request.cookies[COOKIE_NAME];
  return cookie?.split(":")[0] ?? env.ADMIN_USERNAME;
}
