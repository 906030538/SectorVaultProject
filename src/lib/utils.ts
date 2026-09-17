import { LICENSE_FINGERPRINTS, POWERED_BY } from '@/config';

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

/** 递归按 key 排序后序列化（索引归档需要字段顺序稳定，避免编辑产生无谓 diff） */
export function stableStringify(value: unknown): string {
  const sortValue = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sortValue);
    if (input && typeof input === 'object') {
      const record = input as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(record)
          .sort()
          .map((key) => [key, sortValue(record[key])]),
      );
    }
    return input;
  };
  return JSON.stringify(sortValue(value), null, 2);
}

/** 许可证正文归一化（\r\n 归一、行尾去空白、单个末尾换行）——指纹计算与此规则一致 */
export function normalizeLicenseText(text: string): string {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''));
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return `${lines.join('\n')}\n`;
}

/** 文本 SHA-256 十六进制摘要（许可证指纹识别用） */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** LICENSE 文件正文识别为已收录的 SPDX 标识：优先哈希精确匹配，次级比对首行；未识别返回 null */
export async function identifyLicenseText(text: string): Promise<string | null> {
  const normalized = normalizeLicenseText(text);
  const firstLine = (normalized.split('\n').find((line) => line.trim()) ?? '').trim().toLowerCase();
  const hash = await sha256Hex(normalized);
  const byHash = LICENSE_FINGERPRINTS.find((item) => item.sha256 === hash);
  if (byHash) return byHash.id;
  const byLine = LICENSE_FINGERPRINTS.find(
    (item) => item.firstLine.trim().toLowerCase() === firstLine,
  );
  return byLine?.id ?? null;
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
