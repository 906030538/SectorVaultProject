// Pages Functions 根捕获（SPA 回退）：兼容 Cloudflare Pages 与腾讯云 EdgeOne Pages
// 所有请求先进本函数：命中静态资源直接返回；未命中时回退 404 页内容
// （HTTP 200，地址栏不变），由页面内路由组件按 window.location 自行激活。
// 更具体的 Functions（/gh-oauth/*、/oauth/*）优先于本捕获匹配。
// 平台差异：CF 的 ASSETS 做无扩展名映射（/404 → 404.html、/about → /about/），
// EdgeOne 不做——回退须显式取 /404.html，目录页须补尾斜杠重试。
// EdgeOne 实测（2026-09）：优先级 rewrites(edgeone.json) > 静态资源 > Functions，
// _routes.json 不生效（未列入 include 的路径也会进函数），且函数环境无 ASSETS
// 绑定——走到本函数的请求必为重写与静态资源双未命中，只剩回退一件事（自源取 404 页）。

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

/** 无 ASSETS 绑定平台（EdgeOne）的 SPA 回退：自源 fetch 静态层取 404 页内容，取不到则纯 404 */
async function spaFallback(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  // 静态资源（带扩展名）未命中时保持 404，不做 SPA 回退
  if (/\.[\w]+$/.test(path) && !path.endsWith('.html')) {
    return new Response('Not Found', { status: 404 });
  }
  try {
    // /404.html 是真实静态资源（静态优先于函数），自源取不会递归回本函数
    const page = await fetch(new URL('/404.html', request.url).href);
    if (page.ok) {
      return new Response(page.body, {
        status: 200,
        headers: { 'content-type': page.headers.get('content-type') ?? 'text/html;charset=utf-8' },
      });
    }
  } catch {
    /* 自源不可达时退回纯 404 */
  }
  return new Response('Not Found', { status: 404 });
}

export const onRequest: PagesFunction<PagesEnv> = async (context) => {
  const request = normalizedRequest(context.request);

  // EdgeOne 无 ASSETS 绑定（访问即抛 545 Error return from script）：
  // 走本分支做纯回退，不再代理静态资源
  if (!context.env?.ASSETS || typeof context.env.ASSETS.fetch !== 'function') {
    return spaFallback(request);
  }

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

  // EdgeOne 的 ASSETS 不做目录页映射：无扩展名未命中先补尾斜杠再试一次
  // （命中 dist/<dir>/index.html 的真实目录页，如 /about；SPA 路径无目录则继续回退）
  if (!path.endsWith('/')) {
    const withSlash = new URL(request.url);
    withSlash.pathname = `${path}/`;
    try {
      const dirPage = await context.env.ASSETS.fetch(new Request(withSlash.href, request));
      if (dirPage.status < 300) return dirPage;
    } catch {
      /* 无目录页，继续走 404 页回退 */
    }
  }

  // 取 404 页内容：EdgeOne 需显式 /404.html（无扩展名映射）；CF 会把 /404.html
  // 规范化 308 到 /404（须跟随一跳）。逐候选取首个 2xx，均未命中退回纯 404
  let fallback: Response | null = null;
  for (const candidate of ['/404.html', '/404']) {
    let page: Response | null = null;
    try {
      page = await context.env.ASSETS.fetch(new Request(new URL(candidate, request.url), request));
      if (page.status >= 300 && page.status < 400) {
        const pageLocation = page.headers.get('location') ?? '';
        if (pageLocation) {
          page = await context.env.ASSETS.fetch(new Request(new URL(pageLocation, request.url), request));
        }
      }
    } catch {
      page = null;
    }
    if (page && page.status < 300) {
      fallback = page;
      break;
    }
  }
  if (!fallback) return new Response('Not Found', { status: 404 });

  return new Response(fallback.body, {
    status: 200,
    headers: { 'content-type': fallback.headers.get('content-type') ?? 'text/html;charset=utf-8' },
  });
};
