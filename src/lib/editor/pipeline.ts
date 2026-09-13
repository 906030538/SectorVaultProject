import { INDEX_PATHS, POSTS_DIR } from '@/config';
import { getAdapterAsync } from '@/lib/adapters/lazy';
import type { FileChange, GitPlatformAdapter } from '@/lib/adapters/types';
import { generateReadme, type ProjectFile } from '@/lib/content';
import { loadPrimaryArchive, loadPrimaryIndex } from '@/lib/index/loader';
import { getIndexSources } from '@/lib/index/sources';
import { DEFAULT_LOCALE, t } from '@/i18n';
import type { MessageKey } from '@/i18n';
import type {
  IndexFile,
  ParamStatus,
  Platform,
  ReleaseAsset,
  SubmissionEntry,
  SubmissionType,
} from '@/types';
import { processFile, type EditorFile } from './files';
import { baseRepoReadme, emptyLocalArchive, spdxLicenseText } from '@/lib/utils';

export type StepState = 'pending' | 'running' | 'done' | 'warning' | 'error';
export type StepId = 'issue' | 'files' | 'readme' | 'release' | 'assets' | 'index' | 'cover';
export type OnStep = (id: StepId, state: StepState, detail?: string) => void;

/** 编辑器表单状态（新建/编辑共用） */
export interface SubmissionDraft {
  platform: Platform;
  user: string;
  repo: string;
  slug: string;
  type: SubmissionType;
  title: string;
  /** git 提交作者名（缺省用令牌身份） */
  author?: string;
  /** git 提交作者邮箱 */
  email?: string;
  params: ParamStatus;
  videos: string[];
  tracks: string[];
  engines: string[];
  voicebanks: string[];
  songLanguages: string[];
  body: string;
  tags: string[];
  license: string;
  /** 自定义许可证全文（选择"自定义"时填写） */
  licenseText?: string;
  /** 发布简介：新建时写入 release 正文 */
  summary: string;
  /** 是否创建关联评论区 issue（标题为 slug，正文为稿件参数） */
  createIssue: boolean;
  /** 投稿时间（ISO）：编辑器指定；缺省为发布点击时刻。编辑模式忽略（沿用原值） */
  submittedAt?: string;
  /** 发布时间（ISO）：编辑器指定；新建缺省为发布点击时刻 */
  publishedAt?: string;
  cover: File | null;
  /** 编辑模式下含 existing 行（file 为 null） */
  files: EditorFile[];
  attachments: File[];
}

/** 编辑模式的原始稿件上下文 */
export interface EditContext {
  entry: SubmissionEntry;
  /** README attrs.issue；缺失时为空字符串 */
  issue: string;
  oldCover?: string;
  oldFiles: ProjectFile[];
  releaseId: number | null;
  /** 关联 release 原正文中的发布简介（变更检测用） */
  oldSummary?: string;
  /** 旧封面被移除或替换 */
  coverRemoved: boolean;
  /** 需要删除的旧附件 */
  removedAssets: ReleaseAsset[];
}

async function runStep(id: StepId, onStep: OnStep, work: () => Promise<void>): Promise<void> {
  onStep(id, 'running');
  await work();
  onStep(id, 'done');
}

/** 工程文件的物理存储名：压缩/加密方案入库时附加 .zip 后缀，显示名保持原名 */
export function storedProjectFileName(file: {
  name: string;
  compressed?: boolean;
  encrypted?: boolean;
}): string {
  if (!(file.compressed || file.encrypted)) return file.name;
  return file.name.endsWith('.zip') ? file.name : `${file.name}.zip`;
}

export function draftFilesToProjectFiles(files: EditorFile[]): ProjectFile[] {
  return files.map((f) => {
    if (f.existing) return { name: f.name, compressed: f.existing.compressed, encrypted: f.existing.encrypted };
    return { name: f.name, compressed: f.scheme === 'zip', encrypted: f.scheme === 'encrypt' };
  });
}

export function buildReadmeText(
  draft: SubmissionDraft,
  issue: number | string,
  coverName?: string,
  dates?: { submittedAt?: string; publishedAt?: string },
  releaseId?: number | string,
): string {
  return generateReadme({
    issue,
    release: releaseId,
    title: draft.title,
    type: draft.type,
    submittedAt: dates?.submittedAt,
    publishedAt: dates?.publishedAt,
    cover: coverName || undefined,
    license: draft.license || undefined,
    songs: draft.tracks.filter(Boolean),
    engines: draft.engines.filter(Boolean),
    voicebanks: draft.voicebanks.filter(Boolean),
    languages: draft.songLanguages.filter(Boolean),
    videos: draft.videos.filter(Boolean),
    tags: draft.tags,
    body: draft.body,
    files: draftFilesToProjectFiles(draft.files),
  });
}

/** issue 正文：稿件参数摘要（有值的字段逐行列出） */
export function buildIssueBody(draft: SubmissionDraft): string {
  const locale = DEFAULT_LOCALE;
  const lines: string[] = [];
  const row = (label: string, values?: string[]): void => {
    const filtered = values?.filter(Boolean) ?? [];
    if (filtered.length) lines.push(`**${label}**: ${filtered.join('、')}`);
  };
  row(t(locale, 'label.tracks'), draft.tracks);
  row(t(locale, 'label.engines'), draft.engines);
  row(t(locale, 'label.voicebanks'), draft.voicebanks);
  row(t(locale, 'label.songLanguages'), draft.songLanguages);
  if (draft.type === 'project' && draft.params) {
    const paramKey: MessageKey =
      draft.params === 'with-params' ? 'params.with' : draft.params === 'tuned' ? 'params.tuned' : 'params.none';
    lines.push(`**${t(locale, 'editor.params')}**: ${t(locale, paramKey)}`);
  }
  row(t(locale, 'label.videos'), draft.videos);
  // 平台不允许 issue 内容为空：始终带上原仓库 slug 目录链接（读者在平台侧也能直达内容）
  const repoLink = `${repoWebBase(draft.platform)}/${draft.user}/${draft.repo}/tree/main/${POSTS_DIR}/${draft.slug}`;
  return lines.length ? `${lines.join('\n')}\n\n${repoLink}` : repoLink;
}

/** Release 正文：发布简介 + 原仓库 slug 目录链接 +（若部署了用户空间静态页）用户空间链接 */
export function buildReleaseBody(
  user: string,
  repo: string,
  slug: string,
  site?: string,
  summary?: string,
  webBase?: string,
): string {
  // 链接指向原仓库 slug 目录（非本站点），读者在平台侧也能直达内容
  const repoBase = webBase ?? 'https://github.com';
  const links = [`${repoBase}/${user}/${repo}/tree/main/${POSTS_DIR}/${slug}`];
  if (site) {
    let base = site;
    while (base.endsWith('/')) base = base.slice(0, -1);
    links.push(`${base}/view/${repo}/${slug}`);
  }
  const note = summary?.trim();
  return note ? `${note}\n\n${links.join('\n')}` : links.join('\n');
}

/** 各平台仓库站点根地址 */
function repoWebBase(platform: Platform): string {
  switch (platform) {
    case 'gitee':
      return 'https://gitee.com';
    case 'atomgit':
      return 'https://atomgit.com';
    case 'gitcode':
      return 'https://gitcode.com';
    default:
      return 'https://github.com';
  }
}

async function loadIndex(): Promise<IndexFile> {
  // 索引 PR 始终以主索引源为写入目标
  return (await loadPrimaryIndex()).index;
}

/** 构造索引仓变更：按 user+repo+slug upsert 到投稿月份的归档文件，并确保 users 记录 */
export async function buildIndexChange(entry: SubmissionEntry): Promise<FileChange> {
  // 归档是事实来源：先读取投稿月份的目标归档，不存在则创建只含本投稿的新归档；
  // current.json 由索引仓 CI 从归档重建，不在此修改
  const month = entry.submittedAt.slice(0, 7);
  const { index } = await loadPrimaryArchive(month);
  const base: IndexFile = index ?? { submissions: [], users: [] };
  const next: IndexFile = JSON.parse(JSON.stringify(base)) as IndexFile;
  if (!Array.isArray(next.submissions)) next.submissions = [];
  if (!Array.isArray(next.users)) next.users = [];
  const at = next.submissions.findIndex(
    (s) => s.owner === entry.owner && s.repo === entry.repo && s.slug === entry.slug,
  );
  if (at >= 0) next.submissions[at] = entry;
  else next.submissions.push(entry);
  let user = next.users.find((u) => u.platform === entry.platform && u.owner === entry.owner);
  if (!user) {
    user = { platform: entry.platform, owner: entry.owner, repos: [] };
    next.users.push(user);
  }
  if (!(user.repos ?? []).some((r) => r.repo === entry.repo)) {
    user.repos = [...(user.repos ?? []), { repo: entry.repo }];
  }
  return {
    path: `${INDEX_PATHS.archiveDir}/${month}.json`,
    content: `${JSON.stringify(next, null, 2)}\n`,
    encoding: 'utf-8',
  };
}

/**
 * 许可证文件：选择了许可证即向 slug 目录写入 LICENSE（不比较仓库许可证）。
 * SPDX 标识取全文（取不到回退声明）；自定义全文直接写入。
 */
export async function licenseFileChange(
  adapter: GitPlatformAdapter,
  user: string,
  repo: string,
  slug: string,
  license: string | undefined,
  licenseText?: string,
): Promise<FileChange | null> {
  void adapter;
  void user;
  void repo;
  if (!license && !licenseText?.trim()) return null;
  // 自定义全文优先；否则按 SPDX 标识取全文
  const content = licenseText?.trim() || (await spdxLicenseText(license ?? ''));
  return { path: `${POSTS_DIR}/${slug}/LICENSE`, content, encoding: 'utf-8' };
}

/** git 提交作者（草稿填写时）；未填写返回 undefined 用令牌身份 */
function commitAuthor(draft: SubmissionDraft): { name: string; email?: string } | undefined {
  if (!draft.author?.trim() && !draft.email?.trim()) return undefined;
  return { name: draft.author?.trim() || draft.user, ...(draft.email?.trim() ? { email: draft.email.trim() } : {}) };
}

/** 由表单构造索引条目；编辑时 submittedAt/publishedAt 沿用原值 */
export function buildIndexEntry(
  draft: SubmissionDraft,
  date: string,
  cover?: string,
  publishedAt?: string,
  ids?: { issue?: number | string; release?: number },
): SubmissionEntry {
  const base: SubmissionEntry = {
    slug: draft.slug,
    owner: draft.user,
    repo: draft.repo,
    platform: draft.platform,
    type: draft.type,
    title: draft.title,
    submittedAt: date,
    publishedAt: publishedAt ?? date,
  };
  if (cover) base.cover = cover;
  if (ids?.issue !== undefined && ids?.issue !== null && ids.issue !== '')
    base.issue = String(ids.issue);
  // 索引与本地归档中 release id 一律字符串（部分平台 id 超出 JS 安全整数）
  if (ids?.release) base.release = String(ids.release);
  // 作者信息（git 提交作者；显示层缺省回退仓库用户）
  if (draft.author?.trim()) base.author = draft.author.trim();
  if (draft.email?.trim()) base.email = draft.email.trim();
  // 标签与稿件类型无关，均随索引提交
  const tags = draft.tags.filter(Boolean);
  if (tags.length) base.tags = tags;
  if (draft.type === 'project') {
    base.paramState = draft.params;
    base.songs = draft.tracks.filter(Boolean);
    base.engines = draft.engines.filter(Boolean);
    base.voicebanks = draft.voicebanks.filter(Boolean);
    base.languages = draft.songLanguages.filter(Boolean);
  }
  return base;
}

async function fileChange(
  path: string,
  file: File,
  scheme: EditorFile['scheme'],
  password?: string,
): Promise<FileChange> {
  const processed = await processFile(file, scheme, password);
  return { path, content: processed.content, encoding: processed.encoding };
}

async function findUserSite(user: string): Promise<string | undefined> {
  try {
    const index = await loadIndex();
    return index.users.find((u) => u.owner === user)?.pagesUrl ?? undefined;
  } catch {
    return undefined;
  }
}

/** 构造索引仓删除变更：从投稿月份归档移除条目（条目不在该归档时返回 null） */
export async function buildIndexRemoveChange(entry: SubmissionEntry): Promise<FileChange | null> {
  const month = entry.submittedAt.slice(0, 7);
  const { index } = await loadPrimaryArchive(month);
  const base: IndexFile = index ?? { submissions: [], users: [] };
  if (
    !Array.isArray(base.submissions) ||
    !base.submissions.some(
      (s) => s.owner === entry.owner && s.repo === entry.repo && s.slug === entry.slug,
    )
  ) {
    return null;
  }
  const next: IndexFile = JSON.parse(JSON.stringify(base)) as IndexFile;
  next.submissions = next.submissions.filter(
    (s) => !(s.owner === entry.owner && s.repo === entry.repo && s.slug === entry.slug),
  );
  return {
    path: `${INDEX_PATHS.archiveDir}/${month}.json`,
    content: `${JSON.stringify(next, null, 2)}\n`,
    encoding: 'utf-8',
  };
}

/** 向索引仓提交单文件 PR；源选择与稿件同平台优先，无则回退主源 */
async function submitIndexPr(
  token: string | null,
  platform: Platform,
  change: FileChange,
  title: string,
): Promise<string | undefined> {
  if (!token) throw new Error('missing token');
  const sources = await getIndexSources();
  const source = sources.find((s) => s.platform === platform) ?? sources[0]!;
  return (await getAdapterAsync(platform)).openIndexPr(
    token,
    { owner: source.owner, repo: source.repo, branch: source.branch },
    title,
    [change],
  );
}

async function tryIndexPr(
  token: string | null,
  entry: SubmissionEntry,
  onStep: OnStep,
): Promise<void> {
  onStep('index', 'running');
  try {
    const change = await buildIndexChange(entry);
    const prUrl = await submitIndexPr(
      token,
      entry.platform,
      change,
      `index: +${entry.owner}/${entry.repo}/${entry.slug}`,
    );
    onStep('index', 'done', prUrl);
  } catch (error) {
    // 平台不支持或提交失败时降级为警告，不阻断发布
    onStep('index', 'warning', error instanceof Error ? error.message : String(error));
  }
}

/** 删除稿件步骤：文件（含仓库 README 链接与本地索引）、关联发布、主索引条目 */
export type DeleteStepId = 'files' | 'release' | 'index';
export type DeleteOnStep = (id: DeleteStepId, state: StepState, detail?: string) => void;

/**
 * 删除稿件：一个提交移除 slug 目录全部文件、仓库 README 目录链接与本地索引条目；
 * 关联 release 尽力删除（失败/无 id 降级为警告）；主索引以单文件 PR 从归档移除条目。
 * 各步骤幂等，失败后整体重试安全。关联 issue 平台 API 不支持删除，将保留。
 */
export async function deleteSubmission(
  entry: SubmissionEntry,
  token: string | null,
  onStep: DeleteOnStep,
): Promise<void> {
  const { owner: user, repo, slug, platform } = entry;
  let adapterPromise: ReturnType<typeof getAdapterAsync> | null = null;
  const adapter = async () => (adapterPromise ??= getAdapterAsync(platform));

  // 文件：slug 目录 + 仓库 README 链接 + 本地索引条目合并为一个提交
  onStep('files', 'running');
  await runDeleteStep(onStep, 'files', async () => {
    const changes: FileChange[] = [];
    const dir = await (await adapter())
      .listDir(user, repo, `${POSTS_DIR}/${slug}`)
      .catch(() => []);
    for (const file of dir.filter((e) => e.type === 'file')) {
      changes.push({ path: file.path, content: '', delete: true });
    }
    try {
      const readme = await (await adapter()).readFile(user, repo, 'README.md');
      const pattern = new RegExp(
        `\\n?- \\[${slug.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\]\\(${POSTS_DIR}/${slug}/\\)`,
        'g',
      );
      const next = readme.replace(pattern, '');
      if (next !== readme) {
        changes.push({ path: 'README.md', content: next, encoding: 'utf-8' });
      }
    } catch {
      /* README 缺失时跳过 */
    }
    try {
      const raw = await (await adapter()).readFile(user, repo, 'svp-archive.json');
      const archive = JSON.parse(raw) as LocalArchive;
      const hit = (e: SubmissionEntry) => e.owner === user && e.repo === repo && e.slug === slug;
      if (Array.isArray(archive.submissions) && archive.submissions.some(hit)) {
        archive.submissions = archive.submissions.filter((e) => !hit(e));
        changes.push({
          path: 'svp-archive.json',
          content: `${JSON.stringify(archive, null, 2)}\n`,
          encoding: 'utf-8',
        });
      }
    } catch {
      /* 本地索引缺失时跳过 */
    }
    if (changes.length) {
      await (await adapter()).commitFiles(token!, user, repo, `Delete submission ${slug}`, changes);
    }
  });

  // 发布：无 id 或平台不支持时降级为警告
  onStep('release', 'running');
  if (!entry.release) {
    onStep('release', 'warning');
  } else {
    await runDeleteStepWarning(onStep, 'release', async () => {
      await (await adapter()).deleteRelease(token!, user, repo, entry.release!);
    });
  }

  // 索引：条目不在归档时视为完成
  onStep('index', 'running');
  try {
    const change = await buildIndexRemoveChange(entry);
    if (!change) {
      onStep('index', 'done');
    } else {
      const prUrl = await submitIndexPr(
        token,
        platform,
        change,
        `index: -${user}/${repo}/${slug}`,
      );
      onStep('index', 'done', prUrl);
    }
  } catch (error) {
    onStep('index', 'warning', error instanceof Error ? error.message : String(error));
  }
}

/** 删除步骤执行器：失败抛出（标记 error），由调用方提供重试 */
async function runDeleteStep(
  onStep: DeleteOnStep,
  id: DeleteStepId,
  run: () => Promise<void>,
): Promise<void> {
  try {
    await run();
    onStep(id, 'done');
  } catch (error) {
    onStep(id, 'error', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/** 尽力执行的删除步骤：失败降级为警告，不阻断整体流程 */
async function runDeleteStepWarning(
  onStep: DeleteOnStep,
  id: DeleteStepId,
  run: () => Promise<void>,
): Promise<void> {
  try {
    await run();
    onStep(id, 'done');
  } catch (error) {
    onStep(id, 'warning', error instanceof Error ? error.message : String(error));
  }
}

/**
 * 新建投稿的可续传进度：已成功步骤的结果记录于此（编辑器持久化到
 * localStorage），重试时跳过已完成步骤，避免重复创建 issue / release。
 */
export interface PublishProgress {
  /** 进度归属（user/repo/slug 任一变化即视为新投稿，进度作废） */
  user?: string;
  repo?: string;
  slug?: string;
  issue?: number | string;
  filesDone?: boolean;
  releaseId?: number;
  assetsDone?: boolean;
  indexDone?: boolean;
  /** 首次写入本地索引时的稿件条目：重试时索引 PR 复用，保证时间戳一致 */
  entry?: SubmissionEntry;
  /** 用户主动跳过的步骤（不再重试） */
  skipped?: string[];
}

/** 空仓库检测：GitHub/Gitee 列目录时对空仓库返回 Git Repository is empty. */
function isRepoEmptyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /git repository is empty/i.test(message);
}

/** 内容仓本地索引结构（svp-archive.json：只记录 submissions） */
interface LocalArchive {
  submissions: SubmissionEntry[];
}

/** 文件不存在（404/Not Found）判定：找不到时新建，其他错误抛出重试 */
function isMissingFileError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b404\b|not found|未找到/i.test(message);
}

/**
 * 内容仓 README.md 目录更新：追加 slug 名 + slug 相对路径的链接（幂等）。
 * 返回可直接并入提交的文件变更。
 */
export async function upsertRepoReadmeLink(
  adapter: GitPlatformAdapter,
  user: string,
  repo: string,
  slug: string,
): Promise<FileChange> {
  let readme = baseRepoReadme(repo);
  try {
    readme = await adapter.readFile(user, repo, 'README.md');
  } catch (error) {
    // 仅"文件不存在/空仓库"时新建基础结构；限流/网络等错误抛出重试，避免覆盖
    if (!isMissingFileError(error) && !isRepoEmptyError(error)) throw error;
  }
  const href = `(${POSTS_DIR}/${slug}/)`;
  if (!readme.includes(href)) {
    readme = `${readme.trimEnd()}\n\n- [${slug}]${href}\n`;
  }
  return { path: 'README.md', content: readme, encoding: 'utf-8' };
}

/**
 * 内容仓本地索引更新（svp-archive.json）：按 slug upsert 稿件条目。
 * 返回可直接并入提交的文件变更。
 */
export async function upsertLocalArchive(
  adapter: GitPlatformAdapter,
  user: string,
  repo: string,
  slug: string,
  entry: SubmissionEntry,
): Promise<FileChange> {
  // 找不到现有索引（404/空仓库）或内容损坏时创建新索引；限流/网络错误抛出重试，避免覆盖已有索引
  let archive: LocalArchive = { submissions: [] };
  let raw: string | null = null;
  try {
    raw = await adapter.readFile(user, repo, 'svp-archive.json');
  } catch (error) {
    if (!isMissingFileError(error) && !isRepoEmptyError(error)) throw error;
  }
  if (raw !== null) {
    try {
      archive = JSON.parse(raw) as LocalArchive;
      if (!Array.isArray(archive.submissions)) archive.submissions = [];
    } catch {
      /* JSON 损坏时从空索引重建 */
    }
  }
  const at = archive.submissions.findIndex((s) => s.slug === slug);
  if (at >= 0) archive.submissions[at] = entry;
  else archive.submissions.push(entry);
  return {
    path: 'svp-archive.json',
    content: `${JSON.stringify(archive, null, 2)}\n`,
    encoding: 'utf-8',
  };
}

/**
 * 确保内容仓库可写入：空仓库以给定的初始文件（根 README / 本地索引的最终内容）
 * 建仓；未给定时写入基础结构。返回是否执行了初始化（调用方据此跳过重复写入）。
 */
async function ensureRepoInitialized(
  token: string | null,
  user: string,
  repo: string,
  adapter: () => Promise<GitPlatformAdapter>,
  initial?: FileChange[],
): Promise<boolean> {
  try {
    await (await adapter()).listDir(user, repo);
    return false;
  } catch (error) {
    if (!isRepoEmptyError(error)) throw error;
    await (await adapter()).commitFiles(
      token!,
      user,
      repo,
      'Initialize Sector Vault Project repository',
      initial ?? [
        {
          path: 'README.md',
          content: baseRepoReadme(repo),
          encoding: 'utf-8',
        },
        {
          path: 'svp-archive.json',
          content: emptyLocalArchive(),
          encoding: 'utf-8',
        },
      ],
    );
    return true;
  }
}

/** 新建投稿：issue → 文件（内联媒体+README 一个提交） → release → 附件 → 索引 PR（支持断点续传与跳步） */
export async function publishSubmission(
  draft: SubmissionDraft,
  token: string | null,
  onStep: OnStep,
  progress: PublishProgress = {},
): Promise<{ issue: number | string; releaseId: number }> {
  const { user, repo, slug } = draft;
  let issue: number | string = progress.issue ?? 0;
  let releaseId = progress.releaseId ?? 0;
  // 投稿/发布时间缺省取发布点击时刻（投稿时间可由编辑器指定，决定归档月份与 slug 日期）
  const now = new Date().toISOString();
  const skipped = new Set(progress.skipped ?? []);
  const isSkipped = (id: string): boolean => skipped.has(id);
  // 惰性加载适配器
  let adapterPromise: ReturnType<typeof getAdapterAsync> | null = null;
  const adapter = async () => (adapterPromise ??= getAdapterAsync(draft.platform));

  // 步骤执行骨架：已跳过 → warning；已完成 → done；否则执行并记录进度
  async function resumeStep(
    id: StepId,
    done: boolean,
    work: () => Promise<void>,
  ): Promise<void> {
    if (isSkipped(id)) {
      onStep(id, 'warning');
      return;
    }
    if (done) {
      onStep(id, 'done');
      return;
    }
    await runStep(id, onStep, work);
  }

  if (!draft.createIssue) {
    // 未勾选关联评论区：不创建 issue，正文头部 issue 记为 0
    issue = 0;
    onStep('issue', 'warning');
  } else {
    await resumeStep('issue', progress.issue !== undefined, async () => {
      if (!token) throw new Error('missing token');
      issue = await (await adapter()).createIssue(token, user, repo, draft.slug, buildIssueBody(draft));
      progress.issue = issue;
    });
  }

  // 稿件条目（含投稿/发布时间与 issue/release id）：本地索引与索引 PR 共用；
  // 断点续传时复用首次结果，重试时 ids 取最新进度补全
  const entry = progress.entry ?? buildIndexEntry(draft, draft.submittedAt ?? now, draft.cover?.name, draft.publishedAt ?? now);
  progress.entry = entry;

  await resumeStep('files', progress.filesDone === true, async () => {
    // 内联媒体（封面 + 工程文件）、README 与本地索引（目录链接 + svp-archive.json）合并为一个提交。
    // 文件先于 release 创建（空仓库建 release 会失败）；README 只写一次，
    // 不再为补 release id 二次提交（头部 release 属性无消费方；断点续传时 release 已建则带上）
    const changes: FileChange[] = [];
    if (draft.cover) {
      changes.push(await fileChange(`${POSTS_DIR}/${slug}/${draft.cover.name}`, draft.cover, 'raw'));
    }
    for (const f of draft.files) {
      if (!f.file) continue;
      const stored = storedProjectFileName({
        name: f.name,
        compressed: f.scheme === 'zip',
        encrypted: f.scheme === 'encrypt',
      });
      changes.push(await fileChange(`${POSTS_DIR}/${slug}/${stored}`, f.file, f.scheme, f.password));
    }
    changes.push({
      path: `${POSTS_DIR}/${slug}/README.md`,
      content: buildReadmeText(
        draft,
        issue,
        draft.cover?.name,
        { submittedAt: entry.submittedAt, publishedAt: entry.publishedAt },
        releaseId || undefined,
      ),
      encoding: 'utf-8',
    });
    // 许可证与内容仓不同时，向 slug 目录写入 LICENSE 文件
    const licenseChange = await licenseFileChange(await adapter(), user, repo, slug, draft.license, draft.licenseText);
    if (licenseChange) changes.push(licenseChange);
    // 根 README（slug 链接）与本地索引（投稿条目）：空仓库时直接以最终内容初始化建仓，
    // 非空仓库则并入主提交——两种情况都不产生对同一文件的连续双写
    const readmeChange = await upsertRepoReadmeLink(await adapter(), user, repo, slug);
    const archiveChange = await upsertLocalArchive(await adapter(), user, repo, slug, entry);
    const initialized = await ensureRepoInitialized(token, user, repo, adapter, [readmeChange, archiveChange]);
    if (!initialized) changes.push(readmeChange, archiveChange);
    await (await adapter()).commitFiles(token!, user, repo, `Add ${slug}`, changes, commitAuthor(draft));
    progress.filesDone = true;
  });

  await resumeStep('release', progress.releaseId !== undefined, async () => {
    const site = await findUserSite(user);
    // createRelease 按 tag 幂等（已存在则复用），重试不会重复建 release
    releaseId = await (await adapter()).createRelease(
      token!,
      user,
      repo,
      slug,
      buildReleaseBody(user, repo, slug, site, draft.summary, repoWebBase(draft.platform)),
    );
    progress.releaseId = releaseId;
  });

  if (isSkipped('assets')) {
    onStep('assets', 'warning');
  } else if (progress.assetsDone || !draft.attachments.length) {
    onStep('assets', 'done');
  } else if (!releaseId) {
    // release 被跳过或未创建时无法上传附件；release 补建后重试仍会进入此步
    onStep('assets', 'warning');
  } else {
    await runStep('assets', onStep, async () => {
      for (const attachment of draft.attachments) {
        await (await adapter()).uploadReleaseAsset(token!, user, repo, releaseId, attachment, attachment.name);
      }
      progress.assetsDone = true;
    });
  }

  if (isSkipped('index')) {
    onStep('index', 'warning');
  } else if (progress.indexDone) {
    onStep('index', 'done');
  } else {
    // 复用本地索引已写入的条目，保证重试时时间戳一致；ids 取当前进度补全
    const entryForIndex = {
      ...entry,
      issue: progress.issue !== undefined ? String(progress.issue) : undefined,
      release: progress.releaseId !== undefined ? String(progress.releaseId) : undefined,
    };
    await tryIndexPr(token, entryForIndex, onStep);
    progress.indexDone = true;
  }

  return { issue, releaseId };
}

function sameList(a?: string[], b?: string[]): boolean {
  const left = a ?? [];
  const right = b ?? [];
  return left.length === right.length && left.every((v, i) => v === right[i]);
}

/** 编辑投稿：封面 → 文件 → README → 附件 → 索引 PR */
export async function updateSubmission(
  draft: SubmissionDraft,
  ctx: EditContext,
  token: string | null,
  onStep: OnStep,
): Promise<void> {
  const { user, repo, slug } = draft;
  // 惰性加载适配器
  let adapterPromise: ReturnType<typeof getAdapterAsync> | null = null;
  const adapter = async () => (adapterPromise ??= getAdapterAsync(draft.platform));
  const coverChanged = ctx.coverRemoved || draft.cover !== null;
  const currentCover = draft.cover ? draft.cover.name : ctx.coverRemoved ? undefined : ctx.oldCover;

  await runStep('cover', onStep, async () => {
    if (!coverChanged) return;
    const changes: FileChange[] = [];
    if (ctx.oldCover) changes.push({ path: `${POSTS_DIR}/${slug}/${ctx.oldCover}`, content: '', delete: true });
    if (draft.cover) {
      changes.push(await fileChange(`${POSTS_DIR}/${slug}/${draft.cover.name}`, draft.cover, 'raw'));
    }
    if (changes.length) {
      await (await adapter()).commitFiles(token!, user, repo, `Update ${slug} cover`, changes, commitAuthor(draft));
    }
  });

  // 发布时间编辑器可改（未改动时沿用原值）；投稿时间不变更。
  // README 与索引差异先行计算：文件、README 与本地归档合并为一个提交
  const nextPublishedAt = draft.publishedAt ?? ctx.entry.publishedAt ?? ctx.entry.submittedAt;
  const readme = buildReadmeText(draft, ctx.issue, currentCover, {
    submittedAt: ctx.entry.submittedAt,
    publishedAt: nextPublishedAt,
  });
  const entry = ctx.entry;
  const publishedAtChanged =
    draft.publishedAt !== undefined &&
    new Date(draft.publishedAt).getTime() !== new Date(entry.publishedAt ?? entry.submittedAt).getTime();
  const indexChanged =
    draft.title !== entry.title ||
    currentCover !== entry.cover ||
    draft.params !== entry.paramState ||
    publishedAtChanged ||
    !sameList(draft.tracks, entry.songs) ||
    !sameList(draft.engines, entry.engines) ||
    !sameList(draft.voicebanks, entry.voicebanks) ||
    !sameList(draft.songLanguages, entry.languages);
  const updatedEntry = indexChanged
    ? buildIndexEntry(draft, entry.submittedAt, currentCover, nextPublishedAt, {
        issue: ctx.issue || undefined,
        release: ctx.releaseId ?? undefined,
      })
    : null;

  const removedFiles = ctx.oldFiles.filter((of) => !draft.files.some((f) => f.name === of.name));
  const newFiles = draft.files.filter((f) => f.file !== null);
  await runStep('files', onStep, async () => {
    // v5 系连续提交存在读后写延迟：文件与 README 拆分提交会使后者落进竞态窗口
    // （Update is not a fast forward），合并为单提交；本地归档一并写入
    const changes: FileChange[] = removedFiles.map((of) => ({
      // 删除按物理存储名（压缩/加密文件带 .zip 后缀）
      path: `${POSTS_DIR}/${slug}/${storedProjectFileName(of)}`,
      content: '',
      delete: true,
    }));
    for (const f of newFiles) {
      const stored = f.existing
        ? storedProjectFileName({ name: f.name, compressed: f.existing.compressed, encrypted: f.existing.encrypted })
        : storedProjectFileName({ name: f.name, compressed: f.scheme === 'zip', encrypted: f.scheme === 'encrypt' });
      changes.push(await fileChange(`${POSTS_DIR}/${slug}/${stored}`, f.file!, f.scheme, f.password));
    }
    changes.push({ path: `${POSTS_DIR}/${slug}/README.md`, content: readme, encoding: 'utf-8' });
    if (updatedEntry) {
      try {
        const archiveChange = await upsertLocalArchive(await adapter(), user, repo, slug, updatedEntry);
        changes.push(archiveChange);
      } catch (error) {
        // 本地索引读取失败不阻断主提交
        console.warn('[pipeline] 本地索引更新失败:', error);
      }
    }
    await (await adapter()).commitFiles(token!, user, repo, `Update ${slug}`, changes, commitAuthor(draft));
  });
  // README 已随文件同批提交
  onStep('readme', 'done');

  // 发布简介有改动时同步更新关联 release 正文（失败不阻断整体流程）
  const summaryChanged = (draft.summary ?? '').trim() !== (ctx.oldSummary ?? '').trim();
  if (summaryChanged && ctx.releaseId !== null) {
    try {
      const site = await findUserSite(user);
      await (await adapter()).updateReleaseBody(
        token!,
        user,
        repo,
        ctx.releaseId,
        buildReleaseBody(user, repo, slug, site, draft.summary, repoWebBase(draft.platform)),
      );
    } catch (error) {
      console.warn('[pipeline] release 正文更新失败:', error);
    }
  }

  const assetsTouched = draft.attachments.length > 0 || ctx.removedAssets.length > 0;
  if (assetsTouched && ctx.releaseId === null) {
    // 找不到同 slug 的 release，附件无法同步
    onStep('assets', 'warning');
  } else {
    await runStep('assets', onStep, async () => {
      if (!assetsTouched) return;
      for (const asset of ctx.removedAssets) {
        if (asset.id !== undefined) {
          await (await adapter()).deleteReleaseAsset(token!, user, repo, ctx.releaseId!, asset.id);
        }
      }
      for (const attachment of draft.attachments) {
        await (await adapter()).uploadReleaseAsset(token!, user, repo, ctx.releaseId!, attachment, attachment.name);
      }
    });
  }

  // 本地归档已随文件同批提交；此处仅提交索引 PR
  if (updatedEntry) {
    await tryIndexPr(token, updatedEntry, onStep);
  } else {
    onStep('index', 'done');
  }
}
