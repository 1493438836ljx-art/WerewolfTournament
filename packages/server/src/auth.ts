// 轻量认证：scrypt 密码哈希 + HMAC-SHA256 签名 token（零额外依赖）。
// token 载荷 {uid, role, exp}，Base64URL(JSON).Base64URL(HMAC)。
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { db } from "./db/index.js";
import { users } from "./db/schema.js";

export type Role = "admin" | "player";

export interface AuthUser {
  id: string;
  username: string;
  role: Role;
}

// ─── 密码 ───
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const calc = scryptSync(password, salt, 32);
  const expect = Buffer.from(hash, "hex");
  return calc.length === expect.length && timingSafeEqual(calc, expect);
}

// ─── token ───
const TOKEN_TTL_S = 7 * 24 * 3600;

function secret(): string {
  return process.env.WT_AUTH_SECRET || process.env.WT_ADMIN_TOKEN || "wt-dev-secret-change-me";
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export function signToken(user: AuthUser): string {
  const payload = { uid: user.id, role: user.role, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_S };
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(createHmac("sha256", secret()).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyToken(token: string): (AuthUser & { exp: number }) | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expect = createHmac("sha256", secret()).update(body).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== expect.length || !timingSafeEqual(got, expect)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as { uid: string; role: Role; exp: number };
    if (payload.exp * 1000 < Date.now()) return null;
    return { id: payload.uid, role: payload.role, exp: payload.exp, username: "" };
  } catch {
    return null;
  }
}

// ─── fastify 守卫 ───
declare module "fastify" {
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

export function extractUser(req: FastifyRequest): AuthUser | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  const t = verifyToken(auth.slice(7));
  return t ? { id: t.id, username: "", role: t.role } : null;
}

/** 要求已登录；可选要求角色（admin 高于 player） */
export function requireAuth(minRole: Role = "player") {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const user = extractUser(req);
    if (!user) return reply.code(401).send({ error: "未登录" });
    // 回填用户名
    const [row] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
    if (!row) return reply.code(401).send({ error: "用户不存在" });
    if (minRole === "admin" && row.role !== "admin") {
      return reply.code(403).send({ error: "需要管理员权限" });
    }
    req.user = { id: row.id, username: row.username, role: row.role as Role };
  };
}

/** 路由注册：register / login / me */
export function registerAuthRoutes(app: FastifyInstance) {
  app.post("/api/auth/register", async (req, reply) => {
    const body = (req.body ?? {}) as { username?: string; password?: string };
    const username = body.username?.trim() ?? "";
    const password = body.password ?? "";
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(username)) {
      return reply.code(400).send({ error: "用户名须为 3-32 位字母数字/_-" });
    }
    if (password.length < 6) return reply.code(400).send({ error: "密码至少 6 位" });
    const existing = await db.select().from(users).where(eq(users.username, username)).limit(1);
    if (existing.length) return reply.code(409).send({ error: "用户名已存在" });
    const user: AuthUser = { id: `u-${randomUUID().slice(0, 10)}`, username, role: "player" };
    await db.insert(users).values({ id: user.id, username, passwordHash: hashPassword(password), role: "player" });
    return { token: signToken(user), user };
  });

  app.post("/api/auth/login", async (req, reply) => {
    const body = (req.body ?? {}) as { username?: string; password?: string };
    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.username, body.username?.trim() ?? ""))
      .limit(1);
    if (!row || !verifyPassword(body.password ?? "", row.passwordHash)) {
      return reply.code(401).send({ error: "用户名或密码错误" });
    }
    const user: AuthUser = { id: row.id, username: row.username, role: row.role as Role };
    return { token: signToken(user), user };
  });

  app.get("/api/auth/me", { preHandler: requireAuth() }, async (req) => req.user);
}

/** 启动时确保存在管理员（env 指定或默认 admin/admin123，仅当系统中没有任何 admin） */
export async function ensureAdminSeed() {
  const admins = await db.select().from(users).where(eq(users.role, "admin")).limit(1);
  if (admins.length) return;
  const username = process.env.WT_ADMIN_USERNAME || "admin";
  const password = process.env.WT_ADMIN_PASSWORD || "admin123";
  const existing = await db.select().from(users).where(eq(users.username, username)).limit(1);
  if (existing.length) {
    await db.update(users).set({ role: "admin" }).where(eq(users.id, existing[0]!.id));
    return;
  }
  await db.insert(users).values({
    id: `u-${randomUUID().slice(0, 10)}`,
    username,
    passwordHash: hashPassword(password),
    role: "admin",
  });
  console.log(`[auth] 已创建管理员账号: ${username} / ${password}（请尽快修改 WT_ADMIN_PASSWORD）`);
}
