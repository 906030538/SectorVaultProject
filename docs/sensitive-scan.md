# 敏感内容扫描门禁（sensitive scan）

对投稿 PR 中**新增/修改的稿件条目**做敏感词打分，超过阈值时拒绝自动合入并评论引导作者修改或联系管理员。
词库来自私有仓 `906030538/dict-resources` 的 `data/dict-pack.bin`（SVPX 容器，周更，人工审后合并）。

- 脚本：`scripts/check-sensitive.mjs`
- 挂载点（投稿全路径收敛于此两处）：
  - `.github/workflows/validate.yml` — GitHub 索引仓 PR 门禁（含 Gitee/AtomGit 镜像经 `sync-to-github.mjs` 汇入的 PR）
  - `.github/workflows/atomgit-gate.yml` — atomgit 分支镜像直推门禁
- 阈值配置：`config.json` → `sensitiveScan`（`enabled` / `threshold` / `perCategory`）

## 数据流

```
PR head（../pr 工作树，数据只读）
  → 变更条目 = 与基线按 platform/owner/repo/slug 对比后新增或内容有变化的条目
  → 每条目取扫描源：
      索引字段  title / author / tags / songs / engines / voicebanks / languages
      正文      按平台拉内容仓 posts/[slug]/README.md（best-effort，拉不到只扫字段）
  → 逐条目打分 → 任一条目超线 → blocked
```

词包拉取用 `gh api`（raw Accept 头）+ `SVP_BOT_TOKEN`。**拉取失败 fail-open**：
扫描输出 `scan=skipped` 并告警，不阻塞投稿（可用性优先；misconfiguration 在 Actions
summary 的 warning 里可见，内容审核缺位不放大为拒绝服务）。

## 打分规则

### 归一化与匹配口径

与词包白名单（dict-resources）同口径：**NFKC + lowercase**。词包侧已按此口径在出厂前
剔除领域误伤词（allowlist.json），消费侧不再做遮蔽。

| 词形 | 匹配方式 |
|---|---|
| 拉丁词（`^[a-z0-9]+$`） | **整 token 精确匹配**（token = 归一化文本中连续的 `[a-z0-9]+` 段）。`av` 不得命中 `maihime`/`default` 内部 |
| 其余词（含 CJK/点分域名） | 子串匹配，扫两遍取每词最大命中数：① 归一化文本 ② 紧凑形（再去掉空白/零宽/`*·-_.…` 等分隔符），防「字间加符号」规避（法\*轮\*功） |
| URL 碎片段 / 基础设施 token（`www.`、`.com`、含 `:/` 的词；裸 `www`/`com`/`http` 等） | **加载即丢弃**。任何带链接的正文必中，纯噪声；完整域名（`000.bbexe.cn`）不受影响，照常子串匹配 |
| URL 整体（scheme 或 `www.` 开头） | 从文本中摘出，**只参与 ad 类（垃圾站点）检测**。youtube/bilibili 等平台名在 politics（GFW 名单）里，视频链接 credit 是站点核心功能不算内容信号；正文散文裸写平台名仍走 token 通道照常命中 |

同一位置命中多个词时按 **leftmost-longest** 去重叠：长词优先，被长词覆盖的短词子串不再计分
（命中「法轮功」不再重复计「法轮」「轮功」）。

### 计分公式

```
单词命中分 = 类别权重 × 长度系数 × 短词系数 × 字段系数 × 饱和系数
条目总分  = 该条目所有源所有命中的命中分之和（逐条目判定，不跨条目累计）
```

| 系数 | 取值 | 理由 |
|---|---|---|
| 类别权重 | politics **10** / porn **8** / violence **8** / ad **3** / other **3** / mixed **2** | 高危类直接顶格；mixed 占词库 75% 且未分类噪声最大，压低靠累积 |
| 长度系数 | `clamp(词长,2,8)/2` → 2字=1.0 … 8字+=4.0 | 词越长越具体，信号越强 |
| 短词系数 | 2 字词：字段 ×0.25，**正文 ×0** | 子串命中的 2 字词在正常文本里噪声极高（计划/夏天/毕业/支持/购买…），单个不构成证据；歌词长文必撞常用词，正文不计 |
| 字段系数 | 索引字段 ×2，正文 ×1 | 字段是作者主动写就的短文本，同样命中信号更强 |
| 弱类拉丁限制 | ad/mixed/other 的拉丁 token **正文不计分**（字段照常） | 英文歌词/长文必撞词包里的通用英文词（party/dance 一类，实测 `party` 单词跨字段+正文累计 30 分）；带点域名的 ad 词走子串渠道不受影响 |
| 饱和系数 | 同词第 1 次全分，第 2/3 次各 0.5，第 4+ 次 0 | 重复刷屏适度放大但不无限 |

### 判定

- `条目总分 ≥ threshold`（默认 **30**），或
- `条目单分类得分 ≥ perCategory`（默认 **25**）→ 拒绝

校准依据（2026-10 存量全量实测，含正文）：合法稿件噪声地板 **21 分**（`party` 类通用英文词
字段命中 15 + `关系密切` 类民生常用语 6）；politics 4 字词出现在标题一项即 40 分。
曾处理的两个系统性误伤：**YouTube 视频链接**（`youtube` 在词包 politics/GFW 名单，任何
带视频链接的投稿 78 分被拒→URL 摘出只查 ad 类后归零）与**英文歌词 token**（`party`
跨字段+正文累计 30 分→弱类拉丁正文不计后降至 15）。

### 拒绝动作

- validate.yml：在 PR 评论「检测到敏感内容，自行修改或联系管理员。（评分 … 分类得分 …）」
  （幂等：重复推送时更新已有评论，不刷屏），并将检查项置败 → 阻止自动合并；
  拒绝优先于「转人工审查」路径。
- atomgit-gate.yml：置败 → 不自动合入 index。
- **管理员覆写**：blocked 只阻止自动合并，不锁分支；人工确认误伤可直接手动合入，
  或让作者改词后重推。误伤词若是明确的领域/常用词（如 `party`、`关系密切`），走
  dict-resources 侧 `allowlist.json` 出厂剔除，下次周更生效。

### 不扫描项（v1 范围决策）

- `owner` / `repo` / `slug`：身份字段，改名超出投稿编辑范围；
- `cover` 及一切 URL 字段值（URL 中的域名撞 ad 类误伤率高，正文里的域名照常子串匹配）；
- 归档 `users` 记录（owner 名已在稿件条目中覆盖）；
- issue / 评论（不在索引 PR 数据内）。

### 安全与隐私纪律

- **命中词与原文片段绝不输出**：PR 评论与 Actions 日志对投稿者公开，输出命中词等于
  泄露词典内容并提供逐词试探通道。脚本只输出条目分值与分类得分汇总。
- fail-open 仅限基础设施故障（词包拉取失败/脚本崩溃）；扫描结果本身（blocked）必定置败。
- 词包以 token 拉取，token 不落日志；PR 代码只作数据读入，绝不执行（沿用 pull_request_target 安全模式）。

## 运维备忘

- `SVP_BOT_TOKEN`（索引仓 secret）需具备 `906030538/dict-resources` 读权限（classic PAT
  repo scope，或 fine-grained 授予该仓 contents:read）。失效表现为每次门禁出现
  `词包拉取失败` warning + `scan=skipped`。
- 调阈值只改 `config.json`（改动会走人工审查，防投稿者自行放宽）。
- 领域误伤词（如音乐术语撞库）在 **dict-resources 侧 `allowlist.json`** 解决（出厂剔除，
  下次周更生效），不要在扫描脚本里加词。
- 词包里的 `www.`/`.com` 等 URL 碎片段目前由扫描侧丢弃；上游 sync 裁剪同步加过滤更好
  （待办）。
- 本地调试：
  ```
  node scripts/check-sensitive.mjs <baseArchiveDir> <headArchiveDir> --pack ~/git/self/dict-resources/data/dict-pack.bin [--no-body]
  ```
