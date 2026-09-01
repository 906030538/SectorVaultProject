import {
  getV5ReposOwnerRepo,
  getV5ReposOwnerRepoContentsPath,
  getV5ReposOwnerRepoIssues,
  getV5ReposOwnerRepoReleases,
  getV5ReposOwnerRepoReleasesReleaseIdAttachFiles,
  getV5User,
  getV5UsersUsernameRepos,
} from '@gitee/typescript-sdk-v5';
import { client } from '@hey-api/client-axios';
import type {
  AuthInfo,
  FileInfo,
  IssueInfo,
  ReleaseInfo,
  RepoInfo,
} from '@/types';
import { decodeBase64Utf8 } from '@/lib/utils';
import type { FileChange, GitPlatformAdapter } from './types';

// baseUrl 由 hey-api-client-axios-shim.ts 设置为 https://gitee.com/api

interface GiteeProject {
  name: string;
  path: string;
  html_url: string;
  stargazers_count?: number;
  description?: string | null;
  license?: string | null;
}

function mapRepo(repo: GiteeProject): RepoInfo {
  return {
    name: repo.name,
    fullName: repo.path,
    htmlUrl: repo.html_url,
    stars: repo.stargazers_count ?? 0,
    description: repo.description ?? undefined,
    license: repo.license ?? undefined,
  };
}

export class GiteeAdapter implements GitPlatformAdapter {
  readonly platform = 'gitee' as const;

  async getViewer(token: string): Promise<AuthInfo> {
    const { data } = await getV5User({ query: { accessToken: token } });
    const user = data as { login: string; name?: string; avatar_url: string };
    return {
      platform: 'gitee',
      login: user.login,
      name: user.name ?? undefined,
      avatarUrl: user.avatar_url,
    };
  }

  async listRepos(user: string, prefix?: string): Promise<RepoInfo[]> {
    const { data } = await getV5UsersUsernameRepos({
      path: { username: user },
      query: { sort: 'pushed', perPage: 100 },
    });
    const repos = (data as GiteeProject[]) ?? [];
    const filtered = prefix ? repos.filter((r) => r.name.startsWith(prefix)) : repos;
    return filtered.map(mapRepo);
  }

  async getRepo(user: string, repo: string): Promise<RepoInfo> {
    const { data } = await getV5ReposOwnerRepo({ path: { owner: user, repo } });
    return mapRepo(data as GiteeProject);
  }

  async listDir(user: string, repo: string, path = '', ref?: string): Promise<FileInfo[]> {
    const { data } = await getV5ReposOwnerRepoContentsPath({
      path: { owner: user, repo, path },
      query: { ...(ref ? { ref } : {}) },
    });
    const entries = Array.isArray(data)
      ? (data as Array<{
          type: string;
          name: string;
          path: string;
          size?: number;
          download_url?: string | null;
        }>)
      : [];
    return entries.map((entry) => ({
      path: entry.path,
      name: entry.name,
      type: entry.type === 'dir' ? 'dir' : 'file',
      size: entry.size ?? 0,
      downloadUrl: entry.download_url ?? undefined,
    }));
  }

  async readFile(user: string, repo: string, path: string, ref?: string): Promise<string> {
    const { data } = await getV5ReposOwnerRepoContentsPath({
      path: { owner: user, repo, path },
      query: { ...(ref ? { ref } : {}) },
    });
    const file = data as { type?: string; content?: string };
    if (Array.isArray(data) || file.type !== 'file' || !file.content) {
      throw new Error(`Not a file: ${user}/${repo}/${path}`);
    }
    return decodeBase64Utf8(file.content.replace(/\n/g, ''));
  }

  rawUrl(user: string, repo: string, path: string): string {
    return `https://gitee.com/${user}/${repo}/raw/HEAD/${path}`;
  }

  async listReleases(user: string, repo: string): Promise<ReleaseInfo[]> {
    const { data } = await getV5ReposOwnerRepoReleases({
      path: { owner: user, repo },
      query: { perPage: 100 },
    });
    const releases = (data as Array<{
      id: number;
      tag_name: string;
      name?: string | null;
      body?: string | null;
      html_url?: string;
    }>) ?? [];

    return Promise.all(
      releases.map(async (r) => {
        let assets: ReleaseInfo['assets'] = [];
        try {
          const attach = await getV5ReposOwnerRepoReleasesReleaseIdAttachFiles({
            path: { owner: user, repo, releaseId: r.id },
          });
          assets = ((attach.data ?? []) as Array<{
            id?: number;
            name: string;
            size?: number;
            download_url?: string;
          }>).map((a) => ({
            id: a.id,
            name: a.name,
            size: a.size ?? 0,
            downloadUrl: a.download_url ?? '',
          }));
        } catch {
          /* 附件拉取失败时保留空列表 */
        }
        return {
          id: r.id,
          tag: r.tag_name,
          name: r.name ?? r.tag_name,
          body: r.body ?? '',
          htmlUrl: r.html_url ?? `https://gitee.com/${user}/${repo}/releases/${r.tag_name}`,
          reactions: 0,
          assets,
        };
      }),
    );
  }

  async listIssues(user: string, repo: string): Promise<IssueInfo[]> {
    const { data } = await getV5ReposOwnerRepoIssues({
      path: { owner: user, repo },
      query: { state: 'open', perPage: 100 },
    });
    const issues = (data as Array<{
      number: number | string;
      title: string;
      html_url?: string;
      comments?: number;
      created_at?: string;
    }>) ?? [];
    return issues.map((i) => ({
      number: Number(i.number),
      title: i.title,
      htmlUrl: i.html_url ?? `https://gitee.com/${user}/${repo}/issues/${i.number}`,
      comments: i.comments ?? 0,
      createdAt: i.created_at ?? '',
    }));
  }

  discussionsUrl(owner: string, repo: string): string {
    // Gitee 无 Discussions 功能，以仓库页代替
    return `https://gitee.com/${owner}/${repo}`;
  }

  wikiUrl(owner: string, repo: string): string {
    return `https://gitee.com/${owner}/${repo}/wikis`;
  }

  // ---- 写操作（SDK 未导出 POST body 类型，直接用 client） ----

  async commitFiles(
    token: string,
    user: string,
    repo: string,
    message: string,
    changes: FileChange[],
  ): Promise<void> {
    for (const change of changes) {
      if (change.delete) {
        const { data } = await getV5ReposOwnerRepoContentsPath({
          path: { owner: user, repo, path: change.path },
        });
        const sha = (data as { sha?: string }).sha;
        if (!sha) throw new Error(`Cannot resolve sha for ${change.path}`);
        await client.delete({
          url: '/v5/repos/{owner}/{repo}/contents/{path}',
          path: { owner: user, repo, path: change.path },
          body: { access_token: token, sha, message },
        });
        continue;
      }
      await client.post({
        url: '/v5/repos/{owner}/{repo}/contents/{path}',
        path: { owner: user, repo, path: change.path },
        body: {
          access_token: token,
          content: change.content,
          message,
          ...(change.encoding === 'base64' ? { encode: 'base64' } : {}),
        },
      });
    }
  }

  async createIssue(
    token: string,
    user: string,
    repo: string,
    title: string,
    body: string,
  ): Promise<number> {
    const { data } = await client.post<{ number: number | string }>({
      url: '/v5/repos/{owner}/issues',
      path: { owner: user },
      body: { access_token: token, repo, title, body },
    });
    if (!data) throw new Error('Create Gitee issue failed');
    return Number(data.number);
  }

  async createRelease(
    token: string,
    user: string,
    repo: string,
    tag: string,
    body: string,
  ): Promise<number> {
    const { data } = await client.post<{ id: number }>({
      url: '/v5/repos/{owner}/{repo}/releases',
      path: { owner: user, repo },
      body: { access_token: token, tag_name: tag, name: tag, body, target_commitish: 'master' },
    });
    if (!data) throw new Error('Create Gitee release failed');
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
    const form = new FormData();
    form.append('access_token', token);
    form.append('file', file, name);
    const response = await fetch(
      `https://gitee.com/api/v5/repos/${user}/${repo}/releases/${releaseId}/attach_files`,
      { method: 'POST', body: form },
    );
    if (!response.ok) {
      throw new Error(`Upload release asset failed: ${response.status}`);
    }
  }

  async deleteReleaseAsset(
    token: string,
    user: string,
    repo: string,
    releaseId: number,
    assetId: number,
  ): Promise<void> {
    await client.delete({
      url: '/v5/repos/{owner}/{repo}/releases/{releaseId}/attach_files/{id}',
      path: { owner: user, repo, releaseId, id: assetId },
      body: { access_token: token },
    });
  }

  async createRepoFromTemplate(token: string, owner: string, name: string): Promise<void> {
    // Gitee 无模板仓库 API，创建空仓库后由编辑器写入初始内容
    await client.post({
      url: '/v5/user/repos',
      body: { access_token: token, name, auto_init: false, private: false },
    });
    void owner;
  }

  async openIndexPr(token: string, title: string, changes: FileChange[]): Promise<string> {
    void token;
    void title;
    void changes;
    throw new Error('openIndexPr: Gitee index PR flow not implemented yet');
  }
}
