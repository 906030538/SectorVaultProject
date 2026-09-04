/**
 * 站点 base 路径工具：GitHub Pages 等子路径部署时（如 /SectorVaultProject/），
 * 站内链接生成与路由解析都必须感知前缀。BASE_URL 由 Astro 按 base 配置注入。
 */
export const BASE: string = import.meta.env.BASE_URL ?? '/';

/** 站内路径加 base 前缀（输入以 / 开头） */
export function withBase(path: string): string {
  if (!BASE || BASE === '/') return path;
  return `${BASE.replace(/\/$/, '')}${path}`;
}

/** 从 pathname 中剥离 base 前缀（供路由解析） */
export function stripBase(pathname: string): string {
  if (!BASE || BASE === '/') return pathname;
  const prefix = BASE.replace(/\/$/, '');
  return pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname;
}
