import type { IndexFile, SubmissionEntry, UserRecord } from '@/types';
import current from '../../public/mock/index/current.json';
import archive202603 from '../../public/mock/index/archive/2026-03.json';
import archive202604 from '../../public/mock/index/archive/2026-04.json';
import archive202605 from '../../public/mock/index/archive/2026-05.json';
import archive202606 from '../../public/mock/index/archive/2026-06.json';
import archive202607 from '../../public/mock/index/archive/2026-07.json';
import archive202608 from '../../public/mock/index/archive/2026-08.json';
import archive202609 from '../../public/mock/index/archive/2026-09.json';

/** 演示模式静态可用的完整索引（current + 全部归档，与 loadMockIndex 同口径） */
const archives = [
  archive202603,
  archive202604,
  archive202605,
  archive202606,
  archive202607,
  archive202608,
  archive202609,
] as unknown as IndexFile[];

export const mockCurrent = current as unknown as IndexFile;
export const mockSubmissions: SubmissionEntry[] = [
  ...mockCurrent.submissions,
  ...archives.flatMap((file) => file.submissions),
];

const mergedUsers: UserRecord[] = [];
for (const file of [mockCurrent, ...archives]) {
  for (const user of file.users) {
    const existing = mergedUsers.find((u) => u.platform === user.platform && u.owner === user.owner);
    if (existing) {
      const repos = new Set((existing.repos ?? []).map((r) => r.repo));
      for (const ref of user.repos ?? []) repos.add(ref.repo);
      existing.repos = [...repos].map((repo) => ({ repo }));
    } else {
      mergedUsers.push(user);
    }
  }
}
export const mockUsers: UserRecord[] = mergedUsers;

/** 演示模式：为索引中的每个用户生成用户空间静态页（真实部署需配置 SPA 回退） */
export function userStaticPaths(): { params: { name: string } }[] {
  const names = [...new Set(mockUsers.map((u) => u.owner))];
  return names.map((name) => ({ params: { name } }));
}

/** 演示模式：集合详情与稿件详情的静态路径 */
export function viewStaticPaths(): { params: { path: string } }[] {
  const paths = new Set<string>();
  for (const user of mockUsers) {
    for (const ref of user.repos ?? []) paths.add(`${user.owner}/${ref.repo}`);
  }
  for (const sub of mockSubmissions) paths.add(`${sub.owner}/${sub.repo}/${sub.slug}`);
  return Array.from(paths).map((path) => ({ params: { path } }));
}

/** 演示模式：编辑页静态路径 */
export function editStaticPaths(): { params: { name: string; repo: string; slug: string } }[] {
  return mockSubmissions.map((sub) => ({
    params: { name: sub.owner, repo: sub.repo, slug: sub.slug },
  }));
}
