import type { Platform } from '@/types';

/**
 * 平台文件/仓库地址规则（唯一事实源）：运行期适配器 rawUrl、封面解析、
 * 构建期 SSG 数据拉取与外链渲染共用，避免多处各维护一份。
 */

/** 平台站点根（web 地址基） */
const WEB_BASE: Record<Platform, string> = {
  github: 'https://github.com',
  gitee: 'https://gitee.com',
  atomgit: 'https://atomgit.com',
};

export function webBase(platform: Platform): string {
  return WEB_BASE[platform];
}

/** 仓库内文件的 raw 直连地址（匿名可读、无 API 配额） */
export function rawFileUrl(platform: Platform, user: string, repo: string, path: string): string {
  if (platform === 'github') {
    return `https://raw.githubusercontent.com/${user}/${repo}/HEAD/${path}`;
  }
  return `${WEB_BASE[platform]}/${user}/${repo}/raw/HEAD/${path}`;
}

/** 仓库 web 主页 */
export function repoUrl(platform: Platform, user: string, repo: string): string {
  return `${WEB_BASE[platform]}/${user}/${repo}`;
}
