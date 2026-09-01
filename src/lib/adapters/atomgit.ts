import type { GitPlatformAdapter } from './types';

/**
 * AtomGit 适配器：设计预留的第三平台。
 * AtomGit 暂无官方 TypeScript SDK，待基于其 OpenAPI 实现。
 */
export class AtomGitAdapter implements GitPlatformAdapter {
  readonly platform = 'atomgit' as const;

  private unsupported(): never {
    throw new Error('AtomGit adapter is not implemented yet');
  }

  getViewer(): never {
    return this.unsupported();
  }
  listRepos(): never {
    return this.unsupported();
  }
  getRepo(): never {
    return this.unsupported();
  }
  listDir(): never {
    return this.unsupported();
  }
  readFile(): never {
    return this.unsupported();
  }
  rawUrl(user: string, repo: string, path: string): string {
    return `https://atomgit.com/${user}/${repo}/raw/HEAD/${path}`;
  }
  listReleases(): never {
    return this.unsupported();
  }
  listIssues(): never {
    return this.unsupported();
  }
  discussionsUrl(owner: string, repo: string): string {
    return `https://atomgit.com/${owner}/${repo}`;
  }
  wikiUrl(owner: string, repo: string): string {
    return `https://atomgit.com/${owner}/${repo}/docs`;
  }
  commitFiles(): never {
    return this.unsupported();
  }
  createIssue(): never {
    return this.unsupported();
  }
  createRelease(): never {
    return this.unsupported();
  }
  uploadReleaseAsset(): never {
    return this.unsupported();
  }
  deleteReleaseAsset(): never {
    return this.unsupported();
  }
  createRepoFromTemplate(): never {
    return this.unsupported();
  }
  openIndexPr(): never {
    return this.unsupported();
  }
}
