/** base64 解码为 UTF-8 文本（替代已废弃的 escape/atob 组合） */
export function decodeBase64Utf8(base64: string): string {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}
