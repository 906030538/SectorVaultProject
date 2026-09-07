import {
  CONTENT_REPO_PREFIX,
  DEFAULT_FAQ_PAGES,
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

/** 部署配置结构 */
export interface DeploymentConfig {
  /** 索引源列表 */
  indexes?: unknown;
  /** 内容仓默认前缀（新建集合对话框） */
  repoPrefix?: unknown;
  /** 各平台模板仓列表（新建集合对话框；仅支持模板生成的平台生效） */
  templates?: Record<string, unknown[]>;
  /** FAQ 目录（wiki 页面名；缺省用内置列表） */
  faqPages?: unknown;
  /** 跨子域共享 cookie 的父域（如 svp.lyoko.cn；令牌/会话/索引缓存镜像到该域） */
  cookieDomain?: unknown;
  /** OAuth 端点基址（如 https://cf.svp.lyoko.cn；相对 token/env 端点以其为前缀） */
  oauthBase?: unknown;
}

/** 模板仓配置（deployment.json 的 templates 段条目） */
export interface RepoTemplateConfig {
  /** 展示名；缺省为 owner/repo */
  name?: string;
  owner: string;
  repo: string;
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

/** 容错解析单条模板仓配置 */
function normalizeTemplate(raw: unknown): RepoTemplateConfig | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { name, owner, repo } = raw as Record<string, unknown>;
  if (typeof owner !== 'string' || !owner) return null;
  if (typeof repo !== 'string' || !repo) return null;
  return { owner, repo, ...(typeof name === 'string' && name ? { name } : {}) };
}

let configPromise: Promise<DeploymentConfig | null> | undefined;

/** 部署配置（deployment.json）；加载失败或损坏时返回 null */
function loadDeploymentConfig(): Promise<DeploymentConfig | null> {
  configPromise ??= (async () => {
    try {
      const response = await fetch(withBase(DEPLOYMENT_CONFIG_URL));
      if (response.ok) return (await response.json()) as DeploymentConfig;
    } catch {
      /* 配置不可用时使用内置默认 */
    }
    return null;
  })();
  return configPromise;
}

let sourcesPromise: Promise<IndexSource[]> | undefined;

/** 生效的索引源列表：deployment.json 的 indexes 优先，缺失或损坏时回退默认源 */
export function getIndexSources(): Promise<IndexSource[]> {
  sourcesPromise ??= (async () => {
    const config = await loadDeploymentConfig();
    const list = (Array.isArray(config?.indexes) ? config?.indexes : [])
      .map(normalizeSource)
      .filter((source): source is IndexSource => source !== null);
    if (list.length > 0) return list;
    return DEFAULT_INDEX_SOURCES;
  })();
  return sourcesPromise;
}

/** 内容仓默认前缀（新建集合对话框）；deployment.json 的 repoPrefix 优先 */
export async function getRepoPrefix(): Promise<string> {
  const config = await loadDeploymentConfig();
  return typeof config?.repoPrefix === 'string' && config.repoPrefix.trim()
    ? config.repoPrefix.trim()
    : CONTENT_REPO_PREFIX;
}

const templatesPromises: Partial<Record<Platform, Promise<RepoTemplateConfig[]>>> = {};

/** 平台可用的模板仓列表（deployment.json 的 templates 段） */
export function getRepoTemplates(platform: Platform): Promise<RepoTemplateConfig[]> {
  templatesPromises[platform] ??= (async () => {
    const config = await loadDeploymentConfig();
    const raw = config?.templates?.[platform];
    return (Array.isArray(raw) ? raw : [])
      .map(normalizeTemplate)
      .filter((template): template is RepoTemplateConfig => template !== null);
  })();
  return templatesPromises[platform]!;
}

let faqPagesPromise: Promise<string[]> | undefined;

/** FAQ 目录（wiki 页面名列表）：deployment.json 的 faqPages 优先，缺省用内置回退 */
export function getFaqPages(): Promise<string[]> {
  faqPagesPromise ??= (async () => {
    const config = await loadDeploymentConfig();
    const raw = config?.faqPages;
    const list = (Array.isArray(raw) ? raw : [])
      .filter((page): page is string => typeof page === 'string' && !!page.trim())
      .map((page) => page.trim());
    return list.length > 0 ? list : DEFAULT_FAQ_PAGES;
  })();
  return faqPagesPromise;
}

let cookieDomainPromise: Promise<string | undefined> | undefined;

/** 跨子域共享 cookie 的父域（deployment.json 的 cookieDomain；未配置返回 undefined） */
export function getCookieDomain(): Promise<string | undefined> {
  cookieDomainPromise ??= (async () => {
    const config = await loadDeploymentConfig();
    return typeof config?.cookieDomain === 'string' && config.cookieDomain.trim()
      ? config.cookieDomain.trim()
      : undefined;
  })();
  return cookieDomainPromise;
}

let oauthBasePromise: Promise<string | undefined> | undefined;

/** OAuth 端点基址（deployment.json 的 oauthBase，去尾斜杠；未配置返回 undefined） */
export function getOauthBase(): Promise<string | undefined> {
  oauthBasePromise ??= (async () => {
    const config = await loadDeploymentConfig();
    if (typeof config?.oauthBase !== 'string' || !config.oauthBase.trim()) return undefined;
    return config.oauthBase.trim().replace(/\/+$/, '');
  })();
  return oauthBasePromise;
}

/** 主索引源：第一个配置的源，作为索引 PR 的写入目标 */
export async function getPrimaryIndexSource(): Promise<IndexSource> {
  return (await getIndexSources())[0]!;
}

let oauthPromise: Promise<Record<string, OAuthProviderConfig>> | undefined;

/** 部署配置的 OAuth 提供方：deployment.json oauth 段 + 服务端 /oauth/env（密钥仅存环境变量时使用） */
export function getOAuthProviders(): Promise<Record<string, OAuthProviderConfig>> {
  oauthPromise ??= (async () => {
    const merged: Record<string, OAuthProviderConfig> = {};
    // 服务端环境变量下发的凭据（oauthBase 或本站的 /oauth/env Functions）；
    // GitHub 的 appClientId（App 设备流）与 clientId（OAuth 网页流）相互独立
    try {
      const base = await getOauthBase();
      const response = await fetch(base ? `${base}/oauth/env` : withBase('/oauth/env'));
      if (response.ok) {
        const envConfig = (await response.json()) as Record<string, { clientId?: string; appClientId?: string }>;
        for (const [platform, entry] of Object.entries(envConfig)) {
          const creds: OAuthProviderConfig = { clientId: '' };
          if (entry?.appClientId) creds.appClientId = entry.appClientId;
          if (entry?.clientId) creds.clientId = entry.clientId;
          if (creds.clientId || creds.appClientId) merged[platform] = creds;
        }
      }
    } catch {
      /* 非 Functions 部署时无此端点 */
    }
    try {
      const response = await fetch(withBase(DEPLOYMENT_CONFIG_URL));
      if (response.ok) {
        const config = (await response.json()) as {
          oauth?: Record<string, OAuthProviderConfig>;
          /** 顶层 github.clientId 简写（GitHub App 认证） */
          github?: { clientId?: string };
        };
        // 兼容 id/secret 简写（gitee/atomgit 常用）→ clientId/clientSecret
        const normalizeProvider = (
          raw: Record<string, unknown> | undefined,
        ): OAuthProviderConfig | undefined =>
          raw
            ? {
                ...(raw as unknown as OAuthProviderConfig),
                clientId:
                  ((raw as Record<string, unknown>).clientId as string | undefined) ??
                  ((raw as Record<string, unknown>).id as string | undefined) ??
                  '',
                clientSecret:
                  ((raw as Record<string, unknown>).clientSecret as string | undefined) ??
                  ((raw as Record<string, unknown>).secret as string | undefined),
              }
            : undefined;
        for (const [platform, raw] of Object.entries(config.oauth ?? {})) {
          const normalized = normalizeProvider(raw as unknown as Record<string, unknown> | undefined);
          if (normalized?.clientId) merged[platform] = normalized;
        }
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

/** 平台的可用 OAuth 配置（含默认端点）；clientId（网页流）与 appClientId（设备流）均未配置时返回 null。
 * 相对端点（站内 Functions 代理）在有 oauthBase 时指向 worker 子域，绝对地址原样透传。 */
export async function getOAuthConfig(
  platform: Platform,
): Promise<(Required<Pick<OAuthProviderConfig, 'clientId' | 'authorizeUrl' | 'tokenUrl' | 'scope'>> &
  Partial<Pick<OAuthProviderConfig, 'appClientId' | 'deviceCodeUrl' | 'deviceTokenUrl' | 'clientSecret'>>) | null> {
  const providers = await getOAuthProviders();
  const custom = providers[platform];
  if (!custom?.clientId && !custom?.appClientId) return null;
  const preset = DEFAULT_OAUTH_ENDPOINTS[platform];
  const base = await getOauthBase();
  const resolveUrl = (url: string | undefined): string | undefined => {
    if (!url) return undefined;
    if (/^https?:/i.test(url)) return url;
    return `${base ?? ''}${url.startsWith('/') ? url : `/${url}`}`;
  };
  return {
    clientId: custom.clientId ?? '',
    authorizeUrl: resolveUrl(custom.authorizeUrl ?? preset?.authorizeUrl ?? '') ?? '',
    tokenUrl: resolveUrl(custom.tokenUrl ?? preset?.tokenUrl ?? '') ?? '',
    deviceCodeUrl: resolveUrl(custom.deviceCodeUrl ?? preset?.deviceCodeUrl),
    deviceTokenUrl: resolveUrl(custom.deviceTokenUrl ?? preset?.deviceTokenUrl),
    scope: custom.scope ?? preset?.scope ?? '',
    ...(custom.appClientId ? { appClientId: custom.appClientId } : {}),
    ...(custom.clientSecret ? { clientSecret: custom.clientSecret } : {}),
  } as Required<Pick<OAuthProviderConfig, 'clientId' | 'authorizeUrl' | 'tokenUrl' | 'scope'>> &
    Partial<Pick<OAuthProviderConfig, 'appClientId' | 'deviceCodeUrl' | 'deviceTokenUrl' | 'clientSecret'>>;
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
