import type { AuthInfo, Platform } from '@/types';

const TOKEN_KEY: Record<Platform, string> = {
  github: 'svp-token-github',
  gitee: 'svp-token-gitee',
  atomgit: 'svp-token-atomgit',
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

export function saveSession(info: AuthInfo): void {
  localStorage.setItem('svp-session', JSON.stringify(info));
}

export function logout(): void {
  localStorage.removeItem('svp-session');
  for (const platform of Object.keys(TOKEN_KEY) as Platform[]) clearToken(platform);
}

/**
 * GitHub Device Flow 登录骨架：
 * 1. POST https://github.com/login/device/code 获取 user_code / device_code
 * 2. 引导用户在浏览器输入 user_code 完成授权
 * 3. 轮询 https://github.com/login/oauth/access_token 获取 token
 * 需要部署时配置 PUBLIC_GITHUB_CLIENT_ID；生产环境建议通过后端代理避免暴露 client。
 */
export async function requestDeviceCode(): Promise<{
  userCode: string;
  verificationUri: string;
  deviceCode: string;
  interval: number;
}> {
  if (!GITHUB_CLIENT_ID) {
    throw new Error('GitHub OAuth client id is not configured');
  }
  const response = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: new URLSearchParams({ client_id: GITHUB_CLIENT_ID, scope: 'repo' }),
  });
  if (!response.ok) throw new Error(`Device flow failed: ${response.status}`);
  const data = await response.json();
  return {
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    deviceCode: data.device_code,
    interval: data.interval ?? 5,
  };
}
