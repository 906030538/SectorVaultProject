import type {
  AuthInfo,
  FileInfo,
  IssueInfo,
  ReleaseInfo,
  RepoInfo,
} from '@/types';
import { getToken } from '@/lib/auth';
import { decodeBase64Utf8 } from '@/lib/utils';
import type { FileChange, GitPlatformAdapter } from './types';

/**
 * AtomGit 适配器：基于 OpenAPI v5（https://docs.atomgit.com，与 Gitee v5 同源）。
 * 读操作中 contents/issues/releases 与 raw 支持匿名访问；
 * 仓库详情与用户仓库列表要求认证，适配器内部自动附带已保存的令牌。
 * 写操作按 v5 语义实现，需真实令牌联调验证。
 */

const API_BASE = 'https://api.atomgit.com/api/v5';
const WEB_BASE = 'https://atomgit.com';

interface RequestOptions {
  method?: string;
  query?: Record<string, string>;
  body?: unknown;
  /** 缺省时自动使用已保存的 atomgit 令牌（可能为 null，即匿名） */
  token?: string | null;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = options.token !== undefined ? options.token : getToken('atomgit');
  const url = new URL(`${API_BASE}${path}`);
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
    throw new Error(`AtomGit API ${response.status}: ${text.slice(0, 200)}`);
  }
  return (await response.json()) as T;
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

function mapRepo(user: string, repo: AtomGitRepo): RepoInfo {
  const name = repo.path ?? repo.name ?? '';
  const license =
    typeof repo.license === 'string'
      ? repo.license
      : (repo.license?.spdx_id ?? undefined);
  return {
    name,
    fullName: repo.full_name ?? `${user}/${name}`,
    htmlUrl: repo.html_url ?? `${WEB_BASE}/${user}/${name}`,
    stars: repo.stargazers_count ?? 0,
    description: repo.description ?? undefined,
    license,
  };
}

export class AtomGitAdapter implements GitPlatformAdapter {
  readonly platform = 'atomgit' as const;

  async getViewer(token: string): Promise<AuthInfo> {
    const user = await request<{ login: string; name?: string; avatar_url?: string }>('/user', {
      token,
    });
    return {
      platform: 'atomgit',
      login: user.login,
      name: user.name ?? undefined,
      avatarUrl: user.avatar_url ?? '',
    };
  }

  async listRepos(user: string, prefix?: string): Promise<RepoInfo[]> {
    // AtomGit 用户仓库接口要求认证，读取本站已保存的令牌
    const repos = await request<AtomGitRepo[]>(`/users/${encodeURIComponent(user)}/repos`);
    const filtered = prefix ? repos.filter((r) => (r.path ?? r.name ?? '').startsWith(prefix)) : repos;
    return filtered.map((repo) => mapRepo(user, repo));
  }

  async getRepo(user: string, repo: string): Promise<RepoInfo> {
    const data = await request<AtomGitRepo>(`/repos/${encodeURIComponent(user)}/${encodeURIComponent(repo)}`);
    return mapRepo(user, data);
  }

  async listDir(user: string, repo: string, path = '', ref?: string): Promise<FileInfo[]> {
    const entries = await request<Array<{ type: string; name: string; path: string; size?: number }>>(
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
    const file = await request<{ type?: string; content?: string }>(
      `/repos/${encodeURIComponent(user)}/${encodeURIComponent(repo)}/contents/${path}`,
      { query: ref ? { ref } : {} },
    );
    if (file.type !== 'file' || !file.content) {
      throw new Error(`Not a file: ${user}/${repo}/${path}`);
    }
    return decodeBase64Utf8(file.content.replace(/\n/g, ''));
  }

  rawUrl(user: string, repo: string, path: string): string {
    return `${WEB_BASE}/${user}/${repo}/raw/HEAD/${path}`;
  }

  async listReleases(user: string, repo: string): Promise<ReleaseInfo[]> {
    const releases = await request<Array<{
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
      htmlUrl: r.html_url ?? `${WEB_BASE}/${user}/${repo}/releases/${r.tag_name ?? ''}`,
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
    const issues = await request<Array<{
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
      htmlUrl: i.html_url ?? `${WEB_BASE}/${user}/${repo}/issues/${i.number}`,
      comments: i.comments ?? 0,
      createdAt: i.created_at ?? '',
    }));
  }

  discussionsUrl(owner: string, repo: string): string {
    // AtomGit 无 Discussions，以仓库页代替
    return `${WEB_BASE}/${owner}/${repo}`;
  }

  wikiUrl(owner: string, repo: string): string {
    return `${WEB_BASE}/${owner}/${repo}/docs`;
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
        const existing = await request<{ sha?: string }>(path, { token });
        if (!existing.sha) throw new Error(`Cannot resolve sha for ${change.path}`);
        await request(path, { method: 'DELETE', token, body: { sha: existing.sha, message } });
        continue;
      }
      // 已存在的文件走 PUT 更新，否则 POST 新建
      const existing = await request<{ sha?: string } | Array<unknown>>(path, {
        token,
      }).catch(() => null);
      const body = {
        content: change.content,
        message,
        ...(change.encoding === 'base64' ? { encoding: 'base64' } : {}),
        ...(existing && !Array.isArray(existing) && existing.sha ? { sha: existing.sha } : {}),
      };
      const method = existing && !Array.isArray(existing) ? 'PUT' : 'POST';
      await request(path, { method, token, body });
    }
  }

  async createIssue(
    token: string,
    user: string,
    repo: string,
    title: string,
    body: string,
  ): Promise<number> {
    const data = await request<{ number: number | string }>(
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
    const data = await request<{ id?: number }>(
      `/repos/${encodeURIComponent(user)}/${encodeURIComponent(repo)}/releases`,
      { method: 'POST', token, body: { tag_name: tag, name: tag, body } },
    );
    return data.id ?? 0;
  }

  async uploadReleaseAsset(
    token: string,
    user: string,
    repo: string,
    releaseId: number,
    file: Blob,
    name: string,
  ): Promise<void> {
    // v5 附件风格（与 Gitee attach_files 同构）；AtomGit 附件接口需真实令牌联调验证
    const form = new FormData();
    form.append('file', file, name);
    const response = await fetch(
      `${API_BASE}/repos/${encodeURIComponent(user)}/${encodeURIComponent(repo)}/releases/${releaseId}/attach_files`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form },
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
    await request(
      `/repos/${encodeURIComponent(user)}/${encodeURIComponent(repo)}/releases/${releaseId}/attach_files/${assetId}`,
      { method: 'DELETE', token },
    );
  }

  async createRepoFromTemplate(token: string, owner: string, name: string): Promise<void> {
    // AtomGit 暂无模板仓库 API：创建空仓库，由编辑器写入初始内容
    await request('/user/repos', {
      method: 'POST',
      token,
      body: { name, private: false, auto_init: false },
    });
    void owner;
  }

  async openIndexPr(token: string, title: string, changes: FileChange[]): Promise<string> {
    void token;
    void title;
    void changes;
    throw new Error('openIndexPr: AtomGit index PR flow not implemented yet');
  }
}
