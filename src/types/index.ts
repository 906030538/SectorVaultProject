/** Git 托管平台 */
export type Platform = 'github' | 'gitee' | 'atomgit';

/** 稿件类型：工程投稿 / 专栏投稿 */
export type SubmissionType = 'project' | 'article';

/** 有无参数：有参 / 微调 / 无参数 */
export type ParamStatus = 'with-params' | 'tuned' | 'no-params';

/**
 * 用户索引记录：记录用户所在平台、投稿的仓库、静态页面链接，每个仓库一条记录。
 */
export interface UserRecord {
  user: string;
  platform: Platform;
  repo: string;
  /** 用户自行部署的静态页面链接 */
  site?: string;
}

/**
 * 稿件索引条目：记录投稿用户、标题、封面链接、投稿时间、
 * 关联曲目、合成引擎、使用声库、歌曲语言、有无参数。
 */
export interface SubmissionEntry {
  /** 稿件在内容仓中的目录名 */
  slug: string;
  /** 所属用户 */
  user: string;
  /** 所属仓库 */
  repo: string;
  /** 稿件平台（继承自用户索引） */
  platform: Platform;
  type: SubmissionType;
  title: string;
  /** 封面链接（相对仓库路径或完整 URL） */
  cover?: string;
  /** 投稿时间 ISO 8601 */
  date: string;
  /** 关联曲目（多值） */
  tracks?: string[];
  /** 合成引擎（多值） */
  engines?: string[];
  /** 使用声库（多值） */
  voicebanks?: string[];
  /** 歌曲语言（多值） */
  songLanguages?: string[];
  /** 有无参数 */
  params?: ParamStatus;
  /** 标签 */
  tags?: string[];
  /** 正文中除封面外的图片媒体 */
  media?: string[];
}

/** 索引文件：同一个文件中记录稿件与关联用户 */
export interface IndexFile {
  submissions: SubmissionEntry[];
  users: UserRecord[];
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

/** 已登录账户信息 */
export interface AuthInfo {
  platform: Platform;
  login: string;
  name?: string;
  avatarUrl: string;
}
