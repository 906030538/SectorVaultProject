# Cloudflare Pages 部署

本分支（`cf`）适配 Cloudflare Pages，相较 GitHub Pages 部署的额外能力：

1. **Pages Functions 反向代理 GitHub OAuth 端点**——解决 `github.com/login/*` 无 CORS 导致浏览器无法直连的问题；
2. **SPA 回退返回 200**（`functions/[[path]].ts`）——未命中静态资源时回退 `404.html`（页面内路由组件自激活），比 GitHub Pages 的 404 方案对 SEO 更友好。

## 目录结构

```
functions/
  [[path]].ts              # 根捕获：未命中静态资源时回退 404 页内容（HTTP 200，页面内路由自激活）
  gh-oauth/[[path]].ts     # POST /gh-oauth/device/code、/gh-oauth/access_token → github.com/login/*
  oauth/env.ts             # GET /oauth/env：下发各平台 clientId
  oauth/[platform]/token.ts # POST /oauth/{gitee|atomgit}/token：token 交换代理
public/
  _routes.json             # Functions 生效路径（上述前缀 + 裸路径）
public/deployment.json   # 索引源与 OAuth 配置
```

### 不要使用 astro adapter

本站是纯静态输出（已知路径构建期预渲染，未知路径靠 `functions/[[path]].ts` SPA 回退），
没有 SSR 路由。给 `astro.config.mjs` 加 `adapter: cloudflare()` 会导致：

1. 无 SSR 路由时适配器**不产出 `_worker.js`**（worker 路由不存在）；
2. 产物被改成 `dist/client/` 嵌套结构，而 Pages 输出目录是 `dist`，所有资源路径错位、
   `_routes.json` 不在输出根目录而失效；
3. 即使将来产出 `_worker.js`，Pages 会因 `_worker.js` 优先而**忽略整个 `functions/` 目录**，
   OAuth 代理全部失效——两套机制互斥，需把 OAuth 逻辑搬进 Astro API 路由才行。

## 部署步骤

1. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git，选择本仓库 `cf` 分支；
2. 构建配置：
   - Framework preset：**Astro**
   - Build command：`npm run build`
   - Build output directory：`dist`
3. OAuth 配置（**密钥全部走 Pages 环境变量，不进 deployment.json**）——
   Pages → Settings → Variables and Secrets 添加：

   | 变量 | 用途 |
   | --- | --- |
   | `OAUTH_GITHUB_CLIENT_ID` | GitHub 设备授权流 / 回调流 clientId |
   | `OAUTH_GITEE_CLIENT_ID` + `OAUTH_GITEE_CLIENT_SECRET` | Gitee OAuth（token 交换在服务端代理完成） |
   | `OAUTH_ATOMGIT_CLIENT_ID` + `OAUTH_ATOMGIT_CLIENT_SECRET` | AtomGit OAuth（同上） |
   | `OAUTH_GITCODE_CLIENT_ID` | GitCode（暂仅 clientId 下发） |

   - 前端经 `GET /oauth/env` 获取各平台 clientId（secret 永不下发）；
   - Gitee / AtomGit 的 token 交换走 `POST /oauth/{platform}/token`（Functions 注入 secret 后转发上游）；
   - GitHub 设备流走 `/gh-oauth/*`；
   - 本地开发在仓库根放 `.dev.vars`（已被 .gitignore 排除）写入同名变量；
4. 若使用回调式 OAuth（`/login/github`），GitHub App 的回调地址填 `https://<域名>/login/github`；
   Gitee / AtomGit 应用的回调地址填 `https://<域名>/login/{platform}`。

## 本地验证

```bash
npm run build
npx wrangler pages dev dist
```

`wrangler pages dev` 会自动编译当前目录下的 `functions/`（无需 `--functions` 参数），
并读取 `.dev.vars` 注入环境变量。访问 `http://localhost:8788`。

> 若报错 "deploy configuration at .wrangler/deploy/config.json ... does not exist"，
> 删除 `.wrangler/deploy/` 即可——那是 astro cloudflare adapter 构建时写入的残留。

## 与 GitHub Pages 部署的差异

| 项 | main（GitHub Pages） | cf（Cloudflare Pages） |
| --- | --- | --- |
| 部署工作流 | `.github/workflows/deploy-pages.yml` | Pages Git 集成（免配置） |
| SPA 回退 | 404.html（HTTP 404） | functions/view.ts（HTTP 200） |
| GitHub OAuth | 需自备代理（CORS 限制） | `/gh-oauth/*` 内置代理 |
| base 路径 | `/SectorVaultProject`（项目页） | 根路径（无需 ASTRO_BASE） |
