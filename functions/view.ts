// Cloudflare Pages Functions：SPA 回退（代替静态托管的 404.html 方案）
// 未命中静态资源的路径回退 404.html（HTTP 200），由页面内路由组件按
// window.location 自行激活；与 GitHub Pages 的 404.html 行为保持一致，
// 但返回 200 状态码，对搜索引擎更友好。
declare type PagesFunction<E = { ASSETS: { fetch(input: RequestInfo, init?: RequestInit): Promise<Response> } }> = (
  context: { request: Request; env: E; params: Record<string, string | string[]>; waitUntil: (p: Promise<unknown>) => void },
) => Response | Promise<Response>;

interface PagesEnv {
  ASSETS: { fetch: (req: Request) => Promise<Response> };
}

export const onRequest: PagesFunction<PagesEnv> = async (context) => {
  const asset = await context.env.ASSETS.fetch(context.request);
  // 命中静态资源（含 404.html 本身）直接返回
  if (asset.status !== 404) return asset;
  return context.env.ASSETS.fetch(new Request(new URL('/404.html', context.request.url), context.request));
};
