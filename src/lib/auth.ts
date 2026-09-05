import type { AuthInfo, Platform } from '@/types';

const TOKEN_KEY: Record<Platform, string> = {
  github: 'svp-token-github',
  gitee: 'svp-token-gitee',
  atomgit: 'svp-token-atomgit',
  gitcode: 'svp-token-gitcode',
};

/** GitHub Device Flow / GitHub App 的 OAuth Client ID（部署时通过构建配置注入） */
export const GITHUB_CLIENT_ID = import.meta.env.PUBLIC_GITHUB_CLIENT_ID ?? '';

export function getToken(platform: Platform): string | null {
  return localStorage.getItem(TOKEN_KEY[platform]);
}

export function setToken(platform: Platform, token: string): void {
  localStorage.setItem(TOKEN_KEY[platform], token);
}

export function clearToken(platform: Platform): void {
  localStorage.removeItem(TOKEN_KEY[platform]);
}

export function loadSession(): AuthInfo | null {
  const raw = localStorage.getItem('svp-session');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthInfo;
  } catch {
    return null;
  }
}

/** 指定平台的登录会话（多平台 token 并存时按平台分别保存） */
export function loadSessionBy(platform: Platform): AuthInfo | null {
  const raw = localStorage.getItem(`svp-session-${platform}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthInfo;
  } catch {
    return null;
  }
}

export function saveSession(info: AuthInfo): void {
  // svp-session 为最近登录（导航头像展示用）；各平台会话分别保存
  localStorage.setItem('svp-session', JSON.stringify(info));
  localStorage.setItem(`svp-session-${info.platform}`, JSON.stringify(info));
}

export function logout(): void {
  localStorage.removeItem('svp-session');
  for (const platform of Object.keys(TOKEN_KEY) as Platform[]) {
    clearToken(platform);
    localStorage.removeItem(`svp-session-${platform}`);
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
