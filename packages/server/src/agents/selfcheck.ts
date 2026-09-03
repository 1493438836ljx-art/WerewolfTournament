// Agent 连通性自检：spawn -> hello -> ready -> kill。
export interface SelfcheckResult {
  ok: boolean;
  latencyMs: number;
  agentName?: string;
  error?: string;
  stderrTail?: string[];
}

export async function selfcheck(
  spawnFn: () => Promise<{ ready: Promise<{ agentName?: string }>; kill: (reason: string) => Promise<void>; stderrTail: string[]; hasExited: boolean }>,
  timeoutMs = 20_000,
): Promise<SelfcheckResult> {
  const t0 = Date.now();
  let handle: Awaited<ReturnType<typeof spawnFn>> | undefined;
  try {
    handle = await spawnFn();
    const timer = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`自检超时 ${timeoutMs}ms`)), timeoutMs).unref?.(),
    );
    await Promise.race([handle.ready, timer]);
    return {
      ok: true,
      latencyMs: Date.now() - t0,
      agentName: (await handle.ready).agentName,
    };
  } catch (e) {
    return {
      ok: false,
      latencyMs: Date.now() - t0,
      error: e instanceof Error ? e.message : String(e),
      stderrTail: handle?.stderrTail.slice(-20),
    };
  } finally {
    await handle?.kill("selfcheck").catch(() => {});
  }
}
