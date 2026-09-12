import { Octokit } from 'octokit';
import type {
  AuthInfo,
  DiscussionCategoryInfo,
  DiscussionComment,
  DiscussionInfo,
  FileInfo,
  IssueCommentInfo,
  IssueReactionInfo,
  ReleaseReactionInfo,
  IssueInfo,
  ReleaseInfo,
  RepoInfo,
} from '@/types';
import type { CreateRepoOptions, FileChange, GitPlatformAdapter, PlatformUserProfile, RepoOwnerChoice } from './types';
import { baseRepoReadme, decodeBase64Utf8, emptyLocalArchive, fetchGetTimeout, spdxLicenseText } from '@/lib/utils';
import { getToken } from '@/lib/auth';
import { notifyAuthExpired } from '@/lib/auth-expired';

/** 附带已保存令牌的请求返回 401 时视为登录过期（匿名可用的接口）：清除登录态并弹窗提示 */
function watchExpiredToken(fetchImpl: typeof fetch, token?: string): typeof fetch {
  return async (input, init) => {
    const response = await fetchImpl(input, init);
    if (response.status === 401 && token && token === getToken('github')) {
      notifyAuthExpired('github');
    }
    return response;
  };
}

function client(token?: string): Octokit {
  // 读请求带超时（被墙域名的挂起连接 20s 后中止），写操作透传原生 fetch；
  // 关闭自动重试：超时场景下重试会把等待放大到 4×20s
  const request = { fetch: watchExpiredToken(fetchGetTimeout, token), retries: 0 };
  return token ? new Octokit({ auth: token, request }) : new Octokit({ request });
}

/**
 * 读请求客户端：自动附带已保存的 GitHub 令牌
 * （登录后 5000 次/小时，匿名仅 60 次/小时，配额极易耗尽）。
 */
function autoClient(): Octokit {
  return client(getToken('github') ?? undefined);
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
  readonly supportsRepoTemplate = true;

  async getViewer(token: string): Promise<AuthInfo> {
    const { data } = await client(token).rest.users.getAuthenticated();
    return {
      platform: 'github',
      login: data.login,
      name: data.name ?? undefined,
      email: data.email ?? undefined,
      avatarUrl: data.avatar_url,
    };
  }

  async getUser(user: string): Promise<PlatformUserProfile> {
    const { data } = await autoClient().rest.users.getByUsername({ username: user });
    return {
      login: data.login,
      name: data.name ?? undefined,
      avatarUrl: data.avatar_url,
    };
  }

  async listRepos(user: string, prefix?: string): Promise<RepoInfo[]> {
    const { data } = await autoClient().rest.repos.listForUser({
      username: user,
      per_page: 100,
      sort: 'pushed',
    });
    const repos = prefix ? data.filter((r) => r.name.startsWith(prefix)) : data;
    return repos.map(mapRepo);
  }

  async getRepo(user: string, repo: string): Promise<RepoInfo> {
    const { data } = await autoClient().rest.repos.get({ owner: user, repo });
    return mapRepo(data);
  }

  async listDir(user: string, repo: string, path = '', ref?: string): Promise<FileInfo[]> {
    const { data } = await autoClient().rest.repos.getContent({
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
    const { data } = await autoClient().rest.repos.getContent({
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
    const { data } = await autoClient().rest.repos.listReleases({
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
    const { data } = await autoClient().rest.issues.listForRepo({
      owner: user,
      repo,
      per_page: 100,
      state: 'all',
    });
    return data
      .filter((i) => !i.pull_request)
      .map((i) => ({
        number: i.number,
        title: i.title,
        htmlUrl: i.html_url,
        comments: i.comments,
        createdAt: i.created_at,
        state: i.state === 'closed' ? ('closed' as const) : ('open' as const),
      }));
  }

  async updateIssueState(
    token: string,
    user: string,
    repo: string,
    issueNumber: number | string,
    state: 'open' | 'closed',
  ): Promise<void> {
    await client(token).rest.issues.update({
      owner: user,
      repo,
      issue_number: Number(issueNumber),
      state,
    });
  }

  async listIssueComments(
    user: string,
    repo: string,
    issueNumber: number | string,
  ): Promise<IssueCommentInfo[]> {
    const { data } = await autoClient().rest.issues.listComments({
      owner: user,
      repo,
      issue_number: Number(issueNumber),
      per_page: 100,
    });
    return (Array.isArray(data) ? data : []).map((c) => ({
      id: c.id,
      author: c.user?.login,
      authorUrl: c.user?.html_url,
      avatarUrl: c.user?.avatar_url ?? undefined,
      body: c.body ?? '',
      createdAt: c.created_at,
      htmlUrl: c.html_url,
    }));
  }

  async createIssueComment(
    token: string,
    user: string,
    repo: string,
    issueNumber: number | string,
    body: string,
  ): Promise<IssueCommentInfo | null> {
    const { data } = await client(token).rest.issues.createComment({
      owner: user,
      repo,
      issue_number: Number(issueNumber),
      body,
    });
    return {
      id: data.id,
      author: data.user?.login,
      authorUrl: data.user?.html_url,
      avatarUrl: data.user?.avatar_url ?? undefined,
      body: data.body ?? body,
      createdAt: data.created_at,
      htmlUrl: data.html_url,
    };
  }

  async deleteIssueComment(
    token: string,
    user: string,
    repo: string,
    commentId: number,
  ): Promise<void> {
    await client(token).rest.issues.deleteComment({ owner: user, repo, comment_id: commentId });
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
    const { data } = await autoClient().request('GET /repos/{owner}/{repo}/discussions', {
      owner: user,
      repo,
      per_page: 50,
    });
    return (Array.isArray(data) ? (data as GithubDiscussion[]) : []).map((d) => this.mapDiscussion(d));
  }

  async listDiscussionCategories(user: string, repo: string): Promise<DiscussionCategoryInfo[]> {
    // REST 无公开的分类列表端点（/discussions/categories 404），
    // 从讨论列表的 category 字段去重推导（覆盖使用中的分类）
    const { data } = await autoClient().request('GET /repos/{owner}/{repo}/discussions', {
      owner: user,
      repo,
      per_page: 100,
    });
    const items = Array.isArray(data)
      ? (data as Array<{ category?: { id: number; name: string; emoji?: string; description?: string } }>)
      : [];
    const seen = new Set<number>();
    const categories: DiscussionCategoryInfo[] = [];
    for (const item of items) {
      const category = item.category;
      if (!category || seen.has(category.id)) continue;
      seen.add(category.id);
      categories.push({
        id: category.id,
        name: category.name,
        emoji: category.emoji,
        description: category.description,
      });
    }
    return categories;
  }

  async createDiscussion(
    token: string,
    user: string,
    repo: string,
    title: string,
    body: string,
    categoryId: number | string,
  ): Promise<string | null> {
    const { data } = await client(token).request('POST /repos/{owner}/{repo}/discussions', {
      owner: user,
      repo,
      title,
      body,
      category_id: Number(categoryId),
    });
    return (data as { html_url?: string }).html_url ?? null;
  }

  async getDiscussion(user: string, repo: string, number: number): Promise<DiscussionInfo> {
    const { data } = await autoClient().request('GET /repos/{owner}/{repo}/discussions/{discussion_number}', {
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
    const { data } = await autoClient().request(
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
    author?: { name: string; email?: string },
  ): Promise<void> {
    const octokit = client(token);
    // refs API 在分支头被并发推进时报 "Update is not a fast forward"：
    // 重取基准引用后整体重试
    for (let attempt = 0; ; attempt += 1) {
      try {
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
          // git 提交作者（缺省用令牌身份）；接口要求 email，缺失时用平台 noreply 地址
          ...(author?.name
            ? { author: { name: author.name, email: author.email ?? `${author.name}@users.noreply.github.com` } }
            : {}),
        });
        await octokit.rest.git.updateRef({
          owner: user,
          repo,
          ref: 'heads/main',
          sha: commit.sha,
        });
        return;
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        // 分支头被并发推进时递增退避重试（0.8s/1.6s/2.4s/3.2s）
        if (attempt >= 4 || !/not a fast forward/i.test(text)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
      }
    }
  }

  async createIssue(
    token: string,
    user: string,
    repo: string,
    title: string,
    body: string,
  ): Promise<number | string> {
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

  // ---- Release 表情互动（repo reactions REST） ----

  async listReleaseReactions(
    user: string,
    repo: string,
    releaseId: number,
  ): Promise<ReleaseReactionInfo[]> {
    // 匿名 GET 会被 CDN 缓存（点赞后读不到新数据），自动附带已存令牌
    const { data } = await autoClient().request(
      'GET /repos/{owner}/{repo}/releases/{release_id}/reactions',
      { owner: user, repo, release_id: releaseId, per_page: 100 },
    );
    const items = Array.isArray(data)
      ? (data as Array<{ id: number; content: string; user?: { login: string } | null }>)
      : [];
    return items.map((r) => ({ id: r.id, content: r.content, user: r.user?.login }));
  }

  async createReleaseReaction(
    token: string,
    user: string,
    repo: string,
    releaseId: number,
  ): Promise<number | null> {
    // 已点过赞时平台返回 200（幂等）
    const { data } = (await client(token).request(
      'POST /repos/{owner}/{repo}/releases/{release_id}/reactions',
      { owner: user, repo, release_id: releaseId, content: '+1' },
    )) as { data: { id: number } };
    return data?.id ?? null;
  }

  async listIssueReactions(
    user: string,
    repo: string,
    issueNumber: number | string,
  ): Promise<IssueReactionInfo[]> {
    const { data } = await autoClient().request(
      'GET /repos/{owner}/{repo}/issues/{issue_number}/reactions',
      { owner: user, repo, issue_number: Number(issueNumber), per_page: 100 },
    );
    const items = Array.isArray(data)
      ? (data as Array<{ id: number; content: string; user?: { login: string } | null }>)
      : [];
    return items.map((r) => ({ id: r.id, content: r.content, user: r.user?.login }));
  }

  async createIssueReaction(
    token: string,
    user: string,
    repo: string,
    issueNumber: number | string,
  ): Promise<number | null> {
    // 已添加过时平台返回 200（幂等）
    const { data } = (await client(token).request(
      'POST /repos/{owner}/{repo}/issues/{issue_number}/reactions',
      { owner: user, repo, issue_number: Number(issueNumber), content: '+1' },
    )) as { data: { id: number } };
    return data?.id ?? null;
  }

  async deleteIssueReaction(
    token: string,
    user: string,
    repo: string,
    issueNumber: number | string,
    reactionId: number,
  ): Promise<void> {
    // issue 表情的删除端点嵌套在 issue 下（非 /issues/reactions/{id}）
    await client(token).request(
      'DELETE /repos/{owner}/{repo}/issues/{issue_number}/reactions/{reaction_id}',
      { owner: user, repo, issue_number: Number(issueNumber), reaction_id: reactionId },
    );
  }

  async deleteReleaseReaction(
    token: string,
    user: string,
    repo: string,
    releaseId: number,
    reactionId: number,
  ): Promise<void> {
    // release 表情的删除端点嵌套在 release 下（非旧版 /reactions/{id}）
    await client(token).request(
      'DELETE /repos/{owner}/{repo}/releases/{release_id}/reactions/{reaction_id}',
      { owner: user, repo, release_id: releaseId, reaction_id: reactionId },
    );
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

  async deleteRelease(
    token: string,
    user: string,
    repo: string,
    releaseId: number | string,
  ): Promise<void> {
    // GitHub release id 均在安全整数范围内
    await client(token).rest.repos.deleteRelease({
      owner: user,
      repo,
      release_id: Number(releaseId),
    });
  }

  async updateReleaseBody(
    token: string,
    user: string,
    repo: string,
    releaseId: number | string,
    body: string,
  ): Promise<void> {
    await client(token).rest.repos.updateRelease({
      owner: user,
      repo,
      release_id: Number(releaseId),
      body,
    });
  }

  async listOwners(token: string): Promise<RepoOwnerChoice[]> {
    const octokit = client(token);
    const { data: viewer } = await octokit.rest.users.getAuthenticated();
    const owners: RepoOwnerChoice[] = [{ login: viewer.login, kind: 'user' }];
    try {
      const { data: orgs } = await octokit.rest.orgs.listForAuthenticatedUser({ per_page: 100 });
      for (const org of orgs) {
        if (org.login.toLowerCase() !== viewer.login.toLowerCase()) {
          owners.push({ login: org.login, kind: 'org' });
        }
      }
    } catch {
      /* 组织列表不可用时仅个人账户 */
    }
    return owners;
  }

  async createRepo(token: string, options: CreateRepoOptions): Promise<void> {
    const { owner, name, template, license, licenseText } = options;
    const octokit = client(token);
    const { data: viewer } = await octokit.rest.users.getAuthenticated();
    const isOrg = owner.toLowerCase() !== viewer.login.toLowerCase();

    if (template) {
      await octokit.rest.repos.createUsingTemplate({
        template_owner: template.owner,
        template_repo: template.repo,
        owner,
        name,
        private: false,
      });
    } else if (isOrg) {
      // auto_init 生成首个提交，git data API 的 commitFiles 才能定位 heads/main
      await octokit.rest.repos.createInOrg({ org: owner, name, private: false, auto_init: true });
    } else {
      await octokit.rest.repos.createForAuthenticatedUser({ name, private: false, auto_init: true });
    }

    // 模板仓自带基础结构；空仓库创建时补必要文件，许可证按选择写入根 LICENSE
    const changes: FileChange[] = [];
    if (!template) {
      changes.push(
        { path: 'README.md', content: baseRepoReadme(name), encoding: 'utf-8' },
        { path: 'svp-archive.json', content: emptyLocalArchive(), encoding: 'utf-8' },
      );
    }
    const licenseContent = licenseText ?? (license ? await spdxLicenseText(license) : null);
    if (licenseContent) {
      changes.push({ path: 'LICENSE', content: licenseContent, encoding: 'utf-8' });
    }
    if (!changes.length) return;
    // 仓库异步就绪（模板生成/auto_init）时短暂重试
    for (let attempt = 0; ; attempt += 1) {
      try {
        await this.commitFiles(token, owner, name, 'Initialize Sector Vault Project repository', changes);
        return;
      } catch (error) {
        const transient = /404|not found|409|empty/i.test(String(error));
        if (attempt >= 2 || !transient) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
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

    // 工作分支（fork 异步就绪时重试创建）。
    // 既有 fork 的索引分支会落后于上游：先把 fork 的索引分支 ref 强制快进到上游头
    // （fork 网络共享对象库，可直接指向上游 sha；即「Sync fork」的实现），
    // 再以该 sha 建工作分支；同步失败时退回 fork 自身分支头
    // （提交内容本就基于上游最新归档构建，仍可干净合并）
    const prBranch = `svp-index-${Date.now().toString(36)}`;
    let refSha = baseSha;
    for (let attempt = 0; ; attempt += 1) {
      try {
        if (!sameOwner) {
          try {
            await octokit.rest.git.updateRef({
              owner: headOwner,
              repo,
              ref: `heads/${branch}`,
              sha: baseSha,
              force: true,
            });
          } catch {
            const { data } = await octokit.rest.git.getRef({
              owner: headOwner,
              repo,
              ref: `heads/${branch}`,
            });
            refSha = data.object.sha;
          }
        }
        await octokit.rest.git.createRef({
          owner: headOwner,
          repo,
          ref: `refs/heads/${prBranch}`,
          sha: refSha,
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
