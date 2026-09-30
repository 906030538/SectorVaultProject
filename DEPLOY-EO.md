# 腾讯云 EdgeOne Pages 部署

本分支（`tx`）适配腾讯云 EdgeOne Pages。`functions/` 目录沿用 Cloudflare Pages Functions
约定（EdgeOne Pages 兼容），OAuth 代理（`/gh-oauth/*`、`/oauth/*`）开箱可用；SPA 回退
需要下述两处适配。

## 与 Cloudflare Pages 的行为差异（2026-09 线上实测）

1. **静态托管不自动回退根目录 `404.html`**：CF Pages 对未命中路径自动返回项目 404 页，
   EdgeOne 返回平台默认 404；
2. **函数环境无 `ASSETS` 绑定**：`context.env.ASSETS.fetch` 在 EdgeOne 上访问即抛错，
   平台返回 545 `Error return from script`（`/oauth/*` 等不碰 ASSETS 的函数不受影响）；
3. **`_routes.json` 不生效**：函数按文件模板匹配派发，未列入 include 的路径
   （如任意未知路径）同样会进 `functions/[[path]].ts` 捕获；
4. **优先级：`edgeone.json` rewrites > 静态资源 > Functions**——重写命中的路径不进函数，
   静态资源命中的路径不进函数，双未命中才派发函数（再按更具体者优先）。

### `functions/[[path]].ts` 的适配

- 无 ASSETS 绑定时走纯回退分支：自源 `fetch('/404.html')` 取 404 页内容以 200 返回
  （/404.html 是真实静态资源，静态优先于函数，自源取不会递归回本函数）；带扩展名的
  未命中路径保持纯 404；
- CF（有 ASSETS）保留原逻辑：404 页回退显式请求 `/404.html`（CF 会 308 规范化到
  `/404`，跟随一跳）；无扩展名未命中先补尾斜杠重试目录页。

## edgeone.json（项目根目录）

EdgeOne Pages 仅把 `/*` → `/index.html` 这一样式识别为 SPA fallback
（静态资源与函数优先，全未命中才兜底，不作为普通重写生效）。本站**不能照抄**：

- 本站 SPA 外壳是 `404.html` 而非 `index.html`——路由宿主（view/user/edit/discussion/login
  的路由组件）全部挂在 `src/pages/404.astro`，首页 `index.html` 是落地页没有路由宿主；
  `/*` → `/index.html` 会让 `/view/…` 显示首页内容；
- `/*` → `/404.html` 属普通重写，与函数路由的优先级官方文档未定义，可能劫持
  `/oauth/*`、`/gh-oauth/*` 函数——不使用。

采用**前缀受限重写**：`/view`、`/user`、`/edit`、`/login`（含子路径）→ `/404.html`。
这四个前缀没有任何静态资源、也没有专属函数，任何优先级下结果一致：函数先匹配则由
`[[path]].ts` 回退，重写先匹配则由平台兜底，二者内容相同。

`/discussions` **不进重写**：`/discussions/index.html` 是真实的静态列表页，普通重写
在未定义的优先级下可能劫持它；讨论详情页（`/discussions/<id>`）由 `functions/[[path]].ts`
的回退分支兜住（重写与静态双未命中后进函数，自源取 404 页）。未知路径（如 `/random`）
同样由函数回退，不再返回 545。

## 部署步骤

1. EdgeOne 控制台 → EdgeOne Pages → 创建项目 → 接入 Git，选择本仓库 `tx` 分支；
   构建命令与输出目录已由 `edgeone.json` 声明（`npm run build` → `dist`），控制台可不填；
2. 环境变量（项目设置 → 环境变量，与 Cloudflare Pages 部署一致，密钥不进 deployment.json）：

   | 变量 | 用途 |
   | --- | --- |
   | `OAUTH_GITHUB_APP_ID` | GitHub App 设备授权流（`/gh-oauth/*` 透传，无需 secret） |
   | `OAUTH_GITHUB_CLIENT_ID` + `OAUTH_GITHUB_CLIENT_SECRET` | GitHub OAuth 网页流（token 交换代理） |
   | `OAUTH_GITEE_CLIENT_ID` + `OAUTH_GITEE_CLIENT_SECRET` | Gitee OAuth |
   | `OAUTH_ATOMGIT_CLIENT_ID` + `OAUTH_ATOMGIT_CLIENT_SECRET` | AtomGit OAuth |
   | `OAUTH_GITCODE_CLIENT_ID` | GitCode（暂仅 clientId 下发） |

3. 构建失败提示 Node 版本过低时，在 `edgeone.json` 加 `"nodeVersion": "22"`
   （Astro 7 需 Node ≥ 20.3）。

## 线上冒烟清单

- `/oauth/env` 返回各平台 clientId（函数路由）；
- `/view/<owner>/<repo>/<slug>`、`/user/<name>`、`/edit/…`、`/login/…` 经 edgeone.json
  重写返回 404 页外壳（HTTP 200）且页面内路由组件激活、地址栏不变；
- `/discussions/<id>`、任意未知路径（如 `/random`）经 `[[path]].ts` 回退分支返回
  404 页外壳（HTTP 200）——不再出现 545 `Error return from script`；
- `/about`、`/discussions`、`/new`、`/project` 等静态目录页正常（不被重写劫持）；
- `/_astro/*`、`/icons/*` 静态资源 200，不存在的带扩展名路径保持 404；
- `/gh-oauth/device/code` POST 透传正常。

注意：`npx wrangler pages dev dist` 模拟的是 CF 语义（ASSETS 自动做无扩展名映射），
**无法复现** EdgeOne 的差异，回退行为须以线上为准。
