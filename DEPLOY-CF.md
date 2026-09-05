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
3. 部署完成后，在 `public/deployment.json` 中：
   - 填入 `oauth.github.clientId`（GitHub App / OAuth App 的 Client ID，设备授权流无需 client secret）；
   - `deviceCodeUrl` / `tokenUrl` 保持默认的 `/gh-oauth/*` 代理路径；
   - 自定义域名时 Pages 自动签发证书，无需额外配置；
4. 若使用回调式 OAuth（`/login/github`），GitHub App 的回调地址填 `https://<域名>/login/github`。

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
