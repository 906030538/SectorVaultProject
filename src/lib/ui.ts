import type { EngagementStats, SubmissionEntry } from '@/types';
import faviconUrl from '../../favicon.svg?url';
import logoSmallUrl from '../../logo-small.svg?url';
import { POSTS_DIR } from '@/config';
import { getAdapterAsync } from '@/lib/adapters/lazy';
import { withBase } from '@/lib/base';
import { getClientLocale } from '@/lib/i18n-client';
import { t } from '@/i18n';

/** 设置头像 src；加载失败时回退为站点 favicon 占位 */
export function setAvatar(img: HTMLImageElement, url: string): void {
  img.addEventListener(
    'error',
    () => {
      img.src = faviconUrl;
    },
    { once: true },
  );
  img.src = url;
}

/** 无封面/加载失败时的默认占位：logo-small.svg */
export function coverPlaceholder(): HTMLDivElement {
  const div = document.createElement('div');
  div.className =
    'flex aspect-video w-full items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800';
  const logo = document.createElement('img');
  logo.src = logoSmallUrl;
  logo.alt = '';
  logo.className = 'h-8 w-auto opacity-70';
  div.appendChild(logo);
  return div;
}

/** 封面图：解析索引 cover（完整 URL 或相对文件名）为 raw 地址后插入；无封面或加载失败时保留 logo 占位 */
export async function applyCover(entry: SubmissionEntry, coverLink: HTMLElement): Promise<void> {
  if (!entry.cover) return;
  let src: string | null = entry.cover.startsWith('http') ? entry.cover : null;
  if (!src) {
    try {
      const adapter = await getAdapterAsync(entry.platform);
      src = adapter.rawUrl(entry.owner, entry.repo, `${POSTS_DIR}/${entry.slug}/${entry.cover}`);
    } catch {
      return;
    }
  }
  const img = document.createElement('img');
  img.src = src;
  img.alt = entry.title;
  img.loading = 'lazy';
  img.className = 'aspect-video w-full rounded-lg object-cover';
  const placeholder = coverLink.querySelector('div');
  // 封面成功加载后移除 ♪ 占位；加载失败则移除图片保留占位
  img.addEventListener('load', () => placeholder?.remove());
  img.addEventListener('error', () => img.remove());
  if (placeholder) coverLink.insertBefore(img, placeholder);
  else coverLink.appendChild(img);
}

/** 接口配额超限判定（403/429 且报文含 rate limit） */
export function isRateLimitError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status?: number }).status;
    if (status === 429) return true;
    if (status !== 403) return false;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /rate limit/i.test(message);
}

/** 配额超限提示横幅（幂等单例）：登录该平台提高配额，或切换其他线路 */
export function showApiLimitNotice(platform: string): void {
  if (document.getElementById('svp-rate-limit-notice')) return;
  const locale = getClientLocale();
  const banner = document.createElement('div');
  banner.id = 'svp-rate-limit-notice';
  banner.dataset.role = 'rate-limit-notice';
  banner.className =
    'fixed inset-x-0 top-16 z-50 mx-auto flex max-w-2xl items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 shadow-lg dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200';
  const text = document.createElement('div');
  text.className = 'flex-1';
  const title = document.createElement('p');
  title.className = 'font-medium';
  title.textContent = `${t(locale, 'ratelimit.title')}（${platform}）`;
  const hint = document.createElement('p');
  hint.className = 'mt-0.5 text-xs';
  hint.textContent = t(locale, 'ratelimit.hint');
  text.append(title, hint);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn px-2 py-0.5 text-xs';
  close.dataset.action = 'dismiss-rate-limit';
  close.textContent = '×';
  close.addEventListener('click', () => banner.remove());
  banner.append(text, close);
  document.body.appendChild(banner);
}

/** 客户端列表渲染所需的文案（由页面内联 JSON 注入） */
export interface CardLabels {
  paramsWith: string;
  paramsTuned: string;
  paramsNone: string;
}

/** 卡片渲染选项 */
export interface CardOptions {
  compact?: boolean;
  /** 登录用户为稿件所有者时显示编辑/删除按钮 */
  owner?: { editLabel: string; deleteLabel: string };
  engagement?: EngagementStats;
}

function chip(text: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'chip';
  span.textContent = text;
  return span;
}

/** 以 DOM API 构建稿件卡片（避免 XSS） */
export function renderCard(
  entry: SubmissionEntry,
  locale: string,
  labels: CardLabels,
  opts: CardOptions = {},
): HTMLElement {
  const article = document.createElement('article');
  article.className = 'card flex gap-4 p-4';

  const coverLink = document.createElement('a');
  coverLink.href = withBase(`/view/${entry.owner}/${entry.repo}/${entry.slug}`);
  coverLink.className = 'block w-32 shrink-0';
  coverLink.appendChild(coverPlaceholder());
  // 有封面时异步解析并插入（完整 URL 或内容仓相对路径）
  void applyCover(entry, coverLink);

  const body = document.createElement('div');
  body.className = 'min-w-0 flex-1';

  const h3 = document.createElement('h3');
  h3.className = 'truncate font-medium';
  const titleLink = document.createElement('a');
  titleLink.href = coverLink.href;
  titleLink.className = 'hover:text-emerald-600 dark:hover:text-emerald-400';
  titleLink.textContent = entry.title;
  h3.appendChild(titleLink);

  const meta = document.createElement('p');
  meta.className = 'mt-1 text-sm text-slate-500 dark:text-slate-400';
  const userLink = document.createElement('a');
  userLink.href = withBase(`/user/${entry.owner}`);
  userLink.className = 'hover:text-emerald-600 dark:hover:text-emerald-400';
  userLink.textContent = entry.owner;
  const date = document.createElement('time');
  date.dateTime = entry.submittedAt;
  date.textContent = new Date(entry.submittedAt).toLocaleDateString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const sep = document.createElement('span');
  sep.className = 'mx-1.5';
  sep.textContent = '·';
  meta.append(userLink, sep, date);

  body.append(h3, meta);

  if (!opts.compact) {
    const chips = document.createElement('div');
    chips.className = 'mt-2 flex flex-wrap gap-1.5';
    for (const v of entry.songs ?? []) chips.appendChild(chip(`♪ ${v}`));
    for (const v of entry.engines ?? []) chips.appendChild(chip(v));
    for (const v of entry.voicebanks ?? []) chips.appendChild(chip(v));
    for (const v of entry.languages ?? []) chips.appendChild(chip(v));
    if (entry.type === 'project') {
      const paramsChip = chip(
        entry.paramState === 'with-params'
          ? labels.paramsWith
          : entry.paramState === 'tuned'
            ? labels.paramsTuned
            : labels.paramsNone,
      );
      paramsChip.classList.add('font-medium', 'text-emerald-600', 'dark:text-emerald-400');
      chips.appendChild(paramsChip);
    }
    body.appendChild(chips);
  }

  if (opts.engagement) {
    const stats = document.createElement('p');
    stats.className = 'mt-1.5 text-xs text-slate-400 dark:text-slate-500';
    stats.dataset.role = 'engagement';
    stats.textContent = `💬 ${opts.engagement.comments} · ★ ${opts.engagement.reactions}`;
    body.appendChild(stats);
  }

  if (opts.owner) {
    const actions = document.createElement('div');
    actions.className = 'mt-2 flex gap-2';
    const editBtn = document.createElement('a');
    editBtn.href = withBase(`/edit/${entry.owner}/${entry.repo}/${entry.slug}`);
    editBtn.className =
      'rounded-md border border-slate-300 px-2 py-0.5 text-xs hover:border-emerald-500 hover:text-emerald-600 dark:border-slate-600';
    editBtn.dataset.action = 'edit-submission';
    editBtn.textContent = opts.owner.editLabel;
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className =
      'rounded-md border border-slate-300 px-2 py-0.5 text-xs text-rose-600 hover:border-rose-500 dark:border-slate-600';
    deleteBtn.dataset.action = 'delete-submission';
    deleteBtn.textContent = opts.owner.deleteLabel;
    deleteBtn.addEventListener('click', () => {
      article.dispatchEvent(
        new CustomEvent('svp:delete-submission', { bubbles: true, detail: entry }),
      );
    });
    actions.append(editBtn, deleteBtn);
    body.appendChild(actions);
  }

  article.append(coverLink, body);
  return article;
}
