import { Octokit } from 'octokit';
import type {
  AuthInfo,
  FileInfo,
  IssueInfo,
  ReleaseInfo,
  RepoInfo,
} from '@/types';
import type { FileChange, GitPlatformAdapter } from './types';
import { decodeBase64Utf8 } from '@/lib/utils';

function client(token?: string): Octokit {
  return token ? new Octokit({ auth: token }) : new Octokit();
}

function mapRepo(repo: {
  name: string;
  full_name: string;
  html_url: string;
  stargazers_count?: number;
  description?: string | null;
  license?: { spdx_id?: string | null } | null;
}): RepoInfo {
  return {
    name: repo.name,
    fullName: repo.full_name,
    htmlUrl: repo.html_url,
    stars: repo.stargazers_count ?? 0,
    description: repo.description ?? undefined,
    license: repo.license?.spdx_id ?? undefined,
  };
}

export class GitHubAdapter implements GitPlatformAdapter {
  readonly platform = 'github' as const;

  async getViewer(token: string): Promise<AuthInfo> {
    const { data } = await client(token).rest.users.getAuthenticated();
    return {
      platform: 'github',
      login: data.login,
      name: data.name ?? undefined,
      avatarUrl: data.avatar_url,
    };
  }

  async listRepos(user: string, prefix?: string): Promise<RepoInfo[]> {
    const { data } = await client().rest.repos.listForUser({
      username: user,
      per_page: 100,
      sort: 'pushed',
    });
    const repos = prefix ? data.filter((r) => r.name.startsWith(prefix)) : data;
    return repos.map(mapRepo);
  }

  async getRepo(user: string, repo: string): Promise<RepoInfo> {
    const { data } = await client().rest.repos.get({ owner: user, repo });
    return mapRepo(data);
  }

  async listDir(user: string, repo: string, path = '', ref?: string): Promise<FileInfo[]> {
    const { data } = await client().rest.repos.getContent({
      owner: user,
      repo,
      path,
      ...(ref ? { ref } : {}),
    });
    if (!Array.isArray(data)) return [];
    return data.map((entry) => ({
      path: entry.path,
      name: entry.name,
      type: entry.type === 'dir' ? 'dir' : 'file',
      size: 'size' in entry ? entry.size : 0,
      downloadUrl: 'download_url' in entry ? (entry.download_url ?? undefined) : undefined,
    }));
  }

  async readFile(user: string, repo: string, path: string, ref?: string): Promise<string> {
    const { data } = await client().rest.repos.getContent({
      owner: user,
      repo,
      path,
      ...(ref ? { ref } : {}),
    });
    if (Array.isArray(data) || data.type !== 'file' || !data.content) {
      throw new Error(`Not a file: ${user}/${repo}/${path}`);
    }
    return decodeBase64Utf8(data.content.replace(/\n/g, ''));
  }

  rawUrl(user: string, repo: string, path: string): string {
    return `https://raw.githubusercontent.com/${user}/${repo}/HEAD/${path}`;
  }

  async listReleases(user: string, repo: string): Promise<ReleaseInfo[]> {
    const { data } = await client().rest.repos.listReleases({
      owner: user,
      repo,
      per_page: 100,
    });
    return data.map((r) => ({
      id: r.id,
      tag: r.tag_name,
      name: r.name ?? r.tag_name,
      body: r.body ?? '',
      htmlUrl: r.html_url,
      reactions: r.reactions?.total_count ?? 0,
      assets: r.assets.map((a) => ({
        id: a.id,
        name: a.name,
        size: a.size,
        downloadUrl: a.browser_download_url,
      })),
    }));
  }

  async listIssues(user: string, repo: string): Promise<IssueInfo[]> {
    const { data } = await client().rest.issues.listForRepo({
      owner: user,
      repo,
      per_page: 100,
      state: 'open',
    });
    return data
      .filter((i) => !i.pull_request)
      .map((i) => ({
        number: i.number,
        title: i.title,
        htmlUrl: i.html_url,
        comments: i.comments,
        createdAt: i.created_at,
      }));
  }

  discussionsUrl(owner: string, repo: string): string {
    return `https://github.com/${owner}/${repo}/discussions`;
  }

  wikiUrl(owner: string, repo: string): string {
    return `https://github.com/${owner}/${repo}/wiki`;
  }

  // ---- 写操作 ----

  async commitFiles(
    token: string,
    user: string,
    repo: string,
    message: string,
    changes: FileChange[],
  ): Promise<void> {
    const octokit = client(token);
    const { data: refData } = await octokit.rest.git.getRef({
      owner: user,
      repo,
      ref: 'heads/main',
    });
    const baseCommit = refData.object.sha;
    const { data: baseTree } = await octokit.rest.git.getTree({
      owner: user,
      repo,
      tree_sha: baseCommit,
    });

    const tree = await Promise.all(
      changes.map(async (change) => {
        if (change.delete) {
          return { path: change.path, mode: '100644' as const, type: 'blob' as const, sha: null };
        }
        const { data: blob } = await octokit.rest.git.createBlob({
          owner: user,
          repo,
          content: change.content,
          encoding: change.encoding ?? 'utf-8',
        });
        return { path: change.path, mode: '100644' as const, type: 'blob' as const, sha: blob.sha };
      }),
    );

    const { data: newTree } = await octokit.rest.git.createTree({
      owner: user,
      repo,
      base_tree: baseTree.sha,
      tree,
    });
    const { data: commit } = await octokit.rest.git.createCommit({
      owner: user,
      repo,
      message,
      tree: newTree.sha,
      parents: [baseCommit],
    });
    await octokit.rest.git.updateRef({
      owner: user,
      repo,
      ref: 'heads/main',
      sha: commit.sha,
    });
  }

  async createIssue(
    token: string,
    user: string,
    repo: string,
    title: string,
    body: string,
  ): Promise<number> {
    const { data } = await client(token).rest.issues.create({
      owner: user,
      repo,
      title,
      body,
    });
    return data.number;
  }

  async createRelease(
    token: string,
    user: string,
    repo: string,
    tag: string,
    body: string,
  ): Promise<number> {
    const { data } = await client(token).rest.repos.createRelease({
      owner: user,
      repo,
      tag_name: tag,
      name: tag,
      body,
    });
    return data.id;
  }

  async uploadReleaseAsset(
    token: string,
    user: string,
    repo: string,
    releaseId: number,
    file: Blob,
    name: string,
  ): Promise<void> {
    const octokit = client(token);
    const { data: release } = await octokit.rest.repos.getRelease({
      owner: user,
      repo,
      release_id: releaseId,
    });
    const uploadUrl = release.upload_url.replace(/\{.*\}$/, '');
    const response = await fetch(`${uploadUrl}?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
      },
      body: file,
    });
    if (!response.ok) {
      throw new Error(`Upload release asset failed: ${response.status}`);
    }
  }

  async deleteReleaseAsset(
    token: string,
    user: string,
    repo: string,
    _releaseId: number,
    assetId: number,
  ): Promise<void> {
    await client(token).rest.repos.deleteReleaseAsset({
      owner: user,
      repo,
      asset_id: assetId,
    });
  }

  async createRepoFromTemplate(
    token: string,
    owner: string,
    name: string,
    template: { owner: string; repo: string },
  ): Promise<void> {
    await client(token).rest.repos.createUsingTemplate({
      template_owner: template.owner,
      template_repo: template.repo,
      owner,
      name,
      private: false,
    });
  }

  async openIndexPr(token: string, title: string, changes: FileChange[]): Promise<string> {
    // TODO: 完整实现为跨仓库轻量 PR（fork 索引仓 → 更新索引行 → 发起 PR）。
    // 框架阶段先直连索引分支提交（要求 token 对索引仓有写权限）。
    void token;
    void title;
    void changes;
    throw new Error('openIndexPr: fork-based index PR flow not implemented yet');
  }
}
