import { Octokit } from 'octokit';
import type {
  AuthInfo,
  DiscussionComment,
  DiscussionInfo,
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

/** Blob → base64（分块编码避免大文件栈溢出） */
async function blobToBase64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** GitHub Discussion（repo discussions REST） */
interface GithubDiscussion {
  number: number;
  title: string;
  html_url: string;
  body?: string;
  created_at: string;
  updated_at?: string;
  comments: number;
  user?: { login: string; html_url: string } | null;
  category?: { name?: string } | null;
  state?: string;
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

  // ---- Discussions（repo 级 REST 端点未收录于 octokit 快照，request 直调） ----

  mapDiscussion(d: GithubDiscussion): DiscussionInfo {
    return {
      number: d.number,
      title: d.title,
      htmlUrl: d.html_url,
      body: d.body ?? '',
      createdAt: d.created_at,
      updatedAt: d.updated_at,
      comments: d.comments,
      author: d.user?.login,
      authorUrl: d.user?.html_url,
      category: d.category?.name,
      state: d.state,
    };
  }

  async listDiscussions(user: string, repo: string): Promise<DiscussionInfo[]> {
    const { data } = await client().request('GET /repos/{owner}/{repo}/discussions', {
      owner: user,
      repo,
      per_page: 50,
    });
    return (Array.isArray(data) ? (data as GithubDiscussion[]) : []).map((d) => this.mapDiscussion(d));
  }

  async getDiscussion(user: string, repo: string, number: number): Promise<DiscussionInfo> {
    const { data } = await client().request('GET /repos/{owner}/{repo}/discussions/{discussion_number}', {
      owner: user,
      repo,
      discussion_number: number,
    });
    return this.mapDiscussion(data as GithubDiscussion);
  }

  async listDiscussionComments(
    user: string,
    repo: string,
    number: number,
  ): Promise<DiscussionComment[]> {
    const { data } = await client().request(
      'GET /repos/{owner}/{repo}/discussions/{discussion_number}/comments',
      { owner: user, repo, discussion_number: number, per_page: 50 },
    );
    const items = Array.isArray(data)
      ? (data as Array<{
          id: number;
          html_url: string;
          body: string;
          created_at: string;
          user?: { login: string; html_url: string } | null;
          reactions?: { total_count?: number };
        }>)
      : [];
    return items.map((c) => ({
      id: c.id,
      author: c.user?.login,
      authorUrl: c.user?.html_url,
      body: c.body,
      createdAt: c.created_at,
      htmlUrl: c.html_url,
      reactions: c.reactions?.total_count ?? 0,
    }));
  }

  async createDiscussionComment(
    token: string,
    user: string,
    repo: string,
    number: number,
    body: string,
  ): Promise<void> {
    await client(token).request(
      'POST /repos/{owner}/{repo}/discussions/{discussion_number}/comments',
      { owner: user, repo, discussion_number: number, body },
    );
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
    // uploads.github.com 不支持浏览器跨域（CORS 预检 400），
    // 附件改经 api.github.com 的 contents API 提交到内容仓 attachments/{tag}/
    const octokit = client(token);
    const { data: release } = await octokit.rest.repos.getRelease({
      owner: user,
      repo,
      release_id: releaseId,
    });
    const path = `attachments/${release.tag_name}/${name}`;
    await octokit.rest.repos.createOrUpdateFileContents({
      owner: user,
      repo,
      path,
      message: `Upload attachment ${name}`,
      content: await blobToBase64(file),
    });
  }

  async deleteReleaseAsset(
    token: string,
    user: string,
    repo: string,
    releaseId: number,
    assetId: number,
  ): Promise<void> {
    // 附件存于仓库（不在 release 下）：按 release 附件表反查文件名后删除仓库文件
    const octokit = client(token);
    const { data: release } = await octokit.rest.repos.getRelease({
      owner: user,
      repo,
      release_id: releaseId,
    });
    const asset = release.assets.find((a) => a.id === assetId);
    if (!asset?.name) return;
    const path = `attachments/${release.tag_name}/${asset.name}`;
    let sha: string;
    try {
      const { data: content } = await octokit.rest.repos.getContent({ owner: user, repo, path });
      sha = (content as { sha?: string }).sha ?? '';
    } catch {
      return; // 仓库中已不存在
    }
    if (!sha) return;
    await octokit.rest.repos.deleteFile({
      owner: user,
      repo,
      path,
      message: `Delete attachment ${asset.name}`,
      sha,
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
