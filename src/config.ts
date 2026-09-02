import type { Platform } from './types';
import type { MessageKey } from './i18n';

export const SITE_NAME = 'Sector Vault';

/** 内容仓固定前缀，可通过部署配置覆盖 */
export const CONTENT_REPO_PREFIX = 'svp-';

/** 默认分页条数 */
export const PAGE_SIZE = 10;

/** 未归档索引最大条数 */
export const INDEX_MAX_ACTIVE = 1024;

/** 索引数据源：一个索引 = 一个 git 仓库分支 */
export interface IndexSource {
  platform: Platform;
  owner: string;
  repo: string;
  branch: string;
}

/** 默认索引数据源：主站索引仓的 index 分支（部署配置缺失时的回退） */
export const DEFAULT_INDEX_SOURCES: IndexSource[] = [
  { platform: 'github', owner: '906030538', repo: 'SectorVaultProject', branch: 'index' },
];

/** 索引仓内固定路径：未归档索引与按月归档目录 */
export const INDEX_PATHS = {
  current: 'index/current.json',
  archiveDir: 'index/archive',
} as const;

/** 部署配置文件：其 indexes 字段覆盖默认索引源，允许配置多个索引 */
export const DEPLOYMENT_CONFIG_URL = '/deployment.json';

/** 主站点仓库（discussions / wiki 来源） */
export const MAIN_REPO = {
  owner: 'SectorVault',
  name: 'sectorvault.github.io',
  branch: 'main',
};

/** 支持的 git 平台 */
export const SUPPORTED_PLATFORMS: Platform[] = ['github', 'gitee', 'atomgit'];

/** 默认许可证选项：CC0、CC4.0（含细分系列） */
export const LICENSE_OPTIONS: { value: string; label?: string; labelKey?: MessageKey }[] = [
  { value: '', labelKey: 'editor.licenseRepoDefault' },
  { value: 'CC0-1.0', label: 'CC0 1.0' },
  { value: 'CC-BY-4.0', label: 'CC BY 4.0' },
  { value: 'CC-BY-SA-4.0', label: 'CC BY-SA 4.0' },
  { value: 'CC-BY-NC-4.0', label: 'CC BY-NC 4.0' },
  { value: 'CC-BY-NC-SA-4.0', label: 'CC BY-NC-SA 4.0' },
  { value: 'CC-BY-ND-4.0', label: 'CC BY-ND 4.0' },
  { value: 'CC-BY-NC-ND-4.0', label: 'CC BY-NC-ND 4.0' },
];

/** 各平台可用的内容仓模板库（主站点静态部署配置） */
export const REPO_TEMPLATES: Partial<Record<Platform, { owner: string; repo: string }[]>> = {
  github: [{ owner: 'SectorVault', repo: 'svp-template' }],
  gitee: [{ owner: 'SectorVault', repo: 'svp-template' }],
};

/** 内容仓正文头部固定标识 */
export const POWERED_BY = 'Powered by Sector Vault Project';

/** 编辑器约束：列表值/标签上限与单文件大小软提示阈值 */
export const EDITOR_LIMITS = {
  listValues: 10,
  tags: 10,
  fileSoftLimitBytes: 10 * 1024 * 1024,
};

/** 演示模式发布管线每步模拟耗时（毫秒） */
export const MOCK_PIPELINE_STEP_DELAY = 200;

/** 开发期使用的本地模拟索引（结构同真实索引仓：current + 按月归档） */
export const MOCK_INDEX_URL = '/mock/index/current.json';
export const MOCK_ARCHIVE_BASE = '/mock/index/archive';

/** 开发期使用的本地模拟内容（正文/目录/Release/Issue） */
export const MOCK_CONTENT_URL = '/mock/content.json';
