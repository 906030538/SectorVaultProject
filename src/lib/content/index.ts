import { MOCK_CONTENT_URL, POWERED_BY } from '@/config';
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
}

interface MockRepo {
  stars: number;
  license: string;
}

interface MockContent {
  repos: Record<string, MockRepo>;
  readmes: Record<string, string>;
  dirs: Record<string, string[]>;
  releases: Record<string, ReleaseInfo[]>;
  issues: Record<string, IssueInfo[]>;
  abouts?: Record<string, string>;
}

let mockCache: MockContent | null | undefined;

/** 尝试加载本地演示数据；部署了真实索引仓时返回 null 走适配器 */
async function getMock(): Promise<MockContent | null> {
  if (mockCache !== undefined) return mockCache;
  try {
    const response = await fetch(MOCK_CONTENT_URL);
    if (!response.ok) {
      mockCache = null;
      return null;
    }
    mockCache = (await response.json()) as MockContent;
  } catch {
    mockCache = null;
  }
  return mockCache;
}

function repoKey(user: string, repo: string): string {
  return `${user}/${repo}`;
}

/** 演示数据是否可用（部署真实索引仓后 /mock/content.json 不存在） */
export async function isMockAvailable(): Promise<boolean> {
  return (await getMock()) !== null;
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
  cover?: string;
  license?: string;
  /** 视频站链接，逗号连接写入 videos 属性 */
  videos?: string[];
  /** 标签，逗号连接写入 tags 属性（索引 schema 不含标签，随稿件内容存储） */
  tags?: string[];
  body: string;
  files: ProjectFile[];
}

/** 生成编辑器格式的 README（与 parseReadme 严格互逆） */
export function generateReadme(input: ReadmeInput): string {
  const header = [`*${POWERED_BY}*`, `issue: ${input.issue}`];
  if (input.cover) header.push(`cover: ${input.cover}`);
  if (input.license) header.push(`license: ${input.license}`);
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

function mediaKind(name: string): MediaItem['kind'] {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (IMAGE_EXT.has(ext)) return 'image';
  if (AUDIO_EXT.has(ext)) return 'audio';
  if (VIDEO_EXT.has(ext)) return 'video';
  return 'other';
}

/** mock 模式下的图片占位（SVG 数据链接） */
function imagePlaceholder(name: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="100%" height="100%" fill="#e2e8f0"/><text x="50%" y="50%" font-family="sans-serif" font-size="24" fill="#64748b" text-anchor="middle" dominant-baseline="middle">${name}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** mock 模式下的占位音频（0.1s 静音 WAV） */
const SILENT_WAV = `data:audio/wav;base64,UklGRmQGAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YUAGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;

function mockMediaUrl(name: string, kind: MediaItem['kind']): string {
  if (kind === 'image') return imagePlaceholder(name);
  if (kind === 'audio') return SILENT_WAV;
  return '';
}

export async function loadRepoInfo(
  platform: Platform,
  user: string,
  repo: string,
): Promise<RepoInfo | null> {
  const mock = await getMock();
  if (mock) {
    const m = mock.repos[repoKey(user, repo)];
    if (!m) return null;
    return {
      name: repo,
      fullName: repoKey(user, repo),
      htmlUrl: `https://${platform === 'gitee' ? 'gitee.com' : 'github.com'}/${user}/${repo}`,
      stars: m.stars,
      license: m.license,
    };
  }
  return (await getAdapterAsync(platform)).getRepo(user, repo);
}

/** 仓库根目录的个人介绍文件；不存在时返回 undefined */
export async function loadAbout(
  platform: Platform,
  user: string,
  repo: string,
): Promise<string | undefined> {
  const mock = await getMock();
  if (mock) return mock.abouts?.[repoKey(user, repo)];
  try {
    return await (await getAdapterAsync(platform)).readFile(user, repo, 'ABOUT.md');
  } catch {
    return undefined;
  }
}

async function loadReadme(platform: Platform, user: string, repo: string, slug: string): Promise<string> {
  const mock = await getMock();
  if (mock) {
    const raw = mock.readmes[slugKey(user, repo, slug)];
    if (!raw) throw new Error(`README not found: ${slugKey(user, repo, slug)}`);
    return raw;
  }
  return (await getAdapterAsync(platform)).readFile(user, repo, `${slug}/README.md`);
}

async function loadSlugDir(platform: Platform, user: string, repo: string, slug: string): Promise<string[]> {
  const mock = await getMock();
  if (mock) {
    return mock.dirs[slugKey(user, repo, slug)] ?? [];
  }
  const entries = await (await getAdapterAsync(platform)).listDir(user, repo, slug);
  return entries.filter((e) => e.type === 'file').map((e) => e.name);
}

/** 稿件内容：解析 README 并整理仓库媒体（排除 README 与工程文件） */
export async function loadSubmissionContent(
  platform: Platform,
  user: string,
  repo: string,
  slug: string,
): Promise<SubmissionContent> {
  const mock = await getMock();
  const [raw, dir] = await Promise.all([
    loadReadme(platform, user, repo, slug),
    loadSlugDir(platform, user, repo, slug),
  ]);
  const parsed = parseReadme(raw);
  const projectNames = new Set(parsed.files.map((f) => f.name));

  const media: MediaItem[] = dir
    .filter((name) => name !== 'README.md' && !projectNames.has(name))
    .map((name) => {
      const kind = mediaKind(name);
      return { name, kind, url: mock ? mockMediaUrl(name, kind) : '' };
    });
  if (!mock) {
    const adapter = await getAdapterAsync(platform);
    for (const item of media) item.url = adapter.rawUrl(user, repo, `${slug}/${item.name}`);
  }

  return { parsed, media };
}

export async function loadReleases(
  platform: Platform,
  user: string,
  repo: string,
): Promise<ReleaseInfo[]> {
  const mock = await getMock();
  if (mock) return mock.releases[repoKey(user, repo)] ?? [];
  return (await getAdapterAsync(platform)).listReleases(user, repo);
}

export async function loadIssues(platform: Platform, user: string, repo: string): Promise<IssueInfo[]> {
  const mock = await getMock();
  if (mock) return mock.issues[repoKey(user, repo)] ?? [];
  return (await getAdapterAsync(platform)).listIssues(user, repo);
}

const engagementCache = new Map<string, EngagementStats>();

/** 当前页稿件的评论数/点赞数（缓存） */
export async function loadEngagements(
  platform: Platform,
  user: string,
  repo: string,
  entries: SubmissionEntry[],
): Promise<Map<string, EngagementStats>> {
  const mock = await getMock();
  const results = new Map<string, EngagementStats>();

  if (mock) {
    const issues = mock.issues[repoKey(user, repo)] ?? [];
    const releases = mock.releases[repoKey(user, repo)] ?? [];
    for (const entry of entries) {
      const key = slugKey(entry.owner, entry.repo, entry.slug);
      const cached = engagementCache.get(key);
      if (cached) {
        results.set(key, cached);
        continue;
      }
      const stats: EngagementStats = {
        comments: issues.find((i) => i.title === entry.slug)?.comments ?? 0,
        reactions: releases.find((r) => r.tag === entry.slug)?.reactions ?? 0,
      };
      engagementCache.set(key, stats);
      results.set(key, stats);
    }
    return results;
  }

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
