import type { EngagementStats, SubmissionEntry } from '@/types';

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
  coverLink.href = `/view/${entry.user}/${entry.repo}/${entry.slug}`;
  coverLink.className = 'block w-32 shrink-0';
  if (entry.cover?.startsWith('http')) {
    const img = document.createElement('img');
    img.src = entry.cover;
    img.alt = entry.title;
    img.loading = 'lazy';
    img.className = 'aspect-video w-full rounded-lg object-cover';
    coverLink.appendChild(img);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className =
      'flex aspect-video w-full items-center justify-center rounded-lg bg-slate-100 text-2xl text-slate-300 dark:bg-slate-800 dark:text-slate-600';
    placeholder.textContent = '♪';
    coverLink.appendChild(placeholder);
  }

  const body = document.createElement('div');
  body.className = 'min-w-0 flex-1';

  const h3 = document.createElement('h3');
  h3.className = 'truncate font-medium';
  const titleLink = document.createElement('a');
  titleLink.href = coverLink.href;
  titleLink.className = 'hover:text-indigo-600 dark:hover:text-indigo-400';
  titleLink.textContent = entry.title;
  h3.appendChild(titleLink);

  const meta = document.createElement('p');
  meta.className = 'mt-1 text-sm text-slate-500 dark:text-slate-400';
  const userLink = document.createElement('a');
  userLink.href = `/user/${entry.user}`;
  userLink.className = 'hover:text-indigo-600 dark:hover:text-indigo-400';
  userLink.textContent = entry.user;
  const date = document.createElement('time');
  date.dateTime = entry.date;
  date.textContent = new Date(entry.date).toLocaleDateString(locale, {
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
    for (const v of entry.tracks ?? []) chips.appendChild(chip(`♪ ${v}`));
    for (const v of entry.engines ?? []) chips.appendChild(chip(v));
    for (const v of entry.voicebanks ?? []) chips.appendChild(chip(v));
    for (const v of entry.songLanguages ?? []) chips.appendChild(chip(v));
    if (entry.type === 'project') {
      const paramsChip = chip(
        entry.params === 'with-params'
          ? labels.paramsWith
          : entry.params === 'tuned'
            ? labels.paramsTuned
            : labels.paramsNone,
      );
      paramsChip.classList.add('font-medium', 'text-indigo-600', 'dark:text-indigo-400');
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
    editBtn.href = `/edit/${entry.user}/${entry.repo}/${entry.slug}`;
    editBtn.className =
      'rounded-md border border-slate-300 px-2 py-0.5 text-xs hover:border-indigo-500 hover:text-indigo-600 dark:border-slate-600';
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
