import { zipSync } from 'fflate';
import { EDITOR_LIMITS } from '@/config';

/** 工程文件上传方案（DESIGN §编辑器 8） */
export type UploadScheme = 'raw' | 'format' | 'zip' | 'encrypt';

/** 编辑器中的一个工程文件条目 */
export interface EditorFile {
  id: string;
  file: File | null;
  name: string;
  scheme: UploadScheme;
  /** 仅 encrypt 方案使用 */
  password: string;
  /** json/xml 探测结果（决定默认方案） */
  textLike: boolean;
  /** 编辑模式下来自旧 README 的行；方案不可再修改 */
  existing?: { compressed: boolean; encrypted: boolean };
}

export function newEditorFileId(): string {
  return crypto.randomUUID();
}

/** json/xml 探测：扩展名 + 首部非空白字符嗅探 */
export async function detectTextLike(file: File): Promise<boolean> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (ext !== 'json' && ext !== 'xml') return false;
  try {
    const head = (await file.slice(0, 512).text()).trimStart();
    return head.startsWith('{') || head.startsWith('<');
  } catch {
    return ext === 'json' || ext === 'xml';
  }
}

export function defaultScheme(textLike: boolean): UploadScheme {
  return textLike ? 'format' : 'raw';
}

export async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

/** base64 编码（分块，避免大文件栈溢出） */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function prettyJson(text: string): string {
  return JSON.stringify(JSON.parse(text), null, 2);
}

/**
 * 最小 XML 折行缩进器（演示级：按标签切分维护深度；
 * 属性值内含 > 会误切，<?...?> 与 <!-- --> 不加深缩）。
 */
export function prettyXml(text: string): string {
  // 用字符串方法而非正则切分标签（happy-dom 的模块编译器无法解析正则字面量）
  const tokens: string[] = [];
  for (const piece of text.split('\n').join(' ').split('><')) {
    tokens.push(piece.startsWith('<') ? piece : piece.endsWith('>') ? piece : `<${piece}>`);
  }
  const out: string[] = [];
  let depth = 0;
  for (const raw of tokens) {
    const token = raw.trim();
    if (!token) continue;
    const isClosing = token.startsWith('</');
    const isSelfContained =
      token.endsWith('/>') ||
      token.startsWith('<?') ||
      token.startsWith('<!--') ||
      token.startsWith('<![CDATA[');
    if (isClosing) depth = Math.max(0, depth - 1);
    out.push(`${'  '.repeat(depth)}${token}`);
    const isOpening =
      token.startsWith('<') &&
      !isClosing &&
      !isSelfContained &&
      !token.startsWith('<!') &&
      !token.startsWith('<?');
    if (isOpening) depth += 1;
  }
  return out.join('\n');
}

/** 按方案产出可写入仓库的内容 */
export async function processFile(
  file: File,
  scheme: UploadScheme,
  password?: string,
): Promise<{ content: string; encoding: 'utf-8' | 'base64' }> {
  const bytes = await readFileBytes(file);

  if (scheme === 'format') {
    const text = new TextDecoder().decode(bytes);
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const pretty = ext === 'json' ? prettyJson(text) : prettyXml(text);
    return { content: pretty, encoding: 'utf-8' };
  }

  if (scheme === 'zip') {
    const zipped = zipSync({ [file.name]: bytes });
    return { content: bytesToBase64(zipped), encoding: 'base64' };
  }

  if (scheme === 'encrypt') {
    if (!password) throw new Error('Encryption password is required');
    // @zip.js/zip.js 只能在函数体内动态导入（模块级 import.meta.url 破坏 happy-dom）
    const { ZipWriter, Uint8ArrayReader, Uint8ArrayWriter } = await import('@zip.js/zip.js');
    const writer = new Uint8ArrayWriter();
    const zipWriter = new ZipWriter(writer, { password, zipCrypto: true });
    await zipWriter.add(file.name, new Uint8ArrayReader(bytes), { password });
    const zipped = await zipWriter.close();
    return { content: bytesToBase64(zipped), encoding: 'base64' };
  }

  return { content: bytesToBase64(bytes), encoding: 'base64' };
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function isOversize(file: File): boolean {
  return file.size > EDITOR_LIMITS.fileSoftLimitBytes;
}
