import { Browser } from 'happy-dom';

const BASE = 'http://localhost:4321';
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
await new Promise((r) => setTimeout(r, 2000));
let win = page.mainFrame.window;
let doc = page.mainFrame.document;
const switcher = doc.getElementById('lang-switcher');
console.log('switcher found:', !!switcher, 'cards:', doc.querySelectorAll('[data-component="list"] > *').length);
switcher.value = 'en';
switcher.dispatchEvent(new win.Event('change', { bubbles: true }));
await new Promise((r) => setTimeout(r, 3000));
console.log('after change url:', page.mainFrame.url);
win = page.mainFrame.window;
doc = page.mainFrame.document;
console.log('storage svp-locale:', win.localStorage.getItem('svp-locale'));
console.log('lang:', doc.documentElement.lang);
console.log('nav:', [...doc.querySelectorAll('nav a')].map((a) => a.textContent).join('|'));
console.log('errors:', page.virtualConsolePrinter.readAsString().split('\n').filter((l) => l && !/stylesheet|CSS/i.test(l)).join('\n'));
console.log('scripts:', [...doc.querySelectorAll('script[src]')].map((s) => s.src).join('\n'));
await browser.close();
