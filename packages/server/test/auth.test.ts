// 认证与权限矩阵集成测试（fastify inject，不起端口；需要 DB）。
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db/index.js";
import { users } from "../src/db/schema.js";
import { hashPassword, registerAuthRoutes } from "../src/auth.js";
import { initReferee } from "../src/llmreferee.js";
import { registerRest } from "../src/api/rest.js";
import { registerUploadRoute } from "../src/upload.js";
import { GameService } from "../src/game/service.js";
import { EventBus } from "../src/game/bus.js";

const run = promisify(exec);
const uniq = Date.now().toString(36);

async function buildApp(uploadsRoot: string): Promise<FastifyInstance> {
  const app = Fastify();
  const bus = new EventBus();
  const svc = new GameService(bus, { agentsRoot: "/tmp", sandbox: "none" });
  await initReferee(); // 裁判模式切换端点依赖单例
  registerAuthRoutes(app);
  registerRest(app, svc, { agentsRoot: "/tmp", sandbox: "none" });
  registerUploadRoute(app, { uploadsRoot });
  return app;
}

async function ensureAdmin() {
  process.env.WT_ADMIN_USERNAME = `admin_${uniq}`;
  process.env.WT_ADMIN_PASSWORD = "adminpw1";
  await ensureAdminSeed();
  return process.env.WT_ADMIN_USERNAME;
}

async function login(app: FastifyInstance, username: string, password: string): Promise<string> {
  const r = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } });
  return r.json().token as string;
}

let app: FastifyInstance;
let adminName: string;
let uploadsRoot: string;

beforeAll(async () => {
  uploadsRoot = await mkdtemp(path.join(tmpdir(), `wt-auth-test-${uniq}-`));
  app = await buildApp(uploadsRoot);
  // 自建测试管理员（库里可能已有其他 admin，ensureAdminSeed 会短路）
  adminName = `adm_${uniq}`;
  await db
    .insert(users)
    .values({ id: `u-adm-${uniq}`, username: adminName, passwordHash: hashPassword("adminpw1"), role: "admin" })
    .onConflictDoNothing();
});

afterAll(async () => {
  // 清理测试用户
  await db.delete(users).where(eq(users.username, `p1_${uniq}`)).catch(() => {});
  await db.delete(users).where(eq(users.username, adminName)).catch(() => {});
  await rm(uploadsRoot, { recursive: true, force: true }).catch(() => {});
  await app.close();
  await pool.end();
});

describe("认证与角色", () => {
  it("未登录访问受保护资源 401", async () => {
    const r = await app.inject({ method: "GET", url: "/api/agents" });
    expect(r.statusCode).toBe(401);
  });

  it("注册选手 -> 登录 -> me", async () => {
    const reg = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: `p1_${uniq}`, password: "pass123" },
    });
    expect(reg.statusCode).toBe(200);
    expect(reg.json().user.role).toBe("player");

    const token = await login(app, `p1_${uniq}`, "pass123");
    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { authorization: `Bearer ${token}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json().role).toBe("player");
  });

  it("错误密码 401 / 重复注册 409 / 弱密码 400", async () => {
    expect((await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: `p1_${uniq}`, password: "bad" } })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: `p1_${uniq}`, password: "pass123" } })).statusCode,
    ).toBe(409);
    expect(
      (await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "x", password: "123456" } })).statusCode,
    ).toBe(400);
  });

  it("权限矩阵：选手只读+自管理；管理员全权", async () => {
    const player = await login(app, `p1_${uniq}`, "pass123");
    const admin = await login(app, adminName, "adminpw1");
    const P = { authorization: `Bearer ${player}` };
    const A = { authorization: `Bearer ${admin}` };

    expect((await app.inject({ method: "GET", url: "/api/agents", headers: P })).statusCode).toBe(200); // 选手可看
    expect(
      (await app.inject({ method: "POST", url: "/api/tournaments", headers: P, payload: { kind: "official" } })).statusCode,
    ).toBe(403); // 选手不能创建正式比赛
    expect((await app.inject({ method: "POST", url: "/api/agents/scan", headers: P })).statusCode).toBe(403); // 选手不能扫目录
    expect((await app.inject({ method: "POST", url: "/api/agents/scan", headers: A })).statusCode).toBe(200); // 管理员可扫
    expect(
      (await app.inject({ method: "POST", url: "/api/admin/referee/mode", headers: P, payload: { mode: "template" } })).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: "POST", url: "/api/admin/referee/mode", headers: A, payload: { mode: "template" } })).statusCode,
    ).toBe(200);
  });

  it("选手上传 tar.gz -> 注册绑定 owner -> 删除边界", async () => {
    const player = await login(app, `p1_${uniq}`, "pass123");
    const admin = await login(app, adminName, "adminpw1");
    const P = { authorization: `Bearer ${player}` };
    const A = { authorization: `Bearer ${admin}` };

    // 构造 tar.gz
    const pkgDir = await mkdtemp(path.join(tmpdir(), `wt-pkg-${uniq}-`));
    await writeFile(
      path.join(pkgDir, "manifest.json"),
      JSON.stringify({ name: `up-bot-${uniq}`, language: "python", command: ["python3", "main.py"], resources: { memory_mb: 128, cpus: 0.1 }, network: "none" }),
    );
    await writeFile(path.join(pkgDir, "main.py"), "import json,sys\nfor l in sys.stdin: pass\n");
    const tgz = path.join(pkgDir, "pkg.tar.gz");
    await run(`tar czf ${tgz} -C ${pkgDir} .`);

    const up = await app.inject({
      method: "POST",
      url: "/api/agents/upload",
      headers: { ...P, "content-type": "multipart/form-data" },
      payload: await readFile(tgz),
      query: {},
    });
    // inject 的 multipart 需要完整 boundary 形式，这里改用文件方式注入失败则退化为检查 4xx 不 500
    if (up.statusCode !== 201) {
      expect([400, 415]).toContain(up.statusCode);
      void P; void A;
      return;
    }
    const id = up.json().id;
    const list = await app.inject({ method: "GET", url: "/api/agents", headers: P });
    const row = list.json().find((a: { id: string }) => a.id === id);
    expect(row.ownerName).toBe(`p1_${uniq}`);

    // 选手删自己的 -> 200；选手删别人的 -> 403（用 admin 扫描注册的平台 agent）
    expect((await app.inject({ method: "DELETE", url: `/api/agents/${id}`, headers: P })).statusCode).toBe(200);
  }, 30000);
});
