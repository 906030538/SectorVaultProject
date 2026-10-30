// 敏感内容过滤门：懒加载词包到内存（模块级单例，SPA 会话内复用），
// 对稿件正文/评论/讨论内容打分，超阈值时不渲染原文、改显示灰色已屏蔽框。
// 词包缺失（未配置构建 token、拉取或解析失败）时停用过滤（fail-open），永不阻塞渲染。
// 词包由 scripts/fetch-dict-pack.mjs 在构建期注入 public/dict-pack.bin，不入库。
import { SENSITIVE_SCAN } from '@/config';
import { withBase } from '@/lib/base';
import { buildMatcher, type SensitiveMatcher } from './scorer';

let matcherPromise: Promise<SensitiveMatcher | null> | null = null;

function loadMatcher(): Promise<SensitiveMatcher | null> {
  matcherPromise ??= (async () => {
    try {
      const res = await fetch(withBase(SENSITIVE_SCAN.packUrl), {
        signal: AbortSignal.timeout(20_000),
        cache: 'force-cache',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return buildMatcher(new Uint8Array(await res.arrayBuffer()));
    } catch (e) {
      console.warn('[sensitive] 词包不可用，内容过滤停用（fail-open）:', e);
      return null;
    }
  })();
  return matcherPromise;
}

/** 预热：在内容请求发起的同时并行加载词包（详情/讨论页进入时调用一次） */
export function warmupSensitive(): void {
  void loadMatcher();
}

/** 内容是否应被屏蔽；kind: body=长文本（正文） short=短文本（评论，信号权重 ×2） */
export async function screenContent(text: string | null | undefined, kind: 'body' | 'short'): Promise<boolean> {
  if (!text || !text.trim()) return false;
  const matcher = await loadMatcher();
  if (!matcher) return false;
  const { total, perCategory } = matcher.score(text, kind === 'short' ? 2 : 1);
  const catMax = Math.max(0, ...Object.values(perCategory));
  return total >= SENSITIVE_SCAN.threshold || catMax >= SENSITIVE_SCAN.perCategory;
}

/** 灰色已屏蔽框：替换原始内容渲染 */
export function renderBlockedBox(target: HTMLElement, title: string, hint: string): void {
  target.textContent = '';
  const box = document.createElement('div');
  box.className =
    'card flex items-center justify-center gap-3 border-dashed p-8 text-center text-sm text-slate-400 dark:text-slate-500';
  box.dataset.role = 'sensitive-blocked';
  const icon = document.createElement('span');
  icon.className = 'text-xl text-slate-300 dark:text-slate-600';
  icon.textContent = '🚫';
  const text = document.createElement('div');
  text.className = 'flex flex-col gap-1';
  const t1 = document.createElement('p');
  t1.className = 'font-medium';
  t1.textContent = title;
  const t2 = document.createElement('p');
  t2.textContent = hint;
  text.append(t1, t2);
  box.append(icon, text);
  target.appendChild(box);
}
