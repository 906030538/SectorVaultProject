import { INDEX_PATHS, MOCK_PIPELINE_STEP_DELAY, POSTS_DIR } from '@/config';
import { getAdapterAsync } from '@/lib/adapters/lazy';
import type { FileChange, GitPlatformAdapter } from '@/lib/adapters/types';
import { generateReadme, type ProjectFile } from '@/lib/content';
import { loadMockIndex, loadPrimaryArchive, loadPrimaryIndex } from '@/lib/index/loader';
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
  params: ParamStatus;
  videos: string[];
  tracks: string[];
  engines: string[];
  voicebanks: string[];
  songLanguages: string[];
  body: string;
  tags: string[];
  license: string;
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
  /** 旧封面被移除或替换 */
  coverRemoved: boolean;
  /** 需要删除的旧附件 */
  removedAssets: ReleaseAsset[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runStep(
  id: StepId,
  mock: boolean,
  onStep: OnStep,
  work: () => Promise<void>,
): Promise<void> {
  onStep(id, 'running');
  if (mock) await sleep(MOCK_PIPELINE_STEP_DELAY);
  await work();
  onStep(id, 'done');
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
  return lines.join('\n');
}

/** Release 正文：发布简介 + 主站详情链接 +（若部署了用户空间静态页）用户空间链接 */
export function buildReleaseBody(
  user: string,
  repo: string,
  slug: string,
  site?: string,
  summary?: string,
): string {
  const links = [
    `${window.location.origin}/view/${user}/${repo}/${slug}`,
  ];
  if (site) {
    let base = site;
    while (base.endsWith('/')) base = base.slice(0, -1);
    links.push(`${base}/view/${repo}/${slug}`);
  }
  const note = summary?.trim();
  return note ? `${note}\n\n${links.join('\n')}` : links.join('\n');
}

async function loadIndex(mock: boolean): Promise<IndexFile> {
  // 索引 PR 始终以主索引源为写入目标
  return mock ? loadMockIndex() : (await loadPrimaryIndex()).index;
}

/** 构造索引仓变更：按 user+repo+slug upsert 到投稿月份的归档文件，并确保 users 记录 */
export async function buildIndexChange(entry: SubmissionEntry, mock: boolean): Promise<FileChange> {
  // 归档是事实来源：先读取投稿月份的目标归档，不存在则创建只含本投稿的新归档；
  // current.json 由索引仓 CI 从归档重建，不在此修改
  const month = entry.submittedAt.slice(0, 7);
  let base: IndexFile;
  if (mock) {
    base = await loadMockIndex();
  } else {
    const { index } = await loadPrimaryArchive(month);
    base = index ?? { submissions: [], users: [] };
  }
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
 * 许可证文件：稿件许可证与内容仓不同时，向 slug 目录写入 LICENSE
 * （正文优先取 SPDX 许可证全文，取不到时回退为 SPDX 标识声明）。
 */
export async function licenseFileChange(
  adapter: GitPlatformAdapter,
  user: string,
  repo: string,
  slug: string,
  license: string | undefined,
): Promise<FileChange | null> {
  if (!license) return null;
  let repoLicense: string | undefined;
  try {
    repoLicense = (await adapter.getRepo(user, repo)).license;
  } catch {
    repoLicense = undefined; // 仓库信息不可用时按不同处理
  }
  if (repoLicense && repoLicense === license) return null;

  let text: string | null = null;
  try {
    const response = await fetch(`https://api.github.com/licenses/${license.toLowerCase()}`);
    if (response.ok) text = ((await response.json()) as { body?: string }).body ?? null;
  } catch {
    /* 文本不可用时回退声明式内容 */
  }
  const content =
    text ??
    `${license}\n\nSPDX-License-Identifier: ${license}\n\n*Powered by Sector Vault Project*\n`;
  return { path: `${POSTS_DIR}/${slug}/LICENSE`, content, encoding: 'utf-8' };
}

/** 由表单构造索引条目；编辑时 submittedAt/publishedAt 沿用原值 */
export function buildIndexEntry(
  draft: SubmissionDraft,
  date: string,
  cover?: string,
  publishedAt?: string,
  ids?: { issue?: number; release?: number },
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
  if (ids?.issue) base.issue = ids.issue;
  if (ids?.release) base.release = ids.release;
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

async function findUserSite(user: string, mock: boolean): Promise<string | undefined> {
  try {
    const index = await loadIndex(mock);
    return index.users.find((u) => u.owner === user)?.pagesUrl ?? undefined;
  } catch {
    return undefined;
  }
}

async function tryIndexPr(
  token: string | null,
  mock: boolean,
  entry: SubmissionEntry,
  onStep: OnStep,
): Promise<void> {
  onStep('index', 'running');
  try {
    const change = await buildIndexChange(entry, mock);
    if (!mock) {
      if (!token) throw new Error('missing token');
      // PR 目标优先取与稿件同平台的索引源（跨平台投稿时适配器与目标仓一致），无则回退主源
      const sources = await getIndexSources();
      const source = sources.find((s) => s.platform === entry.platform) ?? sources[0]!;
      const prUrl = await (await getAdapterAsync(entry.platform)).openIndexPr(
        token,
        { owner: source.owner, repo: source.repo, branch: source.branch },
        `index: +${entry.owner}/${entry.repo}/${entry.slug}`,
        [change],
      );
      onStep('index', 'done', prUrl);
    } else {
      await sleep(MOCK_PIPELINE_STEP_DELAY);
      onStep('index', 'done');
    }
  } catch (error) {
    // 平台不支持或提交失败时降级为警告，不阻断发布
    onStep('index', 'warning', error instanceof Error ? error.message : String(error));
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
  issue?: number;
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

/** 仓库 README.md 缺失时的基础结构 */
function baseRepoReadme(repo: string): string {
  return `# ${repo}\n\n*Powered by Sector Vault Project*\n`;
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
    // 仅"文件不存在"时新建基础结构；限流/网络等错误抛出重试，避免覆盖
    if (!isMissingFileError(error)) throw error;
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
  // 找不到现有索引（404）或内容损坏时创建新索引；限流/网络错误抛出重试，避免覆盖已有索引
  let archive: LocalArchive = { submissions: [] };
  let raw: string | null = null;
  try {
    raw = await adapter.readFile(user, repo, 'svp-archive.json');
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
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

/** 确保内容仓库可写入：空仓库先初始化基础结构（README + 本地索引） */
async function ensureRepoInitialized(
  token: string | null,
  user: string,
  repo: string,
  adapter: () => Promise<GitPlatformAdapter>,
): Promise<void> {
  try {
    await (await adapter()).listDir(user, repo);
  } catch (error) {
    if (!isRepoEmptyError(error)) throw error;
    await (await adapter()).commitFiles(token!, user, repo, 'Initialize Sector Vault Project repository', [
      {
        path: 'README.md',
        content: baseRepoReadme(repo),
        encoding: 'utf-8',
      },
      {
        path: 'svp-archive.json',
        content: `${JSON.stringify({ submissions: [] }, null, 2)}\n`,
        encoding: 'utf-8',
      },
    ]);
  }
}

/** 新建投稿：issue → 文件（内联媒体+README 一个提交） → release → 附件 → 索引 PR（支持断点续传与跳步） */
export async function publishSubmission(
  draft: SubmissionDraft,
  token: string | null,
  mock: boolean,
  onStep: OnStep,
  progress: PublishProgress = {},
): Promise<{ issue: number; releaseId: number }> {
  const { user, repo, slug } = draft;
  let issue = progress.issue ?? 0;
  let releaseId = progress.releaseId ?? 0;
  // 投稿/发布时间缺省取发布点击时刻（投稿时间可由编辑器指定，决定归档月份与 slug 日期）
  const now = new Date().toISOString();
  const skipped = new Set(progress.skipped ?? []);
  const isSkipped = (id: string): boolean => skipped.has(id);
  // 惰性加载适配器：演示模式全程不触碰平台 SDK 代码
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
    await runStep(id, mock, onStep, work);
  }

  if (!draft.createIssue) {
    // 未勾选关联评论区：不创建 issue，正文头部 issue 记为 0
    issue = 0;
    onStep('issue', 'warning');
  } else {
    await resumeStep('issue', progress.issue !== undefined, async () => {
      if (mock) {
        issue = 13;
        return;
      }
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
    if (!mock) await ensureRepoInitialized(token, user, repo, adapter);
    // 内联媒体（封面 + 工程文件）、README 与本地索引（目录链接 + svp-archive.json）合并为一个提交
    const changes: FileChange[] = [];
    if (draft.cover) {
      changes.push(await fileChange(`${POSTS_DIR}/${slug}/${draft.cover.name}`, draft.cover, 'raw'));
    }
    for (const f of draft.files) {
      if (!f.file) continue;
      changes.push(await fileChange(`${POSTS_DIR}/${slug}/${f.name}`, f.file, f.scheme, f.password));
    }
    changes.push({
      path: `${POSTS_DIR}/${slug}/README.md`,
      // release 尚未创建，头部 release 属性在 release 步补写
      content: buildReadmeText(draft, issue, draft.cover?.name, {
        submittedAt: entry.submittedAt,
        publishedAt: entry.publishedAt,
      }),
      encoding: 'utf-8',
    });
    if (!mock) {
      // 许可证与内容仓不同时，向 slug 目录写入 LICENSE 文件
      const licenseChange = await licenseFileChange(await adapter(), user, repo, slug, draft.license);
      if (licenseChange) changes.push(licenseChange);
      changes.push(await upsertRepoReadmeLink(await adapter(), user, repo, slug));
      changes.push(await upsertLocalArchive(await adapter(), user, repo, slug, entry));
      await (await adapter()).commitFiles(token!, user, repo, `Add ${slug}`, changes);
    }
    progress.filesDone = true;
  });

  await resumeStep('release', progress.releaseId !== undefined, async () => {
    if (mock) {
      releaseId = 1;
      return;
    }
    const site = await findUserSite(user, mock);
    // createRelease 按 tag 幂等（已存在则复用），重试不会重复建 release
    releaseId = await (await adapter()).createRelease(
      token!,
      user,
      repo,
      slug,
      buildReleaseBody(user, repo, slug, site, draft.summary),
    );
    // 补写 README 头部的 release id（小提交，随 release 步一起重试）
    await (await adapter()).commitFiles(token!, user, repo, `Add ${slug} release`, [
      {
        path: `${POSTS_DIR}/${slug}/README.md`,
        content: buildReadmeText(
          draft,
          issue,
          draft.cover?.name,
          { submittedAt: entry.submittedAt, publishedAt: entry.publishedAt },
          releaseId || undefined,
        ),
        encoding: 'utf-8',
      },
    ]);
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
    await runStep('assets', mock, onStep, async () => {
      for (const attachment of draft.attachments) {
        if (!mock) {
          await (await adapter()).uploadReleaseAsset(token!, user, repo, releaseId, attachment, attachment.name);
        }
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
      issue: progress.issue ?? undefined,
      release: progress.releaseId ?? undefined,
    };
    await tryIndexPr(token, mock, entryForIndex, onStep);
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
  mock: boolean,
  onStep: OnStep,
): Promise<void> {
  const { user, repo, slug } = draft;
  // 惰性加载适配器：演示模式全程不触碰平台 SDK 代码
  let adapterPromise: ReturnType<typeof getAdapterAsync> | null = null;
  const adapter = async () => (adapterPromise ??= getAdapterAsync(draft.platform));
  const coverChanged = ctx.coverRemoved || draft.cover !== null;
  const currentCover = draft.cover ? draft.cover.name : ctx.coverRemoved ? undefined : ctx.oldCover;

  await runStep('cover', mock, onStep, async () => {
    if (!coverChanged) return;
    const changes: FileChange[] = [];
    if (ctx.oldCover) changes.push({ path: `${POSTS_DIR}/${slug}/${ctx.oldCover}`, content: '', delete: true });
    if (draft.cover) {
      changes.push(await fileChange(`${POSTS_DIR}/${slug}/${draft.cover.name}`, draft.cover, 'raw'));
    }
    if (changes.length && !mock) {
      await (await adapter()).commitFiles(token!, user, repo, `Update ${slug} cover`, changes);
    }
  });

  const removedFiles = ctx.oldFiles.filter((of) => !draft.files.some((f) => f.name === of.name));
  const newFiles = draft.files.filter((f) => f.file !== null);
  await runStep('files', mock, onStep, async () => {
    if (!removedFiles.length && !newFiles.length) return;
    const changes: FileChange[] = removedFiles.map((of) => ({
      path: `${POSTS_DIR}/${slug}/${of.name}`,
      content: '',
      delete: true,
    }));
    for (const f of newFiles) {
      changes.push(await fileChange(`${POSTS_DIR}/${slug}/${f.name}`, f.file!, f.scheme, f.password));
    }
    if (!mock) await (await adapter()).commitFiles(token!, user, repo, `Update ${slug} files`, changes);
  });

  // 发布时间编辑器可改（未改动时沿用原值）；投稿时间不变更
  const nextPublishedAt = draft.publishedAt ?? ctx.entry.publishedAt ?? ctx.entry.submittedAt;
  const readme = buildReadmeText(draft, ctx.issue, currentCover, {
    submittedAt: ctx.entry.submittedAt,
    publishedAt: nextPublishedAt,
  });
  await runStep('readme', mock, onStep, async () => {
    if (!mock) {
      await (await adapter()).commitFiles(token!, user, repo, `Update ${slug} README`, [
        { path: `${POSTS_DIR}/${slug}/README.md`, content: readme, encoding: 'utf-8' },
      ]);
    }
  });

  const assetsTouched = draft.attachments.length > 0 || ctx.removedAssets.length > 0;
  if (assetsTouched && ctx.releaseId === null) {
    // 找不到同 slug 的 release，附件无法同步
    onStep('assets', 'warning');
  } else {
    await runStep('assets', mock, onStep, async () => {
      if (!assetsTouched) return;
      if (!mock) {
        for (const asset of ctx.removedAssets) {
          if (asset.id !== undefined) {
            await (await adapter()).deleteReleaseAsset(token!, user, repo, ctx.releaseId!, asset.id);
          }
        }
        for (const attachment of draft.attachments) {
          await (await adapter()).uploadReleaseAsset(token!, user, repo, ctx.releaseId!, attachment, attachment.name);
        }
      }
    });
  }

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

  if (indexChanged) {
    const updatedEntry = buildIndexEntry(draft, entry.submittedAt, currentCover, nextPublishedAt, {
      issue: Number(ctx.issue) || undefined,
      release: ctx.releaseId ?? undefined,
    });
    // 投稿时间不变更；同步更新内容仓本地索引（失败不阻断索引 PR）
    if (!mock) {
      try {
        const change = await upsertLocalArchive(await adapter(), user, repo, slug, updatedEntry);
        await (await adapter()).commitFiles(token!, user, repo, `Update ${slug} archive`, [change]);
      } catch (error) {
        console.warn('[pipeline] 本地索引更新失败:', error);
      }
    }
    await tryIndexPr(token, mock, updatedEntry, onStep);
  } else {
    onStep('index', 'done');
  }
}
