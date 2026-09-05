// Cloudflare Pages Functions：Gitee / AtomGit OAuth token 交换代理
// POST /oauth/gitee/token  → https://gitee.com/oauth/token
// POST /oauth/atomgit/token → https://atomgit.com/oauth/token
// 客户端只需携带 code + redirect_uri；client_id / client_secret 由服务端
// 环境变量注入后转发，secret 永不出现在浏览器。
//
// 环境变量：OAUTH_GITEE_CLIENT_ID/SECRET、OAUTH_ATOMGIT_CLIENT_ID/SECRET

interface PagesFunctionEnv {
  ASSETS: { fetch(input: RequestInfo, init?: RequestInit): Promise<Response> };
  OAUTH_GITEE_CLIENT_ID?: string;
  OAUTH_GITEE_CLIENT_SECRET?: string;
  OAUTH_ATOMGIT_CLIENT_ID?: string;
  OAUTH_ATOMGIT_CLIENT_SECRET?: string;
}

declare type PagesFunction<E = { ASSETS: { fetch(input: RequestInfo, init?: RequestInit): Promise<Response> } }> = (
  context: { request: Request; env: E; params: Record<string, string | string[]>; waitUntil: (p: Promise<unknown>) => void },
) => Response | Promise<Response>;

const TARGETS: Record<string, { url: string; idKey: string; secretKey: string }> = {
  gitee: { url: 'https://gitee.com/oauth/token', idKey: 'OAUTH_GITEE_CLIENT_ID', secretKey: 'OAUTH_GITEE_CLIENT_SECRET' },
  atomgit: { url: 'https://atomgit.com/oauth/token', idKey: 'OAUTH_ATOMGIT_CLIENT_ID', secretKey: 'OAUTH_ATOMGIT_CLIENT_SECRET' },
};

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

export const onRequestOptions: PagesFunction<PagesFunctionEnv> = async () =>
  new Response(null, { status: 204, headers: CORS });

export const onRequestPost: PagesFunction<PagesFunctionEnv> = async (context) => {
  const platform = String(context.params.platform ?? '');
  const target = TARGETS[platform];
  if (!target) {
    return new Response(JSON.stringify({ error: 'unknown_oauth_platform', platform }), {
      status: 404,
      headers: { 'content-type': 'application/json', ...CORS },
    });
  }
  const env = context.env as unknown as Record<string, string | undefined>;
  const clientId = env[target.idKey];
  const clientSecret = env[target.secretKey];
  if (!clientId || !clientSecret) {
    return new Response(JSON.stringify({ error: 'oauth_not_configured', platform }), {
      status: 503,
      headers: { 'content-type': 'application/json', ...CORS },
    });
  }

  // 合并客户端提交的 code/redirect_uri 与服务端凭据
  const incoming = new URLSearchParams(await context.request.text());
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
  });
  for (const key of ['code', 'redirect_uri', 'state']) {
    const value = incoming.get(key);
    if (value) form.set(key, value);
  }

  const upstream = await fetch(target.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
      'user-agent': 'sector-vault-pages-proxy',
    },
    body: form.toString(),
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
      ...CORS,
    },
  });
};
