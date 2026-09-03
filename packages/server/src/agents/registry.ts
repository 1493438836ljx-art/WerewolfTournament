// Agent 注册表：扫描 agents/ 目录、DB CRUD、selfcheck 结果缓存。
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { agents } from "../db/schema.js";
import { loadManifest, type LoadedAgent } from "./manifest.js";

export async function registerAgent(dir: string): Promise<string> {
  const loaded: LoadedAgent = loadManifest(dir);
  const id = `agent-${randomUUID().slice(0, 8)}`;
  await db.insert(agents).values({
    id,
    name: loaded.manifest.name,
    dir: loaded.dir,
    manifestJson: loaded.manifest,
    selfcheckStatus: "pending",
  });
  return id;
}

/** 扫描目录下所有含 manifest.json 的子目录并注册（幂等：按 dir 去重更新） */
export async function scanAndRegister(rootDir: string): Promise<{ added: string[]; updated: string[] }> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const added: string[] = [];
  const updated: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".") || e.name === "node_modules") continue;
    const dir = path.join(rootDir, e.name);
    try {
      await stat(path.join(dir, "manifest.json"));
    } catch {
      continue;
    }
    const loaded = loadManifest(dir);
    const existing = await db.select().from(agents).where(eq(agents.dir, loaded.dir)).limit(1);
    if (existing.length > 0) {
      await db
        .update(agents)
        .set({ name: loaded.manifest.name, manifestJson: loaded.manifest })
        .where(eq(agents.id, existing[0]!.id));
      updated.push(existing[0]!.id);
    } else {
      const id = `agent-${randomUUID().slice(0, 8)}`;
      await db.insert(agents).values({
        id,
        name: loaded.manifest.name,
        dir: loaded.dir,
        manifestJson: loaded.manifest,
      });
      added.push(id);
    }
  }
  return { added, updated };
}

export async function listAgents() {
  return db.select().from(agents).orderBy(agents.createdAt);
}

export async function getAgent(id: string) {
  const rows = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function removeAgent(id: string) {
  await db.delete(agents).where(eq(agents.id, id));
}

export async function updateSelfcheck(id: string, status: "ok" | "fail", detail: unknown) {
  await db.update(agents).set({ selfcheckStatus: status, selfcheckDetail: detail }).where(eq(agents.id, id));
}
