import { LICENSE_OPTIONS, PAGE_SIZE } from '@/config';
import { isMockAvailable, loadEngagements, loadRepoInfo } from '@/lib/content';
import { iterateAllSubmissions, loadMockIndex } from '@/lib/index/loader';
import { getAdapterAsync } from '@/lib/adapters/lazy';
import { withBase } from '@/lib/base';
import { loadSession } from '@/lib/auth';
import { renderCard, type CardLabels } from '@/lib/ui';
import type { IndexFile, Platform, RepoInfo, SubmissionEntry } from '@/types';

export interface CollectionLabels extends CardLabels {
  submit: string;
  edit: string;
  delete: string;
  deleteConfirmText: string;
  license: string;
  stars: string;
  user: string;
  save: string;
  cancel: string;
}

export interface CollectionElements {
  repoName: HTMLElement;
  meta: HTMLElement;
  actions: HTMLElement;
  tabs: HTMLElement;
  list: HTMLElement;
  empty: HTMLElement;
  pageInfo: HTMLElement;
  prev: HTMLButtonElement;
  next: HTMLButtonElement;
}

export interface CollectionInit {
  user: string;
  repo: string;
  locale: string;
  labels: CollectionLabels;
  els: CollectionElements;
}

/** 汇总该仓库下全部稿件：先遍历索引源，确定平台后并行尝试内容仓本地索引（svp-archive.json，发布即写入、可能领先于索引 PR） */
async function loadRepoEntries(user: string, repo: string): Promise<SubmissionEntry[]> {
  const fromIndex: SubmissionEntry[] = [];
  let platform: Platform | null = null;
  // 本地索引加载（确定平台后立即发起，与索引遍历并行；失败静默降级为仅索引数据）
  let localArchive: Promise<SubmissionEntry[]> = Promise.resolve([]);
  const startLocalArchive = (p: Platform): void => {
    localArchive = (async () => {
      const adapter = await getAdapterAsync(p);
      const raw = await adapter.readFile(user, repo, 'svp-archive.json');
      const archive = JSON.parse(raw) as IndexFile;
      return Array.isArray(archive.submissions)
        ? archive.submissions.filter((e) => e.owner === user && e.repo === repo)
        : [];
    })().catch(() => [] as SubmissionEntry[]);
  };

  if (await isMockAvailable()) {
    fromIndex.push(...(await loadMockIndex()).submissions.filter((e) => e.owner === user && e.repo === repo));
    platform = fromIndex[0]?.platform ?? null;
    if (platform) startLocalArchive(platform);
  } else {
    for await (const entry of iterateAllSubmissions()) {
      if (entry.owner !== user || entry.repo !== repo) continue;
      fromIndex.push(entry);
      if (!platform) {
        platform = entry.platform;
        startLocalArchive(platform);
      }
    }
  }

  // 合并：同 slug 以本地索引为准（发布时直接写入，时间戳/属性更新）
  const bySlug = new Map(fromIndex.map((entry) => [entry.slug, entry]));
  for (const entry of await localArchive) bySlug.set(entry.slug, entry);
  return [...bySlug.values()].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
}

function dialogShell(title: string): { overlay: HTMLElement; body: HTMLElement } {
  const overlay = document.createElement('div');
  overlay.className =
    'fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4';
  const box = document.createElement('div');
  box.className =
    'card w-full max-w-md p-6 dark:bg-slate-900';
  const h = document.createElement('h2');
  h.className = 'mb-4 text-lg font-semibold';
  h.textContent = title;
  const body = document.createElement('div');
  box.append(h, body);
  overlay.appendChild(box);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) overlay.remove();
  });
  return { overlay, body };
}

/** 仓库编辑框：许可证选择 + 保存 */
function openEditDialog(
  labels: CollectionLabels,
  current: RepoInfo | null,
  onSaved: (license: string) => void,
): void {
  const { overlay, body } = dialogShell(labels.edit);

  const select = document.createElement('select');
  select.className = 'input w-full';
  for (const option of LICENSE_OPTIONS) {
    if (!option.value) continue;
    const el = document.createElement('option');
    el.value = option.value;
    el.textContent = ('label' in option ? option.label : undefined) ?? option.value;
    select.appendChild(el);
  }
  select.value = current?.license ?? 'CC-BY-4.0';
  if (select.value !== (current?.license ?? 'CC-BY-4.0')) select.selectedIndex = 0;

  const buttons = document.createElement('div');
  buttons.className = 'mt-4 flex justify-end gap-2';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn';
  cancel.textContent = labels.cancel;
  cancel.addEventListener('click', () => overlay.remove());
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'btn btn-primary';
  save.dataset.action = 'save-repo';
  save.textContent = labels.save;
  save.addEventListener('click', () => {
    onSaved(select.value);
    overlay.remove();
  });
  buttons.append(cancel, save);
  body.append(select, buttons);
  document.body.appendChild(overlay);
}

/** 删除确认：要求输入仓库名二次确认 */
function openDeleteDialog(labels: CollectionLabels, repo: string): void {
  const { overlay, body } = dialogShell(`${labels.delete}: ${repo}`);

  const hint = document.createElement('p');
  hint.className = 'text-sm text-slate-500 dark:text-slate-400';
  hint.textContent = labels.deleteConfirmText;

  const input = document.createElement('input');
  input.className = 'input mt-3 w-full';
  input.placeholder = repo;

  const buttons = document.createElement('div');
  buttons.className = 'mt-4 flex justify-end gap-2';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn';
  cancel.textContent = labels.cancel;
  cancel.addEventListener('click', () => overlay.remove());
  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = 'btn btn-danger';
  confirm.dataset.action = 'confirm-delete';
  confirm.disabled = true;
  confirm.textContent = labels.delete;
  input.addEventListener('input', () => {
    confirm.disabled = input.value !== repo;
  });
  confirm.addEventListener('click', () => {
    overlay.remove();
    overlay.dispatchEvent(new CustomEvent('svp:delete-repo', { bubbles: true }));
  });
  buttons.append(cancel, confirm);
  body.append(hint, input, buttons);
  document.body.appendChild(overlay);
}

export async function initCollection(init: CollectionInit): Promise<void> {
  const { user, repo, locale, labels, els } = init;
  const session = loadSession();
  const isOwner = session?.login === user;

  const entries = await loadRepoEntries(user, repo);
  const platform: Platform = entries[0]?.platform ?? 'github';
  // 部分平台仓库详情接口匿名受限：拉取失败时降级为无 stars/许可证展示
  let repoInfo = await loadRepoInfo(platform, user, repo).catch(() => null);

  function renderHeader(): void {
    els.repoName.textContent = repo;
    const parts = [`${labels.user}: ${user}`];
    if (repoInfo) {
      parts.push(`★ ${repoInfo.stars} ${labels.stars}`);
      if (repoInfo.license) parts.push(`${labels.license}: ${repoInfo.license}`);
    }
    els.meta.textContent = parts.join(' · ');
  }

  function renderActions(): void {
    els.actions.textContent = '';
    if (!isOwner) return;
    const submit = document.createElement('a');
    submit.href = withBase('/new');
    submit.className = 'btn btn-primary';
    submit.dataset.action = 'submit';
    submit.textContent = labels.submit;

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'btn';
    edit.dataset.action = 'edit-repo';
    edit.textContent = labels.edit;
    edit.addEventListener('click', () =>
      openEditDialog(labels, repoInfo, (license) => {
        if (repoInfo) repoInfo = { ...repoInfo, license };
        else repoInfo = { name: repo, fullName: `${user}/${repo}`, htmlUrl: '', stars: 0, license };
        renderHeader();
      }),
    );

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn';
    del.dataset.action = 'delete-repo';
    del.textContent = labels.delete;
    del.addEventListener('click', () => openDeleteDialog(labels, repo));

    els.actions.append(submit, edit, del);
  }

  renderHeader();
  renderActions();

  let tab: 'project' | 'article' = 'project';
  let page = 0;

  async function render(): Promise<void> {
    const visible = entries.filter((e) => e.type === tab);
    const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
    page = Math.max(0, Math.min(page, totalPages - 1));
    const slice = visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

    const engagements = await loadEngagements(platform, user, repo, slice);

    els.list.textContent = '';
    for (const entry of slice) {
      els.list.appendChild(
        renderCard(entry, locale, labels, {
          compact: tab === 'article',
          engagement: engagements.get(`${user}/${repo}/${entry.slug}`),
          owner: isOwner ? { editLabel: labels.edit, deleteLabel: labels.delete } : undefined,
        }),
      );
    }
    els.empty.hidden = slice.length > 0;
    els.pageInfo.textContent = `${page + 1} / ${totalPages}`;
    els.prev.disabled = page === 0;
    els.next.disabled = page >= totalPages - 1;

    for (const btn of Array.from(els.tabs.querySelectorAll<HTMLButtonElement>('button'))) {
      const active = btn.dataset.tab === tab;
      btn.classList.toggle('btn-primary', active);
      btn.classList.toggle('btn', !active);
    }
  }

  els.tabs.addEventListener('click', (event) => {
    const next = (event.target as HTMLElement).closest('button')?.dataset.tab as
      | 'project'
      | 'article'
      | undefined;
    if (!next || next === tab) return;
    tab = next;
    page = 0;
    void render();
  });
  els.prev.addEventListener('click', () => {
    page -= 1;
    void render();
  });
  els.next.addEventListener('click', () => {
    page += 1;
    void render();
  });

  await render();
}
