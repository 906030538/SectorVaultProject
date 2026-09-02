import DOMPurify from 'dompurify';
import { marked } from 'marked';
import {
  CONTENT_REPO_PREFIX,
  LICENSE_OPTIONS,
  MOCK_PIPELINE_STEP_DELAY,
  REPO_TEMPLATES,
} from '@/config';
import { getAdapterAsync } from '@/lib/adapters/lazy';
import { getToken, loadSession } from '@/lib/auth';
import { isMockAvailable, loadAbout, loadRepoInfo } from '@/lib/content';
import { iterateAllSubmissions, loadActiveIndex, loadMockIndex } from '@/lib/index/loader';
import type { IndexFile, Platform, SubmissionEntry } from '@/types';

export interface UserLabels {
  space: string;
  projects: string;
  articles: string;
  more: string;
  newCollection: string;
  site: string;
  about: string;
  noRepos: string;
  prefix: string;
  repoName: string;
  owner: string;
  template: string;
  license: string;
  licenseDefault: string;
  create: string;
  cancel: string;
  created: string;
  createFailed: string;
  nameRequired: string;
}

export interface UserElements {
  avatar: HTMLElement;
  site: HTMLElement;
  platforms: HTMLElement;
  actions: HTMLElement;
  about: HTMLElement;
  aboutBody: HTMLElement;
  projectCollections: HTMLElement;
  articleCollections: HTMLElement;
}

export interface UserInit {
  name: string;
  locale: string;
  labels: UserLabels;
  els: UserElements;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadIndex(): Promise<IndexFile> {
  if (await isMockAvailable()) return loadMockIndex();
  return loadActiveIndex();
}

async function loadUserEntries(name: string): Promise<SubmissionEntry[]> {
  if (await isMockAvailable()) {
    return (await loadMockIndex()).submissions.filter((e) => e.owner === name);
  }
  // 与集合页相同的口径：真实模式遍历全部索引源
  const all: SubmissionEntry[] = [];
  for await (const entry of iterateAllSubmissions()) {
    if (entry.owner === name) all.push(entry);
  }
  return all;
}

function formatDate(date: string, locale: string): string {
  return new Date(date).toLocaleDateString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function miniCard(entry: SubmissionEntry, locale: string): HTMLElement {
  const link = el('a', 'card block w-40 shrink-0 overflow-hidden p-0');
  link.href = `/view/${entry.owner}/${entry.repo}/${entry.slug}`;
  link.dataset.role = 'mini-card';

  if (entry.cover?.startsWith('http')) {
    const img = el('img', 'aspect-video w-full object-cover');
    img.src = entry.cover;
    img.alt = entry.title;
    img.loading = 'lazy';
    link.appendChild(img);
  } else {
    link.appendChild(
      el(
        'div',
        'flex aspect-video w-full items-center justify-center bg-slate-100 text-2xl text-slate-300 dark:bg-slate-800 dark:text-slate-600',
        '♪',
      ),
    );
  }

  const body = el('div', 'flex flex-col gap-0.5 p-2.5');
  body.appendChild(el('p', 'truncate text-sm font-medium', entry.title));
  body.appendChild(
    el('p', 'text-xs text-slate-400 dark:text-slate-500', formatDate(entry.submittedAt, locale)),
  );
  link.appendChild(body);
  return link;
}

async function renderRepoCollection(
  host: HTMLElement,
  repo: string,
  entries: SubmissionEntry[],
  init: UserInit,
  platform: Platform,
): Promise<void> {
  const { name, locale, labels } = init;

  const card = el('div', 'card flex flex-col gap-3 p-5');
  card.dataset.repo = repo;

  const header = el('div', 'flex flex-wrap items-center gap-2');
  const repoLink = el('a', 'font-semibold hover:text-indigo-600 dark:hover:text-indigo-400', repo);
  repoLink.href = `/view/${name}/${repo}`;
  header.appendChild(repoLink);
  const info = await loadRepoInfo(platform, name, repo);
  if (info) header.appendChild(el('span', 'text-sm text-slate-400', `★ ${info.stars}`));
  const more = el('a', 'btn ml-auto', labels.more);
  more.href = `/view/${name}/${repo}`;
  more.dataset.action = 'more';
  header.appendChild(more);
  card.appendChild(header);

  const row = el('div', 'flex flex-wrap gap-3');
  if (entries.length) {
    for (const entry of entries.slice(0, 3)) row.appendChild(miniCard(entry, locale));
  } else {
    row.appendChild(el('p', 'text-sm text-slate-400', '–'));
  }
  card.appendChild(row);
  host.appendChild(card);
}

function dialogShell(title: string): { overlay: HTMLElement; body: HTMLElement } {
  const overlay = el('div', 'fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4');
  const box = el('div', 'card w-full max-w-md p-6 dark:bg-slate-900');
  box.appendChild(el('h2', 'mb-4 text-lg font-semibold', title));
  const body = el('div');
  box.append(body);
  overlay.appendChild(box);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) overlay.remove();
  });
  return { overlay, body };
}

/** 新建集合：前缀 + 名称、属主、模板库、默认许可证 */
function openCreateDialog(init: UserInit, platform: Platform): void {
  const { labels } = init;
  const session = loadSession()!;
  const { overlay, body } = dialogShell(labels.newCollection);

  const nameRow = el('div', 'flex flex-col gap-1');
  nameRow.appendChild(el('label', 'text-xs text-slate-500', labels.repoName));
  const nameInputs = el('div', 'flex gap-2');
  const prefixInput = el('input', 'input w-24');
  prefixInput.value = CONTENT_REPO_PREFIX;
  prefixInput.setAttribute('data-field', 'prefix');
  const nameInput = el('input', 'input flex-1');
  nameInput.placeholder = 'my-songs';
  nameInput.setAttribute('data-field', 'repo-name');
  nameInputs.append(prefixInput, nameInput);
  nameRow.appendChild(nameInputs);

  const ownerSelect = el('select', 'input w-full');
  ownerSelect.setAttribute('data-field', 'owner');
  const ownerOption = el('option', undefined, session.login);
  ownerOption.value = session.login;
  ownerSelect.appendChild(ownerOption);

  const templates = REPO_TEMPLATES[platform] ?? [];
  const templateSelect = el('select', 'input w-full');
  templateSelect.setAttribute('data-field', 'template');
  templates.forEach((template, index) => {
    const option = el('option', undefined, `${template.owner}/${template.repo}`);
    option.value = String(index);
    templateSelect.appendChild(option);
  });

  const licenseSelect = el('select', 'input w-full');
  licenseSelect.setAttribute('data-field', 'license');
  for (const option of LICENSE_OPTIONS) {
    const node = el('option', undefined, 'label' in option ? option.label : labels.licenseDefault);
    node.value = option.value;
    licenseSelect.appendChild(node);
  }

  const field = (label: string, control: HTMLElement) => {
    const wrap = el('div', 'mt-3 flex flex-col gap-1');
    wrap.append(el('label', 'text-xs text-slate-500', label), control);
    return wrap;
  };

  const error = el('p', 'hidden text-sm text-rose-600');
  const status = el('p', 'hidden text-sm text-emerald-600');

  const buttons = el('div', 'mt-4 flex justify-end gap-2');
  const cancel = el('button', 'btn', labels.cancel);
  cancel.type = 'button';
  cancel.addEventListener('click', () => overlay.remove());
  const create = el('button', 'btn btn-primary', labels.create);
  create.type = 'button';
  create.dataset.action = 'create-repo';
  create.addEventListener('click', async () => {
    const repoName = nameInput.value.trim();
    error.classList.add('hidden');
    if (!repoName) {
      error.textContent = labels.nameRequired;
      error.classList.remove('hidden');
      return;
    }
    create.setAttribute('disabled', '');
    const full = prefixInput.value.trim() + repoName;
    try {
      if (await isMockAvailable()) {
        await sleep(MOCK_PIPELINE_STEP_DELAY * 2);
      } else {
        const token = getToken(platform);
        if (!token || !templates.length) throw new Error('missing token or template');
        const template = templates[Number(templateSelect.value)] ?? templates[0];
        await (await getAdapterAsync(platform)).createRepoFromTemplate(token, ownerSelect.value, full, template);
      }
      status.textContent = labels.created;
      status.classList.remove('hidden');
      setTimeout(() => overlay.remove(), 800);
    } catch {
      error.textContent = labels.createFailed;
      error.classList.remove('hidden');
      create.removeAttribute('disabled');
    }
  });
  buttons.append(cancel, create);

  body.append(
    nameRow,
    field(labels.owner, ownerSelect),
    templates.length ? field(labels.template, templateSelect) : el('span'),
    field(labels.license, licenseSelect),
    error,
    status,
    buttons,
  );
  document.body.appendChild(overlay);
}

export async function initUser(init: UserInit): Promise<void> {
  const { name, labels, els } = init;
  const session = loadSession();

  const [index, entries] = await Promise.all([loadIndex(), loadUserEntries(name)]);

  const records = index.users.filter((u) => u.owner === name);
  const platforms = [...new Set(records.map((u) => u.platform))];
  if (!platforms.length) {
    els.projectCollections.appendChild(el('p', 'text-sm text-slate-400', labels.noRepos));
    return;
  }

  // 同名用户存在于多个平台时，通过 ?git= 查询参数区分展示的数据
  const requested = new URLSearchParams(window.location.search).get('git');
  const platform = requested && platforms.includes(requested as Platform)
    ? (requested as Platform)
    : platforms[0];

  if (platforms.length > 1) {
    for (const p of platforms) {
      const chip = el('a', 'chip', p);
      chip.href = `/user/${name}?git=${p}`;
      chip.dataset.platform = p;
      if (p === platform) chip.classList.add('font-semibold', 'text-indigo-600', 'dark:text-indigo-400');
      els.platforms.appendChild(chip);
    }
  }

  if (session?.login === name && session.avatarUrl) {
    const img = el('img', 'h-full w-full rounded-full object-cover');
    img.src = session.avatarUrl;
    img.alt = name;
    els.avatar.textContent = '';
    els.avatar.appendChild(img);
  }

  const site = records.find((u) => u.platform === platform)?.pagesUrl;
  if (site) {
    const link = el('a', 'btn', labels.site);
    link.href = site;
    link.target = '_blank';
    link.rel = 'noopener';
    link.dataset.action = 'goto-site';
    els.site.appendChild(link);
  }

  if (session?.login === name && session.platform === platform) {
    const button = el('button', 'btn btn-primary', labels.newCollection);
    button.type = 'button';
    button.dataset.action = 'new-collection';
    button.addEventListener('click', () => openCreateDialog(init, platform));
    els.actions.appendChild(button);
  }

  const repos = (records.find((u) => u.platform === platform)?.repos ?? [])
    .map((r) => r.repo)
    .filter((repo) => repo.startsWith(CONTENT_REPO_PREFIX));
  const byRepo = new Map<string, SubmissionEntry[]>();
  for (const entry of entries
    .filter((e) => e.platform === platform)
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))) {
    const list = byRepo.get(entry.repo);
    if (list) list.push(entry);
    else byRepo.set(entry.repo, [entry]);
  }

  if (!repos.length) {
    els.projectCollections.appendChild(el('p', 'text-sm text-slate-400', labels.noRepos));
  }
  for (const repo of repos) {
    const projects = (byRepo.get(repo) ?? []).filter((e) => e.type === 'project');
    await renderRepoCollection(els.projectCollections, repo, projects, init, platform);
  }
  for (const repo of repos) {
    const articles = (byRepo.get(repo) ?? []).filter((e) => e.type === 'article');
    if (!articles.length) continue;
    await renderRepoCollection(els.articleCollections, repo, articles, init, platform);
  }

  for (const repo of repos) {
    const about = await loadAbout(platform, name, repo);
    if (!about) continue;
    els.aboutBody.innerHTML = DOMPurify.sanitize(await marked.parse(about)) as string;
    els.about.classList.remove('hidden');
    break;
  }
}
