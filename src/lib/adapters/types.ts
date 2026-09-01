import type {
  AuthInfo,
  FileInfo,
  IssueInfo,
  ReleaseInfo,
  RepoInfo,
} from '@/types';

/** 写入文件（新建或更新）；delete 为真时删除该路径 */
export interface FileChange {
  path: string;
  /** 文件内容；字符串按 UTF-8 处理，或传 base64；delete 时忽略 */
  content: string;
  encoding?: 'utf-8' | 'base64';
  delete?: boolean;
}

/**
 * Git 平台适配器：屏蔽 GitHub / Gitee / AtomGit 差异。
 * 读操作可匿名（受速率限制），写操作需要登录 token。
 */
export interface GitPlatformAdapter {
  readonly platform: AuthInfo['platform'];

  /** 校验 token 并返回账户信息 */
  getViewer(token: string): Promise<AuthInfo>;

  /** 列出用户仓库；提供 prefix 时仅返回固定前缀的内容仓 */
  listRepos(user: string, prefix?: string): Promise<RepoInfo[]>;

  /** 仓库信息（含 star 数与许可证） */
  getRepo(user: string, repo: string): Promise<RepoInfo>;

  /** 列出目录内容；ref 缺省为默认分支 */
  listDir(user: string, repo: string, path?: string, ref?: string): Promise<FileInfo[]>;

  /** 读取文件文本内容；ref 缺省为默认分支 */
  readFile(user: string, repo: string, path: string, ref?: string): Promise<string>;

  /** 获取文件原始内容下载地址 */
  rawUrl(user: string, repo: string, path: string): string;

  /** Release 列表 */
  listReleases(user: string, repo: string): Promise<ReleaseInfo[]>;

  /** Issue 列表（留言） */
  listIssues(user: string, repo: string): Promise<IssueInfo[]>;

  /** Discussions 页面地址 */
  discussionsUrl(owner: string, repo: string): string;

  /** Wiki 页面地址 */
  wikiUrl(owner: string, repo: string): string;

  // ---- 写操作（编辑器流程，需要登录态） ----

  /** 批量提交文件到指定分支 */
  commitFiles(
    token: string,
    user: string,
    repo: string,
    message: string,
    changes: FileChange[],
  ): Promise<void>;

  /** 创建 issue，返回编号 */
  createIssue(token: string, user: string, repo: string, title: string, body: string): Promise<number>;

  /** 对最新提交创建 release，返回 release id */
  createRelease(
    token: string,
    user: string,
    repo: string,
    tag: string,
    body: string,
  ): Promise<number>;

  /** 上传 release 附件 */
  uploadReleaseAsset(
    token: string,
    user: string,
    repo: string,
    releaseId: number,
    file: Blob,
    name: string,
  ): Promise<void>;

  /** 删除 release 附件 */
  deleteReleaseAsset(
    token: string,
    user: string,
    repo: string,
    releaseId: number,
    assetId: number,
  ): Promise<void>;

  /** 从模板仓库创建内容仓 */
  createRepoFromTemplate(
    token: string,
    owner: string,
    name: string,
    template: { owner: string; repo: string },
    license?: string,
  ): Promise<void>;

  /** 向索引仓提交轻量 PR（仅包含索引更新行） */
  openIndexPr(token: string, title: string, changes: FileChange[]): Promise<string>;
}
