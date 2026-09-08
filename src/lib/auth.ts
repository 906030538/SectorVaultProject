import type { AuthInfo, Platform } from '@/types';
import { AUTH_COOKIE_MAX_AGE, deleteCookie, readCookie, writeCookie } from '@/lib/cookies';

const TOKEN_KEY: Record<Platform, string> = {
  github: 'svp-token-github',
  gitee: 'svp-token-gitee',
  atomgit: 'svp-token-atomgit',
  gitcode: 'svp-token-gitcode',
};

/** GitHub Device Flow / GitHub App 的 OAuth Client ID（部署时通过构建配置注入） */
export const GITHUB_CLIENT_ID = import.meta.env.PUBLIC_GITHUB_CLIENT_ID ?? '';

export function getToken(platform: Platform): string | null {
  const key = TOKEN_KEY[platform];
  const local = localStorage.getItem(key);
  if (local !== null) return local;
  // 跨子域恢复：localStorage 缺失时读父域 cookie（其他子域登录写入）
  const shared = readCookie(key);
  if (shared) localStorage.setItem(key, shared);
  return shared;
}

export function setToken(platform: Platform, token: string): void {
  localStorage.setItem(TOKEN_KEY[platform], token);
  writeCookie(TOKEN_KEY[platform], token, { maxAge: AUTH_COOKIE_MAX_AGE });
}

export function clearToken(platform: Platform): void {
  localStorage.removeItem(TOKEN_KEY[platform]);
  deleteCookie(TOKEN_KEY[platform]);
}

export function loadSession(): AuthInfo | null {
  return parseSession('svp-session');
}

/** 指定平台的登录会话（多平台 token 并存时按平台分别保存） */
export function loadSessionBy(platform: Platform): AuthInfo | null {
  return parseSession(`svp-session-${platform}`);
}

function parseSession(key: string): AuthInfo | null {
  const read = (source: string | null): AuthInfo | null => {
    if (!source) return null;
    try {
      return JSON.parse(source) as AuthInfo;
    } catch {
      return null;
    }
  };
  const local = read(localStorage.getItem(key));
  if (local) return local;
  const shared = read(readCookie(key));
  if (shared) localStorage.setItem(key, JSON.stringify(shared));
  return shared;
}

export function saveSession(info: AuthInfo): void {
  // svp-session 为最近登录（导航头像展示用）；各平台会话分别保存
  const raw = JSON.stringify(info);
  localStorage.setItem('svp-session', raw);
  localStorage.setItem(`svp-session-${info.platform}`, raw);
  writeCookie('svp-session', raw, { maxAge: AUTH_COOKIE_MAX_AGE });
  writeCookie(`svp-session-${info.platform}`, raw, { maxAge: AUTH_COOKIE_MAX_AGE });
}

export function logout(): void {
  localStorage.removeItem('svp-session');
  deleteCookie('svp-session');
  for (const platform of Object.keys(TOKEN_KEY) as Platform[]) {
    clearToken(platform);
    localStorage.removeItem(`svp-session-${platform}`);
    deleteCookie(`svp-session-${platform}`);
  }
}

/** 退出指定平台登录（保留其他平台）；最近登录会话属于该平台时一并清除 */
export function logoutPlatform(platform: Platform): void {
  const last = loadSession();
  clearToken(platform);
  localStorage.removeItem(`svp-session-${platform}`);
  deleteCookie(`svp-session-${platform}`);
  if (last?.platform === platform) {
    localStorage.removeItem('svp-session');
    deleteCookie('svp-session');
  }
}

/**
 * 已有登录态迁移：localStorage 存在而 cookie 缺失时补写镜像。
 * 页面加载时调用，让既有用户在兄弟子域（cf.svp.lyoko.cn 等）直接可用。
 */
export function syncAuthToCookies(): void {
  for (const platform of Object.keys(TOKEN_KEY) as Platform[]) {
    const token = localStorage.getItem(TOKEN_KEY[platform]);
    if (token && !readCookie(TOKEN_KEY[platform])) {
      writeCookie(TOKEN_KEY[platform], token, { maxAge: AUTH_COOKIE_MAX_AGE });
    }
    const key = `svp-session-${platform}`;
    const session = localStorage.getItem(key);
    if (session && !readCookie(key)) writeCookie(key, session, { maxAge: AUTH_COOKIE_MAX_AGE });
  }
  const last = localStorage.getItem('svp-session');
  if (last && !readCookie('svp-session')) {
    writeCookie('svp-session', last, { maxAge: AUTH_COOKIE_MAX_AGE });
  }
}

/**
 * GitHub Device Flow 登录骨架：
 * 1. POST https://github.com/login/device/code 获取 user_code / device_code
 * 2. 引导用户在浏览器输入 user_code 完成授权
 * 3. 轮询 https://github.com/login/oauth/access_token 获取 token
 * 需要部署时配置 PUBLIC_GITHUB_CLIENT_ID；生产环境建议通过后端代理避免暴露 client。
 */
export interface DeviceCodeInfo {
  userCode: string;
  verificationUri: string;
  deviceCode: string;
  interval: number;
}

/** GitHub App 设备授权流第一步：获取 user_code（clientId 来自 deployment.json 或环境变量） */
export async function requestDeviceCode(
  clientId: string,
  deviceCodeUrl = 'https://github.com/login/device/code',
): Promise<DeviceCodeInfo> {
  const response = await fetch(deviceCodeUrl, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: new URLSearchParams({ client_id: clientId, scope: 'repo' }),
  });
  if (!response.ok) throw new Error(`Device flow failed: ${response.status}`);
  // GitHub API 返回 snake_case（user_code / verification_uri / device_code）
  const data = (await response.json()) as Record<string, unknown>;
  return {
    userCode: (data.user_code as string) ?? '',
    verificationUri: (data.verification_uri as string) ?? 'https://github.com/login/device',
    deviceCode: (data.device_code as string) ?? '',
    interval: (data.interval as number) ?? 5,
  };
}

/** 设备授权流轮询：用户确认前 pending，确认后返回 access_token；支持取消 */
export async function pollDeviceToken(
  clientId: string,
  deviceCode: string,
  intervalSeconds: number,
  signal?: AbortSignal,
  tokenUrl = 'https://github.com/login/oauth/access_token',
): Promise<string> {
  const intervalMs = Math.max(1, intervalSeconds) * 1000;
  for (;;) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: new URLSearchParams({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });
    if (!response.ok) throw new Error(`Device token poll failed: ${response.status}`);
    const data = (await response.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
      interval?: number;
    };
    if (data.access_token) return data.access_token;
    if (data.error === 'authorization_pending') continue;
    if (data.error === 'slow_down') {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      continue;
    }
    throw new Error(data.error_description ?? data.error ?? 'Device flow failed');
  }
}
