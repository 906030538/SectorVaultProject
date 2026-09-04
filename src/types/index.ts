/** Git 托管平台 */
export type Platform = 'github' | 'gitee' | 'atomgit' | 'gitcode';

/** 稿件类型：工程投稿 / 专栏投稿 */
export type SubmissionType = 'project' | 'article';

/** 有无参数：有参 / 微调 / 无参数 */
export type ParamStatus = 'with-params' | 'tuned' | 'no-params';

/**
 * 用户索引记录（schema/user.schema.json）：
 * 按平台+用户名合并，repos 数组记录投稿的仓库。
 */
export interface UserRepoRef {
  repo: string;
}

export interface UserRecord {
  platform: Platform;
  owner: string;
  displayName?: string;
  avatar?: string | null;
  /** 用户自行部署的静态页面链接 */
  pagesUrl?: string | null;
  repos?: UserRepoRef[];
}

/**
 * 稿件索引条目（schema/submission.schema.json）：
 * 投稿用户、标题、封面、投稿/发布时间、关联曲目、合成引擎、
 * 使用声库、歌曲语言、有无参数。
 */
export interface SubmissionEntry {
  /** 稿件在内容仓中的目录名 */
  slug: string;
  /** 所属用户 */
  owner: string;
  /** 所属仓库 */
  repo: string;
  /** 稿件平台（继承自用户索引） */
  platform: Platform;
  type: SubmissionType;
  title: string;
  /** 封面链接（相对仓库路径或完整 URL） */
  cover?: string | null;
  /** 投稿时间 ISO 8601 */
  submittedAt: string;
  /** 发布时间 ISO 8601 */
  publishedAt?: string;
  /** 有无参数 */
  paramState?: ParamStatus;
  /** 关联评论区 issue 编号（未创建时缺省） */
  issue?: number;
  /** 关联 release id（未创建时缺省） */
  release?: number;
  /** 关联曲目（多值） */
  songs?: string[];
  /** 合成引擎（多值） */
  engines?: string[];
  /** 使用声库（多值） */
  voicebanks?: string[];
  /** 歌曲语言（多值） */
  languages?: string[];
}

/** 归档索引引用：current.json 的 archives 清单项 */
export interface IndexArchiveRef {
  /** 归档文件名（相对 index/archive/，如 2026-09.json） */
  file: string;
  byType?: Partial<Record<SubmissionType, number>>;
}

/** 索引文件：同一个文件中记录稿件与关联用户 */
export interface IndexFile {
  submissions: SubmissionEntry[];
  users: UserRecord[];
  /** current.json 额外字段：用户总数 */
  userCount?: number;
  /** current.json 额外字段：归档文件清单（按月） */
  archives?: IndexArchiveRef[];
}

/** 投稿列表筛选条件 */
export interface FilterState {
  track?: string;
  engine?: string;
  voicebank?: string;
  songLanguage?: string;
}

/** 稿件互动统计（评论数 / 点赞数） */
export interface EngagementStats {
  comments: number;
  reactions: number;
}

/** 仓库信息 */
export interface RepoInfo {
  name: string;
  fullName: string;
  htmlUrl: string;
  stars: number;
  license?: string;
  description?: string;
}

/** 目录条目 */
export interface FileInfo {
  path: string;
  name: string;
  type: 'file' | 'dir';
  size: number;
  downloadUrl?: string;
}

/** Release 信息 */
export interface ReleaseInfo {
  id: number;
  tag: string;
  name: string;
  body: string;
  htmlUrl: string;
  reactions: number;
  assets: ReleaseAsset[];
}

/** Release 表情互动条目 */
export interface ReleaseReactionInfo {
  id: number;
  /** 表情类型（+1 / -1 / laugh / confused / heart / hooray / rocket / eyes） */
  content: string;
  user?: string;
}

export interface ReleaseAsset {
  /** 平台侧附件 id；mock 数据可缺省 */
  id?: number;
  name: string;
  size: number;
  downloadUrl: string;
}

/** Issue 信息 */
export interface IssueInfo {
  number: number;
  title: string;
  htmlUrl: string;
  comments: number;
  createdAt: string;
}

/** 平台讨论（Discussion）条目 */
export interface DiscussionInfo {
  number: number;
  title: string;
  htmlUrl: string;
  createdAt: string;
  updatedAt?: string;
  comments: number;
  author?: string;
  authorUrl?: string;
  category?: string;
  state?: string;
  /** 讨论正文（Markdown） */
  body?: string;
}

/** 讨论评论 */
export interface DiscussionComment {
  id: number | string;
  author?: string;
  authorUrl?: string;
  body: string;
  createdAt: string;
  htmlUrl?: string;
  reactions?: number;
}

/** 已登录账户信息 */
export interface AuthInfo {
  platform: Platform;
  login: string;
  name?: string;
  avatarUrl: string;
}
