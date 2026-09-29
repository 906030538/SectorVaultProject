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

## OAuth：依赖 oauthBases 远程代理

ESA 不运行 `functions/`，本站自身的 `/oauth/env` 不存在（探测返回 404，跳过）。前端解析顺序
（`src/lib/index/sources.ts`）：**优先本站** `/oauth/env`，不可用时依次探测 `deployment.json`
的 **`oauthBases`** 列表（当前 `https://eo.svp.lyoko.cn` → `https://cf.svp.lyoko.cn`），
取首个返回非空配置的代理。因此 ESA 部署**开箱即用**：

- 登录、token 交换、GitHub 设备流均经远程代理完成（所有 OAuth 端点均带
  `Access-Control-Allow-Origin: *`，跨域可用）；
- OAuth 回调地址仍是主站域名（`https://<域名>/login/{platform}`），与代理域名无关。

可选：在 ESA 上本地承载 OAuth 代理——用 `entry` 指向一个单文件 ER 边缘函数，
实现 `DEPLOY-FC.md` 第一节的平台无关契约（4 类请求 + CORS）。注意两点须先验证：
ESA 边缘函数运行时的入口导出格式与**运行时环境变量**读取方式（官方 build-pages 文档
未明确，构建环境变量经 `process.env`，运行时待确认）；secret 只能存平台环境变量，
绝不可写进 entry 文件。

## 部署步骤

1. ESA 控制台 → Pages → 创建项目 → 接入 Git，选择本仓库 `tx` 分支（或含本文件的分支）；
   构建/输出目录已由 `esa.jsonc` 声明（`npm install` + `npm run build` → `./dist`），
   该文件优先级高于控制台；
2. `esa.jsonc` 的 `name` 与 ESA 项目名保持一致（同名项目自动关联，不存在则自动创建）；
3. Node 版本：构建环境若低于 Astro 7 要求（≥ 20.3），在 `package.json` 加
   `"engines": { "node": ">=20.3.0" }`（ESA 以 engines.node 为准，优先级高于控制台）；
4. OAuth 密钥环境变量**无需**在 ESA 配置（走 oauthBases 远程代理）；若部署了本地
   ER 入口代理，则按 `DEPLOY-FC.md` 的变量表配置并把本站域名追加进 `oauthBases` 首位。

## 线上冒烟清单

- `/view/<owner>/<repo>/<slug>`、`/user/<name>`、`/login/…`、`/discussions/<id>`
  返回 404 页外壳（HTTP 404）且页面内路由组件激活、地址栏不变——状态码是 404 属预期；
- `/about`、`/discussions`、`/new`、`/project` 等静态目录页正常（尾斜杠重定向后 200）；
- `/_astro/*`、`/icons/*` 静态资源 200，不存在的带扩展名路径保持 404；
- 登录流程正常（经 `oauthBases` 代理）：`/login` → 授权 → 回调 `/login/{platform}` 激活。
