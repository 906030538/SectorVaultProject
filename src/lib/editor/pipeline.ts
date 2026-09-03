import { INDEX_PATHS, MOCK_PIPELINE_STEP_DELAY } from '@/config';
import { getAdapterAsync } from '@/lib/adapters/lazy';
import type { FileChange, GitPlatformAdapter } from '@/lib/adapters/types';
import { generateReadme, type ProjectFile } from '@/lib/content';
import { loadMockIndex, loadPrimaryIndex } from '@/lib/index/loader';
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
): string {
  return generateReadme({
    issue,
    cover: coverName || undefined,
    license: draft.license || undefined,
    videos: draft.videos.filter(Boolean),
    tags: draft.tags,
    body: draft.body,
    files: draftFilesToProjectFiles(draft.files),
  });
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
  const index = await loadIndex(mock);
  const next: IndexFile = JSON.parse(JSON.stringify(index)) as IndexFile;
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
  // 归档是事实来源：投稿 PR 写入该稿投稿月份的归档文件，current.json 由索引仓 CI 重建
  const month = entry.submittedAt.slice(0, 7);
  return {
    path: `${INDEX_PATHS.archiveDir}/${month}.json`,
    content: `${JSON.stringify(next, null, 2)}\n`,
    encoding: 'utf-8',
  };
}

/** 由表单构造索引条目；编辑时 submittedAt/publishedAt 沿用原值 */
export function buildIndexEntry(
  draft: SubmissionDraft,
  date: string,
  cover?: string,
  publishedAt?: string,
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
      await (await getAdapterAsync(entry.platform)).openIndexPr(token, `index: +${entry.owner}/${entry.repo}/${entry.slug}`, [change]);
    } else {
      await sleep(MOCK_PIPELINE_STEP_DELAY);
    }
    onStep('index', 'done');
  } catch (error) {
    // openIndexPr 尚未实现（各平台适配器均为桩）：降级为跳过，不阻断发布
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
  /** 用户主动跳过的步骤（不再重试） */
  skipped?: string[];
}

/** 空仓库检测：GitHub/Gitee 列目录时对空仓库返回 Git Repository is empty. */
function isRepoEmptyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /git repository is empty/i.test(message);
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
    await (await adapter()).commitFiles(token!, user, repo, 'Initialize Sector Vault repository', [
      {
        path: 'README.md',
        content: `# ${repo}\n\n*Powered by Sector Vault Project*\n`,
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

  await resumeStep('issue', progress.issue !== undefined, async () => {
    if (mock) {
      issue = 13;
      return;
    }
    if (!token) throw new Error('missing token');
    issue = await (await adapter()).createIssue(token, user, repo, draft.title, '');
    progress.issue = issue;
  });

  await resumeStep('files', progress.filesDone === true, async () => {
    if (!mock) await ensureRepoInitialized(token, user, repo, adapter);
    // 内联媒体（封面 + 工程文件）与 README 合并为一个提交
    const changes: FileChange[] = [];
    if (draft.cover) {
      changes.push(await fileChange(`${slug}/${draft.cover.name}`, draft.cover, 'raw'));
    }
    for (const f of draft.files) {
      if (!f.file) continue;
      changes.push(await fileChange(`${slug}/${f.name}`, f.file, f.scheme, f.password));
    }
    changes.push({
      path: `${slug}/README.md`,
      content: buildReadmeText(draft, issue, draft.cover?.name),
      encoding: 'utf-8',
    });
    if (!mock) await (await adapter()).commitFiles(token!, user, repo, `Add ${slug}`, changes);
    progress.filesDone = true;
  });

  await resumeStep('release', progress.releaseId !== undefined, async () => {
    if (mock) {
      releaseId = 1;
      return;
    }
    const site = await findUserSite(user, mock);
    releaseId = await (await adapter()).createRelease(
      token!,
      user,
      repo,
      slug,
      buildReleaseBody(user, repo, slug, site, draft.summary),
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
    // 投稿/发布时间缺省取发布点击时刻（投稿时间可由编辑器指定，决定归档月份与 slug 日期）
    const now = new Date().toISOString();
    await tryIndexPr(
      token,
      mock,
      buildIndexEntry(draft, draft.submittedAt ?? now, draft.cover?.name, draft.publishedAt ?? now),
      onStep,
    );
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
    if (ctx.oldCover) changes.push({ path: `${slug}/${ctx.oldCover}`, content: '', delete: true });
    if (draft.cover) {
      changes.push(await fileChange(`${slug}/${draft.cover.name}`, draft.cover, 'raw'));
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
      path: `${slug}/${of.name}`,
      content: '',
      delete: true,
    }));
    for (const f of newFiles) {
      changes.push(await fileChange(`${slug}/${f.name}`, f.file!, f.scheme, f.password));
    }
    if (!mock) await (await adapter()).commitFiles(token!, user, repo, `Update ${slug} files`, changes);
  });

  const readme = buildReadmeText(draft, ctx.issue, currentCover);  await runStep('readme', mock, onStep, async () => {
    if (!mock) {
      await (await adapter()).commitFiles(token!, user, repo, `Update ${slug} README`, [
        { path: `${slug}/README.md`, content: readme, encoding: 'utf-8' },
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
  // 发布时间编辑器可改（未改动时沿用原值）；投稿时间不变更
  const nextPublishedAt = draft.publishedAt ?? entry.publishedAt ?? entry.submittedAt;
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
    // 投稿时间不变更
    await tryIndexPr(
      token,
      mock,
      buildIndexEntry(draft, entry.submittedAt, currentCover, nextPublishedAt),
      onStep,
    );
  } else {
    onStep('index', 'done');
  }
}
