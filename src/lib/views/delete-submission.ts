import { t } from '@/i18n';
import type { Locale } from '@/i18n';
import { getToken } from '@/lib/auth';
import { openAuthDialog } from '@/lib/auth-dialog';
import { buildAuthLabels } from '@/lib/labels';
import {
  deleteSubmission,
  type DeleteOnStep,
  type DeleteStepId,
  type StepState,
} from '@/lib/editor/pipeline';
import type { SubmissionEntry } from '@/types';

/**
 * 删除稿件对话框（详情页与集合页共用）：
 * 输入 slug 二次确认 → 文件 / 关联发布 / 索引条目三步执行（对话框内展示进度，失败可整体重试）。
 * 成功后默认刷新页面；提供 onDone 时改走回调（如详情页删除后跳转集合页）。
 */

interface DeleteDialogLabels {
  delete: string;
  cancel: string;
  title: string;
  hint: string;
  stepFiles: string;
  stepRelease: string;
  stepIndex: string;
  failed: string;
  retry: string;
  done: string;
  loginRequired: string;
  login: string;
}

function buildLabels(locale: Locale): DeleteDialogLabels {
  return {
    delete: t(locale, 'collection.delete'),
    cancel: t(locale, 'common.cancel'),
    title: t(locale, 'collection.deleteSubmissionTitle'),
    hint: t(locale, 'collection.deleteSubmissionHint'),
    stepFiles: t(locale, 'collection.deleteStepFiles'),
    stepRelease: t(locale, 'collection.deleteStepRelease'),
    stepIndex: t(locale, 'collection.deleteStepIndex'),
    failed: t(locale, 'collection.deleteFailed'),
    retry: t(locale, 'editor.retry'),
    done: t(locale, 'collection.deleteDone'),
    loginRequired: t(locale, 'collection.loginRequired'),
    login: t(locale, 'nav.login'),
  };
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

export async function openDeleteSubmissionDialog(
  entry: SubmissionEntry,
  locale: string,
  opts: { onDone?: () => void } = {},
): Promise<void> {
  const labels = buildLabels(locale as Locale);
  const { slug } = entry;
  const token = getToken(entry.platform);

  // 未登录稿件所在平台：引导授权（弹窗预选该平台）
  if (!token) {
    const { overlay, body } = dialogShell(labels.title);
    const hint = el('p', 'text-sm text-slate-500 dark:text-slate-400', labels.loginRequired);
    const buttons = el('div', 'mt-4 flex justify-end gap-2');
    const login = el('button', 'btn btn-primary', labels.login);
    login.type = 'button';
    login.addEventListener('click', () => {
      overlay.remove();
      void openAuthDialog(buildAuthLabels(locale as Locale), entry.platform);
    });
    const close = el('button', 'btn', labels.cancel);
    close.type = 'button';
    close.addEventListener('click', () => overlay.remove());
    buttons.append(close, login);
    body.append(hint, buttons);
    document.body.appendChild(overlay);
    return;
  }

  // 第一步：输入 slug 二次确认
  const { overlay, body } = dialogShell(`${labels.title}: ${slug}`);
  const hint = el('p', 'text-sm text-slate-500 dark:text-slate-400', labels.hint);
  const input = el('input', 'input mt-3 w-full');
  input.placeholder = slug;
  const buttons = el('div', 'mt-4 flex justify-end gap-2');
  const cancel = el('button', 'btn', labels.cancel);
  cancel.type = 'button';
  cancel.addEventListener('click', () => overlay.remove());
  const confirm = el('button', 'btn btn-danger', labels.delete);
  confirm.type = 'button';
  confirm.dataset.action = 'confirm-delete-submission';
  confirm.disabled = true;
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
      { id: 'files', text: labels.stepFiles },
      { id: 'release', text: labels.stepRelease },
      { id: 'index', text: labels.stepIndex },
    ];
    const rows = new Map<DeleteStepId, { row: HTMLElement; detail: HTMLElement }>();
    for (const step of stepLabels) {
      const row = el('p', 'mt-2 flex items-start gap-2 text-sm');
      const mark = el('span', 'shrink-0 text-slate-400', '○');
      const wrap = el('span', 'min-w-0');
      wrap.appendChild(document.createTextNode(step.text));
      const detail = el('span', 'block truncate text-xs text-slate-400');
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

    const error = el('p', 'hidden text-sm text-rose-600');
    const actions = el('div', 'mt-4 flex justify-end gap-2');
    const close = el('button', 'btn', labels.cancel);
    close.type = 'button';
    close.addEventListener('click', () => overlay.remove());
    const retry = el('button', 'btn btn-primary', labels.retry);
    retry.type = 'button';
    retry.dataset.action = 'retry-delete';
    retry.addEventListener('click', () => {
      retry.setAttribute('disabled', '');
      error.classList.add('hidden');
      for (const step of stepLabels) onStep(step.id, 'pending');
      void execute();
    });
    actions.append(retry, close);
    body.append(error, actions);

    const execute = (): Promise<void> =>
      deleteSubmission(entry, token, onStep)
        .then(() => {
          retry.remove();
          close.textContent = labels.done;
          setTimeout(() => {
            if (opts.onDone) opts.onDone();
            else window.location.reload();
          }, 900);
        })
        .catch((err: unknown) => {
          error.textContent = `${labels.failed}${
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
