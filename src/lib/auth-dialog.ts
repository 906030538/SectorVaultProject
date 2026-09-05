import { saveSession, setToken } from '@/lib/auth';
import { isMockAvailable } from '@/lib/content';
import { getAdapterAsync } from '@/lib/adapters/lazy';
import { getOAuthConfig } from '@/lib/index/sources';
import { pollDeviceToken, requestDeviceCode } from '@/lib/auth';
import type { Platform } from '@/types';

export interface AuthLabels {
  title: string;
  intro: string;
  platform: string;
  stepRegister: string;
  stepToken: string;
  stepVerify: string;
  register: string;
  tokenPage: string;
  tokenPh: string;
  oauthLogin: string;
  deviceLogin: string;
  tokenSave: string;
  tokenBad: string;
  demoHint: string;
  cancel: string;
}

const PLATFORM_LINKS: Record<Platform, { signup: string; tokens: string }> = {
  github: { signup: 'https://github.com/signup', tokens: 'https://github.com/settings/tokens' },
  gitee: { signup: 'https://gitee.com/signup', tokens: 'https://gitee.com/personal_access_tokens' },
  atomgit: { signup: 'https://atomgit.com/login', tokens: 'https://atomgit.com/-/settings/tokens' },
  gitcode: { signup: 'https://gitcode.com/login', tokens: 'https://gitcode.com/-/settings/tokens' },
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

export async function openAuthDialog(labels: AuthLabels): Promise<void> {
  const overlay = el('div', 'fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4');
  overlay.dataset.role = 'auth-dialog';
  const card = el('div', 'card w-full max-w-lg p-6 dark:bg-slate-900');
  overlay.appendChild(card);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) overlay.remove();
  });

  card.appendChild(el('h2', 'text-lg font-semibold', labels.title));
  card.appendChild(el('p', 'mt-1 text-sm text-slate-500 dark:text-slate-400', labels.intro));

  card.appendChild(el('p', 'mt-4 text-xs font-medium text-slate-500', labels.platform));
  const platformRow = el('div', 'mt-1 flex gap-2');
  platformRow.dataset.role = 'auth-platforms';
  let platform: Platform = 'github';
  const chips = new Map<Platform, HTMLElement>();
  for (const p of ['github', 'gitee', 'atomgit'] as const) {
    const chip = el('button', 'btn', p);
    chip.type = 'button';
    chip.dataset.platform = p;
    chip.addEventListener('click', () => {
      platform = p;
      for (const [key, node] of chips) {
        node.classList.toggle('btn-primary', key === p);
      }
      registerLink.href = PLATFORM_LINKS[p].signup;
      tokenLink.href = PLATFORM_LINKS[p].tokens;
      void syncOauthButton();
    });
    chips.set(p, chip);
    platformRow.appendChild(chip);
  }
  chips.get('github')!.classList.add('btn-primary');
  card.appendChild(platformRow);

  const step = (index: number, text: string, extra?: HTMLElement) => {
    const row = el('div', 'mt-3 flex items-start gap-2 text-sm');
    row.appendChild(el('span', 'chip shrink-0', String(index)));
    const body = el('div', 'flex flex-wrap items-center gap-2');
    body.appendChild(el('span', undefined, text));
    if (extra) body.appendChild(extra);
    row.appendChild(body);
    return row;
  };

  const registerLink = el('a', 'btn', labels.register);
  registerLink.href = PLATFORM_LINKS.github.signup;
  registerLink.target = '_blank';
  registerLink.rel = 'noopener';
  registerLink.dataset.action = 'goto-register';
  const tokenLink = el('a', 'btn', labels.tokenPage);
  tokenLink.href = PLATFORM_LINKS.github.tokens;
  tokenLink.target = '_blank';
  tokenLink.rel = 'noopener';
  tokenLink.dataset.action = 'goto-tokens';

  // OAuth 授权按钮：已配置 OAuth 的平台可直接跳转授权（回调 /login/{platform}）
  const oauthBtn = el('button', 'btn hidden', labels.oauthLogin);
  oauthBtn.type = 'button';
  oauthBtn.dataset.action = 'oauth-login';
  oauthBtn.addEventListener('click', () => {
    void (async () => {
      const cfg = await getOAuthConfig(platform);
      if (!cfg?.authorizeUrl) return;
      const state = crypto.randomUUID().replace(/-/g, '');
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
    })();
  });
  // GitHub App 设备授权（无需回调地址与 client secret，适合零后端静态站）
  const deviceBtn = el('button', 'btn hidden', labels.deviceLogin);
  deviceBtn.type = 'button';
  deviceBtn.dataset.action = 'device-login';
  const syncOauthButton = async (): Promise<void> => {
    const cfg = await getOAuthConfig(platform).catch(() => null);
    oauthBtn.classList.toggle('hidden', !cfg?.authorizeUrl);
    deviceBtn.classList.toggle('hidden', platform !== 'github' || !cfg?.clientId);
  };
  deviceBtn.addEventListener('click', () => {
    void (async () => {
      deviceBtn.setAttribute('disabled', '');
      try {
        const cfg = await getOAuthConfig('github');
        if (!cfg?.clientId) return;
        const device = await requestDeviceCode(cfg.clientId, (cfg as { deviceCodeUrl?: string }).deviceCodeUrl);
        openDeviceDialog(
          device,
          cfg.clientId,
          (cfg as { tokenUrl?: string }).tokenUrl,
        );
      } catch (err) {
        error.textContent = err instanceof Error ? err.message.slice(0, 80) : labels.tokenBad;
        error.classList.remove('hidden');
      } finally {
        deviceBtn.removeAttribute('disabled');
      }
    })();
  });
  void syncOauthButton();

  const tokenInput = el('input', 'input w-full');
  tokenInput.type = 'password';
  tokenInput.placeholder = labels.tokenPh;
  tokenInput.dataset.field = 'token';
  const error = el('p', 'hidden text-sm text-rose-600', labels.tokenBad);
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

  card.append(
    step(1, labels.stepRegister, registerLink),
    step(2, labels.stepToken, tokenLink),
    step(3, labels.stepVerify),
    oauthBtn,
    deviceBtn,
    tokenInput,
    error,
  );
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
