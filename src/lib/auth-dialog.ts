import { saveSession, setToken } from '@/lib/auth';
import { isMockAvailable } from '@/lib/content';
import { getAdapterAsync } from '@/lib/adapters/lazy';
import { getOAuthConfig } from '@/lib/index/sources';
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
  const syncOauthButton = async (): Promise<void> => {
    const cfg = await getOAuthConfig(platform).catch(() => null);
    oauthBtn.classList.toggle('hidden', !cfg?.authorizeUrl);
  };
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
