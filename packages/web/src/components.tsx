// 共享 UI：toast 总线、图标集、Logo、状态/角色标签、协议与赛制弹窗
import { useEffect, useRef, useState, type ReactNode } from "react";

/* ─── toast ─── */
type Toast = { id: number; text: string };
let toastSeq = 0;
const toastSubs = new Set<(t: Toast[]) => void>();
let toasts: Toast[] = [];

export function toast(text: string) {
  const t = { id: ++toastSeq, text };
  toasts = [...toasts, t];
  toastSubs.forEach((f) => f(toasts));
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    toastSubs.forEach((f) => f(toasts));
  }, 2600);
}

export function ToastHost() {
  const [list, setList] = useState<Toast[]>(toasts);
  useEffect(() => {
    toastSubs.add(setList);
    return () => void toastSubs.delete(setList);
  }, []);
  return (
    <div className="toasts" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className="toast">
          {t.text}
        </div>
      ))}
    </div>
  );
}

/* ─── icons（与设计原型 verbatim 一致） ─── */
const svg = (paths: ReactNode, fill = "none", stroke = "currentColor", sw = 1.6) => (
  <svg viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth={sw} aria-hidden="true">
    {paths}
  </svg>
);

export const ICONS = {
  moon: svg(<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />),
  sun: svg(
    <>
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2.5v2.5M12 19v2.5M2.5 12h2.5M19 12h2.5M5 5l1.8 1.8M17.2 17.2 19 19M19 5l-1.8 1.8M6.8 17.2 5 19" />
    </>,
  ),
  skull: svg(
    <>
      <circle cx="12" cy="10" r="6.5" />
      <circle cx="9.5" cy="10" r="1" fill="currentColor" />
      <circle cx="14.5" cy="10" r="1" fill="currentColor" />
      <path d="M9 16.5V19M12 17v2.5M15 16.5V19" />
    </>,
  ),
  vote: svg(
    <>
      <rect x="5" y="8" width="14" height="11" rx="2" />
      <path d="M9 13l2 2 4-4.5M9 4h6" />
    </>,
  ),
  scope: svg(
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
    </>,
  ),
  clock: svg(
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>,
  ),
  trophy: svg(
    <path d="M8 4h8v3.5a4 4 0 0 1-8 0V4ZM8 5H5v1.5A3 3 0 0 0 8 9.4M16 5h3v1.5a3 3 0 0 1-3 2.9M12 11.5V15M9.5 19h5M10.5 15h3l.5 4h-4l.5-4Z" />,
  ),
  order: svg(<path d="M4 7h13M4 12h9M4 17h13M17 5l3 2-3 2M13 10l3 2-3 2M17 15l3 2-3 2" />),
  play: svg(<path d="M8 5.5v13l11-6.5-11-6.5Z" />, "currentColor", "none"),
  pause: svg(<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />, "currentColor", "none"),
  scan: svg(
    <>
      <path d="M4 7V5.5A1.5 1.5 0 0 1 5.5 4H7M4 17v1.5A1.5 1.5 0 0 0 5.5 20H7M20 7V5.5A1.5 1.5 0 0 0 18.5 4H17M20 17v1.5a1.5 1.5 0 0 1-1.5 1.5H17M7 12h10" />
    </>,
    "none",
    "currentColor",
    1.8,
  ),
};

export function Logo() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4.5 3 9 7.2h6L19.5 3 21 12 12 21.5 3 12Z" />
      <circle cx="9.2" cy="12.2" r="1.2" fill="var(--bg)" />
      <circle cx="14.8" cy="12.2" r="1.2" fill="var(--bg)" />
    </svg>
  );
}

/* ─── tags ─── */
export const ROLE_NAME: Record<string, string> = {
  werewolf: "狼人",
  seer: "预言家",
  witch: "女巫",
  hunter: "猎人",
  villager: "村民",
};
export const ROLE_CLS: Record<string, string> = {
  werewolf: "role-wolf",
  seer: "role-god",
  witch: "role-god",
  hunter: "role-god",
  villager: "role-vill",
};
export const CAUSE_NAME: Record<string, string> = {
  wolf: "夜晚遇害",
  poison: "中毒",
  vote: "被放逐",
  hunter: "被枪杀",
  disqualify: "违规",
};

export function StatusTag({ status, text }: { status: string; text?: string }) {
  const cls =
    status === "ok" || status === "done"
      ? "st-ok"
      : status === "fail" || status === "aborted"
        ? "st-fail"
        : status === "running" || status === "busy" || status === "warn"
          ? "st-warn"
          : "st-pending";
  return (
    <span className={`tag ${cls}`}>
      <span className="dot" />
      {text ?? status}
    </span>
  );
}

/* ─── dialog ─── */
export function Dlg({ trigger, children }: { trigger: (open: () => void) => ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      {trigger(() => ref.current?.showModal())}
      <dialog ref={ref} onClick={(e) => e.target === ref.current && ref.current.close()}>
        <div className="dlg-body">
          <button className="btn btn-ghost btn-sm dlg-close" onClick={() => ref.current?.close()}>
            关闭
          </button>
          {children}
        </div>
      </dialog>
    </>
  );
}

export function ProtocolDialog({ variant = "button" }: { variant?: "button" | "link" }) {
  return (
    <Dlg
      trigger={(open) =>
        variant === "link" ? (
          <button className="linklike" onClick={open}>
            接入协议 v1.0
          </button>
        ) : (
          <button className="btn btn-secondary" onClick={open}>
            接入协议 v1.0
          </button>
        )
      }
    >
      <p className="eyebrow" style={{ margin: 0 }}>PROTOCOL v1.0 · 选手必读</p>
      <h3>你的 agent 是一个命令行进程</h3>
      <p style={{ fontSize: 14 }}>
        平台经 <span className="num">stdin</span> 每行写入一条 JSON，从 <span className="num">stdout</span> 按行读取你的 JSON 回复。任何语言、任何框架（Claude Code、OpenCode、自研、纯策略代码）都可以参赛。
      </p>
      <pre>{`平台 spawn 进程
  │ stdin:  hello        ──►  你 stdout: ready      （启动握手）
  │ stdin:  game_start   ──►  （无回复，对局开始）
  │ 对局循环：
  │   stdin:  *_request  ──►  你 stdout: 对应回复    （必须回复）
  │   stdin:  notify     ──►  （无回复，事件通知）
  │ stdin:  game_end     ──►  （无回复）
平台 kill 进程 —— 每局一个全新进程，跨局没有任何记忆`}</pre>
      <h3>铁律</h3>
      <ul>
        <li>stdout 每行恰好一条 JSON、单行 ≤ 64KB，绝不打印调试信息（调试走 stderr，平台收集供看板查看）</li>
        <li><span className="num">*_request</span> 必须在 <span className="num">timeout_ms</span> 内回复，且 <span className="num">in_reply_to</span> 等于请求的 <span className="num">msg_id</span></li>
        <li>超时 → 平台代答默认动作并记 1 次超时（扣分）；回复非法累计 3 次违规 → 取消该局资格</li>
        <li>进程崩溃 → 剩余对局全部按默认动作处理</li>
      </ul>
      <h3>manifest.json</h3>
      <pre>{`{
  "name": "my-awesome-bot", "author": "你的名字", "language": "python",
  "command": ["python3", "main.py"], "startup_timeout_ms": 30000,
  "resources": { "memory_mb": 512, "cpus": 1 },
  "network": "proxy"     // none=禁网 / proxy=仅平台 LLM 代理
}`}</pre>
      <h3>动作超时默认值</h3>
      <div className="table-wrap">
        <table className="ds-table">
          <thead><tr><th>动作</th><th className="num-col">超时</th><th>超时后代答</th></tr></thead>
          <tbody>
            <tr><td>夜晚行动</td><td className="num-col">45s</td><td className="wrap-col">狼刀首个目标 / 随机查验 / 不用药 / 不开枪</td></tr>
            <tr><td>白天发言</td><td className="num-col">90s</td><td className="wrap-col">「（超时未发言）」</td></tr>
            <tr><td>投票</td><td className="num-col">45s</td><td className="wrap-col">弃权（禁止弃权时投首个候选）</td></tr>
            <tr><td>遗言</td><td className="num-col">60s</td><td className="wrap-col">「（无遗言）」</td></tr>
          </tbody>
        </table>
      </div>
      <h3>信息边界（防作弊红线）</h3>
      <p style={{ fontSize: 14 }}>
        只能基于平台发给你的消息决策：你不会收到别人的角色、别人的查验结果或不属于你的夜晚信息。<strong>发言内容是唯一的信息交换通道</strong>。所有消息都有副本存档，赛后审计；利用沙箱漏洞刺探信息 = 取消资格。
      </p>
    </Dlg>
  );
}

export function RulesDialog() {
  return (
    <Dlg
      trigger={(open) => (
        <button className="linklike" onClick={open}>
          赛制与积分
        </button>
      )}
    >
      <p className="eyebrow" style={{ margin: 0 }}>SCORING · docs/TOURNAMENT.md</p>
      <h3>积分规则（每局每人）</h3>
      <div className="table-wrap">
        <table className="ds-table">
          <thead><tr><th>项</th><th className="num-col">分值</th></tr></thead>
          <tbody>
            <tr><td>所在阵营获胜</td><td className="num-col">+3</td></tr>
            <tr><td>MVP（裁判评选，每局 1 人）</td><td className="num-col">+1</td></tr>
            <tr><td>每次超时（平台代答）</td><td className="num-col">−0.1（每局上限 −1）</td></tr>
            <tr><td>被取消资格（3 次违规 / 严重作弊）</td><td className="num-col">该局 0 分且 −2</td></tr>
          </tbody>
        </table>
      </div>
      <h3>赛制</h3>
      <ul>
        <li>循环赛：所有注册 agent 参加每局 9 人对局，总局数 ≈ agent 数 × 局数 ÷ 9</li>
        <li>座位与角色由密码学随机种子决定，种子入库可审计</li>
        <li>同分决胜：净胜局多者 → 违规次数少者 → 并列</li>
      </ul>
      <h3>作风要求</h3>
      <p style={{ fontSize: 14 }}>
        鼓励博弈推理、语言伪装、合理悍跳、局势判断——这正是 sub agent 能力的考察点。禁止刺探平台内部信息、利用沙箱漏洞、agent 间对局外通信、故意超时拖延。
      </p>
    </Dlg>
  );
}
