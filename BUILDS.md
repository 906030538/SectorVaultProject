# 构建目标（一套代码，三种产物）

同一套源码经**编译参数 `PUBLIC_SVP_ROUTER`** 区分三种构建目标，对应三类部署平台策略。
路由核心在 `src/lib/router.ts`（`ROUTER` 常量三值：`path` / `static` / `hash`）。

| | `npm run build` | `npm run build:static` | `npm run build:hash` |
| --- | --- | --- | --- |
| 编译参数 | （默认） | `PUBLIC_SVP_ROUTER=static` | `PUBLIC_SVP_ROUTER=hash` |
| 形态 | 混合 SPA | 纯静态 SSG | hash 单页 |
| 适用平台 | 部署成本中等、**支持 404 回退**（CF Pages、GH Pages） | 部署成本低、想扔上**任意静态托管**且要 SEO | 部署成本高、**不支持 404 回退**（EdgeOne Pages、ESA） |
| 路由 | URL 路径 + 404.html 回退壳 | URL 路径（全部预渲染为真实文件） | `/#/view/owner/repo/slug` 单页 |
| 列表/详情数据 | 客户端拉取（**始终最新**） | 构建期固化（**SEO 可读**，重建才更新） | 客户端拉取（最新） |
| 动态路由（view/user） | 404 回退壳客户端渲染 | `getStaticPaths` 枚举索引全部投稿/用户/集合 | index 单页壳挂载 |
| OAuth 网页流 | 可用 | 不可用（PAT / GitHub 设备流可用） | 已禁用（PAT / GitHub 设备流） |

## 各模式要点

### path（默认，混合 SPA）

静态预渲染页面骨架 + 列表数据客户端拉取；未预渲染路径（`/view/…`、`/user/…` 等）
由静态托管的 404 回退送入 `404.html` SPA 外壳，路由组件按 `window.location`
自行激活。数据永远是最新索引。

### static（纯静态 SSG，SEO）

构建期拉取全部索引（current + 归档合并）与每篇投稿 README（raw 直连，无 API 配额），
预渲染首页统计/最新、工程与专栏全量列表、**每篇投稿详情**（marked + DOMPurify 净化，
敏感词门禁与运行期同阈值，词包缺失 fail-open）、每个集合与用户页。产物即完整站点，
任何纯静态托管直接可用，爬虫无需 JS 即可读到全部内容。

- 单篇内容拉取失败 → 该页降级为占位 + 内容仓外链，构建不中断；
- 构建环境变量：`SSG_TOKEN`（raw 拉取增强，可选）、`SSG_DEPLOYMENT`（本地
  deployment.json 副本覆盖）、`DICT_PACK_FILE`（本地词包，开发用）；
- `prebuild:static` 自动拉词包（无 token 跳过，过滤停用）。

### hash（单页，无回退依赖）

整站收敛为 `index.html` 单页（13+1 路由宿主），站内链接全部 `#/` 前缀——不依赖任何
404 回退 / 重写 / 边缘函数兜底。原静态页变为重定向壳；`/login/:platform` 预渲染为
真实静态回调页。`ASTRO_BASE` 可叠加子路径部署（如 toy 的 `toy/svp/`）。

## 模式选择速查

- 平台能自动回退 404 页 → **path**（数据最新）
- 平台什么都不支持、只 serving 静态文件 → **static**（SEO 最好，数据固化）
- 平台回退不可靠 / 配置成本高 → **hash**（到处能跑，链接带 #）
