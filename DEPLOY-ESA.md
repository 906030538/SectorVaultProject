# 阿里云 ESA Pages 部署

阿里云 ESA（边缘安全加速）Pages 通过项目根目录的 **`esa.jsonc`** 声明构建与回退，
本仓库已提供（`name` 需与 ESA 项目名对齐）。ESA 与前两个平台的差异更大，先读差异再部署。

## 与 Cloudflare Pages / EdgeOne Pages 的差异

1. **不支持 `functions/` 目录**（也没有 `_routes.json` 路由声明）——边缘函数只能经
   `esa.jsonc` 的 `entry` 字段指定**单一入口文件**。本站的 OAuth 代理
   （`/oauth/env`、`/oauth/*/token`、`/gh-oauth/*`）在 ESA 上**默认不可用**，见下文；
2. **回退由 `assets.notFoundStrategy` 声明**，只对**导航请求**（`Sec-Fetch-Mode: navigate`）
   生效，两个取值都不完全等同 CF 的行为：

   | 取值 | 行为 | 适用性 |
   | --- | --- | --- |
   | `singlePageApplication` | 未命中静态资源返回 `index.html` + **200** | 首页是落地页、无路由宿主——`/view/…` 会显示首页内容，**不可用** |
   | `404Page` | 未命中返回 `404.html` + **404** | 外壳正确（路由宿主在 404 页，客户端路由照常激活），**采用** |

   采用 `404Page` 的代价：SPA 路由（`/view/…`、`/discussions/<id>` 等）对爬虫返回 404
   状态码（CF/EdgeOne 线路返回 200，见 `DEPLOY-CF.md` 的 SEO 取舍）。浏览器体验完全一致，
   作为镜像线路可接受；若需 200 语义须自写 ER 入口回退（见下）。
3. 默认开启**尾斜杠重定向**（`/about` → `/about/`），与 CF 一致，无需处理。

ESA 的回退对全部导航路径统一生效（未命中静态资源即回退），**不需要** EdgeOne 那样的
逐前缀 rewrites，`/view`、`/user`、`/edit`、`/login`、`/discussions/<id>` 一并覆盖。

## OAuth：esa/entry.js 单入口代理（零密钥）

ESA **没有** `functions/` 目录的文件路由（也没有 `_routes.json`）——`esa.jsonc` 的
`entry` 把所有「未命中静态资源」的请求交给**一个**入口文件。把 entry 指向
`functions/` 下的某个文件是无效的：那个文件按自身逻辑处理所有路径（如 `[[path]].ts`
会把 `/oauth/env` 当无扩展名路径回退成 404 页），且其余 functions 文件永远不会被分发。

`esa/entry.js`（EdgeRoutine，Service Worker 风格）实现了 `DEPLOY-FC.md` 的代理契约，
**ESA 侧零密钥**：

| 端点 | 行为 |
| --- | --- |
| `GET /oauth/env` | 内嵌公开 clientId（与 `public/deployment.json` oauth 段同步；轮换时两处同改） |
| `POST /gh-oauth/device/code`、`/gh-oauth/access_token` | 中继到 `RELAY_BASE`（EdgeOne）——ESA 边缘节点直连 github.com 实测超时 504，EdgeOne 出方向可达 GitHub |
| `POST /oauth/{github\|gitee\|atomgit}/token` | 服务端中继到 `RELAY_BASE`（EdgeOne 部署，持有全套 OAUTH_* 密钥；浏览器仍只与本站通信） |

entry 格式（线上实测报 599 的原文要求）：**ES module 默认导出带 `fetch` 方法的对象**
（`export default { async fetch(request) {...} }`）——不是 CDN EdgeRoutine 控制台的
`addEventListener('fetch')` Service-Worker 风格。

与 `notFoundStrategy: 404Page` 的配合（官方文档语义）：同时配置函数与回退策略时，
**导航请求不进函数**（由静态回退返回 404.html 外壳，SPA 路由照常激活），进函数的都是
fetch/XHR——正好是 OAuth 端点的请求形态。

ESA 控制台**无需配置任何 OAUTH_* 环境变量**（密钥只在 EdgeOne）；token 交换依赖
`RELAY_BASE` 可用，EdgeOne 不可达时前端自动降级 oauthBases 列表（eo → cf）。

另：登录、token 交换经代理完成时所有 OAuth 端点均带 `Access-Control-Allow-Origin: *`，
跨域可用；OAuth 回调地址仍是主站域名（`https://<域名>/login/{platform}`），与代理域名无关。

## 部署步骤

1. ESA 控制台 → Pages → 创建项目 → 接入 Git，选择本仓库 `tx` 分支（或含本文件的分支）；
   构建/输出目录已由 `esa.jsonc` 声明（`npm install` + `npm run build` → `./dist`），
   该文件优先级高于控制台；
2. `esa.jsonc` 的 `name` 与 ESA 项目名保持一致（同名项目自动关联，不存在则自动创建）；
3. Node 版本：构建环境若低于 Astro 7 要求（≥ 20.3），在 `package.json` 加
   `"engines": { "node": ">=20.3.0" }`（ESA 以 engines.node 为准，优先级高于控制台）；
4. 边缘函数：`esa.jsonc` 已声明 `entry: ./esa/entry.js`（优先级高于控制台的
   「函数文件路径」，控制台指向旧路径也不影响）；ESA 侧无需任何 OAUTH_* 环境变量。

## 线上冒烟清单

> **验证陷阱**：浏览器地址栏直接访问 `/oauth/env` 等 API 路径**必然返回 404 页**——
> 地址栏请求是导航请求（`Sec-Fetch-Mode: navigate`），按官方规则**不进函数**、由
> `notFoundStrategy` 返回 404.html 外壳。这不代表函数未生效。验证函数必须用
> **不带该头的请求**（curl）或从前端页面发起 fetch（`Sec-Fetch-Mode: cors`）：

```bash
# 1. 函数路由（curl 无导航头 → 进函数）：期望 200 + clientId JSON
curl -sD - https://<ESA域名>/oauth/env
# 2. 设备流透传：期望 GitHub 的 JSON 响应（错误参数也返回上游 JSON 而非 404 页）
curl -s -X POST -d "client_id=test" https://<ESA域名>/gh-oauth/device/code
# 3. token 交换中继：空 code 期望上游平台的错误 JSON（链路经 EdgeOne）
curl -s -X POST -d "code=test" https://<ESA域名>/oauth/gitee/token
```

- 最终验收以**前端流程**为准：站点页面打开后触发 `fetch('/oauth/env')`（非导航），
  登录全链路正常；
- `/view/<owner>/<repo>/<slug>`、`/user/<name>`、`/login/…`、`/discussions/<id>`
  返回 404 页外壳（HTTP 404）且页面内路由组件激活、地址栏不变——状态码是 404 属预期；
- `/about`、`/discussions`、`/new`、`/project` 等静态目录页正常（尾斜杠重定向后 200）；
- `/_astro/*`、`/icons/*` 静态资源 200，不存在的带扩展名路径保持 404。
