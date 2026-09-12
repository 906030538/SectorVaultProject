import DOMPurify from 'dompurify';
import { marked } from 'marked';

/** FAQ 文案 */
export interface FaqLabels {
  viewSource: string;
  loadError: string;
  empty: string;
}

export interface FaqElements {
  body: HTMLElement;
  sourceBtn: HTMLAnchorElement;
  error: HTMLElement;
}

export interface FaqInit {
  owner: string;
  repo: string;
  /** wiki 页面名（默认 Home） */
  page: string;
  labels: FaqLabels;
  els: FaqElements;
}

/** GitHub wiki 页面的 raw 地址（raw 域对 wiki 仓库开放匿名读取） */
export function wikiRawUrl(owner: string, repo: string, page: string): string {
  return `https://raw.githubusercontent.com/wiki/${owner}/${repo}/${encodeURIComponent(page)}.md`;
}

/** GitHub wiki 页面的网页地址（页名空格转连字符） */
export function wikiPageUrl(owner: string, repo: string, page: string): string {
  return `https://github.com/${owner}/${repo}/wiki/${page.replace(/\s+/g, '-')}`;
}

/** FAQ 目录条目（wiki 自定义侧栏驱动） */
export interface FaqTocEntry {
  page: string;
  label: string;
}

/**
 * 从 wiki 自定义侧栏（_Sidebar.md）解析目录：提取 `[[Page]]` / `[[Page|显示名]]`
 * 链接，保持出现顺序去重。侧栏不可用时返回 null（调用方回退 deployment.json）。
 */
export async function loadFaqSidebar(owner: string, repo: string): Promise<FaqTocEntry[] | null> {
  try {
    const response = await fetch(wikiRawUrl(owner, repo, '_Sidebar'));
    if (!response.ok) return null;
    const markdown = await response.text();
    const entries: FaqTocEntry[] = [];
    const seen = new Set<string>();
    for (const match of markdown.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)) {
      const page = (match[1] ?? '').trim();
      if (!page || seen.has(page)) continue;
      seen.add(page);
      entries.push({ page, label: (match[2] ?? '').trim() || page });
    }
    return entries.length ? entries : null;
  } catch {
    return null;
  }
}

/** wiki 链接 `[[Page]]` / `[[Page|显示名]]` 转 markdown 链接 */
function expandWikiLinks(markdown: string): string {
  return markdown.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_all, target: string, label?: string) =>
    `[${label ?? target}](/wiki/${target.trim()})`,
  );
}

/**
 * FAQ 页：从主站点仓库 wiki 加载页面内容到当前页渲染；
 * wiki 内部链接重写为站内加载，并提供跳转源按钮。
 */
export async function loadFaqPage(init: FaqInit): Promise<void> {
  const { owner, repo, page, labels, els } = init;

  els.error.hidden = true;
  els.body.textContent = '';

  let markdown: string;
  try {
    const response = await fetch(wikiRawUrl(owner, repo, page));
    if (!response.ok) throw new Error(`wiki ${response.status}`);
    markdown = await response.text();
  } catch {
    els.error.hidden = false;
    els.sourceBtn.href = wikiPageUrl(owner, repo, page);
    return;
  }

  if (!markdown.trim()) {
    els.body.textContent = labels.empty;
  } else {
    const html = marked.parse(expandWikiLinks(markdown), { async: false });
    els.body.innerHTML = DOMPurify.sanitize(html) as string;
    rewriteWikiLinks(els.body, owner, repo, init);
  }

  els.sourceBtn.href = wikiPageUrl(owner, repo, page);
}

/** 把渲染结果中的 wiki 相对链接改为站内加载（点击无刷新切换页面） */
function rewriteWikiLinks(root: HTMLElement, owner: string, repo: string, init: FaqInit): void {
  const prefixes = [`/${owner}/${repo}/wiki/`, '/wiki/'];
  for (const link of Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    const href = link.getAttribute('href') ?? '';
    const prefix = prefixes.find((p) => href.startsWith(p));
    if (!prefix) continue;
    const page = decodeURIComponent(href.slice(prefix.length)).replace(/\/+$/, '');
    if (!page) continue;
    link.href = `/faq?page=${encodeURIComponent(page)}`;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      void loadFaqPage({ ...init, page });
      window.history.replaceState(null, '', `/faq?page=${encodeURIComponent(page)}`);
    });
  }
}
