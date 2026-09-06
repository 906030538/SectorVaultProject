// Cloudflare Pages Functions：OAuth 配置下发端点
// GET /oauth/env → { github: { appClientId?, clientId? }, gitee: {clientId}, ... }
// client secret 只存在于服务端环境变量，绝不下发；token 交换经服务端代理注入。
//
// 环境变量（Pages → Settings → Variables and Secrets）：
//   OAUTH_GITHUB_APP_ID                                  GitHub App 设备流 clientId
//   OAUTH_GITHUB_CLIENT_ID / OAUTH_GITHUB_CLIENT_SECRET  GitHub OAuth 网页流（token 交换代理用）
//   OAUTH_GITEE_CLIENT_ID / OAUTH_GITEE_CLIENT_SECRET
//   OAUTH_ATOMGIT_CLIENT_ID / OAUTH_ATOMGIT_CLIENT_SECRET
//   OAUTH_GITCODE_CLIENT_ID

interface PagesFunctionEnv {
  ASSETS: { fetch(input: RequestInfo, init?: RequestInit): Promise<Response> };
  OAUTH_GITHUB_APP_ID?: string;
  OAUTH_GITHUB_CLIENT_ID?: string;
  OAUTH_GITHUB_CLIENT_SECRET?: string;
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
  const config: Record<string, { clientId?: string; appClientId?: string }> = {};
  // GitHub 两套身份独立配置：App（设备流）与 OAuth App（网页流）
  const github: { clientId?: string; appClientId?: string } = {};
  if (env.OAUTH_GITHUB_APP_ID) github.appClientId = env.OAUTH_GITHUB_APP_ID;
  if (env.OAUTH_GITHUB_CLIENT_ID) github.clientId = env.OAUTH_GITHUB_CLIENT_ID;
  if (github.appClientId || github.clientId) config.github = github;
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
