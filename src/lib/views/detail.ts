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
import type { IssueInfo, Platform, ReleaseInfo, SubmissionEntry } from '@/types';

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

function renderRelease(release: ReleaseInfo | null, labels: DetailLabels, els: DetailElements): void {
  if (!release) return;
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

  const interactions = document.createElement('p');
  interactions.className = 'mt-1 text-sm text-slate-500 dark:text-slate-400';
  interactions.dataset.role = 'interactions';
  interactions.textContent = `${labels.interactions}: 👍 ${release.reactions}`;
  box.appendChild(interactions);

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

function renderIssues(issue: IssueInfo | null, labels: DetailLabels, els: DetailElements): void {
  const box = document.createElement('div');
  box.className = 'card p-4';
  const h = document.createElement('h3');
  h.className = 'font-semibold';
  h.textContent = labels.comments;
  box.appendChild(h);
  if (!issue) {
    const p = document.createElement('p');
    p.className = 'mt-2 text-sm text-slate-400';
    p.textContent = '–';
    box.appendChild(p);
  } else {
    const link = document.createElement('a');
    link.href = issue.htmlUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    link.className =
      'mt-2 inline-flex items-center gap-2 text-sm text-emerald-600 hover:underline dark:text-emerald-400';
    link.textContent = `#${issue.number} ${issue.title}`;
    const count = document.createElement('span');
    count.className = 'text-xs text-slate-400';
    count.dataset.role = 'comment-count';
    count.textContent = `💬 ${issue.comments}`;
    box.append(link, count);
  }
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
    loadSubmissionContent(platform, user, repo, slug),
    loadRepoInfo(platform, user, repo).catch(() => null),
    loadReleases(platform, user, repo).catch(() => []),
    loadIssues(platform, user, repo).catch(() => []),
  ]);

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
  renderRelease(release, labels, els);

  const issue = issues.find((i) => i.title === slug) ?? null;
  renderIssues(issue, labels, els);
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
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.title = url;
      link.className = 'text-emerald-600 hover:underline dark:text-emerald-400';
      try {
        link.textContent = new URL(url).hostname;
      } catch {
        link.textContent = url;
      }
      li.appendChild(link);
    });
    list.appendChild(li);
  }
  return list;
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
  userLink.href = `/user/${entry.owner}`;
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
