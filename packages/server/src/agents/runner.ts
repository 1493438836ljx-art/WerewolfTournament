// AgentProcess：选手 agent 子进程的生命周期管理。
// stdin/stdout 按行 JSON；请求-响应用 msg_id/in_reply_to 关联；
// 违规计数（乱输出/引用过期请求），调用方决定何时 disqualify。
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import {
  a2pMessageSchema,
  MAX_LINE_BYTES,
  type A2PMessage,
  type P2AMessage,
} from "@wt/protocol";
import type { AgentManifest } from "./manifest.js";
import { DEFAULT_STARTUP_TIMEOUT_MS } from "./manifest.js";
import type { SandboxAdapter, SandboxContext } from "./sandbox.js";

export type RequestResult =
  | { ok: true; res: A2PMessage }
  | { ok: false; err: "timeout" | "crash" | "malformed"; detail?: string };

interface Waiter {
  inReplyTo: string;
  resolve: (r: RequestResult) => void;
  timer: NodeJS.Timeout;
}

export class AgentError extends Error {
  constructor(message: string, readonly kind: "startup_timeout" | "spawn" | "protocol") {
    super(message);
  }
}

export class AgentProcess {
  private proc!: ChildProcess;
  private readonly waiters = new Map<string, Waiter>();
  private readonly pendingInReplyTo = new Set<string>();
  private nextId = 1;
  private killed = false;
  private exited = false;

  violations = 0;
  readonly stderrTail: string[] = [];
  private stderrFull: string[] = [];
  private stdinBuf = "";

  private constructor(
    readonly manifest: AgentManifest,
    readonly gameId: string,
    readonly seat: number,
    readonly agentId: string,
  ) {}

  static async spawn(
    manifest: AgentManifest,
    sandbox: SandboxAdapter,
    ctx: SandboxContext & { agentId: string },
  ): Promise<AgentProcess> {
    const ap = new AgentProcess(manifest, ctx.gameId, ctx.seat, ctx.agentId);
    const plan = sandbox.plan(manifest, ctx);
    try {
      ap.proc = spawn(plan.command, plan.args, {
        cwd: plan.cwd,
        env: plan.env,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (e) {
      throw new AgentError(`spawn 失败: ${e}`, "spawn");
    }

    ap.proc.on("exit", (code, signal) => {
      if (ap.killed) return;
      ap.exited = true;
      const tail = ap.stderrTail.slice(-5).join(" | ").slice(0, 300);
      ap.failAll("crash", `进程退出 code=${code} signal=${signal}${tail ? ` stderr: ${tail}` : ""}`);
    });

    const stdout = ap.proc.stdout;
    if (!stdout || !ap.proc.stdin) throw new AgentError("stdio pipe 不可用", "spawn");
    const rl = createInterface({ input: stdout });
    rl.on("line", (line) => ap.onLine(line));

    const stderr = ap.proc.stderr;
    stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      ap.stderrFull.push(text);
      ap.stderrTail.push(...text.split("\n").filter(Boolean));
      if (ap.stderrTail.length > 200) ap.stderrTail.splice(0, ap.stderrTail.length - 200);
    });

    // 启动握手：hello -> ready
    const helloId = ap.rawId();
    ap.pendingInReplyTo.add(helloId);
    ap.write({
      v: 1,
      type: "hello",
      msg_id: helloId,
      game_id: ctx.gameId,
      ts: new Date().toISOString(),
      you: { agent_id: ctx.agentId },
      protocol_version: "1.0",
    });

    const startupTimeout = manifest.startup_timeout_ms ?? DEFAULT_STARTUP_TIMEOUT_MS;
    return new Promise<AgentProcess>((resolve, reject) => {
      const timer = setTimeout(() => {
        ap.readyPromise = undefined;
        reject(new AgentError(`ready 超时（${startupTimeout}ms）`, "startup_timeout"));
        ap.kill("startup_timeout").catch(() => {});
      }, startupTimeout);
      ap.readyPromise = { resolve, reject, timer };
    });
  }

  private readyPromise?: {
    resolve: (ap: AgentProcess) => void;
    reject: (e: AgentError) => void;
    timer: NodeJS.Timeout;
  };

  get stderr(): string {
    return this.stderrFull.join("");
  }
  get hasExited(): boolean {
    return this.exited;
  }

  private rawId(): string {
    return `m${this.nextId++}-${randomUUID().slice(0, 8)}`;
  }

  private write(msg: Record<string, unknown>) {
    if (this.exited || this.killed) return;
    this.stdinBuf = JSON.stringify(msg) + "\n";
    this.proc.stdin!.write(this.stdinBuf);
  }

  /** 发送需要回复的请求；同一时刻同一 agent 可有多个在途请求（并行收集场景）。
   *  参数为宽松对象：消息由编排器的 toRequestMessage 构造（受控），协议校验在回复侧执行。 */
  request(msg: Record<string, unknown> & { timeout_ms?: number }): Promise<RequestResult> {
    if (this.exited || this.killed) {
      return Promise.resolve({ ok: false, err: "crash", detail: "进程已退出" });
    }
    const full = { ...msg, v: 1, msg_id: this.rawId(), game_id: this.gameId, ts: new Date().toISOString() };
    this.write(full);
    const msgId = full.msg_id as string;
    return new Promise<RequestResult>((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(msgId);
        this.pendingInReplyTo.delete(msgId);
        resolve({ ok: false, err: "timeout" });
      }, timeoutOf(full));
      this.waiters.set(msgId, { inReplyTo: msgId, resolve, timer });
      this.pendingInReplyTo.add(msgId);
    });
  }

  /** 发送通知类消息（不等待回复） */
  notify(msg: Record<string, unknown>): void {
    this.write({ ...msg, v: 1, msg_id: this.rawId(), game_id: this.gameId, ts: new Date().toISOString() });
  }

  private onLine(line: string) {
    if (line.length > MAX_LINE_BYTES) {
      this.violations++;
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      this.violations++; // 非 JSON 输出（调试打印混入 stdout 等）
      return;
    }
    const result = a2pMessageSchema.safeParse(parsed);
    if (!result.success) {
      this.violations++;
      // 关键：若引用了在途请求，立即以 malformed 唤醒 waiter（否则白等到超时）
      const inReplyTo = (parsed as { in_reply_to?: string })?.in_reply_to;
      if (typeof inReplyTo === "string" && this.waiters.has(inReplyTo)) {
        const w = this.waiters.get(inReplyTo)!;
        clearTimeout(w.timer);
        this.waiters.delete(inReplyTo);
        w.resolve({
          ok: false,
          err: "malformed",
          detail: result.error.issues[0]?.message ?? "schema 校验失败",
        });
      }
      return;
    }
    const msg = result.data;

    if (msg.type === "ready") {
      this.pendingInReplyTo.delete(msg.in_reply_to);
      if (this.readyPromise) {
        clearTimeout(this.readyPromise.timer);
        const rp = this.readyPromise;
        this.readyPromise = undefined;
        rp.resolve(this);
      }
      return;
    }

    const waiter = this.waiters.get(msg.in_reply_to);
    if (!waiter) {
      // 引用过期/未知请求 -> 丢弃并计违规
      this.violations++;
      return;
    }
    clearTimeout(waiter.timer);
    this.waiters.delete(msg.in_reply_to);
    this.pendingInReplyTo.delete(msg.in_reply_to);
    waiter.resolve({ ok: true, res: msg });
  }

  private failAll(err: "crash", detail: string) {
    for (const [, w] of this.waiters) {
      clearTimeout(w.timer);
      w.resolve({ ok: false, err, detail });
    }
    this.waiters.clear();
    if (this.readyPromise) {
      clearTimeout(this.readyPromise.timer);
      const rp = this.readyPromise;
      this.readyPromise = undefined;
      // 启动阶段崩溃：以错误结束 spawn（不能伪成功）
      rp.reject(new AgentError(`启动失败: ${detail}`, "spawn"));
    }
  }

  async kill(reason: string): Promise<void> {
    if (this.killed) return;
    this.killed = true;
    this.failAll("crash", `killed: ${reason}`);
    const proc = this.proc;
    if (proc.exitCode !== null || proc.signalCode !== null) return;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        proc.kill("SIGKILL");
        resolve();
      }, 3000);
      proc.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      try {
        proc.kill("SIGTERM");
      } catch {
        resolve();
      }
    });
  }
}

function timeoutOf(msg: Record<string, unknown>): number {
  const t = msg.timeout_ms as number | undefined;
  return t && t > 0 ? t + 2000 : 70_000;
}
