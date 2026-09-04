import type {
  AuthInfo,
  DiscussionComment,
  DiscussionInfo,
  FileInfo,
  ReleaseReactionInfo,
  IssueInfo,
  Platform,
  ReleaseInfo,
  RepoInfo,
} from '@/types';
import { getToken } from '@/lib/auth';
import { decodeBase64Utf8 } from '@/lib/utils';
import type { FileChange, GitPlatformAdapter } from './types';

/**
 * v5 系平台通用适配器（AtomGit / GitCode，OpenAPI 同源）。
 * 读操作中 contents/issues/releases 与 raw 支持匿名访问；
 * 仓库详情与用户仓库列表要求认证，适配器内部自动附带已保存的令牌。
 * 写操作按 v5 语义实现，需真实令牌联调验证。
 */

/** UTF-8 文本 → base64（分块编码避免长内容栈溢出）；AtomGit contents 接口要求 base64 */
function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

interface V5AdapterConfig {
  platform: Platform;
  /** API 根地址（如 https://api.atomgit.com/api/v5） */
  apiBase: string;
  /** 网页根地址（链接拼接用） */
  webBase: string;
  /** raw 文件根地址（缺省同 webBase） */
  rawBase?: string;
}

interface RequestOptions {
  method?: string;
  query?: Record<string, string>;
  body?: unknown;
  /** 缺省时自动使用已保存的本平台令牌（可能为 null，即匿名） */
  token?: string | null;
}

interface AtomGitRepo {
  name?: string;
  path?: string;
  full_name?: string;
  html_url?: string;
  stargazers_count?: number;
  description?: string | null;
  license?: string | { spdx_id?: string } | null;
}

function mapRepo(user: string, repo: AtomGitRepo, webBase: string): RepoInfo {
  const name = repo.path ?? repo.name ?? '';
  const license =
    typeof repo.license === 'string'
      ? repo.license
      : (repo.license?.spdx_id ?? undefined);
  return {
    name,
    fullName: repo.full_name ?? `${user}/${name}`,
    htmlUrl: repo.html_url ?? `${webBase}/${user}/${name}`,
    stars: repo.stargazers_count ?? 0,
    description: repo.description ?? undefined,
    license,
  };
}

export class V5PlatformAdapter implements GitPlatformAdapter {
  readonly platform: Platform;
  protected readonly apiBase: string;
  private readonly webBase: string;
  private readonly rawBase: string;

  constructor(config: V5AdapterConfig) {
    this.platform = config.platform;
    this.apiBase = config.apiBase;
    this.webBase = config.webBase;
    this.rawBase = config.rawBase ?? config.webBase;
  }

  protected async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const token = options.token !== undefined ? options.token : getToken(this.platform);
    const url = new URL(`${this.apiBase}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, value);
    }
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`${this.platform} API ${response.status}: ${text.slice(0, 200)}`);
    }
    return (await response.json()) as T;
  }

  async getViewer(token: string): Promise<AuthInfo> {
    const user = await this.request<{ login: string; name?: string; avatar_url?: string }>('/user', {
      token,
    });
    return {
      platform: this.platform,
      login: user.login,
      name: user.name ?? undefined,
      avatarUrl: user.avatar_url ?? '',
    };
  }

  async listRepos(user: string, prefix?: string): Promise<RepoInfo[]> {
    // AtomGit 用户仓库接口要求认证，读取本站已保存的令牌
    const repos = await this.request<AtomGitRepo[]>(`/users/${encodeURIComponent(user)}/repos`);
    const filtered = prefix ? repos.filter((r) => (r.path ?? r.name ?? '').startsWith(prefix)) : repos;
    return filtered.map((repo) => mapRepo(user, repo, this.webBase));
  }

  async getRepo(user: string, repo: string): Promise<RepoInfo> {
    const data = await this.request<AtomGitRepo>(`/repos/${encodeURIComponent(user)}/${encodeURIComponent(repo)}`);
    return mapRepo(user, data, this.webBase);
  }

  async listDir(user: string, repo: string, path = '', ref?: string): Promise<FileInfo[]> {
    const entries = await this.request<Array<{ type: string; name: string; path: string; size?: number }>>(
      `/repos/${encodeURIComponent(user)}/${encodeURIComponent(repo)}/contents/${path}`,
      { query: ref ? { ref } : {} },
    );
    if (!Array.isArray(entries)) return [];
    return entries.map((entry) => ({
      path: entry.path,
      name: entry.name,
      type: entry.type === 'dir' ? 'dir' : 'file',
      size: entry.size ?? 0,
    }));
  }

  async readFile(user: string, repo: string, path: string, ref?: string): Promise<string> {
    const file = await this.request<{ type?: string; content?: string }>(
      `/repos/${encodeURIComponent(user)}/${encodeURIComponent(repo)}/contents/${path}`,
      { query: ref ? { ref } : {} },
    );
    if (file.type !== 'file' || !file.content) {
      throw new Error(`Not a file: ${user}/${repo}/${path}`);
    }
    return decodeBase64Utf8(file.content.replace(/\n/g, ''));
  }

  rawUrl(user: string, repo: string, path: string): string {
    return `${this.rawBase}/${user}/${repo}/raw/HEAD/${path}`;
  }

  async listReleases(user: string, repo: string): Promise<ReleaseInfo[]> {
    const releases = await this.request<Array<{
      id?: number;
      tag_name?: string;
      name?: string | null;
      body?: string | null;
      html_url?: string;
      assets?: Array<{ id?: number; name: string; size?: number; browser_download_url?: string }>;
    }>>(`/repos/${encodeURIComponent(user)}/${encodeURIComponent(repo)}/releases`);
    return (releases ?? []).map((r) => ({
      id: r.id ?? 0,
      tag: r.tag_name ?? '',
      name: r.name ?? r.tag_name ?? '',
      body: r.body ?? '',
      htmlUrl: r.html_url ?? `${this.webBase}/${user}/${repo}/releases/${r.tag_name ?? ''}`,
      reactions: 0,
      assets: (r.assets ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        size: a.size ?? 0,
        downloadUrl: a.browser_download_url ?? '',
      })),
    }));
  }

  async listIssues(user: string, repo: string): Promise<IssueInfo[]> {
    const issues = await this.request<Array<{
      number: number | string;
      title: string;
      html_url?: string;
      comments?: number;
      created_at?: string;
    }>>(`/repos/${encodeURIComponent(user)}/${encodeURIComponent(repo)}/issues`, {
      query: { state: 'open' },
    });
    return (issues ?? []).map((i) => ({
      number: Number(i.number),
      title: i.title,
      htmlUrl: i.html_url ?? `${this.webBase}/${user}/${repo}/issues/${i.number}`,
      comments: i.comments ?? 0,
      createdAt: i.created_at ?? '',
    }));
  }

  discussionsUrl(owner: string, repo: string): string {
    return `${this.webBase}/${owner}/${repo}`;
  }

  // AtomGit 仓库级 Discussions API 形态未定，暂不支持
  async listDiscussions(): Promise<DiscussionInfo[]> {
    return [];
  }

  async getDiscussion(): Promise<DiscussionInfo> {
    throw new Error('AtomGit discussions API is not supported yet');
  }

  async listDiscussionComments(): Promise<DiscussionComment[]> {
    return [];
  }

  async createDiscussionComment(): Promise<void> {
    throw new Error('AtomGit discussions API is not supported yet');
  }

  wikiUrl(owner: string, repo: string): string {
    return `${this.webBase}/${owner}/${repo}/docs`;
  }

  // ---- 写操作（v5 语义；需真实令牌联调验证） ----

  async commitFiles(
    token: string,
    user: string,
    repo: string,
    message: string,
    changes: FileChange[],
  ): Promise<void> {
    const base = `/repos/${encodeURIComponent(user)}/${encodeURIComponent(repo)}/contents`;
    for (const change of changes) {
      const path = `${base}/${change.path}`;
      if (change.delete) {
        const existing = await this.request<{ sha?: string }>(path, { token });
        if (!existing.sha) throw new Error(`Cannot resolve sha for ${change.path}`);
        await this.request(path, { method: 'DELETE', token, body: { sha: existing.sha, message } });
        continue;
      }
      // 已存在的文件走 PUT 更新，否则 POST 新建；content 一律 base64（无 encoding 字段）
      const existing = await this.request<{ sha?: string } | Array<unknown>>(path, {
        token,
      }).catch(() => null);
      const body = {
        content:
          change.encoding === 'base64' ? change.content : utf8ToBase64(change.content),
        message,
        ...(existing && !Array.isArray(existing) && existing.sha ? { sha: existing.sha } : {}),
      };
      const method = existing && !Array.isArray(existing) ? 'PUT' : 'POST';
      await this.request(path, { method, token, body });
    }
  }

  async createIssue(
    token: string,
    user: string,
    repo: string,
    title: string,
    body: string,
  ): Promise<number> {
    const data = await this.request<{ number: number | string }>(
      `/repos/${encodeURIComponent(user)}/issues`,
      { method: 'POST', token, body: { repo, title, body } },
    );
    return Number(data.number);
  }

  async createRelease(
    token: string,
    user: string,
    repo: string,
    tag: string,
    body: string,
  ): Promise<number> {
    const data = await this.request<{ id?: number }>(
      `/repos/${encodeURIComponent(user)}/${encodeURIComponent(repo)}/releases`,
      { method: 'POST', token, body: { tag_name: tag, name: tag, body } },
    );
    return data.id ?? 0;
  }

  // v5 系平台暂无公开的 release 表情互动 API
  async listReleaseReactions(): Promise<ReleaseReactionInfo[]> {
    return [];
  }

  async createReleaseReaction(): Promise<void> {
    throw new Error('AtomGit/GitCode do not support release reactions yet');
  }

  async uploadReleaseAsset(
    token: string,
    user: string,
    repo: string,
    releaseId: number,
    file: Blob,
    name: string,
  ): Promise<void> {
    void token;
    void user;
    void repo;
    void releaseId;
    void file;
    void name;
    // 实测 AtomGit/GitCode 的 release 响应不含 id、附件端点按 tag 寻址且形态未公开；
    // 未联调验证前不盲试，明确报错避免静默失败
    throw new Error('AtomGit/GitCode release 附件上传暂不支持（平台附件接口按 tag 寻址，待联调）');
  }

  async deleteReleaseAsset(
    token: string,
    user: string,
    repo: string,
    releaseId: number,
    assetId: number,
  ): Promise<void> {
    void token;
    void user;
    void repo;
    void releaseId;
    void assetId;
    throw new Error('AtomGit/GitCode release 附件管理暂不支持');
  }

  async createRepoFromTemplate(token: string, owner: string, name: string): Promise<void> {
    // AtomGit 暂无模板仓库 API：创建空仓库，由编辑器写入初始内容
    await this.request('/user/repos', {
      method: 'POST',
      token,
      body: { name, private: false, auto_init: false },
    });
    void owner;
  }

  async openIndexPr(
    token: string,
    target: { owner: string; repo: string; branch: string },
    title: string,
    changes: FileChange[],
  ): Promise<string> {
    const { owner, repo, branch } = target;
    const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    // 轻量 PR：同仓直接创建工作分支提交（无需 fork；要求令牌对索引仓有写权限）
    const prBranch = `svp-index-${Date.now().toString(36)}`;

    // 基准提交：目标索引分支头（AtomGit 分支接口的 commit 字段为 id）
    const baseBranch = await this.request<{ commit?: { id?: string; sha?: string } }>(
      `${base}/branches/${encodeURIComponent(branch)}`,
      { token },
    );
    const baseSha = baseBranch.commit?.id ?? baseBranch.commit?.sha;
    if (!baseSha) throw new Error('AtomGit: cannot resolve index branch head');

    // 创建工作分支（Gitee v5 风格；端点不存在时回退 git refs API，其他错误原样抛出）
    try {
      await this.request(`${base}/branches`, {
        method: 'POST',
        token,
        body: { branch_name: prBranch, refs: branch },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/image repository/i.test(message)) {
        throw new Error('索引仓为镜像仓库，平台禁止写入；请将其重建为普通仓库后再投稿');
      }
      if (!/\b404\b|not found/i.test(message)) throw error;
      await this.request(`${base}/git/refs`, {
        method: 'POST',
        token,
        body: { ref: `refs/heads/${prBranch}`, sha: baseSha },
      });
    }

    // 逐文件提交到工作分支（contents API 带 ref；已存在则 PUT 更新）
    for (const change of changes) {
      if (change.delete) continue;
      const path = `${base}/contents/${change.path}`;
      const existing = await this.request<{ sha?: string }>(path, {
        token,
        query: { ref: prBranch },
      }).catch(() => null);
      await this.request(path, {
        method: existing ? 'PUT' : 'POST',
        token,
        query: { ref: prBranch },
        body: {
          // content 一律 base64（AtomGit contents 接口不接受 encoding 字段）
          content:
            change.encoding === 'base64' ? change.content : utf8ToBase64(change.content),
          message: title,
          branch: prBranch,
          ...(existing?.sha ? { sha: existing.sha } : {}),
        },
      });
    }

    // 创建 PR（同仓分支：head 直用分支名）
    const pr = await this.request<{ number?: number | string; html_url?: string }>(
      `${base}/pulls`,
      {
        method: 'POST',
        token,
        body: { title, head: prBranch, base: branch, body: '*Powered by Sector Vault Project*' },
      },
    );
    return pr.html_url ?? `${this.webBase}/${owner}/${repo}/pulls/${pr.number ?? ''}`;
  }
}
