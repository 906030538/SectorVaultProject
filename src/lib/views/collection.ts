import { LICENSE_OPTIONS, PAGE_SIZE } from '@/config';
import { isMockAvailable, loadEngagements, loadRepoInfo } from '@/lib/content';
import { iterateAllSubmissions, loadMockIndex } from '@/lib/index/loader';
import { getLineSources } from '@/lib/index/sources';
import { getAdapterAsync } from '@/lib/adapters/lazy';
import { withBase } from '@/lib/base';
import { getToken, loadSession, loadSessionBy } from '@/lib/auth';
import { openAuthDialog } from '@/lib/auth-dialog';
import { buildAuthLabels } from '@/lib/labels';
import type { Locale } from '@/i18n';
import {
  deleteSubmission,
  type DeleteOnStep,
  type DeleteStepId,
  type StepState,
} from '@/lib/editor/pipeline';
import { renderCard, type CardLabels } from '@/lib/ui';
import type { IndexFile, Platform, RepoInfo, SubmissionEntry } from '@/types';

export interface CollectionLabels extends CardLabels {
  submit: string;
  edit: string;
  delete: string;
  deleteConfirmText: string;
  deleteSubmissionTitle: string;
  deleteSubmissionHint: string;
  deleteStepFiles: string;
  deleteStepRelease: string;
  deleteStepIndex: string;
  deleteFailed: string;
  deleteRetry: string;
  deleteDone: string;
  loginRequired: string;
  login: string;
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
  const localArchivePromises: Promise<SubmissionEntry[]>[] = [];
  // 读取指定平台内容仓的本地索引（失败静默降级为空）
  const readLocalArchive = (p: Platform): Promise<SubmissionEntry[]> =>
    (async () => {
      const adapter = await getAdapterAsync(p);
      const raw = await adapter.readFile(user, repo, 'svp-archive.json');
      const archive = JSON.parse(raw) as IndexFile;
      return Array.isArray(archive.submissions)
        ? archive.submissions.filter((e) => e.owner === user && e.repo === repo)
        : [];
    })().catch(() => [] as SubmissionEntry[]);

  if (await isMockAvailable()) {
    fromIndex.push(...(await loadMockIndex()).submissions.filter((e) => e.owner === user && e.repo === repo));
    platform = fromIndex[0]?.platform ?? null;
    if (platform) localArchivePromises.push(readLocalArchive(platform));
  } else {
    for await (const entry of iterateAllSubmissions()) {
      if (entry.owner !== user || entry.repo !== repo) continue;
      fromIndex.push(entry);
      if (!platform) {
        platform = entry.platform;
        localArchivePromises.push(readLocalArchive(platform));
      }
    }
    if (!platform) {
      // 索引未收录该仓库（如索引 PR 未合并）：按线路源平台并行尝试本地索引
      const sources = await getLineSources();
      for (const p of [...new Set(sources.map((source) => source.platform))]) {
        localArchivePromises.push(readLocalArchive(p));
      }
    }
  }

  // 合并：同 slug 以本地索引为准（发布时直接写入，时间戳/属性更新）
  const bySlug = new Map(fromIndex.map((entry) => [entry.slug, entry]));
  for (const list of await Promise.all(localArchivePromises)) {
    for (const entry of list) bySlug.set(entry.slug, entry);
  }
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

/** 删除稿件：确认输入 slug 后执行（文件 / 关联发布 / 索引条目），失败可整体重试 */
function openDeleteSubmissionDialog(
  labels: CollectionLabels,
  locale: string,
  entry: SubmissionEntry,
  mock: boolean,
): void {
  const { slug } = entry;
  const token = getToken(entry.platform);

  // 未登录稿件所在平台：引导授权（弹窗预选该平台）
  if (!token) {
    const { overlay, body } = dialogShell(labels.deleteSubmissionTitle);
    const hint = document.createElement('p');
    hint.className = 'text-sm text-slate-500 dark:text-slate-400';
    hint.textContent = labels.loginRequired;
    const buttons = document.createElement('div');
    buttons.className = 'mt-4 flex justify-end gap-2';
    const login = document.createElement('button');
    login.type = 'button';
    login.className = 'btn btn-primary';
    login.textContent = labels.login;
    login.addEventListener('click', () => {
      overlay.remove();
      void openAuthDialog(buildAuthLabels(locale as Locale), entry.platform);
    });
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn';
    close.textContent = labels.cancel;
    close.addEventListener('click', () => overlay.remove());
    buttons.append(close, login);
    body.append(hint, buttons);
    document.body.appendChild(overlay);
    return;
  }

  // 第一步：输入 slug 二次确认
  const { overlay, body } = dialogShell(`${labels.deleteSubmissionTitle}: ${slug}`);
  const hint = document.createElement('p');
  hint.className = 'text-sm text-slate-500 dark:text-slate-400';
  hint.textContent = labels.deleteSubmissionHint;
  const input = document.createElement('input');
  input.className = 'input mt-3 w-full';
  input.placeholder = slug;
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
  confirm.dataset.action = 'confirm-delete-submission';
  confirm.disabled = true;
  confirm.textContent = labels.delete;
  input.addEventListener('input', () => {
    confirm.disabled = input.value.trim() !== slug;
  });
  buttons.append(cancel, confirm);
  body.append(hint, input, buttons);
  document.body.appendChild(overlay);

  // 第二步：执行并在原对话框内展示步骤进度
  const runFlow = (): void => {
    body.textContent = '';
    const stepLabels: { id: DeleteStepId; text: string }[] = [
      { id: 'files', text: labels.deleteStepFiles },
      { id: 'release', text: labels.deleteStepRelease },
      { id: 'index', text: labels.deleteStepIndex },
    ];
    const rows = new Map<DeleteStepId, { row: HTMLElement; detail: HTMLElement }>();
    for (const step of stepLabels) {
      const row = document.createElement('p');
      row.className = 'mt-2 flex items-start gap-2 text-sm';
      const mark = document.createElement('span');
      mark.className = 'shrink-0 text-slate-400';
      mark.textContent = '○';
      const wrap = document.createElement('span');
      wrap.className = 'min-w-0';
      wrap.appendChild(document.createTextNode(step.text));
      const detail = document.createElement('span');
      detail.className = 'block truncate text-xs text-slate-400';
      wrap.appendChild(detail);
      row.append(mark, wrap);
      body.appendChild(row);
      rows.set(step.id, { row, detail });
    }

    const stateMark: Record<StepState, string> = {
      pending: '○',
      running: '…',
      done: '✓',
      warning: '⚠',
      error: '✗',
    };
    const stateColor: Record<StepState, string> = {
      pending: 'text-slate-400',
      running: 'text-indigo-600',
      done: 'text-emerald-600',
      warning: 'text-amber-500',
      error: 'text-rose-600',
    };
    const onStep: DeleteOnStep = (id, state, detail) => {
      const target = rows.get(id);
      if (!target) return;
      const mark = target.row.firstElementChild as HTMLElement;
      mark.textContent = stateMark[state];
      mark.className = `shrink-0 ${stateColor[state]}`;
      if (detail) {
        target.detail.textContent =
          state === 'done' && /^https?:/.test(detail) ? detail.slice(0, 60) : detail.slice(0, 120);
      }
    };

    const error = document.createElement('p');
    error.className = 'hidden text-sm text-rose-600';
    const actions = document.createElement('div');
    actions.className = 'mt-4 flex justify-end gap-2';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn';
    close.textContent = labels.cancel;
    close.addEventListener('click', () => overlay.remove());
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn btn-primary';
    retry.dataset.action = 'retry-delete';
    retry.textContent = labels.deleteRetry;
    retry.addEventListener('click', () => {
      retry.setAttribute('disabled', '');
      error.classList.add('hidden');
      for (const step of stepLabels) onStep(step.id, 'pending');
      void execute();
    });
    actions.append(retry, close);
    body.append(error, actions);

    const execute = (): Promise<void> =>
      deleteSubmission(entry, token, mock, onStep)
        .then(() => {
          retry.remove();
          close.textContent = labels.deleteDone;
          setTimeout(() => window.location.reload(), 900);
        })
        .catch((err: unknown) => {
          error.textContent = `${labels.deleteFailed}${
            err instanceof Error && err.message ? `：${err.message.slice(0, 160)}` : ''
          }`;
          error.classList.remove('hidden');
          retry.removeAttribute('disabled');
        });
    void execute();
  };

  confirm.addEventListener('click', () => {
    // 原对话框内容替换为步骤进度，保持弹窗不关闭
    runFlow();
  });
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
      // 管理按钮要求稿件所在平台已登录（删除/编辑都需要该平台的令牌）
      const canManage = loadSessionBy(entry.platform)?.login === user;
      els.list.appendChild(
        renderCard(entry, locale, labels, {
          compact: tab === 'article',
          engagement: engagements.get(`${user}/${repo}/${entry.slug}`),
          owner: canManage ? { editLabel: labels.edit, deleteLabel: labels.delete } : undefined,
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
  // 卡片删除按钮（renderCard 派发，冒泡到列表容器）
  els.list.addEventListener('svp:delete-submission', (event) => {
    const entry = (event as CustomEvent<SubmissionEntry>).detail;
    if (!entry) return;
    void isMockAvailable().then((mock) => {
      openDeleteSubmissionDialog(labels, locale, entry, mock);
    });
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
