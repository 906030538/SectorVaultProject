// 投稿列表筛选器（可输入下拉框）回归验证
// 前置：npm run build && npm run preview（4321 端口）
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
await page.goto(`${BASE}/project`);
await page.waitUntilComplete();
const doc = page.mainFrame.document;
await waitFor(() => doc.querySelectorAll('[data-component="list"] > *').length > 0);

console.log('[filters] 结构');
const inputs = [...doc.querySelectorAll('[data-component="filters"] input[data-filter]')];
assert('4 个可输入筛选框', inputs.length === 4);
assert('旧式 select 已移除', doc.querySelectorAll('[data-component="filters"] select').length === 0);
const panels = [...doc.querySelectorAll('[data-role="filter-options"]')];
assert('候选面板初始隐藏', panels.every((p) => p.classList.contains('hidden')));
assert('初始列表 10 卡（第 1/2 页）',
  doc.querySelectorAll('[data-component="list"] > *').length === 10 &&
  doc.querySelector('[data-role="page-info"]').textContent.includes('1 / 2'));

console.log('[filters] 候选下拉');
const engineInput = doc.querySelector('input[data-filter="engine"]');
const enginePanel = engineInput.parentElement.querySelector('[data-role="filter-options"]');
engineInput.dispatchEvent(new page.mainFrame.window.Event('focus'));
await waitFor(() => enginePanel.children.length > 0);
assert('聚焦显示候选', !enginePanel.classList.contains('hidden'));
assert('候选不超过 10 条', enginePanel.children.length <= 10);
assert('候选按频次排序（SV 最多在前）',
  enginePanel.children[0].textContent === 'Synthesizer V Studio Pro');

engineInput.value = 'uta';
engineInput.dispatchEvent(new page.mainFrame.window.Event('input'));
await waitFor(() =>
  enginePanel.children.length === 2 &&
  [...enginePanel.children].every((c) => c.textContent.toLowerCase().includes('uta')));
assert('输入文本过滤候选（OpenUtau/UTAU）', true);
assert('输入不立即生效（列表仍 10 卡）',
  doc.querySelectorAll('[data-component="list"] > *').length === 10);

console.log('[filters] 点击搜索才生效');
[...enginePanel.children]
  .find((c) => c.textContent === 'UTAU')
  .dispatchEvent(new page.mainFrame.window.MouseEvent('click', { bubbles: true }));
assert('点击候选写入输入框', engineInput.value === 'UTAU');
assert('选中后面板收起', enginePanel.classList.contains('hidden'));
assert('选中仍不生效（列表不变）',
  doc.querySelectorAll('[data-component="list"] > *').length === 10);

const searchBtn = doc.querySelector('[data-action="search"]');
searchBtn.dispatchEvent(new page.mainFrame.window.MouseEvent('click', { bubbles: true }));
await waitFor(() => doc.querySelectorAll('[data-component="list"] > *').length === 3);
assert('点击搜索后按引擎过滤（3 条）',
  doc.querySelector('[data-role="page-info"]').textContent.includes('1 / 1'));

console.log('[filters] 自定义输入');
engineInput.value = '不存在的引擎';
engineInput.dispatchEvent(new page.mainFrame.window.Event('input'));
assert('自定义输入无候选时面板隐藏', enginePanel.classList.contains('hidden'));
searchBtn.dispatchEvent(new page.mainFrame.window.MouseEvent('click', { bubbles: true }));
await waitFor(() => !doc.querySelector('[data-role="empty"]').hidden);
assert('自定义值参与筛选（空结果）',
  doc.querySelectorAll('[data-component="list"] > *').length === 0);

engineInput.value = '';
const langInput = doc.querySelector('input[data-filter="songLanguage"]');
langInput.value = 'zh';
langInput.dispatchEvent(
  new page.mainFrame.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
);
await waitFor(() => doc.querySelectorAll('[data-component="list"] > *').length === 8);
assert('筛选框回车触发搜索（8 条中文）',
  doc.querySelector('[data-role="page-info"]').textContent.includes('1 / 1'));

const errors = page.virtualConsolePrinter
  .readAsString()
  .split('\n')
  .filter((l) => /Error/.test(l) && !/stylesheet|CSS/i.test(l));
assert('页面无 JS 报错', errors.length === 0);
if (errors.length) console.log(errors.join('\n'));

await browser.close();
console.log(`\n${failed === 0 ? 'ALL PASSED' : `${failed} FAILED`}`);
process.exit(failed);
