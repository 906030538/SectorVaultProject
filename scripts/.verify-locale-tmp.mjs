// 临时脚本：验证语言切换器持久化 + 重载后客户端重翻译
import { Browser } from 'happy-dom';

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
      try { ok = fn(); } catch { ok = false; }
      if (ok) { clearInterval(timer); resolve(); }
      else if (Date.now() - start > timeout) { clearInterval(timer); reject(new Error('waitFor timeout')); }
    }, 50);
  });
}

process.on('unhandledRejection', (reason) => {
  const msg = String(reason?.message ?? reason);
  if (/aborted|NetworkError/i.test(msg)) return;
  throw reason;
});

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
await waitFor(() => doc.querySelectorAll('[data-component="list"] > *').length > 0 || true);

console.log('[locale] 默认中文');
assert('初始 lang=zh-CN', doc.documentElement.lang === 'zh-CN');
assert('初始导航为中文', [...doc.querySelectorAll('nav a')].some((a) => a.textContent === '投稿列表'));

console.log('[locale] 切换为 en 并重载');
const switcher = doc.getElementById('lang-switcher');
switcher.value = 'en';
switcher.dispatchEvent(new win.Event('change', { bubbles: true }));
await waitFor(() => win.localStorage.getItem('svp-locale') === 'en');
await page.waitUntilComplete();
await waitFor(() => page.mainFrame.document.documentElement.lang === 'en', 10000);

const doc2 = page.mainFrame.document;
assert('html lang=en', doc2.documentElement.lang === 'en');
assert('tagline 为英文', doc2.querySelector('[data-i18n="home.tagline"]')?.textContent.includes('Git-based'));
assert('导航 Projects', [...doc2.querySelectorAll('nav a')].some((a) => a.textContent === 'Projects'));
assert('footer Powered by', doc2.querySelector('[data-i18n="footer.powered"]')?.textContent.startsWith('Powered by'));
assert('语言选择器同步 en', doc2.getElementById('lang-switcher')?.value === 'en');
assert('title 含站点名', /Sector Vault Project$/.test(doc2.title));

await browser.close();
console.log(`\n${failed === 0 ? 'ALL PASSED' : `${failed} FAILED`}`);
process.exit(failed);
