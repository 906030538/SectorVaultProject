import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { CONTENT_REPO_PREFIX, EDITOR_LIMITS, LIST_CANDIDATES, SUPPORTED_PLATFORMS } from '@/config';
import { getAdapterAsync } from '@/lib/adapters/lazy';
import { getToken, loadSession, saveSession, setToken } from '@/lib/auth';
import { isMockAvailable, loadReleases, loadSubmissionContent, type ProjectFile } from '@/lib/content';
import {
  defaultScheme,
  detectTextLike,
  formatBytes,
  isOversize,
  newEditorFileId,
  type EditorFile,
  type UploadScheme,
} from '@/lib/editor/files';
import {
  publishSubmission,
  updateSubmission,
  type EditContext,
  type OnStep,
  type PublishProgress,
  type StepId,
  type SubmissionDraft,
} from '@/lib/editor/pipeline';
import { findEntry, loadMockIndex } from '@/lib/index/loader';
import type { ParamStatus, Platform, ReleaseAsset, SubmissionEntry, SubmissionType } from '@/types';

export interface EditorLabels {
  demoBanner: string;
  repo: string;
  slug: string;
  typeLabel: string;
  titleLabel: string;
  titlePh: string;
  videos: string;
  add: string;
  remove: string;
  limitHint: string;
  params: string;
  cover: string;
  coverChoose: string;
  coverReplace: string;
  coverRemove: string;
  body: string;
  write: string;
  preview: string;
  tagsLabel: string;
  tagsPh: string;
  files: string;
  filesHint: string;
  fileTooLarge: string;
  scheme: string;
  schemeRaw: string;
  schemeFormat: string;
  schemeZip: string;
  schemeEncrypt: string;
  attachments: string;
  attachmentChoose: string;
  summary: string;
  submittedAt: string;
  publishedAt: string;
  existing: string;
  license: string;
  authRequired: string;
  platform: string;
  tokenPh: string;
  tokenSave: string;
  tokenBad: string;
  submit: string;
  save: string;
  publishing: string;
  stepIssue: string;
  stepFiles: string;
  stepReadme: string;
  stepRelease: string;
  stepAssets: string;
  stepIndex: string;
  stepCover: string;
  stepSkipped: string;
  retry: string;
  skipStep: string;
  redirectIn: string;
  goNow: string;
  cancelRedirect: string;
  doneNew: string;
  doneEdit: string;
  gotoCollection: string;
  gotoSubmission: string;
  errTitle: string;
  errSlug: string;
  errRepo: string;
  errPassword: string;
  errCoverType: string;
  errLoad: string;
  typeProject: string;
  typeArticle: string;
  paramsWith: string;
  paramsTuned: string;
  paramsNone: string;
  tracks: string;
  engines: string;
  voicebanks: string;
  songLanguages: string;
}

export interface EditorConfig {
  mode: 'new' | 'edit';
  user?: string;
  repo?: string;
  slug?: string;
  licenseOptions: { value: string; label: string }[];
}

type ListKind = 'videos' | 'tracks' | 'engines' | 'voicebanks' | 'songLanguages';
const LIST_KINDS: ListKind[] = ['videos', 'tracks', 'engines', 'voicebanks', 'songLanguages'];

interface EditorState {
  user: string;
  repo: string;
  platform: Platform;
  slug: string;
  type: SubmissionType;
  title: string;
  params: ParamStatus;
  lists: Record<ListKind, string[]>;
  body: string;
  tags: string[];
  license: string;
  summary: string;
  submittedAt: string;
  publishedAt: string;
  cover: File | null;
  coverName: string;
  coverRemoved: boolean;
  files: EditorFile[];
  attachments: File[];
  removedAssets: ReleaseAsset[];
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

function todaySlug(): string {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

function section(title: string): { box: HTMLElement; content: HTMLElement } {
  const box = el('section', 'card flex flex-col gap-3 p-5');
  box.appendChild(el('h2', 'text-sm font-semibold', title));
  const content = el('div', 'flex flex-col gap-2');
  box.appendChild(content);
  return { box, content };
}

/** 登录门控（仅真实模式）：平台下拉 + token 粘贴验证 */
function renderAuthGate(root: HTMLElement, labels: EditorLabels): void {
  root.textContent = '';
  const card = el('div', 'card flex max-w-md flex-col gap-3 p-6');
  card.setAttribute('data-role', 'auth');
  card.appendChild(el('p', 'text-sm font-medium', labels.authRequired));

  const platformSelect = el('select', 'input w-full');
  platformSelect.setAttribute('data-field', 'platform');
  for (const platform of SUPPORTED_PLATFORMS) {
    const option = el('option', undefined, platform);
    option.value = platform;
    platformSelect.appendChild(option);
  }

  const tokenInput = el('input', 'input w-full');
  tokenInput.type = 'password';
  tokenInput.placeholder = labels.tokenPh;
  tokenInput.setAttribute('data-field', 'token');

  const error = el('p', 'hidden text-sm text-rose-600', labels.tokenBad);

  const button = el('button', 'btn btn-primary', labels.tokenSave);
  button.type = 'button';
  button.addEventListener('click', async () => {
    const platform = platformSelect.value as Platform;
    const token = tokenInput.value.trim();
    if (!token) return;
    try {
      const viewer = await (await getAdapterAsync(platform)).getViewer(token);
      setToken(platform, token);
      saveSession(viewer);
      window.location.reload();
    } catch {
      error.classList.remove('hidden');
    }
  });

  card.append(el('label', 'text-xs text-slate-500', labels.platform), platformSelect, tokenInput, error, button);
  root.appendChild(card);
}

function renderListInput(
  kind: ListKind,
  label: string,
  labels: EditorLabels,
  state: EditorState,
): HTMLElement {
  const box = el('div', 'flex flex-col gap-1');
  box.setAttribute('data-role', `list-${kind}`);
  box.appendChild(el('label', 'text-xs text-slate-500', label));
  const rows = el('div', 'flex flex-col gap-1');
  box.appendChild(rows);

  // 候选下拉（datalist）：不限制输入，仅提供建议
  const candidates = LIST_CANDIDATES[kind];
  if (candidates) {
    const datalist = el('datalist');
    datalist.id = `svp-candidates-${kind}`;
    for (const value of candidates) {
      const option = document.createElement('option');
      option.value = value;
      datalist.appendChild(option);
    }
    box.appendChild(datalist);
  }

  // 超限提示：仅在尝试添加超过上限时短暂显示
  const hint = el('p', 'hidden text-xs text-amber-600', labels.limitHint);
  let hintTimer = 0;
  const showLimitHint = (): void => {
    hint.classList.remove('hidden');
    window.clearTimeout(hintTimer);
    hintTimer = window.setTimeout(() => hint.classList.add('hidden'), 3000);
  };

  const sync = (): void => {
    const inputs = rows.querySelectorAll<HTMLInputElement>('input');
    state.lists[kind] = Array.from(inputs).map((input) => input.value);
  };

  // 添加按钮跟随最后一行，与删除按钮同排
  const addBtn = el('button', 'btn px-2.5', '+');
  addBtn.type = 'button';
  addBtn.title = labels.add;
  addBtn.setAttribute('aria-label', labels.add);
  addBtn.setAttribute('data-action', 'add');
  addBtn.addEventListener('click', () => {
    if (rows.children.length >= EDITOR_LIMITS.listValues) {
      showLimitHint();
      return;
    }
    addRow();
    const inputs = rows.querySelectorAll('input');
    inputs[inputs.length - 1]?.focus();
  });

  const addRow = (value = ''): void => {
    if (rows.children.length >= EDITOR_LIMITS.listValues) return;
    const row = el('div', 'flex gap-2');
    const input = el('input', 'input flex-1');
    if (candidates) input.setAttribute('list', `svp-candidates-${kind}`);
    input.value = value;
    input.addEventListener('input', sync);
    const removeBtn = el('button', 'btn px-2.5', '×');
    removeBtn.type = 'button';
    removeBtn.setAttribute('data-action', 'remove');
    removeBtn.addEventListener('click', () => {
      row.remove();
      if (rows.children.length === 0) addRow();
      sync();
    });
    row.append(input, removeBtn);
    rows.appendChild(row);
    row.appendChild(addBtn);
    sync();
  };

  for (const value of state.lists[kind]) addRow(value);
  if (rows.children.length === 0) addRow();
  box.appendChild(hint);
  return box;
}

function renderTagEditor(
  labels: EditorLabels,
  state: EditorState,
): { box: HTMLElement; refresh: () => void } {
  const box = el('div', 'flex flex-col gap-1');
  box.appendChild(el('label', 'text-xs text-slate-500', labels.tagsLabel));
  const chips = el('div', 'flex flex-wrap gap-2');
  chips.setAttribute('data-role', 'tag-chips');
  const input = el('input', 'input');
  input.placeholder = labels.tagsPh;
  input.setAttribute('data-field', 'tags');

  const render = (): void => {
    chips.textContent = '';
    for (const tag of state.tags) {
      const chip = el('span', 'chip flex items-center gap-1', `#${tag}`);
      const x = el('button', 'text-slate-400 hover:text-rose-500', '×');
      x.type = 'button';
      x.addEventListener('click', () => {
        state.tags = state.tags.filter((t) => t !== tag);
        render();
      });
      chip.appendChild(x);
      chips.appendChild(chip);
    }
  };

  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const value = input.value.trim();
    if (!value || state.tags.includes(value) || state.tags.length >= EDITOR_LIMITS.tags) return;
    state.tags.push(value);
    input.value = '';
    render();
  });

  box.append(input, chips);
  return { box, refresh: render };
}

/** 可视化 Markdown 编辑器：工具栏 + 编写/预览双 tab */
function renderMarkdownEditor(labels: EditorLabels, state: EditorState): HTMLElement {
  const box = el('div', 'flex flex-col gap-1');
  box.appendChild(el('label', 'text-xs text-slate-500', labels.body));

  const toolbar = el('div', 'flex flex-wrap gap-1');
  const textarea = el('textarea', 'input min-h-48 font-mono text-sm');
  textarea.placeholder = 'Markdown';
  textarea.setAttribute('data-field', 'body');
  textarea.value = state.body;
  textarea.addEventListener('input', () => {
    state.body = textarea.value;
  });

  const preview = el('div', 'prose-svp hidden min-h-48 rounded-lg border border-slate-200 p-3 dark:border-slate-700');
  preview.setAttribute('data-role', 'preview');

  const writeTab = el('button', 'btn btn-primary', labels.write);
  const previewTab = el('button', 'btn', labels.preview);
  writeTab.type = 'button';
  previewTab.type = 'button';
  writeTab.setAttribute('data-action', 'write');
  previewTab.setAttribute('data-action', 'preview');

  const show = (mode: 'write' | 'preview'): void => {
    const writing = mode === 'write';
    textarea.classList.toggle('hidden', !writing);
    preview.classList.toggle('hidden', writing);
    writeTab.classList.toggle('btn-primary', writing);
    previewTab.classList.toggle('btn-primary', !writing);
    if (!writing) {
      const html = marked.parse(state.body);
      if (html instanceof Promise) {
        void html.then((text) => {
          preview.innerHTML = DOMPurify.sanitize(text) as string;
        });
      } else {
        preview.innerHTML = DOMPurify.sanitize(html) as string;
      }
    }
  };
  writeTab.addEventListener('click', () => show('write'));
  previewTab.addEventListener('click', () => show('preview'));

  const apply = (before: string, after = before, linePrefix?: string): void => {
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    const selected = textarea.value.slice(start, end) || 'text';
    let next: string;
    if (linePrefix) {
      const lines = textarea.value.split('\n');
      let pos = 0;
      for (let i = 0; i < lines.length; i += 1) {
        const lineEnd = pos + lines[i].length;
        if (start >= pos && start <= lineEnd) {
          lines[i] = `${linePrefix}${lines[i]}`;
          break;
        }
        pos = lineEnd + 1;
      }
      next = lines.join('\n');
    } else {
      next = textarea.value.slice(0, start) + before + selected + after + textarea.value.slice(end);
    }
    textarea.value = next;
    state.body = next;
    textarea.focus();
  };

  const tools: [string, () => void][] = [
    ['B', () => apply('**')],
    ['I', () => apply('*')],
    ['H', () => apply('', undefined, '## ')],
    ['🔗', () => apply('[', '](https://)')],
    ['•', () => apply('', undefined, '- ')],
    ['<>', () => apply('```\n', '\n```')],
    ['❝', () => apply('', undefined, '> ')],
  ];
  for (const [text, fn] of tools) {
    const btn = el('button', 'btn px-2', text);
    btn.type = 'button';
    btn.addEventListener('click', fn);
    toolbar.appendChild(btn);
  }

  box.append(toolbar, el('div', 'flex gap-2', undefined), writeTab, previewTab, textarea, preview);
  // 将 tab 按钮放进同一行
  const tabs = box.children[2] as HTMLElement;
  tabs.append(writeTab, previewTab);
  return box;
}

function schemeOptions(labels: EditorLabels): [UploadScheme, string][] {
  return [
    ['raw', labels.schemeRaw],
    ['format', labels.schemeFormat],
    ['zip', labels.schemeZip],
    ['encrypt', labels.schemeEncrypt],
  ];
}

function renderFileRows(
  labels: EditorLabels,
  state: EditorState,
  rows: HTMLElement,
): void {
  rows.textContent = '';
  for (const item of state.files) {
    const row = el('div', 'flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2 text-sm dark:border-slate-700');
    const size = item.file ? formatBytes(item.file.size) : '';
    row.appendChild(el('span', 'font-medium', `${item.name}${size ? ` · ${size}` : ''}`));
    if (item.existing) row.appendChild(el('span', 'chip', labels.existing));
    if (item.file && isOversize(item.file)) {
      row.appendChild(el('span', 'text-xs text-amber-600', labels.fileTooLarge));
    }

    const select = el('select', 'input w-32');
    select.setAttribute('data-role', 'select-scheme');
    if (item.existing) select.disabled = true;
    const effective: UploadScheme = item.existing
      ? item.existing.encrypted
        ? 'encrypt'
        : item.existing.compressed
          ? 'zip'
          : 'raw'
      : item.scheme;
    for (const [value, label] of schemeOptions(labels)) {
      const option = el('option', undefined, label);
      option.value = value;
      option.selected = value === effective;
      select.appendChild(option);
    }
    select.value = effective;
    select.addEventListener('change', () => {
      item.scheme = select.value as UploadScheme;
      passwordInput.classList.toggle('hidden', item.scheme !== 'encrypt');
    });

    const passwordInput = el('input', `input w-32${item.scheme === 'encrypt' ? '' : ' hidden'}`);
    passwordInput.type = 'password';
    passwordInput.placeholder = labels.schemeEncrypt;
    passwordInput.setAttribute('data-role', 'file-password');
    passwordInput.value = item.password;
    passwordInput.addEventListener('input', () => {
      item.password = passwordInput.value;
    });

    const removeBtn = el('button', 'btn', '×');
    removeBtn.type = 'button';
    removeBtn.setAttribute('data-action', 'remove-file');
    removeBtn.addEventListener('click', () => {
      state.files = state.files.filter((f) => f.id !== item.id);
      renderFileRows(labels, state, rows);
    });

    row.append(select, passwordInput, removeBtn);
    rows.appendChild(row);
  }
}

function renderFileControl(labels: EditorLabels, state: EditorState): HTMLElement {
  const { box, content } = section(labels.files);
  content.appendChild(el('p', 'text-xs text-slate-400', labels.filesHint));

  const rows = el('div', 'flex flex-col gap-2');
  rows.setAttribute('data-role', 'file-rows');

  const input = el('input');
  input.type = 'file';
  input.multiple = true;
  input.setAttribute('data-field', 'files');
  input.addEventListener('change', async () => {
    const picked = Array.from(input.files ?? []);
    for (const file of picked) {
      const textLike = await detectTextLike(file);
      state.files.push({
        id: newEditorFileId(),
        file,
        name: file.name,
        scheme: defaultScheme(textLike),
        password: '',
        textLike,
      });
    }
    input.value = '';
    renderFileRows(labels, state, rows);
  });

  renderFileRows(labels, state, rows);
  content.append(input, rows);
  return box;
}

/** 发布简介：默认单行，输入换行时自动增高；新建投稿时写入 release 正文 */
function renderSummaryControl(labels: EditorLabels, state: EditorState): HTMLElement {
  const box = el('div', 'flex flex-col gap-1');
  box.appendChild(el('label', 'text-xs text-slate-500', labels.summary));
  const input = el('textarea', 'input resize-none');
  input.rows = 1;
  input.setAttribute('data-field', 'summary');
  const resize = (): void => {
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
  };
  input.addEventListener('input', () => {
    state.summary = input.value;
    resize();
  });
  box.appendChild(input);
  return box;
}

function renderAttachmentControl(
  labels: EditorLabels,
  state: EditorState,
  getOldAssets: () => ReleaseAsset[],
): { box: HTMLElement; refresh: () => void } {
  const { box, content } = section(labels.attachments);
  const rows = el('div', 'flex flex-col gap-2');
  rows.setAttribute('data-role', 'attachment-rows');

  const render = (): void => {
    rows.textContent = '';
    for (const asset of getOldAssets()) {
      if (state.removedAssets.some((a) => a.name === asset.name)) continue;
      const row = el('div', 'flex items-center gap-2 rounded-lg border border-slate-200 p-2 text-sm dark:border-slate-700');
      row.appendChild(el('span', 'flex-1', `${asset.name} · ${formatBytes(asset.size)}`));
      const removeBtn = el('button', 'btn', '×');
      removeBtn.type = 'button';
      removeBtn.addEventListener('click', () => {
        state.removedAssets.push(asset);
        render();
      });
      row.appendChild(removeBtn);
      rows.appendChild(row);
    }
    for (const file of state.attachments) {
      const row = el('div', 'flex items-center gap-2 rounded-lg border border-slate-200 p-2 text-sm dark:border-slate-700');
      row.appendChild(el('span', 'flex-1', `${file.name} · ${formatBytes(file.size)}`));
      const removeBtn = el('button', 'btn', '×');
      removeBtn.type = 'button';
      removeBtn.addEventListener('click', () => {
        state.attachments = state.attachments.filter((f) => f !== file);
        render();
      });
      row.appendChild(removeBtn);
      rows.appendChild(row);
    }
  };

  const input = el('input');
  input.type = 'file';
  input.multiple = true;
  input.setAttribute('data-field', 'attachments');
  input.addEventListener('change', () => {
    state.attachments.push(...Array.from(input.files ?? []));
    input.value = '';
    render();
  });

  render();
  content.append(el('label', 'text-xs text-slate-500', labels.attachmentChoose), input, rows);
  return { box, refresh: render };
}

function renderCoverControl(labels: EditorLabels, state: EditorState, editable: boolean): HTMLElement {
  const { box, content } = section(labels.cover);
  const info = el('p', 'text-sm text-slate-500');

  const input = el('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.setAttribute('data-field', 'cover');
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    state.cover = file;
    state.coverName = file.name;
    state.coverRemoved = false;
    refresh();
  });

  const removeBtn = el('button', 'btn hidden', labels.coverRemove);
  removeBtn.type = 'button';
  removeBtn.setAttribute('data-action', 'remove-cover');
  removeBtn.addEventListener('click', () => {
    state.cover = null;
    state.coverName = '';
    state.coverRemoved = editable;
    input.value = '';
    refresh();
  });

  const refresh = (): void => {
    info.textContent = state.coverName || labels.coverChoose;
    removeBtn.classList.toggle('hidden', !state.coverName || !editable);
  };

  refresh();
  content.append(info, input, removeBtn);
  return box;
}

const STEP_LABEL_KEYS: Record<StepId, keyof EditorLabels> = {
  issue: 'stepIssue',
  files: 'stepFiles',
  readme: 'stepReadme',
  release: 'stepRelease',
  assets: 'stepAssets',
  index: 'stepIndex',
  cover: 'stepCover',
};

function renderProgress(labels: EditorLabels, steps: StepId[]): HTMLElement {
  const box = el('div', 'card flex flex-col gap-2 p-5');
  box.setAttribute('data-role', 'progress');
  for (const id of steps) {
    const row = el('div', 'flex items-center gap-2 text-sm');
    row.setAttribute('data-step', id);
    row.setAttribute('data-state', 'pending');
    const dot = el('span', 'inline-block h-2 w-2 rounded-full bg-slate-300');
    dot.setAttribute('data-role', 'step-dot');
    row.append(dot, el('span', undefined, labels[STEP_LABEL_KEYS[id]]), el('span', 'text-xs text-slate-400'));
    box.appendChild(row);
  }
  return box;
}

const DOT_COLOR: Record<string, string> = {
  pending: 'bg-slate-300',
  running: 'bg-emerald-500 animate-pulse',
  done: 'bg-indigo-500',
  warning: 'bg-amber-500',
  error: 'bg-rose-500',
};

function makeOnStep(progress: HTMLElement, labels: EditorLabels): { onStep: OnStep; fail: (message: string) => void } {
  const update = (id: StepId, stateName: string, detail?: string): void => {
    const row = progress.querySelector<HTMLElement>(`[data-step="${id}"]`);
    if (!row) return;
    row.setAttribute('data-state', stateName);
    const dot = row.querySelector<HTMLElement>('[data-role="step-dot"]');
    if (dot) dot.className = `inline-block h-2 w-2 rounded-full ${DOT_COLOR[stateName] ?? DOT_COLOR.pending}`;
    const detailEl = row.children[2];
    if (detailEl) {
      detailEl.textContent = stateName === 'warning' ? `${labels.stepSkipped}${detail ? `：${detail}` : ''}` : detail ?? '';
    }
  };
  const onStep: OnStep = (id, stateName, detail) => update(id, stateName, detail);
  const fail = (message: string): void => {
    const running = progress.querySelector<HTMLElement>('[data-state="running"]');
    if (running) update(running.getAttribute('data-step') as StepId, 'error', message);
  };
  return { onStep, fail };
}

/** 新投稿草稿与发布断点的 localStorage 键 */
const DRAFT_KEY = 'svp-draft-new';
const PROGRESS_KEY = 'svp-publish-progress';

/** 草稿快照：可序列化的表单状态（文件与附件不可序列化，不保存） */
interface DraftSnapshot {
  platform: Platform;
  user: string;
  repo: string;
  slug: string;
  type: SubmissionType;
  title: string;
  params: ParamStatus;
  lists: Record<ListKind, string[]>;
  body: string;
  tags: string[];
  license: string;
  summary: string;
  submittedAt: string;
  publishedAt: string;
}

function readDraft(): DraftSnapshot | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<DraftSnapshot>;
    return {
      platform: d.platform ?? 'github',
      user: d.user ?? '',
      repo: d.repo ?? '',
      slug: d.slug ?? '',
      type: d.type === 'article' ? 'article' : 'project',
      title: d.title ?? '',
      params: d.params ?? 'with-params',
      lists: {
        videos: d.lists?.videos ?? [],
        tracks: d.lists?.tracks ?? [],
        engines: d.lists?.engines ?? [],
        voicebanks: d.lists?.voicebanks ?? [],
        songLanguages: d.lists?.songLanguages ?? [],
      },
      body: d.body ?? '',
      tags: d.tags ?? [],
      license: d.license ?? '',
      summary: d.summary ?? '',
      submittedAt: d.submittedAt ?? '',
      publishedAt: d.publishedAt ?? '',
    };
  } catch {
    return null;
  }
}

/** 发布成功提示框：5 秒倒计时后跳转详情页，可取消（取消后展示完成链接面板） */
function showSuccessDialog(labels: EditorLabels, href: string, onCancel: () => void): void {
  const overlay = el('div', 'fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4');
  overlay.dataset.role = 'success-dialog';
  const card = el('div', 'card w-full max-w-sm p-6');
  card.appendChild(el('h2', 'text-lg font-semibold', labels.doneNew));
  const hint = el('p', 'mt-1 text-sm text-slate-500 dark:text-slate-400');
  card.appendChild(hint);
  const buttons = el('div', 'mt-4 flex justify-end gap-2');
  const cancel = el('button', 'btn', labels.cancelRedirect);
  cancel.type = 'button';
  cancel.dataset.action = 'cancel-redirect';
  const goNow = el('a', 'btn btn-primary', labels.goNow);
  goNow.href = href;
  goNow.dataset.action = 'goto-submission';
  buttons.append(cancel, goNow);
  card.appendChild(buttons);
  overlay.appendChild(card);

  let seconds = 5;
  let timer = 0;
  const tick = (): void => {
    hint.textContent = `${seconds} ${labels.redirectIn}`;
  };
  const stop = (): void => {
    window.clearInterval(timer);
    overlay.remove();
    onCancel();
  };
  cancel.addEventListener('click', stop);
  tick();
  timer = window.setInterval(() => {
    seconds -= 1;
    if (seconds <= 0) {
      window.clearInterval(timer);
      window.location.href = href;
      return;
    }
    tick();
  }, 1000);
  document.body.appendChild(overlay);
}

function renderDone(root: HTMLElement, labels: EditorLabels, config: EditorConfig, mode: 'new' | 'edit'): void {  const panel = el('div', 'card flex flex-col gap-3 p-6');
  panel.setAttribute('data-role', 'done');
  panel.appendChild(el('h2', 'text-lg font-semibold', mode === 'new' ? labels.doneNew : labels.doneEdit));
  const links = el('div', 'flex gap-2');
  const collection = el('a', 'btn', labels.gotoCollection);
  collection.href = `/view/${config.user}/${config.repo}`;
  collection.setAttribute('data-action', 'goto-collection');
  const submission = el('a', 'btn btn-primary', labels.gotoSubmission);
  submission.href = `/view/${config.user}/${config.repo}/${config.slug}`;
  submission.setAttribute('data-action', 'goto-submission');
  links.append(collection, submission);
  panel.appendChild(links);
  const progress = root.querySelector('[data-role="progress"]');
  root.textContent = '';
  if (progress) root.appendChild(progress);
  root.appendChild(panel);
}

/** ISO 时间 → datetime-local 输入值（本地时区，分钟精度） */
function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local 输入值 → ISO 时间；空值返回 undefined */
function inputValueToIso(value: string): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

function buildDraft(state: EditorState): SubmissionDraft {
  return {
    platform: state.platform,
    user: state.user,
    repo: state.repo,
    slug: state.slug,
    type: state.type,
    title: state.title,
    params: state.params,
    videos: state.lists.videos.filter(Boolean),
    tracks: state.lists.tracks.filter(Boolean),
    engines: state.lists.engines.filter(Boolean),
    voicebanks: state.lists.voicebanks.filter(Boolean),
    songLanguages: state.lists.songLanguages.filter(Boolean),
    body: state.body,
    tags: state.tags,
    license: state.license,
    summary: state.summary,
    submittedAt: inputValueToIso(state.submittedAt),
    publishedAt: inputValueToIso(state.publishedAt),
    cover: state.cover,
    files: state.files,
    attachments: state.attachments,
  };
}

function validate(state: EditorState, labels: EditorLabels, mode: 'new' | 'edit'): string[] {
  const errors: string[] = [];
  if (!state.title.trim()) errors.push(labels.errTitle);
  if (mode === 'new') {
    if (!state.repo) errors.push(labels.errRepo);
    if (!state.slug) errors.push(labels.errSlug);
  }
  if (state.cover && !state.cover.type.startsWith('image/')) errors.push(labels.errCoverType);
  for (const file of state.files) {
    if (!file.existing && file.scheme === 'encrypt' && !file.password) errors.push(labels.errPassword);
  }
  return errors;
}

export async function initEditor(
  config: EditorConfig,
  labels: EditorLabels,
  root: HTMLElement,
): Promise<void> {
  const mock = await isMockAvailable();

  root.textContent = '';
  if (mock) {
    const banner = el('p', 'mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-700 dark:bg-amber-950 dark:text-amber-300', labels.demoBanner);
    banner.setAttribute('data-role', 'demo-banner');
    root.appendChild(banner);
  } else {
    const session = loadSession();
    const token = session ? getToken(session.platform) : null;
    if (!session || !token) {
      renderAuthGate(root, labels);
      return;
    }
  }

  const form = el('form', 'flex max-w-3xl flex-col gap-5');
  form.addEventListener('submit', (event) => event.preventDefault());
  root.appendChild(form);

  const isEdit = config.mode === 'edit';

  // ---- 状态初始化 ----
  const state: EditorState = {
    user: config.user ?? '',
    repo: config.repo ?? '',
    platform: 'github',
    slug: config.slug ?? todaySlug(),
    type: 'project',
    title: '',
    params: 'with-params',
    lists: { videos: [], tracks: [], engines: [], voicebanks: [], songLanguages: [] },
    body: '',
    tags: [],
    license: '',
    summary: '',
    submittedAt: '',
    publishedAt: '',
    cover: null,
    coverName: '',
    coverRemoved: false,
    files: [],
    attachments: [],
    removedAssets: [],
  };

  // 草稿恢复时期望选中的仓库（fillRepoOptions 加载后应用；须在其定义前初始化避免 TDZ）
  let pendingRepoChoice = '';

  let oldFiles: ProjectFile[] = [];
  let oldAssets: ReleaseAsset[] = [];
  let issueAttr = '';
  let releaseId: number | null = null;
  let entryForCtx: SubmissionEntry | null = null;
  let oldCoverAttr: string | undefined;

  // ---- 投稿时间（新建可选：留空取发布点击时刻；编辑时隐藏不可变） ----
  const submittedAtBox = el('div', 'flex flex-col gap-1');
  submittedAtBox.appendChild(el('label', 'text-xs text-slate-500', labels.submittedAt));
  const submittedAtInput = el('input', 'input w-52');
  submittedAtInput.type = 'datetime-local';
  submittedAtInput.setAttribute('data-field', 'submittedAt');
  if (isEdit) submittedAtBox.hidden = true;
  submittedAtInput.addEventListener('input', () => {
    state.submittedAt = submittedAtInput.value;
    if (!isEdit) slugInput.placeholder = slugFallback();
  });
  submittedAtBox.appendChild(submittedAtInput);

  // ---- slug 回退值：投稿时间的日期 + 标题（未填投稿时间则今天）；用户输入后以输入为准 ----
  const dateSlug = todaySlug();
  const submittedSlug = (): string => {
    const value = submittedAtInput.value;
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
      return `${value.slice(2, 4)}${value.slice(5, 7)}${value.slice(8, 10)}`;
    }
    return dateSlug;
  };
  const slugFallback = (): string => {
    const title = state.title.trim();
    return title ? `${submittedSlug()}-${title}` : submittedSlug();
  };
  const resolveSlug = (): string => {
    if (isEdit) return state.slug;
    return slugInput.value.trim() || slugFallback();
  };

  // ---- 仓库 / 投稿时间 / slug / 类型（同一行） ----
  const row1 = el('div', 'flex flex-wrap items-end gap-3');
  const repoBox = el('div', 'flex flex-col gap-1');
  repoBox.appendChild(el('label', 'text-xs text-slate-500', labels.repo));
  const repoSelect = el('select', 'input w-56');
  repoSelect.setAttribute('data-field', 'repo');
  if (isEdit) repoSelect.disabled = true;
  repoBox.appendChild(repoSelect);

  const slugBox = el('div', 'flex flex-col gap-1');
  slugBox.appendChild(el('label', 'text-xs text-slate-500', labels.slug));
  const slugInput = el('input', 'input w-44');
  slugInput.setAttribute('data-field', 'slug');
  if (isEdit) {
    slugInput.value = state.slug;
    slugInput.readOnly = true;
  } else {
    slugInput.value = '';
  }
  slugInput.addEventListener('input', () => {
    state.slug = slugInput.value.trim();
  });
  slugBox.appendChild(slugInput);
  if (!isEdit) slugInput.placeholder = slugFallback();
  form.appendChild(row1);

  interface RepoOption {
    user: string;
    repo: string;
    platform: Platform;
  }
  const repoOptions: RepoOption[] = [];

  const applyRepoSelection = (): void => {
    const match = repoOptions.find((o) => `${o.user}/${o.repo}` === repoSelect.value);
    if (match) {
      state.user = match.user;
      state.repo = match.repo;
      state.platform = match.platform;
      config.user = match.user;
      config.repo = match.repo;
    }
  };
  repoSelect.addEventListener('change', applyRepoSelection);

  const fillRepoOptions = async (): Promise<void> => {
    if (isEdit) {
      const option = el('option', undefined, `${config.user}/${config.repo}`);
      option.value = `${config.user}/${config.repo}`;
      option.selected = true;
      repoSelect.appendChild(option);
      repoSelect.value = option.value;
      repoSelect.disabled = true;
      return;
    }
    if (mock) {
      const index = await loadMockIndex();
      const seen = new Set<string>();
      for (const u of index.users) {
        for (const ref of u.repos ?? []) {
          if (seen.has(ref.repo)) continue;
          seen.add(ref.repo);
          repoOptions.push({ user: u.owner, repo: ref.repo, platform: u.platform });
        }
      }
    } else {
      const session = loadSession();
      if (session) {
        const repos = await (await getAdapterAsync(session.platform)).listRepos(session.login, CONTENT_REPO_PREFIX);
        for (const repo of repos) {
          repoOptions.push({ user: session.login, repo: repo.name, platform: session.platform });
        }
      }
    }
    for (const option of repoOptions) {
      const node = el('option', undefined, `${option.user}/${option.repo}`);
      node.value = `${option.user}/${option.repo}`;
      repoSelect.appendChild(node);
    }
    if (repoOptions.length) {
      const first = `${repoOptions[0].user}/${repoOptions[0].repo}`;
      const wanted =
        pendingRepoChoice && repoOptions.some((o) => `${o.user}/${o.repo}` === pendingRepoChoice)
          ? pendingRepoChoice
          : first;
      repoSelect.value = wanted;
      applyRepoSelection();
    }
  };

  // ---- 类型 + 标题：按钮并入仓库/slug 行，标题独占一整行 ----
  const typeBox = el('div', 'flex flex-col gap-1');
  typeBox.appendChild(el('label', 'text-xs text-slate-500', labels.typeLabel));
  const typeControls = el('div', 'flex gap-2');
  typeBox.appendChild(typeControls);
  row1.append(repoBox, submittedAtBox, slugBox, typeBox);

  const projectBtn = el('button', 'btn btn-primary', labels.typeProject);
  const articleBtn = el('button', 'btn', labels.typeArticle);
  projectBtn.type = 'button';
  articleBtn.type = 'button';
  projectBtn.setAttribute('data-field', 'type-project');
  articleBtn.setAttribute('data-field', 'type-article');
  const setType = (type: SubmissionType): void => {
    state.type = type;
    projectBtn.className = `btn${type === 'project' ? ' btn-primary' : ''}`;
    articleBtn.className = `btn${type === 'article' ? ' btn-primary' : ''}`;
    for (const node of projectOnly) node.hidden = type !== 'project';
  };
  projectBtn.addEventListener('click', () => setType('project'));
  articleBtn.addEventListener('click', () => setType('article'));

  const typeChip = el('span', 'chip hidden');
  typeChip.setAttribute('data-role', 'type-chip');

  const titleBox = el('div', 'flex flex-col gap-1');
  titleBox.appendChild(el('label', 'text-xs text-slate-500', labels.titleLabel));
  const titleInput = el('input', 'input w-full');
  titleInput.placeholder = labels.titlePh;
  titleInput.setAttribute('data-field', 'title');
  titleInput.addEventListener('input', () => {
    state.title = titleInput.value;
    if (!isEdit) slugInput.placeholder = slugFallback();
  });
  titleBox.appendChild(titleInput);
  form.appendChild(titleBox);

  // ---- 参数状态 + 发布时间（同一行；发布时间新建留空取发布点击时刻，编辑可修改） ----
  const paramsBox = el('div', 'flex flex-col gap-1');
  paramsBox.appendChild(el('label', 'text-xs text-slate-500', labels.params));
  const paramsRow = el('div', 'flex gap-4 text-sm');
  const paramOptions: [ParamStatus, string][] = [
    ['with-params', labels.paramsWith],
    ['tuned', labels.paramsTuned],
    ['no-params', labels.paramsNone],
  ];
  for (const [value, label] of paramOptions) {
    const item = el('label', 'flex items-center gap-1');
    const radio = el('input');
    radio.type = 'radio';
    radio.name = 'editor-params';
    radio.value = value;
    radio.checked = value === state.params;
    radio.setAttribute('data-field', 'params');
    radio.addEventListener('change', () => {
      state.params = value;
    });
    item.append(radio, el('span', undefined, label));
    paramsRow.appendChild(item);
  }
  paramsBox.appendChild(paramsRow);

  const publishedAtBox = el('div', 'flex flex-col gap-1');
  publishedAtBox.appendChild(el('label', 'text-xs text-slate-500', labels.publishedAt));
  const publishedAtInput = el('input', 'input w-52');
  publishedAtInput.type = 'datetime-local';
  publishedAtInput.setAttribute('data-field', 'publishedAt');
  publishedAtInput.addEventListener('input', () => {
    state.publishedAt = publishedAtInput.value;
  });
  publishedAtBox.appendChild(publishedAtInput);

  const metaRow = el('div', 'flex flex-wrap items-end gap-3');
  metaRow.append(paramsBox, publishedAtBox);
  form.appendChild(metaRow);

  // ---- 工程专属区块（article 时隐藏；paramsBox 已随 metaRow 挂载，仅参与隐藏切换） ----
  const projectOnly: HTMLElement[] = [];
  projectOnly.push(paramsBox);

  const listContainer = el('div', 'grid gap-3 sm:grid-cols-2');
  projectOnly.push(listContainer);
  form.appendChild(listContainer);

  const coverControl = renderCoverControl(labels, state, isEdit);
  projectOnly.push(coverControl);
  form.appendChild(coverControl);

  const fileControl = renderFileControl(labels, state);
  projectOnly.push(fileControl);
  form.appendChild(fileControl);

  // ---- 正文 / 标签 / 许可证 / 附件 ----
  form.appendChild(renderMarkdownEditor(labels, state));
  const { box: tagBox, refresh: refreshTags } = renderTagEditor(labels, state);
  form.appendChild(tagBox);

  const licenseBox = el('div', 'flex flex-col gap-1');
  licenseBox.appendChild(el('label', 'text-xs text-slate-500', labels.license));
  const licenseSelect = el('select', 'input w-72');
  licenseSelect.setAttribute('data-field', 'license');
  for (const option of config.licenseOptions) {
    const node = el('option', undefined, option.label);
    node.value = option.value;
    licenseSelect.appendChild(node);
  }
  licenseSelect.addEventListener('change', () => {
    state.license = licenseSelect.value;
  });
  licenseBox.appendChild(licenseSelect);
  form.appendChild(licenseBox);

  // 发布简介（仅新建：随 release 正文发布）
  if (!isEdit) form.appendChild(renderSummaryControl(labels, state));

  const { box: attachmentControl, refresh: refreshAttachments } = renderAttachmentControl(
    labels,
    state,
    () => oldAssets,
  );
  form.appendChild(attachmentControl);

  // ---- 校验与提交 ----
  const validation = el('ul', 'hidden flex-col gap-1 text-sm text-rose-600');
  validation.setAttribute('data-role', 'validation');
  const submitBtn = el('button', 'btn btn-primary self-start', isEdit ? labels.save : labels.submit);
  submitBtn.type = 'submit';
  submitBtn.setAttribute('data-action', 'submit');
  form.append(validation, submitBtn);

  if (isEdit) {
    setTypeChip();
    typeControls.classList.add('hidden');
  } else {
    typeControls.append(projectBtn, articleBtn);
    typeChip.classList.add('hidden');
  }
  typeBox.append(typeControls, typeChip);

  function setTypeChip(): void {
    typeChip.textContent = state.type === 'project' ? labels.typeProject : labels.typeArticle;
    typeChip.classList.remove('hidden');
  }

  setType(state.type);

  // ---- 编辑模式回填 ----
  if (isEdit) {
    const entry = await findEntry(config.user!, config.repo!, config.slug!);
    if (!entry) {
      form.appendChild(el('p', 'text-sm text-rose-600', labels.errLoad));
      submitBtn.disabled = true;
      return;
    }
    entryForCtx = entry;
    state.platform = entry.platform;
    state.type = entry.type;
    state.title = entry.title;
    titleInput.value = entry.title;
    state.params = entry.paramState ?? 'with-params';
    const radio = paramsRow.querySelector<HTMLInputElement>(`input[value="${state.params}"]`);
    if (radio) radio.checked = true;
    state.lists.videos = [];
    state.lists.tracks = entry.songs ?? [];
    state.lists.engines = entry.engines ?? [];
    state.lists.voicebanks = entry.voicebanks ?? [];
    state.lists.songLanguages = entry.languages ?? [];
    // 发布时间回填（可修改）；投稿时间编辑时不可变，输入框已隐藏
    if (entry.publishedAt ?? entry.submittedAt) {
      publishedAtInput.value = toLocalInputValue(entry.publishedAt ?? entry.submittedAt);
      state.publishedAt = publishedAtInput.value;
    }

    try {
      const content = await loadSubmissionContent(entry.platform, config.user!, config.repo!, config.slug!);
      state.body = content.parsed.body;
      state.license = content.parsed.attrs.license ?? '';
      licenseSelect.value = state.license;
      issueAttr = content.parsed.attrs.issue ?? '';
      state.coverName = content.parsed.attrs.cover ?? '';
      oldCoverAttr = content.parsed.attrs.cover || undefined;
      oldFiles = content.parsed.files;
      const videosAttr = content.parsed.attrs.videos;
      if (videosAttr) state.lists.videos = videosAttr.split(',').map((v) => v.trim()).filter(Boolean);
      const tagsAttr = content.parsed.attrs.tags;
      if (tagsAttr) state.tags = tagsAttr.split(',').map((v) => v.trim()).filter(Boolean);
      state.files = oldFiles.map((f) => ({
        id: newEditorFileId(),
        file: null,
        name: f.name,
        scheme: f.encrypted ? 'encrypt' : f.compressed ? 'zip' : 'raw',
        password: '',
        textLike: false,
        existing: { compressed: f.compressed, encrypted: f.encrypted },
      }));
      // 正文编辑器需回填后的值
      const bodyArea = form.querySelector<HTMLTextAreaElement>('[data-field="body"]');
      if (bodyArea) bodyArea.value = state.body;
      // 标签与文件行重渲染
      const chips = form.querySelector<HTMLElement>('[data-role="tag-chips"]');
      if (chips) {
        chips.textContent = '';
        for (const tag of state.tags) {
          const chip = el('span', 'chip flex items-center gap-1', `#${tag}`);
          const x = el('button', 'text-slate-400 hover:text-rose-500', '×');
          x.type = 'button';
          x.addEventListener('click', () => {
            state.tags = state.tags.filter((t) => t !== tag);
            x.parentElement?.remove();
          });
          chip.appendChild(x);
          chips.appendChild(chip);
        }
      }
      const fileRows = form.querySelector<HTMLElement>('[data-role="file-rows"]');
      if (fileRows) renderFileRows(labels, state, fileRows);
      // 封面控件刷新
      const coverInfo = coverControl.querySelector('p');
      if (coverInfo && state.coverName) coverInfo.textContent = state.coverName;
      const removeCover = coverControl.querySelector<HTMLButtonElement>('[data-action="remove-cover"]');
      if (removeCover && state.coverName) removeCover.classList.remove('hidden');
    } catch {
      form.appendChild(el('p', 'text-sm text-rose-600', labels.errLoad));
      submitBtn.disabled = true;
      return;
    }

    try {
      const releases = await loadReleases(entry.platform, config.user!, config.repo!);
      const release = releases.find((r) => r.tag === config.slug) ?? null;
      releaseId = release?.id ?? null;
      oldAssets = release?.assets ?? [];
      refreshAttachments();
    } catch {
      /* release 缺失时附件区仅显示新增 */
    }

    // 重渲染列表输入（回填值）
    listContainer.textContent = '';
    buildListInputs();
    setType(state.type);
    setTypeChip();
  } else {
    // 新建模式：恢复上次未发布的草稿（发布成功时清除）
    const restored = restoreDraftIntoState();
    applyRestoredInputs(restored);
    buildListInputs();
    setupDraftAutosave();
  }
  await fillRepoOptions();

  function buildListInputs(): void {
    listContainer.textContent = '';
    const kindLabels: Record<ListKind, string> = {
      videos: labels.videos,
      tracks: labels.tracks,
      engines: labels.engines,
      voicebanks: labels.voicebanks,
      songLanguages: labels.songLanguages,
    };
    for (const kind of LIST_KINDS) {
      listContainer.appendChild(renderListInput(kind, kindLabels[kind], labels, state));
    }
  }

  // ---- 新投稿草稿：自动保存 / 恢复 / 发布成功清除 ----

  function restoreDraftIntoState(): DraftSnapshot | null {
    const draft = readDraft();
    if (!draft) return null;
    state.type = draft.type;
    state.title = draft.title;
    state.params = draft.params;
    state.slug = draft.slug;
    state.license = draft.license;
    state.summary = draft.summary;
    state.body = draft.body;
    state.submittedAt = draft.submittedAt;
    state.publishedAt = draft.publishedAt;
    state.tags = [...draft.tags];
    for (const kind of LIST_KINDS) state.lists[kind] = [...draft.lists[kind]];
    return draft;
  }

  function applyRestoredInputs(draft: DraftSnapshot | null): void {
    if (!draft) return;
    titleInput.value = draft.title;
    slugInput.value = draft.slug;
    submittedAtInput.value = draft.submittedAt;
    publishedAtInput.value = draft.publishedAt;
    licenseSelect.value = draft.license;
    const radio = paramsRow.querySelector<HTMLInputElement>(`input[value="${draft.params}"]`);
    if (radio) radio.checked = true;
    const bodyArea = form.querySelector<HTMLTextAreaElement>('[data-field="body"]');
    if (bodyArea) bodyArea.value = draft.body;
    setType(draft.type);
    refreshTags();
    slugInput.placeholder = slugFallback();
    pendingRepoChoice = `${draft.user}/${draft.repo}`;
  }

  function collectDraft(): DraftSnapshot {
    return {
      platform: state.platform,
      user: state.user,
      repo: state.repo,
      slug: slugInput.value.trim(),
      type: state.type,
      title: state.title,
      params: state.params,
      lists: { ...state.lists },
      body: state.body,
      tags: [...state.tags],
      license: state.license,
      summary: state.summary,
      submittedAt: state.submittedAt,
      publishedAt: state.publishedAt,
    };
  }

  function setupDraftAutosave(): void {
    let timer = 0;
    const save = (): void => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        try {
          localStorage.setItem(DRAFT_KEY, JSON.stringify(collectDraft()));
        } catch {
          /* 存储配额不足时放弃本次保存 */
        }
      }, 500);
    };
    form.addEventListener('input', save);
    form.addEventListener('change', save);
    form.addEventListener('click', save);
  }

  // ---- 发布断点：进度持久化 + 失败步骤重试/跳过 ----

  let progressCard: HTMLElement | null = null;
  let currentProgress: PublishProgress | null = null;

  function persistProgress(): void {
    if (!currentProgress) return;
    currentProgress.user = state.user;
    currentProgress.repo = state.repo;
    currentProgress.slug = state.slug;
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(currentProgress));
    } catch {
      /* 忽略存储失败 */
    }
  }

  function loadProgress(): PublishProgress {
    try {
      const raw = localStorage.getItem(PROGRESS_KEY);
      if (!raw) return {};
      const saved = JSON.parse(raw) as PublishProgress;
      if (saved.user === state.user && saved.repo === state.repo && saved.slug === state.slug) {
        return saved;
      }
    } catch {
      /* 损坏的进度视为无进度 */
    }
    return {};
  }

  function attachStepControls(row: HTMLElement): void {
    if (row.querySelector('[data-action="retry-step"]')) return;
    const retry = el('button', 'btn px-2 py-0.5 text-xs', labels.retry);
    retry.type = 'button';
    retry.dataset.action = 'retry-step';
    retry.addEventListener('click', () => {
      void runPublish();
    });
    const skip = el('button', 'btn px-2 py-0.5 text-xs', labels.skipStep);
    skip.type = 'button';
    skip.dataset.action = 'skip-step';
    skip.addEventListener('click', () => {
      const failed = progressCard?.querySelector('[data-state="error"]')?.getAttribute('data-step');
      if (failed && currentProgress) {
        currentProgress.skipped = [...new Set([...(currentProgress.skipped ?? []), failed])];
        persistProgress();
      }
      void runPublish();
    });
    row.append(retry, skip);
  }

  async function runPublish(): Promise<void> {
    validation.textContent = '';
    // 新建模式：slug 未输入时回退为 日期-标题
    if (config.mode === 'new') state.slug = resolveSlug();
    const errors = validate(state, labels, config.mode);
    if (errors.length) {
      validation.classList.remove('hidden');
      validation.classList.add('flex');
      for (const message of errors) validation.appendChild(el('li', undefined, message));
      return;
    }
    validation.classList.add('hidden');
    validation.classList.remove('flex');

    submitBtn.disabled = true;
    submitBtn.textContent = labels.publishing;

    const steps: StepId[] = isEdit
      ? ['cover', 'files', 'readme', 'assets', 'index']
      : ['issue', 'files', 'release', 'assets', 'index'];
    if (!progressCard) {
      progressCard = renderProgress(labels, steps);
      form.appendChild(progressCard);
    }
    progressCard
      .querySelectorAll('[data-action="retry-step"], [data-action="skip-step"]')
      .forEach((node) => node.remove());
    const { onStep: onStepInner, fail } = makeOnStep(progressCard, labels);
    // 步骤落定（done/warning）时持久化断点，重试时从失败处续传
    const onStep: OnStep = (id, stateName, detail) => {
      onStepInner(id, stateName, detail);
      if (stateName === 'done' || stateName === 'warning') persistProgress();
    };
    const draft = buildDraft(state);
    const token = mock ? null : getToken(state.platform);
    if (!isEdit) currentProgress = loadProgress();

    try {
      if (isEdit) {
        const ctx: EditContext = {
          entry: entryForCtx!,
          issue: issueAttr,
          oldCover: oldCoverAttr,
          oldFiles,
          releaseId,
          coverRemoved: state.coverRemoved,
          removedAssets: state.removedAssets,
        };
        await updateSubmission(draft, ctx, token, mock, onStep);
        config.user = draft.user;
        config.repo = draft.repo;
        config.slug = draft.slug;
        renderDone(root, labels, config, config.mode);
      } else {
        await publishSubmission(draft, token, mock, onStep, currentProgress ?? {});
        config.user = draft.user;
        config.repo = draft.repo;
        config.slug = draft.slug;
        // 发布成功：清除草稿与断点进度，弹 5 秒跳转提示
        try {
          localStorage.removeItem(DRAFT_KEY);
          localStorage.removeItem(PROGRESS_KEY);
        } catch {
          /* 忽略清除失败 */
        }
        currentProgress = null;
        showSuccessDialog(labels, `/view/${draft.user}/${draft.repo}/${draft.slug}`, () => {
          renderDone(root, labels, config, 'new');
        });
      }
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
      const failedRow = progressCard.querySelector<HTMLElement>('[data-state="error"]');
      if (failedRow) attachStepControls(failedRow);
      submitBtn.disabled = false;
      submitBtn.textContent = isEdit ? labels.save : labels.submit;
    }
  }

  form.addEventListener('submit', () => {
    void runPublish();
  });
}
