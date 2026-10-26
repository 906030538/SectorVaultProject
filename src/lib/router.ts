import { stripBase, withBase } from '@/lib/base';

/**
 * 站点路由核心：path / hash 双模式，由编译参数区分（互斥产物，不混用）。
 *
 * - path 模式（默认 `npm run build`）：路由即 URL 路径，动态路由依赖静态托管的
 *   404 回退（404.html 作 SPA 外壳），适合 CF Pages / GitHub Pages 等回退可用的环境；
 * - hash 模式（`npm run build:hash`，PUBLIC_SVP_ROUTER=hash 注入）：整站收敛为
 *   index.html 单页，路由形如 /#/view/owner/repo/slug —— 不依赖任何 404 回退 /
 *   重写 / 边缘函数兜底，适配 EdgeOne Pages、ESA 等回退不可靠的静态托管。
 *
 * 路由组件一律经 registerRoute 注册激活回调：path 模式在首次加载时跑一轮，
 * hash 模式额外监听 hashchange，每轮先按初始快照重放宿主 DOM 再重新激活。
 */

export const HASH_ROUTER: boolean = import.meta.env.PUBLIC_SVP_ROUTER === 'hash';

/** 当前路由位置：path 为站内路径（已剥 base），query 合并路由查询与地址栏 search */
export interface RouteLocation {
  path: string;
  query: URLSearchParams;
}

/** 站内路由路径（可含 ?query）→ 导航 href：hash 模式折进 # 前缀 */
export function routeHref(path: string): string {
  if (!HASH_ROUTER) return withBase(path);
  return withBase(`/#${path.startsWith('/') ? path : `/${path}`}`);
}

/** 程序化导航（hash 模式仅变 # 不重载页面，path 模式整页跳转） */
export function navigate(path: string): void {
  window.location.href = routeHref(path);
}

/**
 * 当前路由：hash 模式优先取 # 后路径；# 为空时回退 pathname——
 * 兼容经静态回退 / 重写送进来的旧路径链接（如 404.html 外壳直出 /view/…）。
 * query 合并 # 内查询与 location.search（OAuth 回调的 ?code 落在 search 上）。
 */
export function currentRoute(): RouteLocation {
  if (HASH_ROUTER && window.location.hash.length > 1) {
    const raw = window.location.hash.slice(1);
    const queryIndex = raw.indexOf('?');
    const path = queryIndex === -1 ? raw : raw.slice(0, queryIndex);
    const query = queryIndex === -1 ? '' : raw.slice(queryIndex + 1);
    return { path: normalizePath(path), query: mergeQuery(window.location.search, query) };
  }
  return {
    path: normalizePath(stripBase(window.location.pathname)),
    query: new URLSearchParams(window.location.search),
  };
}

/** 路由路径分段（过滤空段并逐段解码；CJK 路径段以百分号编码到达） */
export function routeSegments(path: string): string[] {
  return path
    .split('/')
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });
}

/**
 * 页内替换带查询的路由地址（如 FAQ 目录切换）：replaceState 不触发路由重放，
 * 由调用方自行更新内容。hash 模式必须保留 # 与当前 pathname（index 单页）。
 */
export function replaceRouteUrl(pathWithQuery: string): void {
  if (!HASH_ROUTER) {
    window.history.replaceState(null, '', withBase(pathWithQuery));
    return;
  }
  window.history.replaceState(null, '', `${window.location.pathname}#${normalizePathWithQuery(pathWithQuery)}`);
}

/** 清除地址栏查询串（如消费完 ?auth=1）：hash 模式须保留 # */
export function clearLocationQuery(): void {
  if (!window.location.search) return;
  const url = HASH_ROUTER
    ? `${window.location.pathname}${window.location.hash}`
    : window.location.pathname || '/';
  window.history.replaceState(null, '', url);
}

function normalizePath(path: string): string {
  if (!path.startsWith('/')) return `/${path}`;
  return path;
}

function normalizePathWithQuery(pathWithQuery: string): string {
  const queryIndex = pathWithQuery.indexOf('?');
  const path = queryIndex === -1 ? pathWithQuery : pathWithQuery.slice(0, queryIndex);
  const query = queryIndex === -1 ? '' : pathWithQuery.slice(queryIndex);
  return `${normalizePath(path)}${query}`;
}

function mergeQuery(search: string, hashQuery: string): URLSearchParams {
  const merged = new URLSearchParams(search);
  for (const [key, value] of new URLSearchParams(hashQuery)) merged.set(key, value);
  return merged;
}

type RouteHandler = (loc: RouteLocation) => void | Promise<void>;

const handlers: RouteHandler[] = [];
const hostSnapshots = new Map<HTMLElement, string>();
let booted = false;

/**
 * 注册路由激活回调：回调自行匹配 loc.path（routeSegments 分段），
 * 匹配时须同步显示宿主容器（host.hidden = false），返回的异步初始化随后完成。
 */
export function registerRoute(handler: RouteHandler): void {
  handlers.push(handler);
  if (booted) void handler(currentRoute());
}

/** 首次运行前快照各宿主容器：hash 模式每轮导航重放到初始 DOM，保证可重复激活 */
function snapshotHosts(): void {
  for (const host of document.querySelectorAll<HTMLElement>('[data-route-host]')) {
    if (!hostSnapshots.has(host)) hostSnapshots.set(host, host.innerHTML);
  }
}

/** 重置所有宿主（还原快照并隐藏）并恢复 404 文案，随后由匹配的回调重新激活 */
function resetHosts(): void {
  for (const [host, html] of hostSnapshots) {
    if (host.innerHTML !== html) host.innerHTML = html;
    host.hidden = true;
  }
  document.querySelector('[data-role="not-found"]')?.removeAttribute('hidden');
}

/** 同步判断是否有宿主被激活，同步未命中的回调视为不匹配 */
function hasActiveHost(): boolean {
  for (const host of document.querySelectorAll<HTMLElement>('[data-route-host]')) {
    if (!host.hidden) return true;
  }
  return false;
}

function runRoutes(): void {
  resetHosts();
  const loc = currentRoute();
  for (const handler of handlers) void handler(loc);
  const notice = document.querySelector<HTMLElement>('[data-role="not-found"]');
  if (notice) notice.hidden = hasActiveHost();
}

function boot(): void {
  if (booted) return;
  booted = true;
  snapshotHosts();
  if (HASH_ROUTER) {
    window.addEventListener('hashchange', () => {
      snapshotHosts();
      runRoutes();
      window.scrollTo(0, 0);
    });
  }
  runRoutes();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}
