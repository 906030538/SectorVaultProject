# Sector Vault Project
内容去中心化储存的基于Git的无头CMS，使用Astro开发。

## 主站点
1. 支持不同git平台部署（GitHub、Atomgit、Gitee）。
2. 支持OAuth（GitHub Device Flow）或PAT（GitHub App）授权认证；跨子域共享登录态（父域cookie镜像）；OAuth代理列表（`oauthBases`）依次探测取首个可达。
3. 使用octokit实现githubAdapter，V5PlatformAdapter统一Gitee/AtomGit/GitCode。
4. 与索引数据共仓库，通过不同分支管理。
5. i18n支持，默认支持简体中文、繁体中文、英语、日语。
6. 颜色主题支持，默认白色主题，识别系统深色模式自动切换黑色主题。
7. 全局导航左侧为站点logo、投稿列表、专栏、讨论、常见问题、网站介绍、问题反馈（跳转当前线路索引仓issues），右侧为投稿按钮、线路选择（带global/国内镜像标注）、语言选择、主题选择、用户头像和用户名。
8. 线路选择后用户区按该平台取会话；无该平台登录信息时显示登录按钮（弹窗预选该平台）。
9. 未登陆时，点击导航栏的投稿或登陆按钮，弹出页签式授权对话框（各平台页签+已登陆标记+面板内登出）。导航栏登出按钮仅登出当前线路平台的账号（其他线路登录态保留）。已保存的GitHub令牌失效时（匿名可用接口带令牌返回401）：自动清除该平台登录态并弹「登录过期」对话框，提供重新登录（打开授权对话框）或匿名访问（刷新页面）两个选项；每次页面加载每平台最多提示一次，登录流程中校验的候选令牌不触发。

前端路由：
```
/ -- 首页
/project -- 投稿列表
/article -- 专栏列表
/discussions -- 讨论
/faq -- 常见问题
/about -- 站点介绍
/user/:name -- 用户空间
/view/:name/:repo -- 集合详情
/view/:name/:repo/:slug -- 详情页
/edit/:name/:repo/:slug -- 编辑稿件
/new -- 新建投稿
/login/:platform -- OAuth 回调
```

### 投稿列表
1. 从索引仓加载，分页展示最近的投稿，默认展示10条。
2. 点击下一页时，如果默认索引显示完毕，则自动加载已归档的索引，直至遍历完所有索引，缓存已加载的索引。
3. 提供筛选器，可以根据关联曲目、合成引擎、使用声库、歌曲语言筛选。
4. 提供搜索器，输入关键字点搜索按钮后，遍历索引，列出关联稿件。
5. 列表显示稿件封面、标题、投稿时间、用户名、关联曲目、合成引擎、使用声库、歌曲语言、有无参数。
6. 自动获取当前页的稿件关联issue的评论数和点赞数（👍表情数量），并缓存。
7. 读请求统一超时（`fetchGetTimeout`，20s）：被墙/失联域名的连接会长期pending（iOS无代理时尤甚），超时视为源失败跳过，列表显示空态而非永久加载。接入点为GitHub适配器octokit的自定义fetch（并关闭其自动重试）与V5适配器request；写操作（上传/提交）不受限。

### 投稿详情
1. 宽屏双栏布局：主列（标题/日期/互动数据/正文/标签/媒体/留言），右侧栏（作者卡/工程文件/附件，sticky吸附）。
2. 页面开始展示投稿标题、时间，日期旁显示回复数、点赞数和点赞按钮（点赞=关联issue的👍表情，可取消）。
3. 以列表形式显示关联曲目、合成引擎、使用声库、歌曲语言、有无参数。
4. 如果有，显示关联视频链接（平台icon+视频ID）。
5. 如果有封面先显示封面再显示参数。
6. 渲染正文，不用包含文件头的各种属性；正文结束后显示tag列表。
7. 仓库媒体区只展示可显示/播放的媒体（图片/音频/视频），排除封面（顶部已展示）；工程文件中的明文媒体类文件不在工程文件区显示、改在媒体区展示（压缩/加密文件仍留在工程文件区）；无内容时隐藏区块。
8. 作者卡显示用户头像（API拉取失败回退首字母）、作者名（索引记录优先，回退仓库用户名）、仓库badge（链接优先用API返回的htmlUrl，缺省按平台拼接；GitHub等为owner/repo|平台色两段式，Gitee/AtomGit不显示仓库名、平台色单段badge即仓库跳转按钮，悬停title提示仓库）、收藏badge（Gitee/AtomGit为平台官方star badge图，其余平台为★|数量SVG）、许可证三态：稿件SPDX标识显示名称chip；非SPDX/自定义（README属性非SPDX值，或slug目录存在LICENSE文件）显示折叠卡（默认收起，首次展开才拉取LICENSE全文）；稿件未指定时显示仓库级许可证名称（repoInfo）。README formatter属性头解析兼容旧版`- key: value`列表风格。
9. 工程文件列表：非加密文件整框可点击下载（无独立按钮），悬停手势+扩展名图标（public/icons按扩展名自动识别）；加密文件两行布局（名称行/密码+解密按钮行），解密成功后切换普通文件样式（隐藏控件、标签改已解密、记住密码）。
10. 附件区（原关联release区）：标题行右侧"前往release"按钮；卡片先渲染release正文（发布简介+链接）再列附件列表。平台自动附带的源码打包（gitee的{tag}.zip/.tar.gz，下载地址走/archive/refs/tags/）不属于用户附件，适配层过滤不展示。
11. 留言区：评论列表（头像拉取+本地追加+本人评论可删+右置删除按钮+去除超链接）+ 评论输入框（满行宽度）。
11a. 关联issue已关闭时不加载回复与评论框，仅显示「已关闭评论区」（回复数用issue记录值）；issue列表按state=all拉取（平台不支持时退回open）。
11b. 仓库属主（同平台登录）在留言标题右侧显示「启用/关闭」按钮，点击调用issue开闭接口（GitHub走issues.update；gitee的issue归用户域：PATCH /repos/{owner}/issues/{number}且body带repo/title；atomgit/gitcode走仓库路径），成功后留言区按新状态重渲染。
12. 投稿用户本人（同平台登录）标题行显示编辑和删除按钮；删除走三步幂等管线（文件/发布/索引），成功后跳转集合页。
13. 源稿件404时清除索引缓存并展示已删除引导（后退/集合/用户/源仓库）。
14. 索引未收录兜底（如索引PR未合并、索引仓为镜像拒写）：按当前线路源平台读取稿件正文（README formatter）与内容仓本地索引（svp-archive.json），组装条目后照常渲染（本地索引优先，缺失字段由formatter补齐）；正文也不存在时才显示加载失败。

### 专栏列表
1. 基本与投稿列表一致，但不提供筛选器。
2. 稿件只显示标题、投稿时间、用户名，如果有封面或任意图片媒体也显示。

### 专栏详情
1. 与投稿详情共用组件，不显示工程文件和附件区块。

### 讨论
1. 显示主站点仓库的discussions页面作为讨论区。
2. 提供"新建讨论"按钮：未登录先弹登录框（预选平台）；弹窗含标题输入框、分类选择按钮（从讨论列表推导）、内容编辑框。
3. 讨论详情页支持同平台回复。

### 常见问题
1. 提供页面显示主站点仓库的wiki页面作为FAQ。
2. 左侧列表目录（desktop吸附侧栏，窄屏横排回退），点击无刷新切换；目录来自wiki自定义侧栏`_Sidebar.md`的`[[Page|显示名]]`链接（按出现顺序去重，Home显示名走i18n），拉取失败时回退deployment.json的`faqPages`配置。

### 站点介绍
1. 介绍本网站架构和优势。
2. 显示索引的稿件数量和用户数量。
3. 显示索引仓收藏badges：Gitee/AtomGit直接引用平台官方star badge图（`{repo}/badge/star.svg`、`{repo}/star/badge.svg`，img加载不受CORS限制）；其余平台用shields风格SVG，星标数直连API读取，不可读时显示–。

## 用户空间
用户空间既作为主站点的一个子路由，也可以独立部署。

用户空间独立部署时路由：
```
/ -- 用户空间
/view/:repo -- 当前集合详情
/view/:repo/:slug -- 详情页
/edit/:repo/:slug -- 编辑稿件
/new -- 新建投稿
```

### 个人首页
1. 显示用户名头像（平台API拉取，失败回退首字母）。主站点部署时，如果当前用户索引包含静态部署页面，提供按钮跳转。
2. 如果已经登录的账户是当前用户（无索引记录时也显示），显示新建集合按钮，在弹出界面引导用户创建新仓库。
   1. 仓库名输入框分前置和名称两部分，前缀默认为`svp-`，可通过部署配置默认前缀。
   2. 右侧下拉框选择仓库创建的属主，可能是当前账户或账户所在组织。
   3. 提供模板库选择（deployment.json按平台配置，仅支持模板生成的平台显示）。
   4. 提供下拉框选择默认许可证，提供CC0、CC4.0（含细分系列）可选，可以为空；选择"自定义"时显示全文输入框。
3. 主站点部署时，展示当前用户下所有固定前缀的仓库作为合集，并显示每个仓库最近的3个工程稿件封面标题日期和更多按钮。
4. 将包含专栏投稿的仓库再显示一遍，显示最近的3个专栏稿件和更多按钮。
5. 工程和专栏合集有大标题分隔。
6. 如果某个仓库包含个人介绍文件（`ABOUT.md`），展示第一个找到的内容。
7. 主站点部署时，如果索引包含同名但不同托管平台的用户及仓库时，通过一个查询参数`git`区分展示的数据。

### 集合详情
1. 个人页点击集合更多按钮，或投稿详情页点击仓库名进入集合详情页。
2. 显示当前仓库名、用户名和头像、仓库许可证。
3. 如果已经登录的账户是当前用户，显示投稿、编辑和删除按钮。
4. 工程和专栏各一个标签按钮，切换显示。
5. 稿件列表从索引加载，同时尝试加载仓库的`svp-archive.json`合并（本地条目优先）。
6. 如果已经登录的账户是当前用户，稿件上显示编辑和删除按钮。

### 编辑器
1. 新建投稿时，显示投稿仓库下拉框、slug输入框和工程、专栏互斥按钮；仓库下拉只列当前线路平台已登录账号的仓库，登录门控同样只看当前线路平台的登录态（编辑模式平台由稿件决定，保持任意平台令牌可进入）；slug的placeholder显示为当前6位数字日期+标题；slug输入框有模式校验（与索引仓schema的pattern一致：字母数字下划线连字符假名汉字谚文）。编辑稿件时不可编辑。
2. 标题输入框独占一整行；下方为作者和邮箱输入框（git提交作者，作者默认登录用户）。
3. 提供有参、微调、无参数单选框；视频站链接、关联曲目、合成引擎、使用声库、歌曲语言提供列表输入框。
4. 提供封面图片上传组件：投稿与专栏两种类型均可用（专栏也可配图）；选择图片后以本地 object URL 即时预览（移除/重选时回收链接）。
5. 正文输入框提供可视化Markdown编辑器。
6. 提供标签输入框，最多10个标签。
7. 许可证下拉框：留空（不设置）、CC系列、自定义（展开全文输入框）。选择许可证即向slug目录写入LICENSE文件（SPDX取全文或自定义全文），README不再记录license属性。
8. 工程文件上传控件：每个文件提供方案选择（不处理/格式化/压缩/加密）。默认方案按内容探测：json/xml/svp等JSON或XML文本默认「格式化」（json/svp按JSON两空格缩进可读打印，xml走折行缩进；首部嗅探不匹配时回退「不处理」），其余默认「不处理」。压缩/加密文件入库附加`.zip`后缀（显示名保持原名）。GitHub平台隐藏附件上传控件，显示文本提示。
9. 发布简介输入框（新建和编辑均显示；编辑时从release正文回填，修改后同步更新关联release）。
10. 附件上传控件（非GitHub平台）。
11. 投稿总是创建关联issue（不再提供评论区开关）。
12. 新建投稿流程：
    1. 创建slug同名issue（正文为稿件参数+slug目录链接），记录issue编号（字符串）。
    2. 创建slug同名release，正文包含发布简介和原仓库slug目录链接（非本站链接），记录release id（字符串）。release先于文件创建，README一次写入即携带release id。
    3. 将封面、工程文件、README.md（含作者/邮箱/标签/release id）、LICENSE（如有）写入slug目录，与仓库README链接和本地索引合并为一个提交；空仓库时直接以最终内容（含slug链接的README、含投稿条目的svp-archive.json）初始化建仓，避免初始化后覆盖的连续双写。
    4. 上传附件到release（GitHub不支持，提示跳转平台上传）。
    5. 向索引仓提交单文件PR。
    6. 每步记录进度，失败可断点重试或跳过；草稿自动保存到localStorage。
13. 修改投稿流程：
    1. 封面修改：删旧传新。
    2. 文件修改、README重写、本地归档更新合并为单个提交（消除相邻提交的fast-forward竞态窗口）。
    3. 发布简介有修改时同步更新关联release正文。
    4. 附件同步到关联release。
    5. 索引属性有修改时更新本地归档并向索引仓提PR。
14. git提交作者：GitHub传author（name+email），V5系以令牌身份提交。

### 删除投稿
1. 集合详情页和投稿详情页均提供删除按钮。
2. 确认框要求输入slug二次确认。
3. 三步幂等执行：删除slug目录文件（含README链接清理和本地归档更新）→ 删除关联release（尽力）→ 从索引归档移除条目（PR）。关联issue平台API不支持删除，保留。
4. 失败可整体重试；成功后跳转集合页。

## 主站点-索引仓
1. 只包含一系列json和必要的配置文件。
2. 稿件索引记录：平台、属主、仓库、slug、标题、封面链接、投稿时间、发布时间、作者名、邮箱、关联issue编号（字符串）、关联release id（字符串）、标签列表、关联曲目、合成引擎、使用声库、歌曲语言、有无参数。
3. 索引按照月份归档，保存到`index/archive/YYYY-MM.json`。
4. 定时任务检查用户索引里的仓库是否存在，不存在则应删除这条索引。
5. 定时任务生成`index/current.json`，记录所有归档的文件名和统计。
6. 索引分支允许所有人提交pr，门禁校验通过后自动合入。索引PR的分支策略：索引仓属主同仓开工作分支；其他用户fork索引仓（重复fork返回既有fork），既有fork的索引分支会落后于上游，提交前先把fork的索引分支ref强制快进到上游头（git updateRef，fork网络共享对象库，即「Sync fork」的实现；merge-upstream API只同步默认分支且merges API不支持跨仓head语法），同步失败时退回fork自身分支头（提交内容基于上游最新归档构建，仍可干净合并）。
7. 浏览时按线路加载对应平台索引，带本地缓存（current 10分钟、当月归档12小时、过往归档3天）。
8. 归档目录列举与current.json的archives清单取并集（清单可能滞后）。
9. 首页统计与用户主页使用current+归档合并（无CI线路的users记录在归档里）。

`current.json`内容参考如下：
```json
{
   "archives": [{
      "file": "2026-09.json",
      "byType": { "project": 1, "article": 0 }
   }],
   "users": 1,
   "submissions": [{
      "platform": "github",
      "owner": "testUser",
      "repo": "svp-default",
      "slug": "260901-test",
      "title": "test",
      "author": "测试作者",
      "email": "author@example.com",
      "cover": "./cover.png",
      "submittedAt": "2026-09-01T12:00:00Z",
      "publishedAt": "2026-09-01T12:00:00Z",
      "type": "project",
      "issue": "123",
      "release": "456789",
      "tags": ["标签1"],
      "paramState": "with-param",
      "songs": ["My song"],
      "engines": ["Vocaloid"],
      "voicebanks": ["Miku"],
      "languages": ["jp"]
   }],
   "users": [{
      "platform": "github",
      "owner": "testUser",
      "displayName": "测试",
      "avatar": "https://...",
      "pagesUrl": "https://...",
      "repos": [{ "repo": "svp-default" }]
   }]
}
```

## 内容仓
```
public/ -- 静态目录预留
posts/ -- 数据目录
posts/[slug] -- 投稿目录
posts/[slug]/README.md -- 正文
posts/[slug]/LICENSE -- 稿件级许可证（选择了许可证时写入）
posts/[slug]/cover.png -- 封面
posts/[slug]/project.vsqx -- 工程文件（不处理/格式化）
posts/[slug]/project.vsqx.zip -- 压缩/加密工程文件（物理名带.zip后缀）
README.md -- 简单目录
svp-archive.json -- 本地索引
```

1. 内容仓库结构兼容DecapCMS。
2. 媒体不统一放一个目录，而是与稿件相同目录。
3. 支持用户自行部署静态页面。

## 部署配置（deployment.json）
```json
{
  "indexes": [{ "platform": "github", "owner": "...", "repo": "...", "branch": "index" }],
  "repoPrefix": "svp-",
  "cookieDomain": "svp.lyoko.cn",
  "oauthBases": ["https://cf.svp.lyoko.cn", "https://ccs.lyoko.cn"],
  "faqPages": ["Home", "项目介绍"],
  "oauth": { ... }
}
```
- `repoPrefix`：新建集合对话框默认前缀。
- `cookieDomain`：跨子域共享登录态的父域（令牌/会话cookie镜像）。
- `oauthBases`：OAuth代理基址列表，依次探测取首个可达（兼容旧`oauthBase`单值）。
- `faqPages`：FAQ目录页面列表（兜底：wiki侧栏`_Sidebar.md`不可用时使用）。

## Cloudflare Pages Functions
- `functions/[[path]].ts`：根捕获SPA回退（未命中静态资源以200返回404.html内容）。
- `functions/oauth/env.ts`：下发各平台clientId（环境变量注入）。
- `functions/oauth/[platform]/token.ts`：token交换代理（secret留服务端）。
- `functions/gh-oauth/[[path]].ts`：GitHub设备流代理。

## 静态资源
- `public/icons/`：文件扩展名SVG图标目录（49个，按扩展名自动匹配，未知类型回退file.svg）。
- `public/_routes.json`：Functions生效路径配置。
