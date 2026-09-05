# Sector Vault Project — 索引仓

去中心储存的基于 Git 的无头 CMS（Sector Vault Project）的**索引数据仓**。本仓库只包含一系列 JSON 数据与必要的配置文件，为[主站点](https://svp.lyoko.cn)提供投稿与用户的索引服务。

- 主站点与索引数据共仓库，通过不同分支管理；本目录规范即索引分支的内容。
- 索引分支允许所有人提交 PR，门禁校验格式通过后自动合入。

> **当前尚处于Alpha开发阶段，数据可能不保留，结构定义可能变。**

## 目录结构

```
.
├── index/
│   ├── current.json        # 派生数据：最近投稿（长度由 config.json 的 currentLimit 配置）+ 用户记录 + 归档元数据（CI 生成，禁止手改）
│   └── archive/
│       └── YYYY-MM.json    # 按月份的归档索引，事实来源，投稿 PR 直接修改（不限长度）
├── schema/
│   ├── archive.schema.json     # 归档索引文件结构（JSON Schema draft-07）
│   ├── current.schema.json     # 派生索引文件结构
│   ├── submission.schema.json  # 稿件索引条目结构
│   └── user.schema.json        # 用户索引条目结构
├── scripts/
│   └── rebuild.mjs         # 从归档重建 current.json（合并去重、仓库存活检查、重算元数据）
├── config.json             # 索引仓配置：currentLimit（current.json 稿件数上限，默认 1024）
└── .github/workflows/
    ├── validate.yml        # PR 格式校验门禁 + 自动合入
    └── rebuild.yml         # 合入后重建 current.json；每月定时做仓库存活清理
├── LICENSE                 # CC BY 4.0
```

### 归档文件 `index/archive/YYYY-MM.json` 结构（投稿 PR 修改的目标）

```jsonc
{
  "submissions": [
    {
      "platform": "github",           // 托管平台：github | gitee | atomgit
      "owner": "someone",
      "repo": "svp-works",
      "slug": "250831",               // 投稿目录名
      "title": "示例投稿",
      "cover": "https://.../cover.webp",
      "submittedAt": "2026-08-31T00:00:00Z",   // 投稿日期（一经写入不可修改，门禁强制）
      "publishedAt": "2026-08-31T12:00:00Z",   // 发布日期（可与投稿日期不同，允许更新）
      "issue": 42,                             // 关联 issue 编号（投稿时创建的标题同名 issue）
      "release": "250831",                     // 关联 release 标签名（与 slug 同名），无则为 null
      "type": "project",              // project | article
      "paramState": "with-param",     // with-param | tuned | no-param
      "songs": [], "engines": [], "voicebanks": [], "languages": []
    }
  ],
  "users": [
    {
      "platform": "github",
      "owner": "someone",
      "displayName": "Someone",
      "avatar": "https://.../avatar.png",
      "pagesUrl": null,               // 用户自部署的静态页面链接
      "repos": [{ "repo": "svp-works" }]  // 每个仓库一条记录
    }
  ]
}
```

`current.json` 结构相同，额外多两个由重建任务维护的字段：`userCount`（总用户数，按平台+用户名合并不分仓库）和 `archives` 数组（每个归档文件按类型 project/article 的统计）。

## 工作流程

### 投稿（新增索引）

1. 主站编辑器完成投稿后，向本仓库的 `main` 分支发送一个**轻量 PR**，直接修改投稿月份对应的 `index/archive/YYYY-MM.json`，写入当前稿件的必要索引内容与用户记录（归档长度不设限，只追加不删改他人条目）。
2. PR 触发 `validate.yml` 门禁；校验通过后自动合入（squash）。
3. 合入触发 `rebuild.yml`：合并全部归档、去重、按投稿时间倒序截取最近 `currentLimit` 条生成 `current.json`，并重算 `archives` 元数据。

### 修改投稿

- 索引属性（封面、标题等）变更时同样发送轻量 PR 修改对应归档文件，**投稿时间不变更**。

### 定时任务

- `rebuild.yml` 每月 1 日 12:00 UTC 运行（也可手动触发）：
  1. **预生成下月归档**：确保下个月的空归档文件 `index/archive/YYYY-MM.json` 存在，投稿 PR 始终有当月文件可写。
  2. **仓库存活检查**：逐一检查用户索引中记录的仓库（GitHub/Gitee/Atomgit API）是否存在，不存在则从用户记录中删除，并重建 `current.json`。

### 阅读顺序（主站点加载）

1. 先加载 `current.json` 分页展示；
2. 翻页耗尽后按时间倒序依次加载 `archive/*.json`，并缓存已加载的索引，直至遍历完毕（`archives` 数组可用于跳过空归档）。

## 部署门禁

所有修改 `index/**` 的 PR 必须通过 `validate.yml`：

| 检查项         | 说明                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------- |
| 派生数据保护   | 禁止手改 `index/current.json`（由 Action 生成，PR 中出现该文件改动即失败）                         |
| 投稿日期不可变 | 已存在稿件（同 `platform/owner/repo/slug`）的 `submittedAt` 不允许修改，改动即失败                 |
| PR 范围限制    | 删除任何文件、或一次修改多个稿件（新增+改动 > 1 条）的 PR 不自动合并，评论说明原因并请求管理员审核 |
| JSON 语法      | `index/archive/*.json` 必须是合法 JSON                                                             |
| Schema 校验    | 使用 ajv（draft-07）按 `schema/` 下各 schema 递归校验                                              |
| 枚举与格式     | `platform`、`type`、`paramState` 枚举值，`submittedAt`/`publishedAt` 为 ISO 8601，数组字段 ≤ 10 项 |

校验通过且 PR 只涉及单个投稿（无文件删除、新增/改动稿件 ≤ 1 条）时，由 `gh pr merge --auto --squash` 自动合入，无需人工审核；其余情况（删除文件或同时修改多个投稿）转为人工流程：PR 会被评论标注原因并请求管理员审核。校验失败则 PR 被阻塞，需修改后重新推送。

## 配置

`config.json`：

```json
{ "currentLimit": 1024 }
```

- `currentLimit`：`current.json` 保留的最近稿件数上限，可通过修改该文件并重新合入触发重建；本地运行可用环境变量 `CURRENT_LIMIT` 覆盖。

## 本地校验与重建

```bash
npx ajv-cli validate -s schema/archive.schema.json -r schema/submission.schema.json -r schema/user.schema.json -d "index/archive/*.json" --spec=draft7
node scripts/rebuild.mjs   # GITHUB_TOKEN=... 可选，用于仓库存活检查
```
