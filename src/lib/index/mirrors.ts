import type { Platform } from '@/types';
import { getAdapterAsync } from '@/lib/adapters/lazy';
import { getIndexSources } from './sources';

/** 镜像仓目标（由索引 index/mirrors.json 的地址解析） */
export interface MirrorTarget {
  platform: Platform;
  owner: string;
  repo: string;
}

const ADDR = /^((?:github|gitee|atomgit|gitcode)\.com)\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/;
const HOST_PLATFORM: Record<string, Platform> = {
  'github.com': 'github',
  'gitee.com': 'gitee',
  'atomgit.com': 'atomgit',
  'gitcode.com': 'gitcode',
};

function parseAddress(address: string): MirrorTarget | null {
  const match = ADDR.exec(address);
  if (!match) return null;
  const platform = HOST_PLATFORM[match[1]!];
  if (!platform) return null;
  return { platform, owner: match[2]!, repo: match[3]! };
}

/**
 * 当前仓库的镜像候选：读主索引源 index/mirrors.json，找到与该仓库同组的记录
 * （键或列表含任一平台形式的本仓地址），返回组内其余地址按列表顺序解析。
 * 源仓库地址在前（保存时约定），其余为镜像；读取失败返回空。
 */
export async function loadMirrorTargets(owner: string, repo: string): Promise<MirrorTarget[]> {
  const source = (await getIndexSources())[0];
  if (!source) return [];
  let map: Record<string, string[]>;
  try {
    const adapter = await getAdapterAsync(source.platform);
    const raw = await adapter.readFile(source.owner, source.repo, 'index/mirrors.json', source.branch);
    map = JSON.parse(raw) as Record<string, string[]>;
  } catch {
    /* mirrors.json 不存在或不可读时无镜像 */
    return [];
  }
  const selfAddresses = new Set(
    Object.keys(HOST_PLATFORM).map((host) => `${host}/${owner}/${repo}`.toLowerCase()),
  );
  for (const [key, list] of Object.entries(map)) {
    const group = [key, ...(Array.isArray(list) ? list : [])]
      .map((address) => String(address).toLowerCase());
    const self = group.find((address) => selfAddresses.has(address));
    if (!self) continue;
    return group
      .filter((address) => address !== self)
      .map(parseAddress)
      .filter((target): target is MirrorTarget => target !== null);
  }
  return [];
}
