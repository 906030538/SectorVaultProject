# Sector Vault Project — 索引仓

内容去中心化储存的基于 Git 的无头 CMS（Sector Vault Project）的**索引数据仓**。本仓库只包含一系列 JSON 数据与必要的配置文件，为[主站点](../DESIGN.md)提供投稿与用户的索引服务。

- 主站点与索引数据共仓库，通过不同分支管理；本目录规范即索引分支的内容。
- 索引分支允许所有人提交 PR，门禁校验格式通过后自动合入。

## 目录结构

```
.
├── index/
│   ├── current.json        # 未归档索引：最近投稿（上限 1024 条）+ 用户记录
│   └── archive/
│       └── YYYY-MM.json    # 按月份归档的历史索引（由定时任务生成）
├── schema/
│   ├── current.schema.json     # 索引文件整体结构（JSON Schema draft-07）
│   ├── submission.schema.json  # 稿件索引条目结构
│   └── user.schema.json        # 用户索引条目结构
├── scripts/
│   └── archive.mjs         # 归档与仓库存活检查脚本（供定时任务调用）
└── .github/workflows/
    ├── validate.yml        # PR 格式校验门禁 + 自动合入
    └── archive.yml         # 定时归档任务（每月 1 日 03:00 UTC）
```

### `index/current.json` 结构

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
      "submittedAt": "2026-08-31T00:00:00Z",
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

## 工作流程

### 投稿（新增索引）

1. 主站编辑器完成投稿后，向本仓库的 `main` 分支发送一个**轻量 PR**，修改 `index/current.json`，写入当前稿件的必要索引内容与用户记录。
2. PR 触发 `validate.yml` 门禁；校验通过后自动合入（squash）。

### 修改投稿

- 索引属性（封面、标题等）变更时同样发送轻量 PR 更新索引，**投稿时间不变更**。

### 归档（定时任务）

- `archive.yml` 每月 1 日 03:00 UTC 运行（也可手动触发）：
  1. **仓库存活检查**：逐一检查用户索引中记录的仓库是否存在，不存在则删除对应记录。
  2. **归档**：`current.json` 超过 1024 条投稿时，将最早的溢出条目移入 `index/archive/YYYY-MM.json`（同月累加），`current.json` 只保留最近 1024 条。

### 阅读顺序（主站点加载）

1. 先加载 `current.json` 分页展示；
2. 翻页耗尽后按时间倒序依次加载 `archive/*.json`，并缓存已加载的索引，直至遍历完毕。

## 部署门禁

所有修改 `index/**` 的 PR 必须通过 `validate.yml`：

| 检查项 | 说明 |
| --- | --- |
| JSON 语法 | `index/**/*.json` 必须是合法 JSON |
| Schema 校验 | 使用 ajv（draft-07）按 `schema/` 下三个 schema 递归校验 |
| 容量约束 | `submissions` 条目数 ≤ 1024 |
| 枚举与格式 | `platform`、`type`、`paramState` 枚举值，`submittedAt` 为 ISO 8601，数组字段 ≤ 10 项 |

校验通过后由 `gh pr merge --auto --squash` 自动合入，无需人工审核；校验失败则 PR 被阻塞，需修改后重新推送。

## 本地校验

```bash
npx ajv-cli validate -s schema/current.schema.json -r schema/submission.schema.json -r schema/user.schema.json -d "index/**/*.json" --spec=draft7
```
