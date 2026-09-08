import { loadSessionBy, logoutPlatform, saveSession, setToken } from '@/lib/auth';
import { isMockAvailable } from '@/lib/content';
import { getAdapterAsync } from '@/lib/adapters/lazy';
import { getOAuthConfig } from '@/lib/index/sources';
import { pollDeviceToken, requestDeviceCode } from '@/lib/auth';
import { withBase } from '@/lib/base';
import type { Platform } from '@/types';

export interface AuthLabels {
  title: string;
  intro: string;
  /** 平台页签组无障碍标签 */
  platform: string;
  /** 页签上"（已登陆）"标记 */
  loggedIn: string;
  logout: string;
  /** 令牌登录提示 */
  tokenHint: string;
  /** 常见问题链接文本 */
  faqLink: string;
  tokenPh: string;
  oauthLogin: string;
  oauthUnavailable: string;
  deviceLogin: string;
  tokenSave: string;
  tokenBad: string;
  demoHint: string;
  cancel: string;
}

/** 弹窗内展示的平台页签 */
const DIALOG_PLATFORMS = ['github', 'gitee', 'atomgit'] as const;

const PLATFORM_NAMES: Record<string, string> = {
  github: 'GitHub',
  gitee: 'Gitee',
  atomgit: 'AtomGit',
};

const MOCK_AVATAR = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="32" fill="#6366f1"/><text x="32" y="42" font-family="sans-serif" font-size="28" fill="#fff" text-anchor="middle">D</text></svg>',
)}`;

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

/** 导航栏登录：授权指引对话框（选平台 → 注册 → 创建令牌 → 验证登录） */
/** OAuth state 随机串（crypto.randomUUID 仅安全上下文可用，降级 Math.random） */
function randomState(): string {
  try {
    return crypto.randomUUID().replace(/-/g, '');
  } catch {
    return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  }
}

/** GitHub App 设备授权对话框：显示 user_code + 引导链接，轮询令牌成功后保存登录态 */
function openDeviceDialog(
  device: { userCode: string; verificationUri: string; deviceCode: string; interval: number },
  clientId: string,
  deviceTokenUrlRef?: string,
): void {
  const overlay = el('div', 'fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4');
  overlay.dataset.role = 'device-dialog';
  const card = el('div', 'card flex w-full max-w-sm flex-col gap-3 p-6');
  card.appendChild(el('h2', 'text-lg font-semibold', 'GitHub App 授权'));
  const steps = el('ol', 'list-inside list-decimal space-y-1 text-sm text-slate-600 dark:text-slate-300');
  const open = el('a', 'text-emerald-600 hover:underline dark:text-emerald-400', device.verificationUri);
  open.href = device.verificationUri;
  open.target = '_blank';
  open.rel = 'noopener';
  const li1 = el('li');
  li1.append('打开 ', open);
  const li2 = el('li');
  li2.append('输入验证码：');
  const code = el('code', 'select-all rounded-lg bg-slate-100 px-2.5 py-1 font-mono text-base font-bold dark:bg-slate-800', device.userCode);
  li2.appendChild(code);
  const li3 = el('li', undefined, '授权后本页将自动完成登录');
  steps.append(li1, li2, li3);
  card.appendChild(steps);
  const status = el('p', 'text-sm text-slate-400');
  status.dataset.role = 'device-status';
  status.textContent = '等待授权…';
  const cancel = el('button', 'btn self-end', '取消');
  cancel.type = 'button';
  cancel.dataset.action = 'cancel-device';
  card.append(status, cancel);
  overlay.appendChild(card);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) overlay.remove();
  });
  cancel.addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);
  // 页面关闭/对话框移除即停止轮询
  const controller = new AbortController();
  const observer = new MutationObserver(() => {
    if (!document.body.contains(overlay)) controller.abort();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  void (async () => {
    try {
      const token = await pollDeviceToken(
        clientId,
        device.deviceCode,
        device.interval,
        controller.signal,
        (deviceTokenUrlRef as string | undefined) ?? undefined,
      );
      const viewer = await (await getAdapterAsync('github')).getViewer(token);
      setToken('github', token);
      saveSession(viewer);
      window.location.reload();
    } catch (err) {
      if (controller.signal.aborted) return;
      status.className = 'text-sm text-rose-600';
      status.textContent = err instanceof Error ? err.message.slice(0, 100) : '授权失败';
    } finally {
      observer.disconnect();
    }
  })();
}

/** 打开登录对话框；preferred 为预选平台（如当前线路）。页签切换平台，按登录态显示账户信息或授权按钮 */
export async function openAuthDialog(labels: AuthLabels, preferred?: Platform): Promise<void> {
  const overlay = el('div', 'fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4');
  overlay.dataset.role = 'auth-dialog';
  const card = el('div', 'card w-full max-w-lg p-6 dark:bg-slate-900');
  overlay.appendChild(card);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) overlay.remove();
  });

  card.appendChild(el('h2', 'text-lg font-semibold', labels.title));
  card.appendChild(el('p', 'mt-1 text-sm text-slate-500 dark:text-slate-400', labels.intro));

  // 平台页签：已有登录信息的平台追加（已登陆）
  const tabBar = el(
    'div',
    'mt-4 flex gap-1 border-b border-slate-200 dark:border-slate-700',
  );
  tabBar.dataset.role = 'auth-platforms';
  tabBar.setAttribute('role', 'tablist');
  tabBar.setAttribute('aria-label', labels.platform);
  let platform: Platform = 'github';
  const tabs = new Map<Platform, HTMLButtonElement>();
  for (const p of DIALOG_PLATFORMS) {
    const tab = el('button');
    tab.type = 'button';
    tab.dataset.platform = p;
    tab.setAttribute('role', 'tab');
    tab.addEventListener('click', () => {
      platform = p;
      refreshTabs();
      renderPanel();
    });
    tabs.set(p, tab);
    tabBar.appendChild(tab);
  }
  // 预选平台（当前线路无登录信息时从登录按钮进入，直接落在目标平台）
  if (preferred && tabs.has(preferred)) platform = preferred;
  card.appendChild(tabBar);

  const refreshTabs = (): void => {
    for (const [p, tab] of tabs) {
      const session = loadSessionBy(p);
      const name = PLATFORM_NAMES[p] ?? p;
      tab.textContent = session ? `${name}（${labels.loggedIn}）` : name;
      const active = p === platform;
      tab.className = [
        'rounded-t-lg border-b-2 px-3.5 py-2 text-sm transition-colors',
        active
          ? 'border-emerald-500 font-medium text-emerald-700 dark:border-emerald-400 dark:text-emerald-300'
          : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200',
      ].join(' ');
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    }
  };
  refreshTabs();

  const error = el('p', 'hidden text-sm text-rose-600');

  // 平台面板：已登陆显示用户名 + 登出；未登陆显示 OAuth / 设备授权按钮
  const panel = el('div', 'mt-4 min-h-14');
  panel.dataset.role = 'auth-panel';
  card.appendChild(panel);
  const renderPanel = (): void => {
    panel.textContent = '';
    const session = loadSessionBy(platform);
    if (session) {
      const row = el('div', 'flex flex-wrap items-center gap-3');
      const name = el('span', 'font-medium', session.name ?? session.login);
      if (session.name && session.name !== session.login) {
        name.appendChild(document.createTextNode(`（${session.login}）`));
      }
      const logoutBtn = el('button', 'btn', labels.logout);
      logoutBtn.type = 'button';
      logoutBtn.dataset.action = 'logout-platform';
      logoutBtn.addEventListener('click', () => {
        logoutPlatform(platform);
        refreshTabs();
        renderPanel();
      });
      row.append(name, logoutBtn);
      panel.appendChild(row);
      return;
    }
    const buttons = el('div', 'flex flex-wrap gap-2');
    // OAuth 授权按钮：已配置网页流凭据的平台可跳转授权（回调 /login/{platform}）
    const oauthBtn = el('button', 'btn btn-primary hidden', labels.oauthLogin);
    oauthBtn.type = 'button';
    oauthBtn.dataset.action = 'oauth-login';
    oauthBtn.addEventListener('click', () => {
      oauthBtn.setAttribute('disabled', '');
      void (async () => {
        try {
          const cfg = await getOAuthConfig(platform);
          if (!cfg?.authorizeUrl) {
            error.textContent = labels.oauthUnavailable;
            error.classList.remove('hidden');
            return;
          }
          const state = randomState();
          try {
            sessionStorage.setItem('svp-oauth-state', state);
          } catch {
            /* 存储不可用时跳过 state 校验 */
          }
          const redirectUri = `${window.location.origin}/login/${platform}`;
          const params = new URLSearchParams({
            client_id: cfg.clientId,
            redirect_uri: redirectUri,
            response_type: 'code',
            state,
          });
          if (cfg.scope) params.set('scope', cfg.scope);
          window.location.href = `${cfg.authorizeUrl}?${params.toString()}`;
        } catch (err) {
          error.textContent = err instanceof Error ? err.message.slice(0, 80) : labels.tokenBad;
          error.classList.remove('hidden');
          oauthBtn.removeAttribute('disabled');
        }
      })();
    });
    // GitHub App 设备授权（无需回调地址与 client secret，适合零后端静态站）
    const deviceBtn = el('button', 'btn hidden', labels.deviceLogin);
    deviceBtn.type = 'button';
    deviceBtn.dataset.action = 'device-login';
    deviceBtn.addEventListener('click', () => {
      void (async () => {
        deviceBtn.setAttribute('disabled', '');
        try {
          const cfg = await getOAuthConfig('github');
          const appClientId = cfg?.appClientId ?? cfg?.clientId;
          if (!cfg || !appClientId) return;
          const device = await requestDeviceCode(appClientId, cfg.deviceCodeUrl);
          openDeviceDialog(device, appClientId, cfg.deviceTokenUrl);
        } catch (err) {
          error.textContent = err instanceof Error ? err.message.slice(0, 80) : labels.tokenBad;
          error.classList.remove('hidden');
        } finally {
          deviceBtn.removeAttribute('disabled');
        }
      })();
    });
    buttons.append(oauthBtn, deviceBtn);
    panel.appendChild(buttons);
    // GitHub：App 设备授权（appClientId）与 OAuth 网页流（clientId）凭据独立，可同时显示；
    // 仅配置旧变量 OAUTH_GITHUB_CLIENT_ID 时回退供设备流使用。其余平台只显示 OAuth 跳转。
    void (async () => {
      const cfg = await getOAuthConfig(platform).catch(() => null);
      const useDevice = platform === 'github' && !!(cfg?.appClientId ?? cfg?.clientId);
      const useWeb = !!cfg?.clientId && !!cfg?.authorizeUrl;
      if (!panel.isConnected) return;
      deviceBtn.classList.toggle('hidden', !useDevice);
      oauthBtn.classList.toggle('hidden', !useWeb);
    })();
  };
  renderPanel();

  // 令牌登录提示 + 常见问题链接（注册/令牌申请指引在 wiki 用户帐户-注册页）
  const hint = el('p', 'mt-3 text-xs text-slate-500 dark:text-slate-400');
  hint.appendChild(document.createTextNode(`${labels.tokenHint} `));
  const faq = el('a', 'text-emerald-600 hover:underline dark:text-emerald-400', labels.faqLink);
  faq.href = withBase('/faq?page=' + encodeURIComponent('用户帐户-注册'));
  faq.dataset.action = 'goto-faq';
  hint.appendChild(faq);
  card.appendChild(hint);

  const tokenInput = el('input', 'input mt-2 w-full');
  tokenInput.type = 'password';
  tokenInput.placeholder = labels.tokenPh;
  tokenInput.dataset.field = 'token';
  const submit = el('button', 'btn btn-primary', labels.tokenSave);
  submit.type = 'button';
  submit.dataset.action = 'auth-submit';
  submit.addEventListener('click', async () => {
    const token = tokenInput.value.trim();
    if (!token) return;
    submit.setAttribute('disabled', '');
    error.classList.add('hidden');
    try {
      if (await isMockAvailable()) {
        // 演示模式：任意令牌以演示账户登录
        await new Promise((resolve) => setTimeout(resolve, 100));
        setToken(platform, token);
        saveSession({ platform, login: 'demo', name: 'Demo', avatarUrl: MOCK_AVATAR });
      } else {
        const viewer = await (await getAdapterAsync(platform)).getViewer(token);
        setToken(platform, token);
        saveSession(viewer);
      }
      window.location.reload();
    } catch {
      error.classList.remove('hidden');
      submit.removeAttribute('disabled');
    }
  });

  card.append(tokenInput, error);
  if (await isMockAvailable()) {
    card.appendChild(el('p', 'mt-2 text-xs text-amber-600', labels.demoHint));
  }

  const buttons = el('div', 'mt-4 flex justify-end gap-2');
  const cancel = el('button', 'btn', labels.cancel);
  cancel.type = 'button';
  cancel.addEventListener('click', () => overlay.remove());
  buttons.append(cancel, submit);
  card.appendChild(buttons);

  document.body.appendChild(overlay);
}
