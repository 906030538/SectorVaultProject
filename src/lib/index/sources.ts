import {
  DEFAULT_INDEX_SOURCES,
  DEPLOYMENT_CONFIG_URL,
  SUPPORTED_PLATFORMS,
  type IndexSource,
} from '@/config';
import type { Platform } from '@/types';

/** 部署配置结构：indexes 为索引源列表 */
export interface DeploymentConfig {
  indexes?: unknown;
}

const PLATFORM_SET = new Set<string>(SUPPORTED_PLATFORMS);

/** 容错解析单条索引源配置；branch 缺省为 index */
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

let sourcesPromise: Promise<IndexSource[]> | undefined;

/** 生效的索引源列表：deployment.json 的 indexes 优先，缺失或损坏时回退默认源 */
export function getIndexSources(): Promise<IndexSource[]> {
  sourcesPromise ??= (async () => {
    try {
      const response = await fetch(DEPLOYMENT_CONFIG_URL);
      if (response.ok) {
        const config = (await response.json()) as DeploymentConfig;
        const list = (Array.isArray(config.indexes) ? config.indexes : [])
          .map(normalizeSource)
          .filter((source): source is IndexSource => source !== null);
        if (list.length > 0) return list;
      }
    } catch {
      /* 配置不可用时使用内置默认 */
    }
    return DEFAULT_INDEX_SOURCES;
  })();
  return sourcesPromise;
}

/** 主索引源：第一个配置的源，作为索引 PR 的写入目标 */
export async function getPrimaryIndexSource(): Promise<IndexSource> {
  return (await getIndexSources())[0]!;
}
