import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { unzipSync, zipSync, strToU8 } from 'fflate';
import { getAdapterAsync } from '@/lib/adapters/lazy';
import {
  isMockAvailable,
  loadRepoInfo,
  loadReleases,
  loadIssues,
  loadSubmissionContent,
  type MediaItem,
  type ProjectFile,
} from '@/lib/content';
import { findEntry } from '@/lib/index/loader';
import { getToken, loadSessionBy } from '@/lib/auth';
import { openAuthDialog } from '@/lib/auth-dialog';
import { buildAuthLabels } from '@/lib/labels';
import { normalizeLocale, type Locale } from '@/i18n';
import type { ReleaseReactionInfo } from '@/types';
import { applyCover, isRateLimitError, showApiLimitNotice } from '@/lib/ui';
import { withBase } from '@/lib/base';
import type { IssueCommentInfo, IssueInfo, Platform, ReleaseInfo, SubmissionEntry } from '@/types';

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

export interface DetailLabels {
  paramsWith: string;
  paramsTuned: string;
  paramsNone: string;
  date: string;
  tracks: string;
  engines: string;
  voicebanks: string;
  songLanguages: string;
  videos: string;
  media: string;
  files: string;
  release: string;
  comments: string;
  download: string;
  decrypt: string;
  password: string;
  encrypted: string;
  compressed: string;
  attachments: string;
  interactions: string;
  like: string;
  liked: string;
  commentsDisabled: string;
  noComments: string;
  viewIssue: string;
  commentPh: string;
  commentSubmit: string;
  commentFailed: string;
  loginToComment: string;
  loadError: string;
  license: string;
  stars: string;
}

export interface DetailElements {
  title: HTMLElement;
  date: HTMLElement;
  meta: HTMLElement;
  body: HTMLElement;
  tags: HTMLElement;
  media: HTMLElement;
  author: HTMLElement;
  files: HTMLElement;
  release: HTMLElement;
  issues: HTMLElement;
}

export interface DetailInit {
  user: string;
  repo: string;
  slug: string;
  locale: string;
  labels: DetailLabels;
  els: DetailElements;
}

function renderTags(tags: string[], els: DetailElements): void {
  els.tags.textContent = '';
  for (const tag of tags) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className =
      'rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600 hover:bg-emerald-100 hover:text-emerald-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700';
    btn.textContent = `#${tag}`;
    els.tags.appendChild(btn);
  }
}

function renderMedia(items: MediaItem[], els: DetailElements): void {
  const grid = document.createElement('div');
  grid.className = 'grid grid-cols-2 gap-3 sm:grid-cols-3';
  for (const item of items) {
    const figure = document.createElement('figure');
    figure.className = 'card overflow-hidden';
    if (item.kind === 'image') {
      const img = document.createElement('img');
      img.src = item.url;
      img.alt = item.name;
      img.loading = 'lazy';
      img.className = 'aspect-video w-full object-cover';
      figure.appendChild(img);
    } else if (item.kind === 'audio') {
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.src = item.url;
      audio.className = 'w-full';
      figure.appendChild(audio);
    } else if (item.kind === 'video') {
      const video = document.createElement('video');
      video.controls = true;
      video.src = item.url;
      video.className = 'aspect-video w-full';
      figure.appendChild(video);
    } else {
      const p = document.createElement('p');
      p.className = 'p-3 text-sm text-slate-500';
      p.textContent = item.name;
      figure.appendChild(p);
    }
    const caption = document.createElement('figcaption');
    caption.className =
      'truncate border-t border-slate-100 px-2 py-1 text-xs text-slate-400 dark:border-slate-800';
    caption.textContent = item.name;
    figure.appendChild(caption);
    grid.appendChild(figure);
  }
  els.media.appendChild(grid);
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** 演示模式下合成的工程文件字节（压缩文件生成真实 ZIP，便于演练解压管线） */
function mockFileBytes(file: ProjectFile): Uint8Array {
  const content = strToU8(`Sector Vault Project mock project file: ${file.name}\n`);
  if (file.compressed || file.encrypted) {
    return zipSync({ [file.name]: content });
  }
  return content;
}

async function downloadProjectFile(
  init: DetailInit,
  platform: Platform,
  baseDir: string,
  file: ProjectFile,
  password?: string,
): Promise<void> {
  const { user, repo } = init;
  const mock = await isMockAvailable();
  let bytes: Uint8Array;
  if (mock) {
    bytes = mockFileBytes(file);
  } else {
    const url = (await getAdapterAsync(platform)).rawUrl(user, repo, `${baseDir}/${file.name}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    bytes = new Uint8Array(await response.arrayBuffer());
  }

  if (!file.compressed && !file.encrypted) {
    saveBlob(new Blob([bytes as BlobPart]), file.name);
    return;
  }

  // 压缩 / 加密文件：先在前端完整加载，再解压（加密需密码）后返回浏览器
  if (file.encrypted) {
    const { ZipReader, Uint8ArrayReader, Uint8ArrayWriter } = await import('@zip.js/zip.js');
    const reader = new ZipReader(new Uint8ArrayReader(bytes), { password });
    const entries = await reader.getEntries();
    for (const entry of entries) {
      if (entry.directory) continue;
      const data = await entry.getData(new Uint8ArrayWriter(), { password });
      saveBlob(new Blob([data as BlobPart]), entry.filename);
    }
    await reader.close();
    return;
  }

  const unzipped = unzipSync(bytes);
  for (const [name, data] of Object.entries(unzipped)) {
    saveBlob(new Blob([data as BlobPart]), name);
  }
}

function renderFiles(
  init: DetailInit,
  platform: Platform,
  baseDir: string,
  files: ProjectFile[],
  els: DetailElements,
): void {
  const { labels } = init;
  const ul = document.createElement('ul');
  ul.className = 'flex flex-col gap-2';
  for (const file of files) {
    const li = document.createElement('li');
    li.className = 'card flex flex-wrap items-center gap-3 p-3';

    const name = document.createElement('span');
    name.className = 'min-w-0 flex-1 truncate font-mono text-sm';
    name.textContent = file.name;
    li.appendChild(name);

    if (file.compressed) {
      const badge = document.createElement('span');
      badge.className = 'chip';
      badge.textContent = labels.compressed;
      li.appendChild(badge);
    }
    if (file.encrypted) {
      const badge = document.createElement('span');
      badge.className = 'chip text-rose-600 dark:text-rose-400';
      badge.textContent = labels.encrypted;
      li.appendChild(badge);
    }

    if (file.encrypted) {
      const input = document.createElement('input');
      input.type = 'password';
      input.className = 'input w-32';
      input.placeholder = labels.password;
      input.dataset.role = 'file-password';
      li.appendChild(input);
    }

    const status = document.createElement('span');
    status.className = 'text-xs text-slate-400';
    status.dataset.role = 'file-status';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-primary';
    btn.dataset.action = 'download-file';
    btn.textContent = file.encrypted ? labels.decrypt : labels.download;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      status.textContent = '…';
      const password = li.querySelector<HTMLInputElement>('[data-role="file-password"]')?.value;
      try {
        await downloadProjectFile(init, platform, baseDir, file, password);
        status.textContent = '✓';
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : labels.loadError;
      } finally {
        btn.disabled = false;
      }
    });
    li.append(btn, status);
    ul.appendChild(li);
  }
  els.files.appendChild(ul);
}

/** release 表情互动的类型 → emoji */
const REACTION_EMOJI: Record<string, string> = {
  '+1': '👍',
  '-1': '👎',
  laugh: '😄',
  confused: '😕',
  heart: '❤️',
  hooray: '🎉',
  rocket: '🚀',
  eyes: '👀',
};

function renderRelease(
  init: DetailInit,
  platform: Platform,
  release: ReleaseInfo | null,
  labels: DetailLabels,
  els: DetailElements,
): void {
  if (!release) return;
  const { user, repo, locale } = init;
  const box = document.createElement('div');
  box.className = 'card p-4';
  const h = document.createElement('h3');
  h.className = 'font-semibold';
  const link = document.createElement('a');
  link.href = release.htmlUrl;
  link.target = '_blank';
  link.rel = 'noopener';
  link.className = 'text-emerald-600 hover:underline dark:text-emerald-400';
  link.textContent = release.name || release.tag;
  h.appendChild(link);
  box.appendChild(h);

  // 互动记录：emoji 计数 + 点赞按钮（在关联 release 上添加 👍）
  const interactions = document.createElement('div');
  interactions.className = 'mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500 dark:text-slate-400';
  interactions.dataset.role = 'interactions';
  interactions.appendChild(document.createTextNode(`${labels.interactions}:`));
  const chips = document.createElement('span');
  chips.className = 'flex flex-wrap items-center gap-1.5';
  chips.dataset.role = 'reaction-chips';
  interactions.appendChild(chips);
  const likeBtn = document.createElement('button');
  likeBtn.type = 'button';
  likeBtn.className = 'btn px-2.5 py-1 text-xs';
  likeBtn.dataset.action = 'like-release';
  likeBtn.textContent = `👍 ${labels.like}`;
  const likeStatus = document.createElement('span');
  likeStatus.className = 'text-xs text-slate-400';
  likeStatus.dataset.role = 'like-status';
  interactions.append(likeBtn, likeStatus);
  box.appendChild(interactions);

  const refresh = async (): Promise<void> => {
    let reactions: ReleaseReactionInfo[] = [];
    try {
      const adapter = await getAdapterAsync(platform);
      reactions = await adapter.listReleaseReactions(user, repo, release.id);
    } catch {
      /* 平台不支持或读取失败时回退 release 汇总计数 */
    }
    const groups = new Map<string, number>();
    for (const reaction of reactions) {
      groups.set(reaction.content, (groups.get(reaction.content) ?? 0) + 1);
    }
    chips.textContent = '';
    if (groups.size > 0) {
      for (const [content, count] of groups) {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.dataset.reaction = content;
        chip.textContent = `${REACTION_EMOJI[content] ?? content} ${count}`;
        chips.appendChild(chip);
      }
    } else if (release.reactions > 0) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = `👍 ${release.reactions}`;
      chips.appendChild(chip);
    } else {
      chips.appendChild(document.createTextNode('–'));
    }
    // 当前用户已点赞时置为已赞状态
    const viewer = loadSessionBy(platform)?.login;
    const liked =
      viewer !== undefined && reactions.some((r) => r.user === viewer && r.content === '+1');
    likeBtn.disabled = liked;
    likeBtn.textContent = `👍 ${liked ? labels.liked : labels.like}`;
  };
  void refresh();

  likeBtn.addEventListener('click', () => {
    void (async () => {
      const token = getToken(platform);
      if (!token) {
        void openAuthDialog(buildAuthLabels(normalizeLocale(locale) as Locale));
        return;
      }
      likeBtn.disabled = true;
      likeStatus.textContent = '…';
      try {
        const adapter = await getAdapterAsync(platform);
        await adapter.createReleaseReaction(token, user, repo, release.id);
        likeStatus.textContent = '';
        await refresh();
      } catch (error) {
        likeBtn.disabled = false;
        likeStatus.textContent = error instanceof Error ? error.message.slice(0, 60) : labels.loadError;
      }
    })();
  });

  if (release.assets.length > 0) {
    const assetTitle = document.createElement('p');
    assetTitle.className = 'mt-3 text-sm font-medium';
    assetTitle.textContent = labels.attachments;
    box.appendChild(assetTitle);
    const ul = document.createElement('ul');
    ul.className = 'mt-1 flex flex-col gap-1 text-sm';
    for (const asset of release.assets) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = asset.downloadUrl;
      a.target = '_blank';
      a.rel = 'noopener';
      a.className = 'text-emerald-600 hover:underline dark:text-emerald-400';
      a.textContent = asset.name;
      const size = document.createElement('span');
      size.className = 'ml-2 text-xs text-slate-400';
      size.textContent = formatBytes(asset.size);
      li.append(a, size);
      ul.appendChild(li);
    }
    box.appendChild(ul);
  }
  els.release.appendChild(box);
}

/** 渲染单条 issue 评论（Markdown 安全渲染） */
function renderIssueComment(comment: IssueCommentInfo, locale: string): HTMLElement {
  const item = document.createElement('article');
  item.className = 'card p-3';
  item.dataset.role = 'issue-comment';
  const head = document.createElement('p');
  head.className = 'flex flex-wrap items-center gap-2 text-sm';
  const author = comment.author
    ? comment.authorUrl
      ? (() => {
          const a = document.createElement('a');
          a.href = comment.authorUrl!;
          a.target = '_blank';
          a.rel = 'noopener';
          a.className = 'font-medium hover:text-emerald-600 dark:hover:text-emerald-400';
          a.textContent = comment.author;
          return a;
        })()
      : el('span', undefined, comment.author)
    : document.createElement('span');
  head.append(
    author,
    el('span', 'mx-1 text-slate-400', '·'),
    document.createElement(
      'span',
      'text-xs text-slate-400',
      new Date(comment.createdAt).toLocaleDateString(locale, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }),
    ),
  );
  if (comment.htmlUrl) {
    const link = el('a', 'ml-auto text-xs text-emerald-600 hover:underline dark:text-emerald-400', '↗');
    link.href = comment.htmlUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    head.appendChild(link);
  }
  item.appendChild(head);
  const body = document.createElement('div', 'prose-svp mt-2 text-sm');
  body.innerHTML = DOMPurify.sanitize(marked.parse(comment.body, { async: false })) as string;
  item.appendChild(body);
  return item;
}

/**
 * 评论区：issue 存在时 API 加载回复列表 + 同平台登录显示评论框；
 * issue 不存在显示"评论区已禁用"；无该平台登录态提示登录当前平台。
 */
async function renderIssueSection(
  init: DetailInit,
  platform: Platform,
  issue: IssueInfo | null,
  labels: DetailLabels,
  els: DetailElements,
): Promise<void> {
  const { user, repo, locale } = init;
  const box = document.createElement('div');
  box.className = 'card p-4';
  const h = document.createElement('h3');
  h.className = 'font-semibold';
  h.textContent = labels.comments;
  box.appendChild(h);

  if (!issue) {
    // 未创建关联 issue（发布时未勾选评论区）
    const p = document.createElement('p', 'mt-2 text-sm text-slate-400', labels.commentsDisabled);
    p.dataset.role = 'comments-disabled';
    box.appendChild(p);
    els.issues.appendChild(box);
    return;
  }

  // 标题行：issue 链接 + 评论数 + 跳转原 issue 按钮
  const head = document.createElement('p');
  head.className = 'mt-2 flex flex-wrap items-center gap-2 text-sm';
  const link = document.createElement('a');
  link.href = issue.htmlUrl;
  link.target = '_blank';
  link.rel = 'noopener';
  link.className = 'text-emerald-600 hover:underline dark:text-emerald-400';
  link.textContent = `#${issue.number} ${issue.title}`;
  const count = document.createElement('span', 'text-xs text-slate-400');
  count.dataset.role = 'comment-count';
  head.append(link, count);
  const original = document.createElement('a', 'btn ml-auto px-2.5 py-1 text-xs', `${labels.viewIssue} ↗`);
  original.href = issue.htmlUrl;
  original.target = '_blank';
  original.rel = 'noopener';
  original.dataset.action = 'goto-issue';
  head.appendChild(original);
  box.appendChild(head);

  // 回复列表（API 加载）
  const list = el('div', 'mt-3 flex flex-col gap-2');
  list.dataset.role = 'issue-comments';
  const loading = el('p', 'mt-3 text-sm text-slate-400', '…');
  box.appendChild(list);
  box.appendChild(loading);

  const adapter = await getAdapterAsync(platform);
  const loadComments = async (): Promise<IssueCommentInfo[]> => {
    let comments: IssueCommentInfo[] = [];
    try {
      comments = await adapter.listIssueComments(user, repo, issue.number);
    } catch {
      /* 评论加载失败时保留空列表 */
    }
    loading.remove();
    list.textContent = '';
    count.textContent = `💬 ${comments.length}`;
    if (comments.length === 0) {
      list.appendChild(el('p', 'text-sm text-slate-400', labels.noComments));
    } else {
      for (const comment of comments) list.appendChild(renderIssueComment(comment, locale));
    }
    return comments;
  };
  void loadComments();

  // 评论输入：有该平台登录态时显示输入框 + 评论按钮；否则提示登录当前平台
  const footer = el('div', 'mt-3');
  footer.dataset.role = 'issue-comment-form';
  const token = getToken(platform);
  if (token) {
    const textarea = el('textarea', 'input min-h-20');
    textarea.placeholder = labels.commentPh;
    textarea.dataset.field = 'issue-comment';
    const status = el('p', 'hidden text-xs');
    status.dataset.role = 'comment-status';
    const submit = el('button', 'btn btn-primary self-start', labels.commentSubmit);
    submit.type = 'button';
    submit.dataset.action = 'submit-comment';
    submit.addEventListener('click', () => {
      void (async () => {
        const body = textarea.value.trim();
        if (!body) return;
        submit.disabled = true;
        status.classList.add('hidden');
        try {
          await adapter.createIssueComment(token, user, repo, issue.number, body);
          textarea.value = '';
          await loadComments();
        } catch (error) {
          status.className = 'text-xs text-rose-600';
          status.textContent = error instanceof Error ? error.message.slice(0, 80) : labels.commentFailed;
          status.classList.remove('hidden');
        } finally {
          submit.disabled = false;
        }
      })();
    });
    footer.append(textarea, status, submit);
  } else {
    footer.appendChild(el('p', 'text-sm text-slate-400', labels.loginToComment));
  }
  box.appendChild(footer);
  els.issues.appendChild(box);
}

export async function initDetail(init: DetailInit): Promise<void> {
  const { user, repo, slug, locale, labels, els } = init;

  const entry = await findEntry(user, repo, slug);
  if (!entry) {
    els.body.textContent = labels.loadError;
    return;
  }

  els.title.textContent = entry.title;
  els.date.textContent = new Date(entry.submittedAt).toLocaleDateString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const platform: Platform = entry.platform;
  // 仓库信息 / release / issue 拉取失败不阻断正文渲染（部分平台匿名受限）
  const [content, repoInfo, releases, issues] = await Promise.all([
    loadSubmissionContent(platform, user, repo, slug).catch((error) => {
      if (isRateLimitError(error)) showApiLimitNotice(platform);
      throw error;
    }),
    loadRepoInfo(platform, user, repo).catch(() => null),
    loadReleases(platform, user, repo).catch(() => []),
    loadIssues(platform, user, repo).catch(() => []),
  ]);

  // 封面（有则先于参数显示；相对文件名经 applyCover 解析为 raw 地址）
  const figure = document.createElement('figure');
  figure.dataset.role = 'detail-cover';
  figure.className = 'mb-2 hidden overflow-hidden rounded-xl';
  const coverHolder = document.createElement('div');
  coverHolder.className =
    'flex aspect-video w-full max-w-xl items-center justify-center rounded-xl bg-slate-100 text-4xl text-slate-300 dark:bg-slate-800 dark:text-slate-600';
  coverHolder.textContent = '♪';
  figure.appendChild(coverHolder);
  els.meta.before(figure);
  if (entry.cover) {
    figure.classList.remove('hidden');
    void applyCover(entry, figure).then(() => {
      const img = figure.querySelector('img');
      if (img) img.className = 'aspect-video w-full max-w-xl rounded-xl object-cover';
    });
  } else {
    figure.remove();
  }

  // 元数据列表（视频链接来自稿件 README 头部，逗号分隔）
  els.meta.textContent = '';
  const videos = (content.parsed.attrs.videos ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const metaList = buildMetaList(entry, labels, videos);
  els.meta.appendChild(metaList);

  // 正文（不含文件头属性）
  const html = await marked.parse(content.parsed.body);
  els.body.innerHTML = DOMPurify.sanitize(html) as string;

  const tags = (content.parsed.attrs.tags ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  renderTags(tags, els);
  renderMedia(content.media, els);

  // 作者卡 + 许可证（稿件级优先，缺省仓库级）
  renderAuthor(entry, repoInfo, content, labels, els);

  renderFiles(init, platform, content.baseDir, content.parsed.files, els);

  const release = releases.find((r) => r.tag === slug) ?? null;
  renderRelease(init, platform, release, labels, els);

  const issue = issues.find((i) => i.title === slug) ?? null;
  await renderIssueSection(init, platform, issue, labels, els);
}

function buildMetaList(
  entry: SubmissionEntry,
  labels: DetailLabels,
  videos: string[],
): HTMLUListElement {
  const list = document.createElement('ul');
  list.className = 'flex flex-col gap-1.5 text-sm';
  const row = (label: string, values: string[] | undefined): void => {
    if (!values?.length) return;
    const li = document.createElement('li');
    const strong = document.createElement('span');
    strong.className = 'mr-2 font-medium text-slate-500 dark:text-slate-400';
    strong.textContent = label;
    const span = document.createElement('span');
    span.textContent = values.join('、');
    li.append(strong, span);
    list.appendChild(li);
  };
  row(labels.tracks, entry.songs);
  row(labels.engines, entry.engines);
  row(labels.voicebanks, entry.voicebanks);
  row(labels.songLanguages, entry.languages);
  if (entry.paramState) {
    const label =
      entry.paramState === 'with-params'
        ? labels.paramsWith
        : entry.paramState === 'tuned'
          ? labels.paramsTuned
          : labels.paramsNone;
    row(' ', [label]);
  }
  if (videos.length > 0) {
    const li = document.createElement('li');
    const strong = document.createElement('span');
    strong.className = 'mr-2 font-medium text-slate-500 dark:text-slate-400';
    strong.textContent = labels.videos;
    li.appendChild(strong);
    videos.forEach((url, index) => {
      if (index > 0) li.appendChild(document.createTextNode('、'));
      li.appendChild(renderVideoLink(url));
    });
    list.appendChild(li);
  }
  return list;
}

/** 视频平台的轻量 icon（内联 SVG，避免外链与许可问题） */
const VIDEO_ICONS: Record<string, string> = {
  bilibili:
    '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M17.813 4.653h.854c2.51.017 4.545 2.086 4.543 4.596v5.176c0 2.51-2.034 4.545-4.545 4.545H5.335c-2.51 0-4.545-2.034-4.545-4.545V9.25c0-2.51 2.034-4.545 4.545-4.545h.804l-1.072-1.88a.86.86 0 0 1 .322-1.176.86.86 0 0 1 1.176.322l1.403 2.458h7.264l1.395-2.443a.86.86 0 0 1 1.176-.322.86.86 0 0 1 .322 1.176l-1.008 1.813zM7.425 7.613v3.974c0 .475.386.86.86.86s.86-.385.86-.86V7.613a.86.86 0 0 0-.86-.86.86.86 0 0 0-.86.86zm7.43 0v3.974c0 .475.386.86.86.86s.86-.385.86-.86V7.613a.86.86 0 0 0-.86-.86.86.86 0 0 0-.86.86z" fill-rule="evenodd"/></svg>',
  youtube:
    '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M23.5 6.19a3.02 3.02 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.51A3.02 3.02 0 0 0 .5 6.19C0 8.07 0 12 0 12s0 3.93.5 5.81a3.02 3.02 0 0 0 2.123 2.136c1.872.51 9.377.51 9.377.51s7.505 0 9.378-.51A3.02 3.02 0 0 0 23.5 17.8C24 15.93 24 12 24 12s0-3.93-.5-5.81zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>',
  nicovideo:
    '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M7.38 4.01h9.24c1.9 0 2.79.2 3.52.64.74.44 1.07.92 1.36 1.85.28.92.28 1.84.28 3.74v3.52c0 1.9 0 2.82-.28 3.74-.29.93-.62 1.41-1.36 1.85-.73.44-1.62.64-3.52.64H7.38c-1.9 0-2.79-.2-3.52-.64-.74-.44-1.07-.92-1.36-1.85C2.22 16.58 2.2 15.66 2.2 13.76v-3.52c0-1.9.02-2.82.3-3.74.29-.93.62-1.41 1.36-1.85.73-.44 1.62-.64 3.52-.64zm1.36 10.36h1.92l1.76-2.65 1.76 2.65h1.94l-2.7-4.02 2.54-3.78h-1.9l-1.64 2.5-1.64-2.5H8.8l2.53 3.78-2.6 4.02z"/></svg>',
  generic:
    '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm6 4v8l7-4-7-4z" fill-rule="evenodd"/></svg>',
};

/** 平台识别（按域名） */
function videoIconKey(hostname: string): string {
  if (/(^|\.)bilibili\.com$|(^|\.)b23\.tv$/.test(hostname)) return 'bilibili';
  if (/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(hostname)) return 'youtube';
  if (/(^|\.)nicovideo\.jp$|(^|\.)nico\.ms$/.test(hostname)) return 'nicovideo';
  return 'generic';
}

/** 视频链接显示名：平台 icon + 视频 ID（path 末段或 v=/sm 等查询参数） */
function renderVideoLink(url: string): HTMLAnchorElement {
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener';
  link.title = url;
  link.className = 'inline-flex items-center gap-1 text-emerald-600 hover:underline dark:text-emerald-400';

  let hostname = '';
  let videoId = '';
  try {
    const parsed = new URL(url);
    hostname = parsed.hostname;
    videoId = parsed.searchParams.get('v')
      ?? parsed.pathname.split('/').filter(Boolean).pop()
      ?? '';
  } catch {
    videoId = url;
  }
  const icon = document.createElement('span');
  icon.className = 'inline-flex text-base leading-none';
  icon.innerHTML = VIDEO_ICONS[videoIconKey(hostname)] ?? VIDEO_ICONS.generic!;
  const text = document.createElement('span');
  text.textContent = videoId || hostname;
  link.append(icon, text);
  return link;
}

function renderAuthor(
  entry: SubmissionEntry,
  repoInfo: { stars: number; license?: string; htmlUrl?: string } | null,
  content: { parsed: { attrs: Record<string, string> } },
  labels: DetailLabels,
  els: DetailElements,
): void {
  els.author.textContent = '';

  const avatar = document.createElement('div');
  avatar.className =
    'flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-lg font-bold text-emerald-600 dark:bg-emerald-900 dark:text-emerald-300';
  avatar.textContent = entry.owner.slice(0, 1).toUpperCase();

  const info = document.createElement('div');
  info.className = 'flex flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-sm';

  const userLink = document.createElement('a');
  userLink.href = withBase(`/user/${entry.owner}`);
  userLink.className = 'font-medium hover:text-emerald-600 dark:hover:text-emerald-400';
  userLink.textContent = entry.owner;
  info.appendChild(userLink);

  if (repoInfo?.htmlUrl) {
    const repoLink = document.createElement('a');
    repoLink.href = repoInfo.htmlUrl;
    repoLink.target = '_blank';
    repoLink.rel = 'noopener';
    repoLink.className = 'text-slate-500 hover:text-emerald-600 dark:text-slate-400';
    repoLink.textContent = `${entry.owner}/${entry.repo}`;
    info.appendChild(repoLink);
  }

  if (repoInfo) {
    const stars = document.createElement('span');
    stars.className = 'text-slate-400';
    stars.dataset.role = 'repo-stars';
    stars.textContent = `★ ${repoInfo.stars} ${labels.stars}`;
    info.appendChild(stars);
  }

  const license = content.parsed.attrs.license || repoInfo?.license;
  if (license) {
    const span = document.createElement('span');
    span.className =
      'rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300';
    span.dataset.role = 'license';
    span.textContent = `${labels.license}: ${license}`;
    info.appendChild(span);
  }

  els.author.append(avatar, info);
}
