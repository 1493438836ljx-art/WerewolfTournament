// 沙箱适配器：控制选手 agent 进程的运行环境。
// - none   本地开发：环境变量清洗 + 超时击杀（无强隔离，仅调试用）
// - docker 正式比赛：每 agent 一个容器 —— 网络隔离（none / 仅 LLM 代理的专用网桥）、
//         内存/CPU/pids 按 manifest 强制、只读根文件系统 + tmpfs 工作目录、非 root、
//         源码只读挂载，--rm 自动回收。
import type { AgentManifest } from "./manifest.js";

export type SandboxMode = "none" | "docker";

export interface SpawnPlan {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
}

export interface SandboxContext {
  gameId: string;
  seat: number;
  /** agent 源码目录（manifest 所在目录） */
  agentDir: string;
  /** 分配给该进程的可写工作目录（docker 模式映射为容器内 /tmp/work） */
  workDir: string;
  /** 平台 LLM 代理地址（manifest.network=proxy 时注入；docker 模式应传 host.docker.internal 形式） */
  llmProxyUrl?: string;
  llmProxyToken?: string;
  llmProxyModel?: string;
}

/** 平台敏感环境变量绝不让选手进程看到 */
const ENV_ALLOWLIST_PREFIXES = ["PATH", "HOME", "LANG", "LC_", "TMPDIR", "WT_", "PYTHON", "NODE"];

/** docker 模式注入容器的变量（白名单进一步收紧到 WT_*） */
const DOCKER_ENV_KEYS = ["WT_GAME_ID", "WT_SEAT", "WT_WORK_DIR", "WT_LLM_PROXY_URL", "WT_LLM_PROXY_TOKEN", "WT_AGENT_LLM_MODEL"];

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

/** 按语言映射运行时镜像（manifest.image 可覆盖，供审批后的自定义镜像） */
export function imageFor(manifest: AgentManifest): string {
  const lang = (manifest as { image?: string }).image ?? "";
  if (lang) return lang;
  const l = manifest.language.toLowerCase();
  if (l.includes("node") || l.includes("typescript") || l.includes("js")) return "wt-agent-node:latest";
  return "wt-agent-python:latest";
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
      // 开发模式：直接在 agent 源码目录运行（docker 模式则容器化）
      return { command: command!, args, env, cwd: ctx.agentDir };
    },
  };
}

export function dockerSandbox(): SandboxAdapter {
  return {
    mode: "docker",
    plan(manifest, ctx) {
      const inner = noneSandbox().plan(manifest, ctx);

      const env: Record<string, string> = {};
      for (const k of DOCKER_ENV_KEYS) {
        if (inner.env[k] !== undefined) env[k] = inner.env[k]!;
      }
      // 容器内工作目录固定为 /tmp/work（tmpfs 可写）
      env.WT_WORK_DIR = "/tmp/work";

      const args: string[] = [
        "run",
        "-i", // 保持 stdin 管道（协议通道）
        "--rm", // 退出自动回收
        "--name", `wt-agent-${ctx.gameId}-s${ctx.seat}`,
        // 网络：禁网 或 仅可达 LLM 代理的专用网桥（容器互访已禁用 icc）
        "--network", manifest.network === "proxy" ? "wt-agent-net" : "none",
        // 资源限制（按 manifest 强制）
        "--memory", `${manifest.resources.memory_mb}m`,
        "--memory-swap", `${manifest.resources.memory_mb}m`, // 禁 swap 放大
        "--cpus", String(manifest.resources.cpus),
        "--pids-limit", "128",
        // 文件系统：只读根 + tmpfs 工作区
        "--read-only",
        "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m",
        // 非 root
        "--user", "10001:10001",
        // 源码只读挂载（宿主绝对路径 -> /agent）
        "-v", `${ctx.agentDir}:/agent:ro`,
        "-w", "/agent",
      ];
      // Linux 宿主需要显式网关映射；Docker Desktop（macOS/Win）自带 host.docker.internal
      if (manifest.network === "proxy") {
        args.push("--add-host", "host.docker.internal:host-gateway");
      }
      for (const [k, v] of Object.entries(env)) {
        args.push("-e", `${k}=${v}`);
      }
      args.push(imageFor(manifest), inner.command, ...inner.args);
      // docker CLI 进程保留白名单环境（PATH 解析可执行文件、HOME 读客户端配置）；
      // 容器内 env 全部经 -e 显式注入，此处不构成泄漏面
      return { command: "docker", args, env: cleanEnv(), cwd: ctx.workDir };
    },
  };
}

export function sandboxFor(mode: SandboxMode): SandboxAdapter {
  if (mode === "none") return noneSandbox();
  if (mode === "docker") return dockerSandbox();
  throw new Error(`unknown sandbox mode ${mode}`);
}
