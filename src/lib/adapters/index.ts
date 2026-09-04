import type { Platform } from '@/types';
import type { GitPlatformAdapter } from './types';
import { GitHubAdapter } from './github';
import { GiteeAdapter } from './gitee';
import { V5PlatformAdapter } from './atomgit';

const adapters: Record<Platform, GitPlatformAdapter> = {
  github: new GitHubAdapter(),
  gitee: new GiteeAdapter(),
  atomgit: new V5PlatformAdapter({
    platform: 'atomgit',
    apiBase: 'https://api.atomgit.com/api/v5',
    webBase: 'https://atomgit.com',
  }),
  gitcode: new V5PlatformAdapter({
    platform: 'gitcode',
    apiBase: 'https://api.gitcode.com/api/v5',
    webBase: 'https://gitcode.com',
    rawBase: 'https://raw.gitcode.com',
  }),
};

export function getAdapter(platform: Platform): GitPlatformAdapter {
  return adapters[platform];
}

export type { FileChange, GitPlatformAdapter } from './types';
