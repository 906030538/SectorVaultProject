// Cloudflare Pages Functions：根捕获（SPA 回退）
// 所有请求先进本函数：命中静态资源直接返回；未命中时回退 404 页内容
// （HTTP 200，地址栏不变），由页面内路由组件按 window.location 自行激活。
// 更具体的 Functions（/gh-oauth/*、/oauth/*）优先于本捕获匹配。

interface PagesEnv {
  ASSETS: { fetch(input: RequestInfo, init?: RequestInit): Promise<Response> };
}

declare type PagesFunction<E = { ASSETS: { fetch(input: RequestInfo, init?: RequestInit): Promise<Response> } }> = (
  context: { request: Request; env: E; params: Record<string, string | string[]>; waitUntil: (p: Promise<unknown>) => void },
) => Response | Promise<Response>;

/** 规范化请求 URL：路径逐段百分号编码（ASSETS 要求 ASCII ByteString，原始 CJK 会 502） */
function normalizedRequest(request: Request): Request {
  const url = new URL(request.url);
  const encoded = url.pathname
    .split('/')
    .map((segment) => encodeURIComponent(decodeURIComponent(segment)))
    .join('/');
  if (encoded === url.pathname) return request;
  const target = new URL(request.url);
  target.pathname = encoded;
  return new Request(target.href, request);
}

export const onRequest: PagesFunction<PagesEnv> = async (context) => {
  const request = normalizedRequest(context.request);
  let asset: Response;
  try {
    asset = await context.env.ASSETS.fetch(request);
  } catch {
    // wrangler 本地 loopback 会把编码路径解码后交给静态服务导致 ByteString 错误；
    // 字符串 URL 形式可绕过（生产环境无此问题）
    asset = await context.env.ASSETS.fetch(new URL(request.url).href);
  }

  // 目录型页面（dist/.../index.html）：ASSETS 308 补尾斜杠后重取，避免把重定向丢给浏览器
  if (asset.status >= 300 && asset.status < 400) {
    const location = asset.headers.get('location') ?? '';
    if (!/\/404(\.html)?$/.test(new URL(location, request.url).pathname)) {
      const withSlash = new URL(request.url);
      withSlash.pathname = `${withSlash.pathname.replace(/\/$/, '')}/`;
      asset = await context.env.ASSETS.fetch(new Request(withSlash.href, request));
    }
  }

  // 未命中：404，或 308 指向 /404（SPA 规范化）——两种都以 200 返回 404 页内容
  const location = asset.headers.get('location') ?? '';
  const isNotFound =
    asset.status === 404 ||
    (asset.status >= 300 && asset.status < 400 && /\/404(\.html)?$/.test(new URL(location, request.url).pathname));
  if (!isNotFound) return asset;

  // 静态资源（带扩展名）未命中时保持 404，不做 SPA 回退
  const path = new URL(request.url).pathname;
  if (/\.[\w]+$/.test(path) && !path.endsWith('.html')) {
    return new Response('Not Found', { status: 404 });
  }

  // ASSETS 把 /404.html 规范化为 /404，直接请求 /404 并以 200 返回其内容
  const fallback = await context.env.ASSETS.fetch(new Request(new URL('/404', request.url), request));
  return new Response(fallback.body, {
    status: 200,
    headers: { 'content-type': fallback.headers.get('content-type') ?? 'text/html;charset=utf-8' },
  });
};
