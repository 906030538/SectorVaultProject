import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { CONTENT_REPO_PREFIX, LICENSE_OPTIONS, SUPPORTED_PLATFORMS } from '@/config';
import { getAdapterAsync } from '@/lib/adapters/lazy';
import { getToken, loadSessionBy } from '@/lib/auth';
import { applyCover, coverPlaceholder, setAvatar } from '@/lib/ui';
import { withBase } from '@/lib/base';
import { loadAbout, loadRepoInfo } from '@/lib/content';
import { iterateAllSubmissions, loadLineIndexMerged } from '@/lib/index/loader';
import { getRepoPrefix, getRepoTemplates } from '@/lib/index/sources';
import type { AuthInfo, IndexFile, Platform, SubmissionEntry } from '@/types';

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
  templateNone: string;
  license: string;
  licenseNone: string;
  licenseCustom: string;
  licenseCustomPh: string;
  licenseCustomRequired: string;
  create: string;
  creating: string;
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

async function loadIndex(): Promise<IndexFile> {
  // current + 归档合并：无 CI 线路的 users 记录在归档里
  return loadLineIndexMerged();
}

async function loadUserEntries(name: string): Promise<SubmissionEntry[]> {
  // 与集合页相同的口径：遍历全部索引源
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
  link.href = withBase(`/view/${entry.owner}/${entry.repo}/${entry.slug}`);
  link.dataset.role = 'mini-card';

  link.appendChild(coverPlaceholder());
  // 有封面时异步解析并插入（完整 URL 或内容仓相对路径）
  void applyCover(entry, link);

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
  const repoLink = el('a', 'font-semibold hover:text-emerald-600 dark:hover:text-emerald-400', repo);
  repoLink.href = withBase(`/view/${name}/${repo}`);
  header.appendChild(repoLink);
  const info = await loadRepoInfo(platform, name, repo).catch(() => null);
  if (info) header.appendChild(el('span', 'text-sm text-slate-400', `★ ${info.stars}`));
  const more = el('a', 'btn ml-auto', labels.more);
  more.href = withBase(`/view/${name}/${repo}`);
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

/**
 * 新建集合对话框：前缀 + 名称、属主（账户/组织）、模板库（可不使用）、默认许可证（可自定义）。
 * 前缀与模板列表来自 deployment.json（repoPrefix / templates），属主含账户所在组织。
 */
async function openCreateDialog(init: UserInit, platform: Platform): Promise<void> {
  const { labels } = init;
  const session = loadSessionBy(platform)!;
  const { overlay, body } = dialogShell(labels.newCollection);

  // 名称行：前缀（部署配置默认，可改）+ 名称 + 属主下拉（右侧）
  const nameRow = el('div', 'flex flex-col gap-1');
  nameRow.appendChild(el('label', 'text-xs text-slate-500', labels.repoName));
  const nameInputs = el('div', 'flex gap-2');
  const prefixInput = el('input', 'input w-24 shrink-0');
  prefixInput.value = CONTENT_REPO_PREFIX;
  prefixInput.setAttribute('data-field', 'prefix');
  prefixInput.setAttribute('aria-label', labels.prefix);
  void getRepoPrefix().then((value) => {
    prefixInput.value = value;
  });
  const nameInput = el('input', 'input min-w-0 flex-1');
  nameInput.placeholder = 'my-songs';
  nameInput.setAttribute('data-field', 'repo-name');

  const ownerSelect = el('select', 'input w-40 shrink-0');
  ownerSelect.setAttribute('data-field', 'owner');
  ownerSelect.setAttribute('aria-label', labels.owner);
  const ownerOption = el('option', undefined, session.login);
  ownerOption.value = session.login;
  ownerSelect.appendChild(ownerOption);
  nameInputs.append(prefixInput, nameInput, ownerSelect);
  nameRow.appendChild(nameInputs);

  // 属主候选：账户所在组织（列表不可用时仅个人账户）
  const adapter = await getAdapterAsync(platform);
  const token = getToken(platform);
  if (token) {
    void adapter
      .listOwners(token)
      .then((choices) => {
        for (const choice of choices) {
          if (choice.kind !== 'org') continue;
          const option = el('option', undefined, choice.login);
          option.value = choice.login;
          ownerSelect.appendChild(option);
        }
      })
      .catch(() => {
        /* 组织列表不可用时仅个人账户 */
      });
  }

  // 模板下拉：deployment.json 按平台配置；仅支持模板生成的平台展示
  const templates = adapter.supportsRepoTemplate ? await getRepoTemplates(platform) : [];
  const templateSelect = el('select', 'input w-full');
  templateSelect.setAttribute('data-field', 'template');
  for (const [index, template] of templates.entries()) {
    const option = el('option', undefined, template.name ?? `${template.owner}/${template.repo}`);
    option.value = String(index);
    templateSelect.appendChild(option);
  }
  const templateNone = el('option', undefined, labels.templateNone);
  templateNone.value = '';
  templateSelect.appendChild(templateNone);

  // 默认许可证：不设置 / SPDX 预设 / 自定义全文
  const licenseSelect = el('select', 'input w-full');
  licenseSelect.setAttribute('data-field', 'license');
  const licenseNone = el('option', undefined, labels.licenseNone);
  licenseNone.value = '';
  licenseSelect.appendChild(licenseNone);
  for (const option of LICENSE_OPTIONS) {
    if (!option.value) continue;
    const node = el('option', undefined, option.label ?? option.value);
    node.value = option.value;
    licenseSelect.appendChild(node);
  }
  const licenseCustomOption = el('option', undefined, labels.licenseCustom);
  licenseCustomOption.value = 'custom';
  licenseSelect.appendChild(licenseCustomOption);

  const licenseTextWrap = el('div', 'mt-2 hidden');
  const licenseText = el('textarea', 'input min-h-32 w-full font-mono text-xs');
  licenseText.placeholder = labels.licenseCustomPh;
  licenseText.setAttribute('data-field', 'license-text');
  licenseTextWrap.appendChild(licenseText);
  licenseSelect.addEventListener('change', () => {
    licenseTextWrap.classList.toggle('hidden', licenseSelect.value !== 'custom');
  });

  const field = (label: string, control: HTMLElement) => {
    const wrap = el('div', 'mt-3 flex flex-col gap-1');
    wrap.append(el('label', 'text-xs text-slate-500', label), control);
    return wrap;
  };

  const error = el('p', 'hidden text-sm text-rose-600');
  const status = el('p', 'hidden text-sm text-indigo-600');

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
    status.classList.add('hidden');
    if (!repoName) {
      error.textContent = labels.nameRequired;
      error.classList.remove('hidden');
      return;
    }
    const isCustom = licenseSelect.value === 'custom';
    const customText = licenseText.value.trim();
    if (isCustom && !customText) {
      error.textContent = labels.licenseCustomRequired;
      error.classList.remove('hidden');
      return;
    }
    create.setAttribute('disabled', '');
    status.textContent = labels.creating;
    status.classList.remove('hidden');
    const template =
      templates.length && templateSelect.value !== ''
        ? templates[Number(templateSelect.value)]
        : undefined;
    try {
      if (!token) throw new Error('missing token');
      await adapter.createRepo(token, {
        owner: ownerSelect.value,
        name: `${prefixInput.value.trim()}${repoName}`,
        template,
        license: !isCustom && licenseSelect.value ? licenseSelect.value : undefined,
        ...(isCustom ? { licenseText: customText } : {}),
      });
      status.textContent = labels.created;
      create.removeAttribute('disabled');
      setTimeout(() => overlay.remove(), 800);
    } catch (err) {
      status.classList.add('hidden');
      const detail = err instanceof Error && err.message ? `：${err.message.slice(0, 160)}` : '';
      error.textContent = `${labels.createFailed}${detail}`;
      error.classList.remove('hidden');
      create.removeAttribute('disabled');
    }
  });
  buttons.append(cancel, create);

  body.append(
    nameRow,
    ...(templates.length ? [field(labels.template, templateSelect)] : []),
    field(labels.license, licenseSelect),
    licenseTextWrap,
    error,
    status,
    buttons,
  );
  document.body.appendChild(overlay);
}

export async function initUser(init: UserInit): Promise<void> {
  const { name, labels, els } = init;

  const [index, entries] = await Promise.all([loadIndex(), loadUserEntries(name)]);

  const records = index.users.filter((u) => u.owner === name);
  const platforms = [...new Set(records.map((u) => u.platform))];

  // 同名用户存在于多个平台时，通过 ?git= 查询参数区分展示的数据
  const requested = new URLSearchParams(window.location.search).get('git');
  const platform: Platform | undefined =
    requested && platforms.includes(requested as Platform)
      ? (requested as Platform)
      : (platforms[0] as Platform | undefined);

  // 页面用户本人的登录会话：优先当前展示平台，其次任一平台同名会话
  // （无索引记录的新用户也应有新建集合入口）
  let ownerSession: AuthInfo | null = null;
  if (platform) {
    const session = loadSessionBy(platform);
    if (session?.login === name) ownerSession = session;
  }
  if (!ownerSession) {
    for (const p of SUPPORTED_PLATFORMS) {
      const session = loadSessionBy(p);
      if (session?.login === name) {
        ownerSession = session;
        break;
      }
    }
  }

  const applyAvatar = (url: string): void => {
    const img = el('img', 'h-full w-full rounded-full object-cover');
    setAvatar(img, url);
    img.alt = name;
    els.avatar.textContent = '';
    els.avatar.appendChild(img);
  };
  if (ownerSession?.avatarUrl) {
    applyAvatar(ownerSession.avatarUrl);
  } else if (platform) {
    // 无本平台会话时向平台 API 获取头像；获取失败保留首字母图标
    void getAdapterAsync(platform)
      .then((adapter) => adapter.getUser(name))
      .then((profile) => {
        if (profile.avatarUrl) applyAvatar(profile.avatarUrl);
      })
      .catch(() => {
        /* 保留首字母图标 */
      });
  }

  if (ownerSession) {
    const button = el('button', 'btn btn-primary', labels.newCollection);
    button.type = 'button';
    button.dataset.action = 'new-collection';
    button.addEventListener('click', () => void openCreateDialog(init, ownerSession!.platform));
    els.actions.appendChild(button);
  }

  if (!platform) {
    // 索引中尚无记录：仅展示登录态入口与占位
    els.projectCollections.appendChild(el('p', 'text-sm text-slate-400', labels.noRepos));
    return;
  }

  if (platforms.length > 1) {
    for (const p of platforms) {
      const chip = el('a', 'chip', p);
      chip.href = withBase(`/user/${name}?git=${p}`);
      chip.dataset.platform = p;
      if (p === platform) chip.classList.add('font-semibold', 'text-emerald-600', 'dark:text-emerald-400');
      els.platforms.appendChild(chip);
    }
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
