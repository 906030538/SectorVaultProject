// SVP 阿里云 ESA Pages 边缘函数入口（零依赖）
//
// ESA Pages 没有 Cloudflare 式 functions/ 目录路由：所有「未命中静态资源」的请求
// 都进本文件，由这里的路由实现 DEPLOY-FC.md 的 OAuth 代理契约（4 类请求 + CORS）。
// 配合 esa.jsonc 的 notFoundStrategy:404Page——导航请求由静态回退处理、不进本函数
//（官方文档：同时配置函数与 notFoundStrategy 时导航请求不触发函数），到这里的
// 都是 fetch/XHR 类请求，正好是 OAuth 端点的形态。
//
// 入口格式（2026-09-30 线上实测，报 599 时的原文）：
//   Error: Load user script error: the JavaScript script does not conform to the
//   expected ES module format, where an object with a function named "fetch" or
//   "bypass" is expected to be default exported.
// 即 ESA Pages 要求 ES module **默认导出**带 fetch 方法的对象——不是 CDN
// EdgeRoutine 控制台的 addEventListener('fetch') Service-Worker 风格。
//
// 密钥策略（ESA 侧零密钥，secret 永不进本文件/仓库）：
//   GET  /oauth/env                内嵌公开 clientId（见 ENV_CONFIG）
//   POST /gh-oauth/device/code     直接透传 github.com/login/device/code（设备流无需 secret）
//   POST /gh-oauth/access_token    直接透传 github.com/login/oauth/access_token
//   POST /oauth/{platform}/token   转发给 RELAY_BASE（EdgeOne 部署持有全套密钥），
//                                  浏览器仍只与本站通信（同源中继）

// token 交换中继目标：EdgeOne 部署（eo.svp.lyoko.cn 已配 OAUTH_* 环境变量）
const RELAY_BASE = 'https://eo.svp.lyoko.cn';

// 公开 clientId（可安全下发浏览器；与 public/deployment.json 的 oauth 段同源，
// 轮换/新增平台时两处同步——github.appClientId 只在此处与 EdgeOne 环境变量出现）
const ENV_CONFIG = {
  github: {
    appClientId: 'Iv23liK3bFBaofC58xLg', // GitHub App 设备流
    clientId: 'Ov23liHaS6KYboeULvpf', // OAuth App 网页流
  },
  gitee: { clientId: '0715c0c7ff892ba18c797963ee9771d53e537d1be5a2a72d7d475937cd873537' },
  atomgit: { clientId: 'f1b16bb0456241ed920113c33ad7edc2' },
};

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const GH_PROXY = {
  '/gh-oauth/device/code': 'https://github.com/login/device/code',
  '/gh-oauth/access_token': 'https://github.com/login/oauth/access_token',
};

// ESA Pages 入口约定：默认导出 { fetch }，所有未命中静态资源的请求由此处理
export default {
  async fetch(request) {
    return handle(request);
  },
};

async function handle(request) {
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (request.method === 'GET' && url.pathname === '/oauth/env') {
    return new Response(JSON.stringify(ENV_CONFIG), {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS },
    });
  }

  // GitHub 设备流透传（无需 secret）
  if (request.method === 'POST' && GH_PROXY[url.pathname]) {
    return forward(request, GH_PROXY[url.pathname]);
  }

  // token 交换：secret 只在 RELAY_BASE——服务端转发无 CORS 限制，响应加回本站 CORS
  const tokenMatch = url.pathname.match(/^\/oauth\/(github|gitee|atomgit)\/token$/);
  if (request.method === 'POST' && tokenMatch) {
    return forward(request, `${RELAY_BASE}/oauth/${tokenMatch[1]}/token`);
  }

  return new Response(JSON.stringify({ error: 'not_found', path: url.pathname }), {
    status: 404,
    headers: { 'content-type': 'application/json', ...CORS },
  });
}

/** 转发 POST（body 原样透传），透传上游响应并附加 CORS 与 no-store */
async function forward(request, target) {
  const upstream = await fetch(target, {
    method: 'POST',
    headers: {
      'content-type': request.headers.get('content-type') ?? 'application/x-www-form-urlencoded',
      accept: request.headers.get('accept') ?? 'application/json',
      'user-agent': 'svp-esa-oauth-entry',
    },
    body: await request.text(),
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
      ...CORS,
    },
  });
}
