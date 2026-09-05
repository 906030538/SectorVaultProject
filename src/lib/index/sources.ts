import {
  DEFAULT_INDEX_SOURCES,
  DEFAULT_OAUTH_ENDPOINTS,
  DEPLOYMENT_CONFIG_URL,
  SUPPORTED_PLATFORMS,
  type IndexSource,
  type OAuthProviderConfig,
} from '@/config';
import { GITHUB_CLIENT_ID } from '@/lib/auth';
import { withBase } from '@/lib/base';
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
      const response = await fetch(withBase(DEPLOYMENT_CONFIG_URL));
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

let oauthPromise: Promise<Record<string, OAuthProviderConfig>> | undefined;

/** 部署配置的 OAuth 提供方（deployment.json 的 oauth 段；GitHub clientId 亦可经环境变量注入） */
export function getOAuthProviders(): Promise<Record<string, OAuthProviderConfig>> {
  oauthPromise ??= (async () => {
    try {
      const response = await fetch(withBase(DEPLOYMENT_CONFIG_URL));
      if (response.ok) {
        const config = (await response.json()) as {
          oauth?: Record<string, OAuthProviderConfig>;
          /** 顶层 github.clientId 简写（GitHub App 认证） */
          github?: { clientId?: string };
        };
        const merged = { ...(config.oauth ?? {}) };
        // 顶层 github.clientId 与 oauth.github 合并（后者优先）
        if (config.github?.clientId && !merged.github?.clientId) {
          merged.github = { ...(merged.github ?? {}), clientId: config.github.clientId };
        }
        if (GITHUB_CLIENT_ID && !merged.github?.clientId) {
          merged.github = { ...(merged.github ?? {}), clientId: GITHUB_CLIENT_ID };
        }
        return merged;
      }
    } catch {
      /* 配置不可用时仅环境变量 */
    }
    return GITHUB_CLIENT_ID ? { github: { clientId: GITHUB_CLIENT_ID } } : {};
  })();
  return oauthPromise;
}

/** 平台的可用 OAuth 配置（含默认端点；未配置 clientId 时返回 null） */
export async function getOAuthConfig(
  platform: Platform,
): Promise<Required<Pick<OAuthProviderConfig, 'clientId' | 'authorizeUrl' | 'tokenUrl' | 'scope'>> | null> {
  const providers = await getOAuthProviders();
  const custom = providers[platform];
  if (!custom?.clientId) return null;
  const preset = DEFAULT_OAUTH_ENDPOINTS[platform];
  return {
    clientId: custom.clientId,
    authorizeUrl: custom.authorizeUrl ?? preset?.authorizeUrl ?? '',
    tokenUrl: custom.tokenUrl ?? preset?.tokenUrl ?? '',
    scope: custom.scope ?? preset?.scope ?? '',
    ...(custom.clientSecret ? { clientSecret: custom.clientSecret } : {}),
  } as Required<Pick<OAuthProviderConfig, 'clientId' | 'authorizeUrl' | 'tokenUrl' | 'scope'>>;
}

/** 线路偏好（选定的托管平台）存储键；未设置 = 全部平台 */
export const LINE_STORAGE_KEY = 'svp-line';

/** 当前线路（null = 全部平台） */
export function getStoredLine(): string | null {
  try {
    return localStorage.getItem(LINE_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

export function setStoredLine(platform: Platform | null): void {
  try {
    if (platform) localStorage.setItem(LINE_STORAGE_KEY, platform);
    else localStorage.removeItem(LINE_STORAGE_KEY);
  } catch {
    /* 存储不可用时忽略 */
  }
}

/** 当前线路生效的索引源：选定平台时只保留该平台的源（无配置时回退全部） */
export async function getLineSources(): Promise<IndexSource[]> {
  const all = await getIndexSources();
  const line = getStoredLine();
  if (!line) return all;
  const filtered = all.filter((source) => source.platform === line);
  return filtered.length > 0 ? filtered : all;
}

/** 不作为独立线路展示的平台（数据仍参与合并，仅不出现在下拉） */
const HIDDEN_LINE_PLATFORMS = new Set<string>(['gitcode']);

/** 配置中出现的平台（线路下拉选项；排除隐藏平台） */
export async function getAvailablePlatforms(): Promise<Platform[]> {
  const all = await getIndexSources();
  return [...new Set(all.map((source) => source.platform))].filter(
    (platform) => !HIDDEN_LINE_PLATFORMS.has(platform),
  );
}
