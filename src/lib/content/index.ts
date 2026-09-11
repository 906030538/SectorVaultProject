import { POSTS_DIR, POWERED_BY } from '@/config';
import type { IssueInfo, Platform, ReleaseInfo, RepoInfo, SubmissionEntry } from '@/types';
import { getAdapterAsync } from '@/lib/adapters/lazy';
import { fetchEngagementForEntries } from '@/lib/index/stats';
import type { EngagementStats } from '@/types';

/** 工程文件（来自正文文件列表；* 压缩、** 加密） */
export interface ProjectFile {
  name: string;
  compressed: boolean;
  encrypted: boolean;
}

/** 解析后的内容仓 README 结构 */
export interface ParsedReadme {
  attrs: Record<string, string>;
  body: string;
  files: ProjectFile[];
}

export interface MediaItem {
  name: string;
  kind: 'image' | 'audio' | 'video' | 'other';
  url: string;
}

export interface SubmissionContent {
  parsed: ParsedReadme;
  media: MediaItem[];
  /** 投稿实际所在目录（posts/[slug] 或兼容的 [slug]） */
  baseDir: string;
}

function repoKey(user: string, repo: string): string {
  return `${user}/${repo}`;
}

function slugKey(user: string, repo: string, slug: string): string {
  return `${user}/${repo}/${slug}`;
}

/**
 * 解析内容仓 README：
 * 头部固定 *Powered by...*，随后属性行（issue、cover、license 等），
 * 第一个 --- 分隔符后为正文，第二个分隔符后为工程文件列表。
 */
export function parseReadme(raw: string): ParsedReadme {
  const sections = raw.split(/^\s*---\s*$/m);
  const header = sections[0] ?? '';
  // 正文可能包含独立的 --- 行：文件列表取最后一段，中间段重组成正文
  const fileList = sections.length >= 3 ? (sections[sections.length - 1] ?? '') : '';
  const body = sections
    .slice(1, sections.length >= 3 ? -1 : sections.length)
    .join('\n---\n')
    .trim();

  const attrs: Record<string, string> = {};
  for (const line of header.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.includes(POWERED_BY)) continue;
    const idx = trimmed.indexOf(':');
    if (idx > 0) {
      attrs[trimmed.slice(0, idx).trim().toLowerCase()] = trimmed.slice(idx + 1).trim();
    }
  }

  const files: ProjectFile[] = [];
  for (const line of fileList.split('\n')) {
    const item = line.trim();
    if (!item.startsWith('- ')) continue;
    const rest = item.slice(2).trim();
    const stars = rest.match(/^\*+/)?.[0].length ?? 0;
    files.push({
      name: rest.slice(stars).trim(),
      compressed: stars === 1,
      encrypted: stars >= 2,
    });
  }

  return { attrs, body, files };
}

/** generateReadme 的输入；空值属性整行省略 */
export interface ReadmeInput {
  issue: number | string;
  title?: string;
  type?: string;
  /** 投稿时间（ISO） */
  submittedAt?: string;
  /** 发布时间（ISO） */
  publishedAt?: string;
  cover?: string;
  license?: string;
  /** 关联 release id */
  release?: number | string;
  /** 关联曲目（多值，逗号连接） */
  songs?: string[];
  /** 合成引擎（多值） */
  engines?: string[];
  /** 使用声库（多值） */
  voicebanks?: string[];
  /** 歌曲语言（多值） */
  languages?: string[];
  /** 视频站链接，逗号连接写入 videos 属性 */
  videos?: string[];
  /** 标签，逗号连接写入 tags 属性（索引 schema 不含标签，随稿件内容存储） */
  tags?: string[];
  body: string;
  files: ProjectFile[];
}

/** 生成编辑器格式的 README（与 parseReadme 严格互逆）：头部携带全部稿件参数 */
export function generateReadme(input: ReadmeInput): string {
  const header = [`*${POWERED_BY}*`, `issue: ${input.issue}`];
  if (input.release !== undefined && input.release !== '' && input.release !== 0) {
    header.push(`release: ${input.release}`);
  }
  if (input.title) header.push(`title: ${input.title}`);
  if (input.type) header.push(`type: ${input.type}`);
  if (input.submittedAt) header.push(`submittedAt: ${input.submittedAt}`);
  if (input.publishedAt) header.push(`publishedAt: ${input.publishedAt}`);
  if (input.cover) header.push(`cover: ${input.cover}`);
  if (input.songs?.length) header.push(`songs: ${input.songs.join(', ')}`);
  if (input.engines?.length) header.push(`engines: ${input.engines.join(', ')}`);
  if (input.voicebanks?.length) header.push(`voicebanks: ${input.voicebanks.join(', ')}`);
  if (input.languages?.length) header.push(`languages: ${input.languages.join(', ')}`);
  if (input.videos?.length) header.push(`videos: ${input.videos.join(', ')}`);
  if (input.tags?.length) header.push(`tags: ${input.tags.join(', ')}`);

  const fileList = input.files.map((f) => {
    const stars = f.encrypted ? '**' : f.compressed ? '*' : '';
    return `- ${stars}${f.name}`;
  });

  return [header.join('\n'), '', '---', '', input.body.trim(), '', '---', '', fileList.join('\n')].join('\n') + '\n';
}

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif']);
const AUDIO_EXT = new Set(['wav', 'mp3', 'ogg', 'flac', 'm4a']);
const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'mkv']);

/** 文件扩展名 → 媒体类别（详情页工程文件与媒体区的分流依据） */
export function mediaKind(name: string): MediaItem['kind'] {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (IMAGE_EXT.has(ext)) return 'image';
  if (AUDIO_EXT.has(ext)) return 'audio';
  if (VIDEO_EXT.has(ext)) return 'video';
  return 'other';
}

export async function loadRepoInfo(
  platform: Platform,
  user: string,
  repo: string,
): Promise<RepoInfo | null> {
  return (await getAdapterAsync(platform)).getRepo(user, repo);
}

/** 仓库根目录的个人介绍文件；不存在时返回 undefined */
export async function loadAbout(
  platform: Platform,
  user: string,
  repo: string,
): Promise<string | undefined> {
  try {
    return await (await getAdapterAsync(platform)).readFile(user, repo, 'ABOUT.md');
  } catch {
    return undefined;
  }
}

/**
 * 解析投稿基础目录：优先 posts/[slug]（DESIGN 内容仓结构），
 * 兼容早期直接位于根下的 [slug] 目录。
 */
async function resolveBaseDir(
  platform: Platform,
  user: string,
  repo: string,
  slug: string,
): Promise<string> {
  const adapter = await getAdapterAsync(platform);
  for (const base of [`${POSTS_DIR}/${slug}`, slug]) {
    try {
      await adapter.readFile(user, repo, `${base}/README.md`);
      return base;
    } catch {
      /* 尝试下一个候选目录 */
    }
  }
  throw new Error(`README not found: ${user}/${repo}/${slug}`);
}

async function loadReadme(
  platform: Platform,
  user: string,
  repo: string,
  slug: string,
  baseDir: string,
): Promise<string> {
  return (await getAdapterAsync(platform)).readFile(user, repo, `${baseDir}/README.md`);
}

async function loadSlugDir(
  platform: Platform,
  user: string,
  repo: string,
  baseDir: string,
): Promise<string[]> {
  const entries = await (await getAdapterAsync(platform)).listDir(user, repo, baseDir);
  return entries.filter((e) => e.type === 'file').map((e) => e.name);
}

/** 稿件内容：解析 README 并整理仓库媒体（排除 README 与工程文件） */
export async function loadSubmissionContent(
  platform: Platform,
  user: string,
  repo: string,
  slug: string,
): Promise<SubmissionContent> {
  const baseDir = await resolveBaseDir(platform, user, repo, slug);
  const [raw, dir] = await Promise.all([
    loadReadme(platform, user, repo, slug, baseDir),
    loadSlugDir(platform, user, repo, baseDir).catch(() => [] as string[]),
  ]);
  const parsed = parseReadme(raw);
  const projectFiles = new Map(parsed.files.map((f) => [f.name, f] as const));

  const adapter = await getAdapterAsync(platform);
  const media: MediaItem[] = dir
    .filter((name) => {
      if (name === 'README.md') return false;
      const file = projectFiles.get(name);
      // 明文媒体类工程文件保留在媒体列表（详情页媒体区展示）；
      // 其余工程文件（含压缩/加密，物理名为 .zip 后缀不在此列）不重复进媒体区
      return !file || (!file.compressed && !file.encrypted && mediaKind(name) !== 'other');
    })
    .map((name) => ({ name, kind: mediaKind(name), url: adapter.rawUrl(user, repo, `${baseDir}/${name}`) }));

  return { parsed, media, baseDir };
}

export async function loadReleases(
  platform: Platform,
  user: string,
  repo: string,
): Promise<ReleaseInfo[]> {
  return (await getAdapterAsync(platform)).listReleases(user, repo);
}

export async function loadIssues(platform: Platform, user: string, repo: string): Promise<IssueInfo[]> {
  return (await getAdapterAsync(platform)).listIssues(user, repo);
}

/** 当前页稿件的评论数/点赞数 */
export async function loadEngagements(
  platform: Platform,
  user: string,
  repo: string,
  entries: SubmissionEntry[],
): Promise<Map<string, EngagementStats>> {
  const results = new Map<string, EngagementStats>();
  const fromStats = await fetchEngagementForEntries(await getAdapterAsync(platform), entries);
  for (const entry of entries) {
    results.set(
      slugKey(entry.owner, entry.repo, entry.slug),
      fromStats.get(`${entry.platform}:${entry.owner}/${entry.repo}#${entry.slug}`) ?? {
        comments: 0,
        reactions: 0,
      },
    );
  }
  return results;
}
