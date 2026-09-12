// 选手作品上传：multipart tar.gz -> 解包校验 -> agents/uploads/<owner>-<name>/ -> 注册。
import { createWriteStream, mkdirSync } from "node:fs";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { extract as tarExtract } from "tar";
import type { FastifyInstance } from "fastify";
import { db } from "./db/index.js";
import { agents } from "./db/schema.js";
import { loadManifest } from "./agents/manifest.js";
import { requireAuth, type AuthUser } from "./auth.js";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const ALLOWED_SUFFIX = /\.(py|js|mjs|ts|json|txt|md|toml|yaml|yml|sh)$/i;

export function registerUploadRoute(app: FastifyInstance, opts: { uploadsRoot: string }) {
  mkdirSync(opts.uploadsRoot, { recursive: true });

  app.post(
    "/api/agents/upload",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const user = req.user as AuthUser;
      const file = await req.file({ limits: { fileSize: MAX_UPLOAD_BYTES } });
      if (!file) return reply.code(400).send({ error: "缺少 tar.gz 文件（字段名 file）" });
      if (!/\.tar\.gz$|\.tgz$/i.test(file.filename)) {
        return reply.code(400).send({ error: "仅支持 .tar.gz / .tgz 上传" });
      }

      const tmp = path.join(opts.uploadsRoot, `tmp-${randomUUID().slice(0, 8)}.tar.gz`);
      await pipeline(file.file, createWriteStream(tmp));

      // 解包到临时目录 -> 校验 manifest 与路径安全 -> 落位
      const staging = path.join(opts.uploadsRoot, `stage-${randomUUID().slice(0, 8)}`);
      try {
        mkdirSync(staging, { recursive: true });
        await tarExtract({ file: tmp, cwd: staging, strip: 1, filter: (p: string) => !p.includes("..") });

        // 定位 manifest.json（支持一级子目录）
        const { readdir } = await import("node:fs/promises");
        let manifestDir = staging;
        const entries = await readdir(staging);
        if (!entries.includes("manifest.json")) {
          const sub = entries.find(async (e) => {
            try {
              const st = await stat(path.join(staging, e));
              return st.isDirectory();
            } catch {
              return false;
            }
          });
          if (sub) manifestDir = path.join(staging, sub);
        }
        await stat(path.join(manifestDir, "manifest.json"));

        const loaded = loadManifest(manifestDir);
        // 文件类型白名单（防御性）
        const walk = async (dir: string): Promise<string[]> => {
          const out: string[] = [];
          for (const e of await readdir(dir, { withFileTypes: true })) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) out.push(...(await walk(full)));
            else out.push(full);
          }
          return out;
        };
        const files = await walk(manifestDir);
        const bad = files.find((f) => !ALLOWED_SUFFIX.test(f));
        if (bad) {
          return reply.code(400).send({ error: `不支持的文件类型: ${path.basename(bad)}（允许: py/js/mjs/ts/json/txt/md/toml/yaml/sh）` });
        }

        // 落位：uploads/<ownername>-<agentname>
        const destDir = path.join(opts.uploadsRoot, `${user.username}-${loaded.manifest.name}`);
        await rm(destDir, { recursive: true, force: true });
        const { cp } = await import("node:fs/promises");
        await cp(manifestDir, destDir, { recursive: true });
        // 附上传元信息
        await writeFile(
          path.join(destDir, "UPLOAD.json"),
          JSON.stringify({ owner: user.username, uploadedAt: new Date().toISOString() }, null, 2),
        );

        // 注册（同名覆盖更新）
        const { eq } = await import("drizzle-orm");
        const existing = await db.select().from(agents).where(eq(agents.dir, destDir)).limit(1);
        let id: string;
        if (existing.length) {
          id = existing[0]!.id;
          await db
            .update(agents)
            .set({ name: loaded.manifest.name, manifestJson: loaded.manifest, selfcheckStatus: "pending", ownerId: user.id })
            .where(eq(agents.id, id));
        } else {
          id = `agent-${randomUUID().slice(0, 8)}`;
          await db.insert(agents).values({
            id,
            name: loaded.manifest.name,
            dir: destDir,
            manifestJson: loaded.manifest,
            ownerId: user.id,
          });
        }
        return reply.code(201).send({ id, name: loaded.manifest.name, dir: destDir });
      } catch (e) {
        return reply.code(400).send({ error: `上传包无效: ${e instanceof Error ? e.message : e}` });
      } finally {
        await rm(tmp, { force: true }).catch(() => {});
        await rm(staging, { recursive: true, force: true }).catch(() => {});
      }
    },
  );

  void readFile; // 保留引用（未来做包内容审计）
}
