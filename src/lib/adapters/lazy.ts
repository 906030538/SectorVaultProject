import type { Platform } from '@/types';
import type { GitPlatformAdapter } from './types';

/**
 * 延迟加载平台适配器。适配器依赖 octokit 等重型 SDK，其压缩产物中的
 * 特殊语法会使 happy-dom 的模块编译器状态漂移，故不进首屏同步 chunk。
 */
export async function getAdapterAsync(platform: Platform): Promise<GitPlatformAdapter> {
  const { getAdapter } = await import('./index');
  return getAdapter(platform);
}
