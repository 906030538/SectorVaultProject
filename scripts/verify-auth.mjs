// 导航登录授权指引对话框回归验证
// 前置：npm run build && npm run preview（4321 端口）
import { Browser } from 'happy-dom';

// 演示登录后页面 reload 与 browser.close() 存在竞态，忽略因此被中止的 fetch
process.on('unhandledRejection', (reason) => {
  const msg = String(reason?.message ?? reason);
  if (/aborted|NetworkError/i.test(msg)) return;
  throw reason;
});

const BASE = 'http://localhost:4321';
let failed = 0;

function assert(name, ok) {
  console.log(`  ${ok ? 'ok ' : 'FAIL'} ${name}`);
  if (!ok) failed += 1;
}

function waitFor(fn, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      let ok = false;
      try {
        ok = fn();
      } catch {
        ok = false;
      }
      if (ok) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - start > timeout) {
        clearInterval(timer);
        reject(new Error('waitFor timeout'));
      }
    }, 50);
  });
}

const browser = new Browser({
  settings: {
    enableJavaScriptEvaluation: true,
    disableJavaScriptFileLoading: false,
    disableCSSFileLoading: true,
    suppressInsecureJavaScriptEnvironmentWarning: true,
    fetch: { disableSameOriginPolicy: true },
  },
});

const page = browser.newPage();
await page.goto(`${BASE}/`);
await page.waitUntilComplete();
const win = page.mainFrame.window;
const doc = page.mainFrame.document;
const MouseEvent = win.MouseEvent;

console.log('[auth] 对话框结构');
const loginBtn = doc.querySelector('#user-area button');
assert('导航存在登录按钮', !!loginBtn);
loginBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
await waitFor(() => doc.querySelector('[data-role="auth-dialog"]'));
const dialog = doc.querySelector('[data-role="auth-dialog"]');
assert('授权对话框打开', !!dialog);

const chips = [...dialog.querySelectorAll('[data-role="auth-platforms"] [data-platform]')];
assert('两个平台选择芯片', chips.length === 2);
assert('默认选中 github',
  chips.find((c) => c.dataset.platform === 'github').classList.contains('btn-primary'));

const registerLink = dialog.querySelector('[data-action="goto-register"]');
const tokenLink = dialog.querySelector('[data-action="goto-tokens"]');
assert('注册引导链接指向 github', registerLink.getAttribute('href') === 'https://github.com/signup');
assert('令牌引导链接指向 github', registerLink.getAttribute('target') === '_blank' &&
  tokenLink.getAttribute('href') === 'https://github.com/settings/tokens');

assert('令牌输入框存在', !!dialog.querySelector('input[data-field="token"]'));
assert('提交按钮存在', !!dialog.querySelector('[data-action="auth-submit"]'));

console.log('[auth] 切换平台');
dialog.querySelector('[data-platform="gitee"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
assert('切换后 gitee 高亮',
  dialog.querySelector('[data-platform="gitee"]').classList.contains('btn-primary') &&
  !dialog.querySelector('[data-platform="github"]').classList.contains('btn-primary'));
assert('引导链接切换为 gitee',
  dialog.querySelector('[data-action="goto-register"]').getAttribute('href') === 'https://gitee.com/signup' &&
  dialog.querySelector('[data-action="goto-tokens"]').getAttribute('href') === 'https://gitee.com/personal_access_tokens');

console.log('[auth] 演示模式登录');
assert('演示模式提示显示', dialog.textContent.includes('演示账户'));
const tokenInput = dialog.querySelector('input[data-field="token"]');
tokenInput.value = 'any-token';
tokenInput.dispatchEvent(new win.Event('input', { bubbles: true }));
const submitBtn = dialog.querySelector('[data-action="auth-submit"]');
submitBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
await waitFor(() => !!win.localStorage.getItem('svp-session'), 10000);
const session = JSON.parse(win.localStorage.getItem('svp-session'));
assert('会话写入（演示账户）', session.login === 'demo' && session.platform === 'gitee');
assert('令牌已保存', !!win.localStorage.getItem('svp-token-gitee'));

const errors = page.virtualConsolePrinter
  .readAsString()
  .split('\n')
  .filter((l) => /Error/.test(l) && !/stylesheet|CSS/i.test(l));
assert('页面无 JS 报错', errors.length === 0);
if (errors.length) console.log(errors.join('\n'));

await browser.close();
console.log(`\n${failed === 0 ? 'ALL PASSED' : `${failed} FAILED`}`);
process.exit(failed);
