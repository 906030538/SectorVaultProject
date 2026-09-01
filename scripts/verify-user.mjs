// 用户空间回归验证
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

async function open(path) {
  const page = browser.newPage();
  await page.goto(`${BASE}${path}`);
  await page.waitUntilComplete();
  const doc = page.mainFrame.document;
  await waitFor(() => doc.querySelector('[data-component="project-collections"] [data-repo]'));
  return { page, doc };
}

function jsErrors(page) {
  return page.virtualConsolePrinter
    .readAsString()
    .split('\n')
    .filter((l) => /Error/.test(l) && !/stylesheet|CSS/i.test(l));
}

// ---------- 1. /user/demo（默认 github） ----------
console.log('[user] /user/demo');
{
  const { page, doc } = await open('/user/demo');

  const chips = [...doc.querySelectorAll('[data-role="platforms"] [data-platform]')];
  assert('平台切换芯片 2 个', chips.length === 2);
  assert('默认平台 github 高亮',
    chips.find((c) => c.dataset.platform === 'github').classList.contains('text-indigo-600'));
  assert('gitee 芯片链接带 ?git=',
    chips.find((c) => c.dataset.platform === 'gitee').getAttribute('href').includes('git=gitee'));

  const projectCards = [...doc.querySelectorAll('[data-component="project-collections"] [data-repo]')];
  assert('工程合集 2 个仓库（含空仓 svp-notes）',
    projectCards.length === 2 &&
    projectCards.some((c) => c.dataset.repo === 'svp-demo') &&
    projectCards.some((c) => c.dataset.repo === 'svp-notes'));

  const demo = projectCards.find((c) => c.dataset.repo === 'svp-demo');
  const minis = [...demo.querySelectorAll('[data-role="mini-card"]')];
  assert('最近 3 个工程稿件', minis.length === 3);
  assert('按日期倒序（夜航星群在最前）',
    minis[0].textContent.includes('夜航星群') &&
    minis[0].getAttribute('href') === '/view/demo/svp-demo/260815');
  assert('star 数显示', demo.textContent.includes('★ 42'));
  assert('更多按钮指向集合页',
    demo.querySelector('[data-action="more"]').getAttribute('href') === '/view/demo/svp-demo');
  assert('空仓库占位', projectCards.find((c) => c.dataset.repo === 'svp-notes').textContent.includes('–'));

  const articleCards = [...doc.querySelectorAll('[data-component="article-collections"] [data-repo]')];
  assert('专栏合集 1 个仓库', articleCards.length === 1 && articleCards[0].dataset.repo === 'svp-demo');
  assert('专栏稿件 2 条', articleCards[0].querySelectorAll('[data-role="mini-card"]').length === 2);

  const about = doc.querySelector('[data-role="about"]');
  assert('ABOUT 渲染', !about.classList.contains('hidden') &&
    doc.querySelector('[data-role="about-body"]').textContent.includes('合成器'));

  assert('无静态页按钮', !doc.querySelector('[data-action="goto-site"]'));
  assert('未登录无新建集合按钮', !doc.querySelector('[data-action="new-collection"]'));
  assert('页面无 JS 报错', jsErrors(page).length === 0);
}

// ---------- 2. /user/demo?git=gitee ----------
console.log('[user] /user/demo?git=gitee');
{
  const { page, doc } = await open('/user/demo?git=gitee');

  const chips = [...doc.querySelectorAll('[data-role="platforms"] [data-platform]')];
  assert('gitee 芯片高亮',
    chips.find((c) => c.dataset.platform === 'gitee').classList.contains('text-indigo-600'));

  const projectCards = [...doc.querySelectorAll('[data-component="project-collections"] [data-repo]')];
  assert('仅 gitee 仓库', projectCards.length === 1 && projectCards[0].dataset.repo === 'svp-demo-gitee');
  assert('工程稿件「星轨漫游」',
    projectCards[0].querySelector('[data-role="mini-card"]').textContent.includes('星轨漫游'));
  assert('专栏稿件 1 条',
    doc.querySelectorAll('[data-component="article-collections"] [data-role="mini-card"]').length === 1);
  assert('页面无 JS 报错', jsErrors(page).length === 0);
}

// ---------- 3. /user/mirai（单平台 + 静态页） ----------
console.log('[user] /user/mirai');
{
  const { page, doc } = await open('/user/mirai');

  assert('单平台不渲染切换芯片',
    doc.querySelectorAll('[data-role="platforms"] [data-platform]').length === 0);
  const siteBtn = doc.querySelector('[data-action="goto-site"]');
  assert('静态空间按钮', !!siteBtn && siteBtn.getAttribute('href') === 'https://mirai.example.com');
  assert('工程合集渲染',
    doc.querySelector('[data-component="project-collections"] [data-repo="svp-mirai"]') !== null);
  assert('star 数显示',
    doc.querySelector('[data-repo="svp-mirai"]').textContent.includes('★ 18'));
  assert('ABOUT 缺失时隐藏', doc.querySelector('[data-role="about"]').classList.contains('hidden'));
  assert('页面无 JS 报错', jsErrors(page).length === 0);
}

await browser.close();
console.log(`\n${failed === 0 ? 'ALL PASSED' : `${failed} FAILED`}`);
process.exit(failed);
