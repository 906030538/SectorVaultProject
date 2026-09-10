// Cloudflare Pages Functions：仓库信息代理
// GET /api/repo-info?url=<encoded-url> → 转发 GET 并返回 JSON 响应
// 用于 AtomGit/GitCode 等不返回 CORS 头的平台仓库详情（浏览器跨域被阻断时经此代理读取）。
// 仅接受白名单域名的 GET 请求，不透传认证头（公开仓库信息无需令牌）。

declare type PagesFunction<E = { ASSETS: { fetch(input: RequestInfo, init?: RequestInit): Promise<Response> } }> = (
  context: { request: Request; env: E; params: Record<string, string | string[]>; waitUntil: (p: Promise<unknown>) => void },
) => Response | Promise<Response>;

const ALLOWED_HOSTS = new Set([
  'atomgit.com',
  'gitcode.com',
]);

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
};

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { status: 204, headers: CORS });

export const onRequestGet: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  const target = url.searchParams.get('url');
  if (!target) {
    return new Response(JSON.stringify({ error: 'missing_url' }), {
      status: 400,
      headers: { 'content-type': 'application/json', ...CORS },
    });
  }
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_url' }), {
      status: 400,
      headers: { 'content-type': 'application/json', ...CORS },
    });
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    return new Response(JSON.stringify({ error: 'host_not_allowed', host: parsed.hostname }), {
      status: 403,
      headers: { 'content-type': 'application/json', ...CORS },
    });
  }
  // 前端可传 token 查询参数（部分平台仓库详情要求认证）
  const token = url.searchParams.get('token');
  const headers: Record<string, string> = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const upstream = await fetch(parsed.toString(), { headers });
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'cache-control': 'public, max-age=300',
      ...CORS,
    },
  });
};
