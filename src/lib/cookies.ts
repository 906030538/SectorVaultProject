import { getCookieDomain } from '@/lib/index/sources';

/**
 * 跨子域共享存储：与 localStorage 同名的键镜像到父域 cookie
 * （Domain=deployment.json 的 cookieDomain，如 svp.lyoko.cn），
 * 供同父域的其他子域站点（cf.svp.lyoko.cn 等）恢复登录态与索引缓存。
 * cookie 与 localStorage 同为明文可读，不降低也不提高原有安全边界；
 * 未配置 cookieDomain 时只读写本站 cookie（不跨域）。
 */

/** 单个 cookie 的尺寸护栏（编码后），超过则放弃镜像（索引归档可能超限） */
const MAX_COOKIE_LENGTH = 3800;

/** 令牌/会话镜像 cookie 的有效期（秒）：180 天，与平台令牌寿命同量级 */
export const AUTH_COOKIE_MAX_AGE = 180 * 24 * 60 * 60;

export interface CookieWriteOptions {
  /** 秒；缺省为会话 cookie */
  maxAge?: number;
}

/** 配置的父域是否域匹配当前 host（等于或为其子域）；不匹配返回 null 表示跳过 */
function domainAttribute(domain: string): string | null {
  const host = location.hostname;
  if (host === domain || host.endsWith(`.${domain}`)) return domain;
  return null;
}

export function writeCookie(name: string, value: string, options: CookieWriteOptions = {}): void {
  const encoded = `${name}=${encodeURIComponent(value)}`;
  if (encoded.length > MAX_COOKIE_LENGTH) return;
  const parts = [encoded, 'Path=/', 'SameSite=Lax'];
  if (location.protocol === 'https:') parts.push('Secure');
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  void getCookieDomain().then((configured) => {
    // 未配置或当前 host 不在配置域下：写本站 cookie（host-only，不跨域）
    const domain = configured ? domainAttribute(configured) : undefined;
    if (domain === null) return; // 配置了域但 host 不匹配：跳过（如本地开发）
    document.cookie = domain ? `${parts.join('; ')}; Domain=${domain}` : parts.join('; ');
  });
}

export function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      try {
        return decodeURIComponent(trimmed.slice(prefix.length));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function deleteCookie(name: string): void {
  void getCookieDomain().then((configured) => {
    const domain = configured ? domainAttribute(configured) : undefined;
    if (domain === null) return;
    document.cookie = domain
      ? `${name}=; Path=/; Max-Age=0; Domain=${domain}`
      : `${name}=; Path=/; Max-Age=0`;
  });
}
