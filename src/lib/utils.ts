import { POWERED_BY } from '@/config';

/** GET 读请求超时：被墙/失联域名的连接会长期 pending（iOS 无代理时尤甚），
 *  不设超时页面会永久停在加载态。仅限读取；写操作（上传/提交）不受限。 */
const GET_TIMEOUT_MS = 20_000;

/**
 * 带超时的 fetch：GET 请求到时直接放弃等待并抛错（Promise.race 式，
 * 不依赖 abort 在各层的传播），同时尽力中止底层连接；其余方法原样透传。
 */
export async function fetchGetTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = init?.method?.toUpperCase() ?? 'GET';
  if (method !== 'GET') return fetch(input, init);
  const outer = init?.signal;
  const controller = new AbortController();
  const relay = (): void => controller.abort();
  outer?.addEventListener('abort', relay, { once: true });
  const request = fetch(input, { ...init, signal: controller.signal });
  request.catch(() => {
    /* 超时放弃后底层请求迟到的失败不再上报 */
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<Response>((resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`fetch timeout after ${GET_TIMEOUT_MS / 1000}s: ${String(input)}`));
      }, GET_TIMEOUT_MS);
      request.then(resolve, reject);
    });
  } finally {
    if (timer) clearTimeout(timer);
    outer?.removeEventListener('abort', relay);
  }
}

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
    const response = await fetchGetTimeout(`https://api.github.com/licenses/${license.toLowerCase()}`);
    if (response.ok) {
      const body = ((await response.json()) as { body?: string }).body;
      if (body) return body;
    }
  } catch {
    /* 文本不可用时回退声明式内容 */
  }
  return `${license}\n\nSPDX-License-Identifier: ${license}\n\n*${POWERED_BY}*\n`;
}
