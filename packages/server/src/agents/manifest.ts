// Agent manifest 定义与加载校验。
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

export const agentManifestSchema = z.object({
  name: z.string().min(1).max(64),
  author: z.string().max(64).optional(),
  language: z.string().min(1).max(32),
  command: z.array(z.string().min(1)).min(1),
  startup_timeout_ms: z.number().int().min(1000).max(120_000).optional(),
  resources: z.object({
    memory_mb: z.number().int().min(64).max(4096),
    cpus: z.number().min(0.1).max(4),
  }),
  network: z.enum(["none", "proxy"]),
  /** 审批后的自定义运行时镜像（缺省按 language 映射 wt-agent-python/node） */
  image: z.string().max(128).optional(),
});

export type AgentManifest = z.infer<typeof agentManifestSchema>;

export const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;

export interface LoadedAgent {
  dir: string;
  manifest: AgentManifest;
}

export function loadManifest(dir: string): LoadedAgent {
  const raw = readFileSync(path.join(dir, "manifest.json"), "utf8");
  const parsed = agentManifestSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(`manifest.json 非法: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  return { dir: path.resolve(dir), manifest: parsed.data };
}
