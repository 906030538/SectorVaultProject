# OAuth 代理部署到函数计算平台（阿里云 / 华为云 / 腾讯云等）

静态主站（GitHub Pages）自身没有 Functions，OAuth 的代理端点由任一 FaaS 平台承担即可。
前端通过 `deployment.json` 的 **`oauthBases` 列表**依次探测（`GET <base>/oauth/env`），
**取第一个可达的代理**——所以部署到任何平台后，只需把访问域名追加进列表，无需改前端代码。

本文给出：① 代理契约（平台无关）；② 零依赖单文件实现（可直接跑在「Web 函数」型平台）；
③ 各平台接入要点。

## 一、代理契约

任何平台只要实现以下 4 类请求即可（源实现见 `functions/` 目录，行为需保持一致）：

| 请求 | 行为 |
| --- | --- |
| `GET /oauth/env` | 从环境变量组装各平台 clientId 下发（见下表）；`cache-control: no-store` |
| `POST /oauth/{platform}/token` | platform ∈ `github`/`gitee`/`atomgit`。读请求体（form-urlencoded 的 `code`、`redirect_uri` 等），**服务端注入 client_id/client_secret** 后转发对应平台 token 端点，原样返回上游响应 |
| `POST /gh-oauth/device/code` | 透传到 `https://github.com/login/device/code`（body 原样转发） |
| `POST /gh-oauth/access_token` | 透传到 `https://github.com/login/oauth/access_token` |

所有响应必须带 CORS 头（前端跨域调用）：`Access-Control-Allow-Origin: *`；OPTIONS 预检返回 204 并带
`Allow-Methods: POST, GET, OPTIONS` 与 `Allow-Headers: content-type`。token 交换响应加 `cache-control: no-store`。

环境变量（密钥只存在于函数平台，不下发浏览器、不写 deployment.json）：

| 变量 | 用途 |
| --- | --- |
| `OAUTH_GITHUB_APP_ID` | GitHub App 设备流 clientId（`/oauth/env` 下发为 `github.appClientId`） |
| `OAUTH_GITHUB_CLIENT_ID` / `OAUTH_GITHUB_CLIENT_SECRET` | GitHub OAuth 网页流（`/oauth/github/token` 注入） |
| `OAUTH_GITEE_CLIENT_ID` / `OAUTH_GITEE_CLIENT_SECRET` | Gitee token 交换 |
| `OAUTH_ATOMGIT_CLIENT_ID` / `OAUTH_ATOMGIT_CLIENT_SECRET` | AtomGit token 交换 |
| `OAUTH_GITCODE_CLIENT_ID` | GitCode（仅 clientId 下发） |

> 仅做 OAuth 代理时**不需要** `functions/[[path]].ts` 的 SPA 回退——那是代理同时托管静态站点时才用的。

## 二、可移植单文件实现（Node.js ≥ 18，零依赖）

适用于「Web 函数 / HTTP Server 型」触发方式（阿里云 Web 函数、腾讯云 Web 函数、华为 HTTP 函数等）：
平台把请求转发给容器内的 HTTP 端口，直接 `node oauth-proxy.js` 启动即可。

```js
// oauth-proxy.js —— SVP OAuth 代理：node oauth-proxy.js，监听 0.0.0.0:$PORT
const { createServer } = require('node:http');

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
};
const TOKEN_TARGETS = {
  github: { url: 'https://github.com/login/oauth/access_token', id: 'OAUTH_GITHUB_CLIENT_ID', secret: 'OAUTH_GITHUB_CLIENT_SECRET' },
  gitee: { url: 'https://gitee.com/oauth/token', id: 'OAUTH_GITEE_CLIENT_ID', secret: 'OAUTH_GITEE_CLIENT_SECRET' },
  atomgit: { url: 'https://atomgit.com/oauth/token', id: 'OAUTH_ATOMGIT_CLIENT_ID', secret: 'OAUTH_ATOMGIT_CLIENT_SECRET' },
};
const GH_PROXY = {
  '/gh-oauth/device/code': 'https://github.com/login/device/code',
  '/gh-oauth/access_token': 'https://github.com/login/oauth/access_token',
};

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://local');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }
  // GET /oauth/env
  if (req.method === 'GET' && url.pathname === '/oauth/env') {
    const config = {};
    const github = {};
    if (process.env.OAUTH_GITHUB_APP_ID) github.appClientId = process.env.OAUTH_GITHUB_APP_ID;
    if (process.env.OAUTH_GITHUB_CLIENT_ID) github.clientId = process.env.OAUTH_GITHUB_CLIENT_ID;
    if (github.appClientId || github.clientId) config.github = github;
    for (const [key, envKey] of [['gitee', 'OAUTH_GITEE_CLIENT_ID'], ['atomgit', 'OAUTH_ATOMGIT_CLIENT_ID'], ['gitcode', 'OAUTH_GITCODE_CLIENT_ID']]) {
      if (process.env[envKey]) config[key] = { clientId: process.env[envKey] };
    }
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS });
    return res.end(JSON.stringify(config));
  }
  // POST /oauth/{platform}/token：注入 secret 后转发
  const tokenMatch = url.pathname.match(/^\/oauth\/(github|gitee|atomgit)\/token$/);
  if (req.method === 'POST' && tokenMatch) {
    const target = TOKEN_TARGETS[tokenMatch[1]];
    const clientId = process.env[target.id];
    const clientSecret = process.env[target.secret];
    if (!clientId || !clientSecret) {
      res.writeHead(503, { 'content-type': 'application/json', ...CORS });
      return res.end(JSON.stringify({ error: 'oauth_not_configured', platform: tokenMatch[1] }));
    }
    const params = new URLSearchParams(await readBody(req));
    params.set('client_id', clientId);
    params.set('client_secret', clientSecret);
    const upstream = await fetch(target.url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: params.toString(),
    });
    res.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
      ...CORS,
    });
    return res.end(await upstream.text());
  }
  // POST /gh-oauth/*：GitHub 设备流透传
  if (req.method === 'POST' && GH_PROXY[url.pathname]) {
    const upstream = await fetch(GH_PROXY[url.pathname], {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: req.headers.accept ?? 'application/json',
        'user-agent': 'svp-oauth-proxy',
      },
      body: await readBody(req),
    });
    res.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
      ...CORS,
    });
    return res.end(await upstream.text());
  }
  res.writeHead(404, { 'content-type': 'application/json', ...CORS });
  res.end(JSON.stringify({ error: 'not_found', path: url.pathname }));
}

const port = Number(process.env.PORT || process.env.CAPort || 9000);
createServer((req, res) => {
  handle(req, res).catch(() => {
    if (!res.headersSent) res.writeHead(502, CORS);
    res.end('{"error":"proxy_failed"}');
  });
}).listen(port, '0.0.0.0');
```

## 三、各平台接入要点

### 阿里云函数计算 FC 3.0

1. 控制台创建函数 → **Web 函数**，运行时 Node.js 18/20，启动命令 `node oauth-proxy.js`，
   监听端口填 `9000`（代码读取 `CAPort`/`PORT`，默认 9000）；
2. 代码上传：把 `oauth-proxy.js` 打包 zip，或用 [Serverless Devs](https://www.serverless-devs.com/)（`s.yaml` 的 `customRuntimeConfig` + `codeUri`）；
3. 函数配置 → 环境变量：填第一节表格中的变量；
4. 触发器：HTTP 触发器（或 Web 函数自带 URL），得到默认域名
   `https://<函数名>.<地域>.fcapp.run`；
5. 域名注意：**中国内地地域**自定义域名必须 ICP 备案；默认 `fcapp.run` 域名可直接使用（有 QPS 限制）。
   免备案需求可选拓展地域（香港/新加坡等）；
6. 验证：`curl https://<域名>/oauth/env` 返回 clientId JSON 即成功。

### 华为云 FunctionGraph

两种方式：

- **HTTP 函数**（推荐，自带函数 URL，无需 API 网关）：创建时选择「HTTP 函数」，
  运行时 Node.js，直接用上面的 `oauth-proxy.js`（HTTP 函数以容器 HTTP 服务方式运行，监听端口默认 8000，代码里 `PORT` 环境变量可覆盖——把启动环境的 `PORT` 设为 8000 或让代码默认值与平台一致）；
- **事件函数 + APIG 触发器**：handler 签名 `async (event, context)`，需要适配 API 网关的事件结构：

  ```js
  // 事件适配层：APIG 事件 → req/res → 复用 handle()
  exports.handler = async (event) => {
    // event.httpMethod / event.path / event.headers / event.body(可能 base64)
    // 组装成伪 req/res 调用第二节的 handle()，再包装为
    // { statusCode, headers: {…CORS}, body, isBase64Encoded: false }
  };
  ```

环境变量在函数配置页设置；自定义域名走 APIG（内地需备案）。函数 URL 形如
`https://<graph-endpoint>/v2/0/<project>/function/<name>/invocations`——建议绑自定义域名后加入 `oauthBases`。

### 腾讯云 SCF（同“其他 Serverless 平台”参考）

- **Web 函数**：同阿里云方式，监听 `0.0.0.0:9000`（SCF Web 函数默认端口 9000），直接使用 `oauth-proxy.js`；
- 事件函数 + API 网关：同华为事件适配（`integration-response` 集成响应返回 `{statusCode, headers, body}`）。

### 通用清单（其他平台对照）

1. 平台能以「HTTP 服务」或「HTTP 事件」方式触发函数；
2. 运行时 Node.js ≥ 18（需要原生 `fetch`；低版本自行补充 `node-fetch` 依赖亦可）；
3. 函数具备**公网出方向**访问能力（转发 github/gitee/atomgit）；
4. 支持环境变量配置；
5. 响应头可自定义（CORS 三件套 + no-store）。

## 四、接入 deployment.json

部署完成后，把代理访问地址**追加**到 `oauthBases` 列表（顺序即探测优先级）：

```json
"oauthBases": [
  "https://cf.svp.lyoko.cn",
  "https://ccs.lyoko.cn",
  "https://svp-oauth.<地域>.fcapp.run"
]
```

前端启动时依次探测 `/oauth/env`，自动选用第一个可达代理；全部不可达时回退站点相对路径
（即仅 Functions 托管部署自身可用）。多代理天然互为灾备。

## 五、上线自检

```bash
# 1. env 端点：返回 clientId 且带 CORS
curl -sD - -H "Origin: https://svp.lyoko.cn" https://<代理域名>/oauth/env

# 2. 预检：应 204 + allow-methods
curl -sD - -o /dev/null -X OPTIONS \
  -H "Origin: https://svp.lyoko.cn" -H "Access-Control-Request-Method: POST" \
  https://<代理域名>/gh-oauth/access_token

# 3. token 交换：空 code 应返回上游平台的错误 JSON（而非代理 5xx）
curl -s -X POST -H "Origin: https://svp.lyoko.cn" \
  -d "code=test&redirect_uri=https://svp.lyoko.cn/login/gitee" \
  https://<代理域名>/oauth/gitee/token
```

安全要点：secret 只存平台环境变量；响应禁止缓存 token（`no-store`）；不要把请求体（含 code/token）写入日志；
回调式 OAuth（gitee/atomgit 网页流）的 `redirect_uri` 仍是主站域名（`https://svp.lyoko.cn/login/{platform}`），
与代理所在域名无关，无需在代理侧配置回调。
