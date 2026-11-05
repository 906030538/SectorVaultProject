import type { IndexFile, SubmissionEntry, UserRecord } from '@/types';

/**
 * 索引文件合并纯函数（同构）：客户端 loader 与构建期 SSG 数据加载共用。
 * 稿件按唯一键去重（先到先得），用户记录按平台+用户名合并（repos 取并集）。
 */

export function submissionKey(entry: SubmissionEntry): string {
  return `${entry.platform}:${entry.owner}/${entry.repo}/${entry.slug}`;
}

/** 用户记录合并（同 rebuild.mjs：按平台+用户名合并，repos 取并集） */
export function mergeUserRecords(target: UserRecord[], incoming: UserRecord[]): void {
  for (const user of incoming) {
    const existing = target.find((u) => u.platform === user.platform && u.owner === user.owner);
    if (!existing) {
      target.push({ ...user, repos: (user.repos ?? []).map((r) => ({ ...r })) });
      continue;
    }
    const repos = new Set((existing.repos ?? []).map((r) => r.repo));
    for (const ref of user.repos ?? []) repos.add(ref.repo);
    existing.repos = [...repos].map((repo) => ({ repo }));
    existing.displayName = existing.displayName ?? user.displayName;
    existing.avatar = existing.avatar ?? user.avatar;
    existing.pagesUrl = existing.pagesUrl ?? user.pagesUrl;
  }
}

/** 合并多个索引文件：稿件按唯一键去重（先到先得），用户记录合并 */
export function mergeIndexFiles(files: IndexFile[]): IndexFile {
  const merged: IndexFile = { submissions: [], users: [] };
  const seen = new Set<string>();
  for (const file of files) {
    for (const submission of file.submissions) {
      const key = submissionKey(submission);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.submissions.push(submission);
    }
    mergeUserRecords(merged.users, file.users);
  }
  return merged;
}
