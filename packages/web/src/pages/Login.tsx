import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiLogin, apiRegister } from "../auth.js";
import { Logo, toast } from "../components.js";

export function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setErr("");
    setBusy(true);
    try {
      const user =
        mode === "login" ? await apiLogin(username.trim(), password) : await apiRegister(username.trim(), password);
      toast(`欢迎，${user.username}（${user.role === "admin" ? "管理员" : "选手"}）`);
      navigate("/");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="section screen-pad">
      <div className="container" style={{ maxWidth: 440 }}>
        <div className="card">
          <div className="stack" style={{ gap: 18, alignItems: "center", paddingTop: 12 }}>
            <Logo />
            <div style={{ textAlign: "center" }}>
              <p className="eyebrow" style={{ margin: "0 0 6px" }}>
                {mode === "login" ? "SIGN IN" : "SIGN UP"}
              </p>
              <h1 className="screen-title" style={{ fontSize: 20 }}>
                {mode === "login" ? "登录控制台" : "选手注册"}
              </h1>
            </div>

            <div className="field" style={{ width: "100%" }}>
              <label htmlFor="l-user">用户名</label>
              <input
                className="input"
                id="l-user"
                value={username}
                autoComplete="username"
                placeholder="3-32 位字母数字 / _ -"
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
            </div>
            <div className="field" style={{ width: "100%" }}>
              <label htmlFor="l-pass">密码</label>
              <input
                className="input"
                id="l-pass"
                type="password"
                value={password}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                placeholder="至少 6 位"
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
            </div>

            {err && <p className="form-error" style={{ width: "100%" }}>{err}</p>}

            <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} onClick={submit} disabled={busy}>
              {busy ? "处理中…" : mode === "login" ? "登录" : "注册并登录"}
            </button>

            <p className="meta" style={{ fontSize: 12.5 }}>
              {mode === "login" ? (
                <>
                  没有账号？
                  <button className="linklike" onClick={() => setMode("register")}>
                    选手注册
                  </button>
                </>
              ) : (
                <>
                  已有账号？
                  <button className="linklike" onClick={() => setMode("login")}>
                    直接登录
                  </button>
                </>
              )}
            </p>
            <p className="meta" style={{ fontSize: 11.5, textAlign: "center" }}>
              管理员账号由赛事方分配；选手注册后即可上传自己的 agent 参赛
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
