// Cloudflare Pages Functions：OAuth 配置下发端点
// GET /oauth/env → { github: {clientId}, gitee: {clientId}, atomgit: {clientId}, gitcode: {clientId} }
// client secret 只存在于服务端环境变量，绝不下发；token 交换经 /oauth/[platform]/token 代理完成。
//
// 环境变量（Pages → Settings → Variables and Secrets）：
//   OAUTH_GITHUB_CLIENT_ID / OAUTH_GITEE_CLIENT_ID / OAUTH_ATOMGIT_CLIENT_ID / OAUTH_GITCODE_CLIENT_ID
//   OAUTH_GITEE_CLIENT_SECRET / OAUTH_ATOMGIT_CLIENT_SECRET（token 交换代理用）
//   OAUTH_GITHUB_CLIENT_ID 同时作为设备授权流 clientId

interface PagesFunctionEnv {
  ASSETS: { fetch(input: RequestInfo, init?: RequestInit): Promise<Response> };
  OAUTH_GITHUB_CLIENT_ID?: string;
  OAUTH_GITEE_CLIENT_ID?: string;
  OAUTH_GITEE_CLIENT_SECRET?: string;
  OAUTH_ATOMGIT_CLIENT_ID?: string;
  OAUTH_ATOMGIT_CLIENT_SECRET?: string;
  OAUTH_GITCODE_CLIENT_ID?: string;
}

declare type PagesFunction<E = { ASSETS: { fetch(input: RequestInfo, init?: RequestInit): Promise<Response> } }> = (
  context: { request: Request; env: E; params: Record<string, string | string[]>; waitUntil: (p: Promise<unknown>) => void },
) => Response | Promise<Response>;

export const onRequestGet: PagesFunction<PagesFunctionEnv> = async (context) => {
  const env = context.env;
  const config: Record<string, { clientId: string }> = {};
  if (env.OAUTH_GITHUB_CLIENT_ID) {
    config.github = { clientId: env.OAUTH_GITHUB_CLIENT_ID };
  }
  if (env.OAUTH_GITEE_CLIENT_ID) {
    config.gitee = { clientId: env.OAUTH_GITEE_CLIENT_ID };
  }
  if (env.OAUTH_ATOMGIT_CLIENT_ID) {
    config.atomgit = { clientId: env.OAUTH_ATOMGIT_CLIENT_ID };
  }
  if (env.OAUTH_GITCODE_CLIENT_ID) {
    config.gitcode = { clientId: env.OAUTH_GITCODE_CLIENT_ID };
  }
  return new Response(JSON.stringify(config), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};
