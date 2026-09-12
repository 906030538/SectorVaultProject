import type { Platform } from '@/types';
import { logoutPlatform } from '@/lib/auth';
import { openAuthDialog } from '@/lib/auth-dialog';
import { buildAuthLabels } from '@/lib/labels';
import { getClientLocale } from '@/lib/i18n-client';
import { t } from '@/i18n';

const notified = new Set<Platform>();

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

/**
 * 已保存令牌失效（匿名可用的接口带令牌返回 401）：清除该平台登录态并弹窗提示，
 * 提供「重新登录」（打开授权对话框）与「匿名访问」（刷新页面，后续请求不再带令牌）。
 * 每个平台每次页面加载只提示一次，避免并发 401 叠出多个弹窗。
 */
export function notifyAuthExpired(platform: Platform): void {
  logoutPlatform(platform);
  if (notified.has(platform)) return;
  notified.add(platform);

  const locale = getClientLocale();
  const overlay = el('div', 'fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4');
  overlay.dataset.role = 'auth-expired';
  const card = el('div', 'card w-full max-w-sm p-6 dark:bg-slate-900');
  card.appendChild(el('h2', 'text-lg font-semibold', t(locale, 'auth.expiredTitle')));
  card.appendChild(el('p', 'mt-2 text-sm text-slate-500 dark:text-slate-400', t(locale, 'auth.expiredHint')));

  const buttons = el('div', 'mt-5 flex justify-end gap-2');
  const anonymous = el('button', 'btn', t(locale, 'auth.anonymousAccess'));
  anonymous.type = 'button';
  anonymous.dataset.action = 'auth-expired-anonymous';
  anonymous.addEventListener('click', () => window.location.reload());
  const relogin = el('button', 'btn btn-primary', t(locale, 'auth.relogin'));
  relogin.type = 'button';
  relogin.dataset.action = 'auth-expired-relogin';
  relogin.addEventListener('click', () => {
    overlay.remove();
    void openAuthDialog(buildAuthLabels(locale), platform);
  });
  buttons.append(anonymous, relogin);
  card.appendChild(buttons);
  overlay.appendChild(card);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
}
