import type { Platform } from '@/types';
import type { GitPlatformAdapter } from './types';
import { GitHubAdapter } from './github';
import { GiteeAdapter } from './gitee';
import { AtomGitAdapter } from './atomgit';

const adapters: Record<Platform, GitPlatformAdapter> = {
  github: new GitHubAdapter(),
  gitee: new GiteeAdapter(),
  atomgit: new AtomGitAdapter(),
};

export function getAdapter(platform: Platform): GitPlatformAdapter {
  return adapters[platform];
}

export type { FileChange, GitPlatformAdapter } from './types';
