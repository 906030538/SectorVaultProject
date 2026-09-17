import type { Platform } from './types';
import type { MessageKey } from './i18n';

export const SITE_NAME = 'SVP - Sector Vault Project';

/** 内容仓固定前缀：内置回退值，deployment.json 的 repoPrefix 可覆盖（新建集合对话框） */
export const CONTENT_REPO_PREFIX = 'svp-';

/** 内容仓数据目录：投稿目录为 posts/[slug]（DESIGN.md 内容仓结构） */
export const POSTS_DIR = 'posts';

/**
 * slug 合法字符（与索引仓 schema/submission.schema.json 的 pattern 保持一致）：
 * ASCII 字母数字、下划线、连字符、平假名/片假名、CJK 汉字（含扩展A与兼容）、谚文。
 * 不含空格、点、斜杠与全角符号。
 */
export const SLUG_PATTERN = /^[0-9A-Za-z_\-\u3041-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7A3\u3130-\u318F]+$/;

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

/** FAQ 目录回退列表（wiki 页面名；deployment.json 的 faqPages 可覆盖） */
export const DEFAULT_FAQ_PAGES: string[] = ['Home', '项目介绍', '内容管理', '用户帐户-注册'];

/** OAuth 提供方配置（deployment.json 的 oauth 段或构建环境变量注入） */
export interface OAuthProviderConfig {
  clientId: string;
  /** GitHub App 设备流 clientId（与 OAuth App 的 clientId 相互独立） */
  appClientId?: string;
  /** 隐式公开的机密（静态站点无法保密，仅自部署场景使用） */
  clientSecret?: string;
  authorizeUrl?: string;
  /** 网页流令牌交换端点（authorization_code，服务端代理注入 secret） */
  tokenUrl?: string;
  /** 设备授权码端点（GitHub App 设备流）；默认走站内 /gh-oauth 代理避免 CORS */
  deviceCodeUrl?: string;
  /** 设备流轮询令牌端点；与网页流 tokenUrl 分开（无 secret，client_id 为 App ID） */
  deviceTokenUrl?: string;
  scope?: string;
}

/** 各平台 token 交换直连端点（无 Functions 代理的静态部署回退用；需 clientSecret） */
export const DIRECT_TOKEN_ENDPOINTS: Partial<Record<Platform, string>> = {
  github: 'https://github.com/login/oauth/access_token',
  gitee: 'https://gitee.com/oauth/token',
  atomgit: 'https://atomgit.com/oauth/token',
};

/** 各平台 OAuth 默认端点（tokenUrl / deviceCodeUrl 指向站内 Functions 代理，secret 留在服务端环境变量） */
export const DEFAULT_OAUTH_ENDPOINTS: Partial<Record<Platform, { authorizeUrl: string; tokenUrl: string; deviceCodeUrl?: string; deviceTokenUrl?: string; scope: string }>> = {
  github: {
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: '/oauth/github/token',
    deviceCodeUrl: '/gh-oauth/device/code',
    deviceTokenUrl: '/gh-oauth/access_token',
    scope: 'repo',
  },
  gitee: {
    authorizeUrl: 'https://gitee.com/oauth/authorize',
    tokenUrl: '/oauth/gitee/token',
    scope: 'projects issues user_info',
  },
  atomgit: {
    authorizeUrl: 'https://atomgit.com/oauth/authorize',
    tokenUrl: '/oauth/atomgit/token',
    scope: 'user info',
  },
};

/** 主站点仓库（discussions / wiki 来源） */
export const MAIN_REPO = {
  owner: 'SectorVault',
  name: 'sectorvault.github.io',
  branch: 'main',
};

/** 支持的 git 平台 */
export const SUPPORTED_PLATFORMS: Platform[] = ['github', 'gitee', 'atomgit', 'gitcode'];

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

/**
 * 已收录许可证标准正文的指纹：正文归一化（\r\n 归一为 \n、行尾去空白、单个末尾换行）
 * 后取 SHA-256。同一许可证收录多来源文本——GitHub licenses API（管线写入 LICENSE 的正文源）
 * 与 CC 官方 legalcode.txt（用户手贴正文），用于 LICENSE 文件内容识别；firstLine 供哈希未命中时的次级比对。
 */
export const LICENSE_FINGERPRINTS: { sha256: string; id: string; firstLine: string }[] = [
  { sha256: 'a2010f343487d3f7618affe54f789f5487602331c0a8d03f49e9a7c547cf0499', id: 'CC0-1.0', firstLine: 'Creative Commons Legal Code' },
  { sha256: 'f5b745ef98087f531e719ee8ca6a96809444573ecc7173c6fa68eaad39b3cc3f', id: 'CC-BY-4.0', firstLine: 'Attribution 4.0 International' },
  { sha256: '9e5f1b3c610b9c2da5c313bf81d577a7d1acec686bdb0384edefa6df0f90cd94', id: 'CC-BY-4.0', firstLine: 'Attribution 4.0 International' },
  { sha256: '2003829cf643d61b00a76088dd31bb11b8029546f24c56b39fd492adb9281483', id: 'CC-BY-SA-4.0', firstLine: 'Attribution-ShareAlike 4.0 International' },
  { sha256: '23ee78c8bae49cf08ea2f0c84945c66b987ebe4520881fb51b3dad4fb43d07c2', id: 'CC-BY-SA-4.0', firstLine: 'Attribution-ShareAlike 4.0 International' },
  { sha256: '3711f963c05d0be80d53e5923308a6dee31b203da23435c9cfb7c7b6e4dd5e19', id: 'CC-BY-NC-4.0', firstLine: 'Attribution-NonCommercial 4.0 International' },
  { sha256: '1349a4b6148492b44f629e64eed676612e234fe9a839e4f3b277c1482c8849f1', id: 'CC-BY-NC-SA-4.0', firstLine: 'Attribution-NonCommercial-ShareAlike 4.0 International' },
  { sha256: '00b6b2ffad0a8a99a0497b6474d16296adb91a9d9d83dd745d3148176aa16b7e', id: 'CC-BY-ND-4.0', firstLine: 'Attribution-NoDerivatives 4.0 International' },
  { sha256: 'f7f28b8c7a1af76b9874ca6d040e8b1eb6768fd1043106c9d315090ea96754e7', id: 'CC-BY-NC-ND-4.0', firstLine: 'Attribution-NonCommercial-NoDerivatives 4.0 International' },
];

/** SPDX 摘要构件（CC deed 风格），按语言组合出许可证展开卡的摘要文本 */
const LICENSE_SUMMARY_BLOCKS: Record<string, { base: string; by: string; nc: string; nd: string; sa: string; cc0: string }> = {
  'zh-Hans': {
    base: '您可以自由地共享（复制、再分发本作品于任何媒介与格式）与演绎（修改、转换、在此基础上创作）。',
    by: '署名：必须给出适当的署名、提供许可协议链接，并标明是否作过修改。',
    nc: '非商业性：不得将本作品用于商业目的。',
    nd: '禁止演绎：再分发时必须提供完整原文，不得修改、转换或在此基础上创作。',
    sa: '相同方式共享：演绎作品必须以与原作品相同的许可协议分发。',
    cc0: '本作品已被其作者贡献至公共领域，在法律允许的范围内，您可以出于任何目的自由复制、修改、分发与使用，无需署名。',
  },
  'zh-Hant': {
    base: '您可以自由地共享（複製、再分發本作品於任何媒介與格式）與演繹（修改、轉換、在此基礎上創作）。',
    by: '署名：必須給出適當的署名、提供授權條款連結，並標明是否作過修改。',
    nc: '非商業性：不得將本作品用於商業目的。',
    nd: '禁止演繹：再分發時必須提供完整原文，不得修改、轉換或在此基礎上創作。',
    sa: '相同方式共享：演繹作品必須以與原作品相同的授權條款分發。',
    cc0: '本作品已被其作者貢獻至公共領域，在法律允許的範圍內，您可以出於任何目的自由複製、修改、分發與使用，無需署名。',
  },
  en: {
    base: 'You are free to share (copy and redistribute in any medium or format) and adapt (remix, transform, and build upon).',
    by: 'Attribution: appropriate credit, a license link, and an indication of changes must be given.',
    nc: 'NonCommercial: the material may not be used for commercial purposes.',
    nd: 'NoDerivatives: the material must be redistributed verbatim without changes.',
    sa: 'ShareAlike: adaptations must be licensed under the same license as the original.',
    cc0: 'This work has been dedicated to the public domain; you may copy, modify, distribute and use it for any purpose without attribution, to the extent permitted by law.',
  },
  ja: {
    base: 'いかなる媒体や形式でも、共有（複製・再配布）および演繹（改変・変換・二次創作）が自由に行えます。',
    by: '表示：適切なクレジット表記とライセンスへのリンク、変更の有無の明示が必要です。',
    nc: '非営利：本作品を営利目的で利用してはなりません。',
    nd: '改変禁止：改変せずそのまま再配布しなければなりません。',
    sa: '継承：二次的作品は元の作品と同じライセンスで配布する必要があります。',
    cc0: '本作品はパブリックドメインに提供されています。法律の許す範囲で、表示なしにあらゆる目的で複製・改変・配布・利用できます。',
  },
};

/** 许可证摘要（deed 风格组合文本）；未收录的标识返回 null */
export function licenseSummary(id: string, locale: string): string | null {
  const blocks = LICENSE_SUMMARY_BLOCKS[locale] ?? LICENSE_SUMMARY_BLOCKS.en!;
  if (id === 'CC0-1.0') return blocks.cc0;
  const parts = [blocks.base, blocks.by];
  if (id.includes('-NC')) parts.push(blocks.nc);
  if (id.includes('-ND')) parts.push(blocks.nd);
  if (id.endsWith('-SA-4.0')) parts.push(blocks.sa);
  return parts.length > 1 ? parts.join('\n') : null;
}

/** 许可证外链：SPDX 页面（无语言变体）+ CC deed（有当前语言版本时提供） */
export function licenseLinks(id: string, locale: string): { spdx: string; deed?: string } {
  const links: { spdx: string; deed?: string } = { spdx: `https://spdx.org/licenses/${id}.html` };
  const lang = locale === 'zh-Hans' ? 'zh' : locale === 'zh-Hant' ? 'zh-Hant' : locale;
  if (id === 'CC0-1.0') {
    links.deed = `https://creativecommons.org/publicdomain/zero/1.0/deed.${lang}`;
    return links;
  }
  // CC-BY-4.0 → by、CC-BY-NC-SA-4.0 → by-nc-sa
  const cc = id.match(/^CC-(BY(?:-NC)?(?:-SA|-ND)?)-4\.0$/);
  if (cc) links.deed = `https://creativecommons.org/licenses/${cc[1]!.toLowerCase()}/4.0/deed.${lang}`;
  return links;
}

/** 内容仓模板仓列表：由 deployment.json 的 templates 按平台配置（见 src/lib/index/sources.ts） */

/** 内容仓正文头部固定标识 */
export const POWERED_BY = 'Powered by Sector Vault Project';

/** 编辑器约束：列表值/标签上限与单文件大小软提示阈值 */
export const EDITOR_LIMITS = {
  listValues: 10,
  tags: 10,
  fileSoftLimitBytes: 10 * 1024 * 1024,
};

/**
 * 列表输入的下拉候选（可按部署配置；datalist 不限制自由输入）。
 * 仅合成引擎 / 使用声库 / 歌曲语言提供建议。
 */
export const LIST_CANDIDATES: Partial<Record<'engines' | 'voicebanks' | 'songLanguages', string[]>> = {
  engines: [
    'VOCALOID',
    'Synthesizer V',
    'Synthesizer V 2',
    'VoiSona',
    'OpenUtau',
    'ACE Studio',
    'XStudio',
    'CeVIO AI',
    'UTAU',
    'piapro studio',
  ],
  voicebanks: [
    '初音ミク',
    '重音テト',
    '星尘',
    '洛天依',
    '乐正绫',
    'POPY',
    'ROSE',
    'PASTEL',
    'HALO',
    'AVER',
  ],
  songLanguages: ['zh', 'ja', 'en', 'ko', 'es', 'zh-yue', 'zh-nan', 'zh-hak'],
};
