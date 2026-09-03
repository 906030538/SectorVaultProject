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

/** UTF-8 文本 → base64（分块编码避免长内容栈溢出） */
function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
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
    const octokit = client(token);
    // 按 tag 幂等：重试时复用已创建的 release，避免重复
    try {
      const { data: existing } = await octokit.rest.repos.getReleaseByTag({ owner: user, repo, tag });
      return existing.id;
    } catch {
      /* 不存在时创建 */
    }
    const { data } = await octokit.rest.repos.createRelease({
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

  async openIndexPr(
    token: string,
    target: { owner: string; repo: string; branch: string },
    title: string,
    changes: FileChange[],
  ): Promise<string> {
    const octokit = client(token);
    const { data: viewer } = await octokit.rest.users.getAuthenticated();
    const login = viewer.login;
    const { owner, repo, branch } = target;

    // 基准提交取自上游索引分支
    const { data: baseRef } = await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${branch}`,
    });
    const baseSha = baseRef.object.sha;

    // 分支宿主：索引仓所有者直接在上游开分支，其他用户先 fork（重复 fork 返回既有 fork）
    const sameOwner = login.toLowerCase() === owner.toLowerCase();
    let headOwner = owner;
    if (!sameOwner) {
      await octokit.rest.repos.createFork({ owner, repo });
      headOwner = login;
    }

    // 工作分支（fork 异步就绪时重试创建）
    const prBranch = `svp-index-${Date.now().toString(36)}`;
    for (let attempt = 0; ; attempt += 1) {
      try {
        await octokit.rest.git.createRef({
          owner: headOwner,
          repo,
          ref: `refs/heads/${prBranch}`,
          sha: baseSha,
        });
        break;
      } catch (error) {
        const missingRepo = /404|Not Found/i.test(String(error));
        if (attempt >= 5 || !missingRepo) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }

    // 逐文件提交到工作分支（contents API 要求 base64）
    for (const change of changes) {
      let sha: string | undefined;
      try {
        const { data } = await octokit.rest.repos.getContent({
          owner: headOwner,
          repo,
          path: change.path,
          ref: prBranch,
        });
        sha = (data as { sha?: string }).sha;
      } catch {
        /* 新文件无需 sha */
      }
      const content = change.encoding === 'base64' ? change.content : utf8ToBase64(change.content);
      await octokit.rest.repos.createOrUpdateFileContents({
        owner: headOwner,
        repo,
        path: change.path,
        branch: prBranch,
        message: title,
        content,
        ...(sha ? { sha } : {}),
      });
    }

    // PR：fork 的 head 需 "login:branch"，同仓直用分支名
    const { data: pr } = await octokit.rest.pulls.create({
      owner,
      repo,
      title,
      head: sameOwner ? prBranch : `${login}:${prBranch}`,
      base: branch,
      body: '*Powered by Sector Vault Project*',
    });
    return pr.html_url;
  }
}
