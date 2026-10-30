// 构建期拉取敏感词包 → public/dict-pack.bin（npm run build 的 prebuild 钩子）。
// 词包来自私有仓 906030538/dict-resources 的 data/dict-pack.bin（SVPX 容器，无明文）。
// 来源优先级：DICT_PACK_FILE（本地文件，开发用）> DICT_PACK_TOKEN / GITHUB_TOKEN
// （CI secret，经 GitHub contents API raw 拉取）。无可用来源时静默跳过——
// 构建不依赖词包，站点功能照常，客户端敏感过滤自动停用（fail-open）。
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'dict-pack.bin');
const REPO = '906030538/dict-resources';
const PATH_IN_REPO = 'data/dict-pack.bin';

mkdirSync(dirname(OUT), { recursive: true });

async function main() {
  const localFile = process.env.DICT_PACK_FILE;
  if (localFile && existsSync(localFile)) {
    copyFileSync(localFile, OUT);
    console.log(`[dict-pack] copied from DICT_PACK_FILE: ${localFile}`);
    return;
  }
  const token = process.env.DICT_PACK_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    console.log('[dict-pack] 无 token（DICT_PACK_TOKEN/GITHUB_TOKEN），跳过；站点敏感过滤将停用（fail-open）');
    return;
  }
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${PATH_IN_REPO}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.raw' },
  });
  if (!res.ok) {
    console.warn(`[dict-pack] 拉取失败 HTTP ${res.status}，跳过；站点敏感过滤将停用（fail-open）`);
    return;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 21 || buf.subarray(0, 4).toString('latin1') !== 'SVPX') {
    console.warn('[dict-pack] 响应不是 SVPX 容器，跳过（token 权限或路径异常）');
    return;
  }
  const { writeFileSync } = await import('node:fs');
  writeFileSync(OUT, buf);
  console.log(`[dict-pack] fetched ${(buf.length / 1024).toFixed(0)}KB -> public/dict-pack.bin`);
}

main().catch((e) => {
  console.warn(`[dict-pack] 拉取异常（${e.message}），跳过；站点敏感过滤将停用（fail-open）`);
});
