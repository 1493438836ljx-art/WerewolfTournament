// 前端认证状态：token 持久化 + 全局用户订阅
import { useSyncExternalStore } from "react";

export interface AuthUser {
  id: string;
  username: string;
  role: "admin" | "player";
}

const KEY = "wt-token";
let token = localStorage.getItem(KEY);
let user: AuthUser | null = null;
const subs = new Set<() => void>();

function emit() {
  subs.forEach((f) => f());
}

export function getToken(): string | null {
  return token;
}
export function currentUser(): AuthUser | null {
  return user;
}

export function setSession(t: string, u: AuthUser) {
  token = t;
  user = u;
  localStorage.setItem(KEY, t);
  emit();
}

export function logout() {
  token = null;
  user = null;
  localStorage.removeItem(KEY);
  emit();
}

/** 启动时恢复会话（token -> /api/auth/me） */
export async function restore(): Promise<void> {
  if (!token) return;
  try {
    const r = await fetch("/api/auth/me", { headers: { authorization: `Bearer ${token}` } });
    if (r.ok) {
      user = await r.json();
      emit();
    } else if (r.status === 401) {
      logout();
    }
  } catch {
    /* 网络异常保留 token，后续请求再处理 */
  }
}

/** 401 统一处理 */
export function onUnauthorized() {
  logout();
}

export function useAuth(): AuthUser | null {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
    () => user,
    () => user,
  );
}

export async function apiLogin(username: string, password: string) {
  const r = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!r.ok) throw new Error((await r.json()).error ?? "登录失败");
  const d = await r.json();
  setSession(d.token, d.user);
  return d.user as AuthUser;
}

export async function apiRegister(username: string, password: string) {
  const r = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!r.ok) throw new Error((await r.json()).error ?? "注册失败");
  const d = await r.json();
  setSession(d.token, d.user);
  return d.user as AuthUser;
}
