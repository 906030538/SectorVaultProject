import { POWERED_BY } from '@/config';

/** base64 解码为 UTF-8 文本（替代已废弃的 escape/atob 组合） */
export function decodeBase64Utf8(base64: string): string {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

/** 内容仓 README.md 缺失时的基础结构 */
export function baseRepoReadme(repo: string): string {
  return `# ${repo}\n\n*${POWERED_BY}*\n`;
}

/** 内容仓本地索引初始内容（svp-archive.json） */
export function emptyLocalArchive(): string {
  return `${JSON.stringify({ submissions: [] }, null, 2)}\n`;
}

/**
 * SPDX 许可证全文：取不到时回退为 SPDX 标识声明。
 * 文本源为 GitHub licenses API（匿名可用，受速率限制）。
 */
export async function spdxLicenseText(license: string): Promise<string> {
  try {
    const response = await fetch(`https://api.github.com/licenses/${license.toLowerCase()}`);
    if (response.ok) {
      const body = ((await response.json()) as { body?: string }).body;
      if (body) return body;
    }
  } catch {
    /* 文本不可用时回退声明式内容 */
  }
  return `${license}\n\nSPDX-License-Identifier: ${license}\n\n*${POWERED_BY}*\n`;
}
