import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { getAdapterAsync } from '@/lib/adapters/lazy';
import { getIndexSources } from '@/lib/index/sources';
import { getToken, loadSession } from '@/lib/auth';
import type { IndexSource } from '@/config';
import type { Platform } from '@/types';
import type { DiscussionComment, DiscussionInfo } from '@/types';

export interface DiscussionsLabels {
  title: string;
  description: string;
  open: string;
  none: string;
  loadError: string;
  comments: string;
  viewOriginal: string;
  reply: string;
  replyPlaceholder: string;
  replySubmit: string;
  replyPosting: string;
  replySuccess: string;
  replyFailed: string;
  replyLoginHint: string;
  back: string;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/** 平台徽标 */
function platformChip(platform: Platform): HTMLElement {
  const chip = el('span', 'chip', platform);
  chip.dataset.platform = platform;
  return chip;
}

/** 讨论归属源（含平台），详情路由参数由此而来 */
export interface DiscussionSourceRef extends IndexSource { }

export interface DiscussionListElements {
  list: HTMLElement;
  empty: HTMLElement;
  error: HTMLElement;
  loading: HTMLElement;
}

/** 讨论列表：遍历全部索引源，聚合各仓库的讨论（按更新时间倒序） */
export async function initDiscussionList(
  locale: string,
  labels: DiscussionsLabels,
  els: DiscussionListElements,
): Promise<void> {
  const sources = await getIndexSources();
  const items: { source: IndexSource; discussion: DiscussionInfo }[] = [];
  for (const source of sources) {
    try {
      const adapter = await getAdapterAsync(source.platform);
      const discussions = await adapter.listDiscussions(source.owner, source.repo);
      for (const discussion of discussions) {
        items.push({ source, discussion });
      }
    } catch {
      /* 单个源不可用时跳过 */
    }
  }
  items.sort(
    (a, b) =>
      (b.discussion.updatedAt ?? b.discussion.createdAt).localeCompare(
        a.discussion.updatedAt ?? a.discussion.createdAt,
      ),
  );

  els.loading.hidden = true;
  if (!items.length) {
    els.empty.hidden = false;
    return;
  }

  for (const { source, discussion } of items) {
    const card = el('a', 'card flex flex-col gap-2 p-4');
    card.href = `/discussions/${source.platform}/${source.owner}/${source.repo}/${discussion.number}`;
    card.dataset.role = 'discussion-card';

    const head = el('div', 'flex flex-wrap items-center gap-2');
    head.appendChild(platformChip(source.platform));
    if (discussion.category) head.appendChild(el('span', 'chip', discussion.category));
    if (discussion.state === 'closed') head.appendChild(el('span', 'chip text-slate-400', discussion.state));
    const title = el('span', 'min-w-0 flex-1 truncate font-medium', discussion.title);
    head.appendChild(title);
    card.appendChild(head);

    const meta = el('p', 'text-xs text-slate-400 dark:text-slate-500');
    const author = discussion.author
      ? `${discussion.author} · `
      : '';
    meta.textContent = `${author}${formatDate(discussion.updatedAt ?? discussion.createdAt, locale)} · 💬 ${discussion.comments} ${labels.comments}`;
    card.appendChild(meta);
    els.list.appendChild(card);
  }
}

export interface DiscussionDetailElements {
  title: HTMLElement;
  meta: HTMLElement;
  body: HTMLElement;
  comments: HTMLElement;
  actions: HTMLElement;
  reply: HTMLElement;
}

export interface DiscussionDetailInit {
  platform: Platform;
  owner: string;
  repo: string;
  number: number;
  locale: string;
  labels: DiscussionsLabels;
  els: DiscussionDetailElements;
}

function renderComment(
  comment: DiscussionComment,
  locale: string,
  labels: DiscussionsLabels,
): HTMLElement {
  const card = el('article', 'card p-4');
  card.dataset.role = 'discussion-comment';
  const head = el('p', 'text-sm');
  const author = el('span', 'font-medium', comment.author ?? '?');
  head.append(
    author,
    el('span', 'mx-1.5 text-slate-400', '·'),
    el('span', 'text-xs text-slate-400', formatDate(comment.createdAt, locale)),
  );
  if (comment.reactions) {
    head.append(el('span', 'ml-2 text-xs text-slate-400', `👍 ${comment.reactions}`));
  }
  if (comment.htmlUrl) {
    const link = el('a', 'ml-2 text-xs text-emerald-600 hover:underline dark:text-emerald-400', labels.viewOriginal);
    link.href = comment.htmlUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    head.appendChild(link);
  }
  card.appendChild(head);

  const body = el('div', 'prose-svp mt-2 text-sm');
  const html = marked.parse(comment.body, { async: false });
  body.innerHTML = DOMPurify.sanitize(html) as string;
  card.appendChild(body);
  return card;
}

function renderReplyBox(
  init: DiscussionDetailInit,
  onPosted: () => void,
): HTMLElement {
  const { labels } = init;
  const box = el('div', 'card flex flex-col gap-2 p-4');
  box.dataset.role = 'reply-box';
  box.appendChild(el('h3', 'text-sm font-semibold', labels.reply));

  const textarea = el('textarea', 'input min-h-24');
  textarea.placeholder = labels.replyPlaceholder;
  textarea.setAttribute('data-field', 'reply-body');

  const status = el('p', 'hidden text-sm');
  const submit = el('button', 'btn btn-primary self-start', labels.replySubmit);
  submit.type = 'button';
  submit.dataset.action = 'submit-reply';
  submit.addEventListener('click', async () => {
    const body = textarea.value.trim();
    if (!body) return;
    submit.disabled = true;
    submit.textContent = labels.replyPosting;
    status.classList.add('hidden');
    try {
      const token = getToken(init.platform);
      if (!token) throw new Error('missing token');
      const adapter = await getAdapterAsync(init.platform);
      await adapter.createDiscussionComment(token, init.owner, init.repo, init.number, body);
      textarea.value = '';
      status.className = 'text-sm text-emerald-600';
      status.textContent = labels.replySuccess;
      status.classList.remove('hidden');
      onPosted();
    } catch {
      status.className = 'text-sm text-rose-600';
      status.textContent = labels.replyFailed;
      status.classList.remove('hidden');
    } finally {
      submit.disabled = false;
      submit.textContent = labels.replySubmit;
    }
  });

  box.append(textarea, status, submit);
  return box;
}

/** 讨论详情：标题/正文/评论列表 + 平台跳转按钮 + 同平台回复框 */
export async function initDiscussionDetail(init: DiscussionDetailInit): Promise<void> {
  const { platform, owner, repo, number, locale, labels, els } = init;
  const adapter = await getAdapterAsync(platform);

  const [discussion, comments] = await Promise.all([
    adapter.getDiscussion(owner, repo, number),
    adapter.listDiscussionComments(owner, repo, number).catch(() => [] as DiscussionComment[]),
  ]);

  document.title = `${discussion.title} - Sector Vault Project`;
  els.title.textContent = discussion.title;

  const meta = el('p', 'flex flex-wrap items-center gap-2 text-sm text-slate-500 dark:text-slate-400');
  meta.appendChild(platformChip(platform));
  if (discussion.category) meta.appendChild(el('span', 'chip', discussion.category));
  const author = discussion.author
    ? discussion.authorUrl
      ? (() => {
        const link = el('a', 'hover:text-emerald-600 dark:hover:text-emerald-400', discussion.author!);
        link.href = discussion.authorUrl!;
        link.target = '_blank';
        link.rel = 'noopener';
        return link;
      })()
      : el('span', undefined, discussion.author)
    : el('span');
  meta.append(
    author,
    el('span', 'mx-1.5', '·'),
    el('span', undefined, formatDate(discussion.createdAt, locale)),
    el('span', 'mx-1.5', '·'),
    el('span', undefined, `💬 ${discussion.comments} ${labels.comments}`),
  );
  els.meta.textContent = '';
  els.meta.appendChild(meta);

  const html = marked.parse(discussion.body ?? '', { async: false });
  els.body.innerHTML = DOMPurify.sanitize(html) as string;

  // 评论列表
  els.comments.textContent = '';
  if (comments.length) {
    for (const comment of comments) {
      els.comments.appendChild(renderComment(comment, locale, labels));
    }
  } else {
    els.comments.appendChild(el('p', 'text-sm text-slate-400', '–'));
  }

  // 跳转平台讨论页按钮
  els.actions.textContent = '';
  const original = el('a', 'btn', `${labels.viewOriginal} ↗`);
  original.href = discussion.htmlUrl;
  original.target = '_blank';
  original.rel = 'noopener';
  original.dataset.action = 'goto-discussion';
  els.actions.appendChild(original);

  // 回复框：仅登录平台与讨论平台一致时展示
  const session = loadSession();
  els.reply.textContent = '';
  if (session?.login && session.platform === platform) {
    const reload = async (): Promise<void> => {
      const fresh = await adapter
        .listDiscussionComments(owner, repo, number)
        .catch(() => [] as DiscussionComment[]);
      els.comments.textContent = '';
      for (const comment of fresh) {
        els.comments.appendChild(renderComment(comment, locale, labels));
      }
    };
    els.reply.appendChild(renderReplyBox(init, () => void reload()));
  } else {
    els.reply.appendChild(el('p', 'text-sm text-slate-400', labels.replyLoginHint));
  }
}
