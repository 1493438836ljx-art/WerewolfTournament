// 沙箱适配器：控制选手 agent 进程的运行环境。
// - none   本地开发：环境变量清洗 + 独立工作目录 + 超时击杀（无强隔离）
// - docker 正式赛（Linux 宿主）：容器隔离（网络/内存/CPU/pids/只读文件系统）
import type { AgentManifest } from "./manifest.js";

export type SandboxMode = "none" | "docker";

export interface SpawnPlan {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  /** docker 模式的额外说明（预留给容器编排） */
  dockerArgs?: string[];
}

export interface SandboxContext {
  gameId: string;
  seat: number;
  /** agent 源码目录（manifest 所在目录） */
  agentDir: string;
  /** 分配给该进程的可写工作目录（docker 模式挂载为 tmpfs；none 模式经 WT_WORK_DIR 告知） */
  workDir: string;
  /** 平台 LLM 代理地址（manifest.network=proxy 时注入） */
  llmProxyUrl?: string;
  llmProxyToken?: string;
  llmProxyModel?: string;
}

/** 平台敏感环境变量绝不让选手进程看到 */
const ENV_ALLOWLIST_PREFIXES = ["PATH", "HOME", "LANG", "LC_", "TMPDIR", "WT_", "PYTHON", "NODE"];

export function cleanEnv(extra: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (ENV_ALLOWLIST_PREFIXES.some((p) => k === p || k.startsWith(p))) out[k] = v;
  }
  return { ...out, ...extra };
}

export interface SandboxAdapter {
  mode: SandboxMode;
  plan(manifest: AgentManifest, ctx: SandboxContext): SpawnPlan;
}

export function noneSandbox(): SandboxAdapter {
  return {
    mode: "none",
    plan(manifest, ctx) {
      const env: Record<string, string> = cleanEnv({
        WT_GAME_ID: ctx.gameId,
        WT_SEAT: String(ctx.seat),
        WT_WORK_DIR: ctx.workDir,
      });
      if (manifest.network === "proxy" && ctx.llmProxyUrl) {
        env.WT_LLM_PROXY_URL = ctx.llmProxyUrl;
        env.WT_LLM_PROXY_TOKEN = ctx.llmProxyToken ?? "";
        if (ctx.llmProxyModel) env.WT_AGENT_LLM_MODEL = ctx.llmProxyModel;
      }
      const [command, ...args] = manifest.command;
      // 开发模式：直接在 agent 源码目录运行（docker 模式则挂载为只读 /agent）
      return { command: command!, args, env, cwd: ctx.agentDir };
    },
  };
}

/** docker 沙箱（Linux 正式赛）：命令在容器内执行。M8 部署阶段接入真实 docker run 包装。 */
export function dockerSandbox(): SandboxAdapter {
  return {
    mode: "docker",
    plan(manifest, ctx) {
      const inner = noneSandbox().plan(manifest, ctx);
      const dockerArgs = [
        "run", "--rm", "--network", manifest.network === "proxy" ? "wt-agent-net" : "none",
        "--memory", `${manifest.resources.memory_mb}m`,
        "--cpus", String(manifest.resources.cpus),
        "--pids-limit", "128",
        "--read-only",
        "--tmpfs", "/tmp:rw,size=64m",
        "--user", "10001:10001",
        "-v", `${ctx.workDir}:/agent:ro`,
        "-w", "/agent",
      ];
      return {
        command: "docker",
        args: [...dockerArgs, ...dockerEnvArgs(inner.env), "wt-agent-base", inner.command, ...inner.args],
        env: cleanEnv(),
        cwd: ctx.workDir,
        dockerArgs,
      };
    },
  };
}

function dockerEnvArgs(env: Record<string, string>): string[] {
  return Object.entries(env)
    .filter(([k]) => k.startsWith("WT_"))
    .flatMap(([k, v]) => ["-e", `${k}=${v}`]);
}

export function sandboxFor(mode: SandboxMode): SandboxAdapter {
  if (mode === "none") return noneSandbox();
  if (mode === "docker") return dockerSandbox();
  throw new Error(`unknown sandbox mode ${mode}`);
}
