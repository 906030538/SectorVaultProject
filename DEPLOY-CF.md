# Cloudflare Pages 部署

本分支（`cf`）适配 Cloudflare Pages，相较 GitHub Pages 部署的额外能力：

1. **Pages Functions 反向代理 GitHub OAuth 端点**——解决 `github.com/login/*` 无 CORS 导致浏览器无法直连的问题；
2. **SPA 回退返回 200**（`functions/view.ts`）——未命中静态资源时回退 `404.html`（页面内路由组件自激活），比 GitHub Pages 的 404 方案对 SEO 更友好。

## 目录结构

```
functions/
  gh-oauth/[[path]].ts   # POST /gh-oauth/device/code、/gh-oauth/access_token → github.com/login/*
  view.ts                # 动态路由的 SPA 回退（/view、/user、/edit、/login、/discussions 前缀）
public/
  _routes.json           # Functions 生效路径（仅上述前缀 + /gh-oauth）
public/deployment.json   # 索引源与 OAuth 配置
```

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
npx wrangler pages dev dist --functions=functions
```

访问 `http://localhost:8788`。

## 与 GitHub Pages 部署的差异

| 项 | main（GitHub Pages） | cf（Cloudflare Pages） |
| --- | --- | --- |
| 部署工作流 | `.github/workflows/deploy-pages.yml` | Pages Git 集成（免配置） |
| SPA 回退 | 404.html（HTTP 404） | functions/view.ts（HTTP 200） |
| GitHub OAuth | 需自备代理（CORS 限制） | `/gh-oauth/*` 内置代理 |
| base 路径 | `/SectorVaultProject`（项目页） | 根路径（无需 ASTRO_BASE） |
