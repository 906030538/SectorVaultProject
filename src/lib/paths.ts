import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_INDEX_SOURCES, SUPPORTED_PLATFORMS, type IndexSource } from '@/config';
import type { IndexFile, Platform, SubmissionEntry, UserRecord } from '@/types';

/**
 * 构建期静态路径派生：从部署配置的索引源抓取 current.json，
 * 为用户空间 / 集合 / 稿件 / 编辑页生成静态路径。
 * 真实索引为空时这些页面数为 0；索引仓更新后重新构建即可。
 */

const PLATFORM_SET = new Set<string>(SUPPORTED_PLATFORMS);

function normalizeSource(raw: unknown): IndexSource | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { platform, owner, repo, branch } = raw as Record<string, unknown>;
  if (typeof platform !== 'string' || !PLATFORM_SET.has(platform)) return null;
  if (typeof owner !== 'string' || !owner) return null;
  if (typeof repo !== 'string' || !repo) return null;
  return {
    platform: platform as Platform,
    owner,
    repo,
    branch: typeof branch === 'string' && branch ? branch : 'index',
  };
}

/** 与运行时 sources.ts 同优先级：public/deployment.json 优先，缺失回退默认源 */
function buildTimeSources(): IndexSource[] {
  try {
    const path = fileURLToPath(new URL('../../public/deployment.json', import.meta.url));
    const config = JSON.parse(readFileSync(path, 'utf8')) as { indexes?: unknown };
    const list = (Array.isArray(config.indexes) ? config.indexes : [])
      .map(normalizeSource)
      .filter((source): source is IndexSource => source !== null);
    if (list.length > 0) return list;
  } catch {
    /* 配置缺失时使用内置默认 */
  }
  return DEFAULT_INDEX_SOURCES;
}

/** 平台 raw 文件地址（github 走 raw.githubusercontent，其余平台走 /raw/{branch}/） */
function rawFileUrl(source: IndexSource, path: string): string {
  if (source.platform === 'github') {
    return `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${source.branch}/${path}`;
  }
  const host = source.platform === 'gitee' ? 'https://gitee.com' : 'https://atomgit.com';
  return `${host}/${source.owner}/${source.repo}/raw/${source.branch}/${path}`;
}

async function fetchCurrentIndex(source: IndexSource): Promise<IndexFile | null> {
  try {
    const response = await fetch(rawFileUrl(source, 'index/current.json'));
    if (!response.ok) return null;
    return (await response.json()) as IndexFile;
  } catch {
    return null;
  }
}

async function loadIndexForPaths(): Promise<IndexFile> {
  const merged: IndexFile = { submissions: [], users: [] };
  const seen = new Set<string>();
  for (const source of buildTimeSources()) {
    const index = await fetchCurrentIndex(source);
    if (!index) continue;
    for (const submission of index.submissions) {
      const key = `${submission.platform}:${submission.owner}/${submission.repo}/${submission.slug}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.submissions.push(submission);
    }
    for (const user of index.users) {
      if (merged.users.some((u) => u.platform === user.platform && u.owner === user.owner)) continue;
      merged.users.push(user);
    }
  }
  return merged;
}

/** 索引中每个用户生成用户空间静态页 */
export async function userStaticPaths(): Promise<{ params: { name: string } }[]> {
  const index = await loadIndexForPaths();
  const names = [...new Set(index.users.map((u: UserRecord) => u.owner))];
  return names.map((name) => ({ params: { name } }));
}

/** 集合详情与稿件详情的静态路径 */
export async function viewStaticPaths(): Promise<{ params: { path: string } }[]> {
  const index = await loadIndexForPaths();
  const paths = new Set<string>();
  for (const user of index.users) {
    for (const ref of user.repos ?? []) paths.add(`${user.owner}/${ref.repo}`);
  }
  for (const sub of index.submissions) {
    paths.add(`${sub.owner}/${sub.repo}/${sub.slug}`);
  }
  return Array.from(paths).map((path) => ({ params: { path } }));
}

/** 编辑页静态路径 */
export async function editStaticPaths(): Promise<
  { params: { name: string; repo: string; slug: string } }[]
> {
  const index = await loadIndexForPaths();
  return index.submissions.map((sub: SubmissionEntry) => ({
    params: { name: sub.owner, repo: sub.repo, slug: sub.slug },
  }));
}
