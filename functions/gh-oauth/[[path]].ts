// Cloudflare Pages Functions：反向代理 GitHub OAuth 端点（解决浏览器 CORS 限制）
// 路由：/gh-oauth/device/code  → https://github.com/login/device/code
//       /gh-oauth/access_token → https://github.com/login/oauth/access_token
// 部署配置中把 oauth.github.deviceCodeUrl / tokenUrl 指向这两个路径即可。
// 仅透传 POST + 表单体，不加改写、不落日志，令牌不经过持久化。

declare type PagesFunction<E = { ASSETS: { fetch(input: RequestInfo, init?: RequestInit): Promise<Response> } }> = (
  context: { request: Request; env: E; params: Record<string, string | string[]>; waitUntil: (p: Promise<unknown>) => void },
) => Response | Promise<Response>;

interface PagesEnv {
  ASSETS: { fetch: (req: Request) => Promise<Response> };
}

const GITHUB_LOGIN = 'https://github.com/login';

export const onRequestPost: PagesFunction<PagesEnv> = async (context) => {
  const url = new URL(context.request.url);
  const proxyPath = url.pathname.replace(/^\/gh-oauth/, '');

  let target: string;
  if (proxyPath === '/device/code') {
    target = `${GITHUB_LOGIN}/device/code`;
  } else if (proxyPath === '/access_token') {
    target = `${GITHUB_LOGIN}/oauth/access_token`;
  } else {
    return new Response(JSON.stringify({ error: 'unknown_oauth_proxy_path', path: proxyPath }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  const upstream = await fetch(target, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: context.request.headers.get('accept') ?? 'application/json',
      'user-agent': 'sector-vault-pages-proxy',
    },
    body: await context.request.text(),
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
    },
  });
};

export const onRequest: PagesFunction<PagesEnv> = async () => {
  return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
    status: 405,
    headers: { 'content-type': 'application/json', allow: 'POST' },
  });
};
