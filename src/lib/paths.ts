import mockIndex from '../../public/mock/index.json';

/** 演示模式：为索引中的每个用户生成用户空间静态页（真实部署需配置 SPA 回退） */
export function userStaticPaths(): { params: { name: string } }[] {
  const names = [...new Set(mockIndex.users.map((u) => u.user))];
  return names.map((name) => ({ params: { name } }));
}
