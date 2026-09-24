import { LICENSE_OPTIONS, PAGE_SIZE } from '@/config';
import { loadEngagements, loadRepoInfo } from '@/lib/content';
import { iterateAllSubmissions } from '@/lib/index/loader';
import { getLineSources } from '@/lib/index/sources';
import { getAdapterAsync } from '@/lib/adapters/lazy';
import { withBase } from '@/lib/base';
import { loadSession, loadSessionBy, getToken } from '@/lib/auth';
import { spdxLicenseText } from '@/lib/utils';
import { getIndexSources, setStoredLine } from '@/lib/index/sources';
import { loadMirrorTargets } from '@/lib/index/mirrors';
import { openDeleteSubmissionDialog } from '@/lib/views/delete-submission';
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
  licenseCustomName: string;
  licenseCustomPh: string;
  licenseCustomRequired: string;
  mirrorsLabel: string;
  mirrorsPh: string;
  mirrorsInvalid: string;
  mirrorsAdd: string;
  saving: string;
  saveFailed: string;
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

/** 镜像仓库地址模式：当前支持的 git 平台（域名/属主/仓库） */
const MIRROR_ADDR_PATTERN =
  /^(github|gitee|atomgit|gitcode)\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const PLATFORM_HOST: Record<Platform, string> = {
  github: 'github.com',
  gitee: 'gitee.com',
  atomgit: 'atomgit.com',
  gitcode: 'gitcode.com',
};

/** 仓库地址（域名/属主/仓库，mirrors 键与值的统一形式） */
function repoAddress(platform: Platform, user: string, repo: string): string {
  return `${PLATFORM_HOST[platform]}/${user}/${repo}`;
}

/**
 * 镜像列表写入索引仓：index/mirrors.json 以源仓库地址为键、镜像仓库列表为值，
 * 单文件 PR 提交（源选择与稿件同平台优先，无则回退主源）。
 */
async function submitMirrorsIndexPr(
  token: string,
  platform: Platform,
  sourceAddr: string,
  mirrors: string[],
): Promise<void> {
  const sources = await getIndexSources();
  const source = sources.find((s) => s.platform === platform) ?? sources[0]!;
  const adapter = await getAdapterAsync(source.platform);
  let map: Record<string, string[]> = {};
  try {
    const raw = await adapter.readFile(source.owner, source.repo, 'index/mirrors.json', source.branch);
    map = JSON.parse(raw) as Record<string, string[]>;
  } catch {
    /* 文件不存在时新建 */
  }
  map[sourceAddr] = mirrors;
  await adapter.openIndexPr(
    token,
    { owner: source.owner, repo: source.repo, branch: source.branch },
    `mirrors: ${sourceAddr}`,
    [{ path: 'index/mirrors.json', content: `${JSON.stringify(map, null, 2)}\n`, encoding: 'utf-8' }],
  );
}

/** 仓库编辑框：许可证选择（含自定义全文）+ 镜像仓库列表 + 保存 */
function openEditDialog(
  labels: CollectionLabels,
  platform: Platform,
  user: string,
  repo: string,
  current: RepoInfo | null,
  onSaved: (license: string) => void,
): void {
  const { overlay, body } = dialogShell(labels.edit);

  const select = document.createElement('select');
  select.className = 'input w-full';
  select.setAttribute('data-field', 'repo-license');
  for (const option of LICENSE_OPTIONS) {
    if (!option.value) continue;
    const el = document.createElement('option');
    el.value = option.value;
    el.textContent = ('label' in option ? option.label : undefined) ?? option.value;
    select.appendChild(el);
  }
  const customOption = document.createElement('option');
  customOption.value = 'custom';
  customOption.textContent = labels.licenseCustomName;
  select.appendChild(customOption);

  // 当前许可证：已知 SPDX 选中对应项；未知（含平台识别不了的全文许可证）视为自定义
  const currentLicense = current?.license ?? '';
  const selectCurrent = (): void => {
    // 注意：select 未挂载文档时 WebKit 对 .value/.index 均不可靠，须在挂载后赋值
    const known = LICENSE_OPTIONS.some((option) => option.value === currentLicense);
    if (known && currentLicense) select.value = currentLicense;
    else if (currentLicense) select.value = 'custom';
    else select.selectedIndex = 0;
  };

  const textarea = document.createElement('textarea');
  textarea.className = 'input mt-2 min-h-28 w-full font-mono text-xs';
  textarea.placeholder = labels.licenseCustomPh;
  textarea.setAttribute('data-field', 'repo-license-text');
  textarea.hidden = true;
  const syncTextarea = (): void => {
    textarea.hidden = select.value !== 'custom';
  };
  select.addEventListener('change', syncTextarea);

  // ---- 镜像仓库列表：与新建投稿页的列表输入同款样式（行式输入+增删按钮），
  // 回填自 svp-archive.json 的 mirrors，失焦校验地址模式 ----
  const currentAddr = repoAddress(platform, user, repo);
  let initialMirrors: string[] = [currentAddr];
  let mirrorsLoaded = false; // 回填完成前不判定"已变更"
  const mirrorsBox = document.createElement('div');
  mirrorsBox.className = 'mt-4 flex flex-col gap-1';
  mirrorsBox.setAttribute('data-role', 'mirrors-box');
  const mirrorsLabel = document.createElement('label');
  mirrorsLabel.className = 'text-xs text-slate-500';
  mirrorsLabel.textContent = labels.mirrorsLabel;
  const mirrorRows = document.createElement('div');
  mirrorRows.className = 'flex flex-col gap-1';
  const mirrorError = document.createElement('p');
  mirrorError.className = 'hidden text-xs text-rose-600';
  mirrorsBox.append(mirrorsLabel, mirrorRows, mirrorError);

  /** 收集行输入的镜像地址（去空、去重、排除源仓库自身） */
  const collectMirrors = (): string[] => {
    const values: string[] = [];
    for (const input of Array.from(mirrorRows.querySelectorAll<HTMLInputElement>('input'))) {
      const value = input.value.trim().toLowerCase();
      if (!value) continue;
      if (value === currentAddr || values.includes(value)) continue;
      values.push(value);
    }
    return values;
  };

  const mirrorAdd = document.createElement('button');
  mirrorAdd.type = 'button';
  mirrorAdd.className = 'btn px-2.5';
  mirrorAdd.textContent = '+';
  mirrorAdd.title = labels.mirrorsAdd;
  mirrorAdd.setAttribute('aria-label', labels.mirrorsAdd);
  mirrorAdd.setAttribute('data-action', 'add-mirror');
  const addMirrorRow = (value = ''): void => {
    const row = document.createElement('div');
    row.className = 'flex gap-2';
    const input = document.createElement('input');
    input.className = 'input flex-1';
    input.value = value;
    input.placeholder = labels.mirrorsPh;
    input.setAttribute('data-field', 'repo-mirror');
    // 失焦校验：非法地址红框提示（保存时统一拦截）
    input.addEventListener('change', () => {
      const value = input.value.trim().toLowerCase();
      input.classList.toggle('border-rose-500', !!value && !MIRROR_ADDR_PATTERN.test(value));
      if (!value || MIRROR_ADDR_PATTERN.test(value)) mirrorError.classList.add('hidden');
    });
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn px-2.5';
    removeBtn.textContent = '×';
    removeBtn.setAttribute('data-action', 'remove-mirror');
    removeBtn.addEventListener('click', () => {
      row.remove();
      if (mirrorRows.children.length === 0) addMirrorRow();
    });
    row.append(input, removeBtn);
    mirrorRows.appendChild(row);
    row.appendChild(mirrorAdd);
  };
  mirrorAdd.addEventListener('click', () => {
    addMirrorRow();
    const inputs = mirrorRows.querySelectorAll('input');
    inputs[inputs.length - 1]?.focus();
  });
  addMirrorRow();

  const error = document.createElement('p');
  error.className = 'mt-2 hidden text-xs text-rose-600';
  error.dataset.role = 'license-error';

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
    void (async () => {
      error.classList.add('hidden');
      mirrorError.classList.add('hidden');
      const isCustom = select.value === 'custom';
      const customText = textarea.value.trim();
      if (isCustom && !customText) {
        error.textContent = labels.licenseCustomRequired;
        error.classList.remove('hidden');
        return;
      }
      const licenseChanged = isCustom || select.value !== currentLicense;
      const mirrors = collectMirrors();
      // 非法地址（红框）或空行有内容时拦截保存
      const invalidMirror = mirrors.some((addr) => !MIRROR_ADDR_PATTERN.test(addr));
      if (invalidMirror) {
        mirrorError.textContent = labels.mirrorsInvalid;
        mirrorError.classList.remove('hidden');
        return;
      }
      const mirrorsChanged =
        mirrorsLoaded && JSON.stringify([currentAddr, ...mirrors]) !== JSON.stringify(initialMirrors);
      // 均未变更时直接关闭，不产生提交
      if (!licenseChanged && !mirrorsChanged) {
        overlay.remove();
        return;
      }
      const token = getToken(platform);
      if (!token) {
        error.textContent = labels.saveFailed;
        error.classList.remove('hidden');
        return;
      }
      save.disabled = true;
      save.textContent = labels.saving;
      try {
        const adapter = await getAdapterAsync(platform);
        if (licenseChanged) {
          // 许可证全文写入仓库根目录 LICENSE（自定义用输入全文，SPDX 取标准全文）
          const content = isCustom ? customText : await spdxLicenseText(select.value);
          await adapter.commitFiles(token, user, repo, 'Update license', [
            { path: 'LICENSE', content, encoding: 'utf-8' },
          ]);
        }
        if (mirrorsChanged) {
          // mirrors 列表：当前仓库地址在前，镜像地址按输入顺序
          const list = [currentAddr, ...mirrors];
          let archive: { submissions?: unknown; mirrors?: string[] } = { submissions: [] };
          try {
            archive = JSON.parse(await adapter.readFile(user, repo, 'svp-archive.json')) as typeof archive;
          } catch {
            /* 归档缺失时新建 */
          }
          archive.mirrors = list;
          await adapter.commitFiles(token, user, repo, 'Update mirrors', [
            { path: 'svp-archive.json', content: `${JSON.stringify(archive, null, 2)}\n`, encoding: 'utf-8' },
          ]);
          // 索引仓 mirrors.json：源仓库地址为键，列表为值（单文件 PR）
          await submitMirrorsIndexPr(token, platform, currentAddr, list);
        }
        onSaved(isCustom ? labels.licenseCustomName : select.value);
        overlay.remove();
      } catch (saveError) {
        save.disabled = false;
        save.textContent = labels.save;
        error.textContent = `${labels.saveFailed}${
          saveError instanceof Error && saveError.message ? `：${saveError.message.slice(0, 120)}` : ''
        }`;
        error.classList.remove('hidden');
      }
    })();
  });
  buttons.append(cancel, save);
  body.append(select, textarea, error, mirrorsBox, buttons);
  document.body.appendChild(overlay);
  // 挂载后再定位当前选项并同步文本框显隐（WebKit 未挂载 select 赋值不可靠）
  selectCurrent();
  syncTextarea();

  // 回填现有镜像（svp-archive.json 的 mirrors 去掉源仓库自身）
  void (async () => {
    try {
      const adapter = await getAdapterAsync(platform);
      const raw = await adapter.readFile(user, repo, 'svp-archive.json');
      const archive = JSON.parse(raw) as { mirrors?: string[] };
      const existing = (archive.mirrors ?? []).filter(
        (addr) => addr !== currentAddr && MIRROR_ADDR_PATTERN.test(addr),
      );
      // 逐行填入已有镜像（首行预置为空行时替换）
      if (existing.length) {
        mirrorRows.textContent = '';
        for (const addr of existing) addMirrorRow(addr);
      }
      initialMirrors = [currentAddr, ...existing];
    } catch {
      /* 归档缺失时列表为空 */
    }
    mirrorsLoaded = true;
  })();
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

  let entries = await loadRepoEntries(user, repo);
  let platform: Platform = entries[0]?.platform ?? 'github';
  /** 数据读取目标（镜像回退成功后为镜像仓库） */
  let dataOwner = user;
  let dataRepo = repo;
  if (!entries.length) {
    // 内容仓数据不可得（索引未收录且本地索引读取失败）：按索引 mirrors 依次尝试镜像仓的 svp-archive.json
    for (const target of await loadMirrorTargets(user, repo)) {
      try {
        const adapter = await getAdapterAsync(target.platform);
        const raw = await adapter.readFile(target.owner, target.repo, 'svp-archive.json');
        const archive = JSON.parse(raw) as IndexFile;
        const list = (Array.isArray(archive.submissions) ? archive.submissions : []).filter(
          (e) => e.owner === user && e.repo === repo,
        );
        if (!list.length) continue;
        entries = list;
        platform = target.platform;
        dataOwner = target.owner;
        dataRepo = target.repo;
        // 线路切换为镜像平台（不重载，避免索引平台自动切回）
        setStoredLine(platform);
        break;
      } catch {
        /* 该镜像不可用，尝试下一个 */
      }
    }
  }
  // 部分平台仓库详情接口匿名受限：拉取失败时降级为无 stars/许可证展示
  let repoInfo = await loadRepoInfo(platform, dataOwner, dataRepo).catch(() => null);

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
      openEditDialog(labels, platform, user, repo, repoInfo, (license) => {
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
      // btn 基类两态都保留（选中只叠加 btn-primary），否则选中态丢失按钮基础样式
      btn.classList.toggle('btn-primary', btn.dataset.tab === tab);
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
    void openDeleteSubmissionDialog(entry, locale);
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
