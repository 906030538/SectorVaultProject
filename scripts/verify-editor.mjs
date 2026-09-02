import { Browser } from 'happy-dom';
import { ReadableStream, TransformStream, WritableStream } from 'node:stream/web';

const BASE = process.env.BASE ?? 'http://localhost:4321';
const browser = new Browser({
  settings: {
    enableJavaScriptEvaluation: true,
    disableJavaScriptFileLoading: false,
    disableCSSFileLoading: true,
    suppressInsecureJavaScriptEnvironmentWarning: true,
    fetch: { disableSameOriginPolicy: true },
  },
});

let passed = 0;
let failed = 0;
function assert(name, ok) {
  if (ok) {
    passed += 1;
    console.log(`  ok  ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${name}`);
  }
}

// happy-dom 将 WritableStream/TransformStream 映射为 Node 经典流（无 getWriter），
// zip.js 需要真正的 Web Streams，加载页面后覆盖为 Node 内置实现
function patchStreams(page) {
  const win = page.mainFrame.window;
  win.WritableStream = WritableStream;
  win.TransformStream = TransformStream;
  win.ReadableStream = ReadableStream;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      if (fn()) return true;
    } catch {
      /* 元素尚未就绪 */
    }
    await sleep(100);
  }
  return false;
}

function todaySlug() {
  const d = new Date();
  return (
    String(d.getFullYear()).slice(2) +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0')
  );
}

function injectFile(page, input, name, content, type = 'application/octet-stream') {
  const win = page.mainFrame.window;
  const file = new win.File([content], name, { type });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new win.Event('change', { bubbles: true }));
  return file;
}

// ---------- 1. /new 表单结构 ----------
console.log('\n[new] 表单结构与校验');
{
  const page = browser.newPage();
  await page.goto(`${BASE}/new`);
  await page.waitUntilComplete();
  patchStreams(page);
  const doc = page.mainFrame.document;
  await waitFor(() => doc.querySelector('[data-field="repo"] option'));

  const repoSelect = doc.querySelector('[data-field="repo"]');
  const optionTexts = Array.from(repoSelect.options).map((o) => o.text);
  assert('repo 下拉含 4 个演示仓库', optionTexts.length === 4 && optionTexts.includes('demo/svp-demo'));

  const slugInput = doc.querySelector('[data-field="slug"]');
  assert('slug 新建时空值且占位为今日日期', slugInput.value === '' && slugInput.placeholder.startsWith(todaySlug()));

  assert('五个列表输入组存在', ['videos', 'tracks', 'engines', 'voicebanks', 'songLanguages']
    .every((k) => doc.querySelector(`[data-role="list-${k}"]`)));

  const licenseSelect = doc.querySelector('[data-field="license"]');
  assert('许可证下拉 8 项且首项为仓库默认译文',
    licenseSelect.options.length === 8 &&
    licenseSelect.options[0].text === '与仓库许可相同（默认）');

  assert('无裸 editor.* key 泄漏', !doc.body.innerHTML.includes('editor.'));
  assert('演示模式横幅存在', !!doc.querySelector('[data-role="demo-banner"]'));

  // 空标题提交 → 校验
  doc.querySelector('[data-action="submit"]').dispatchEvent(
    new page.mainFrame.window.MouseEvent('click', { bubbles: true }),
  );
  await sleep(200);
  const validation = doc.querySelector('[data-role="validation"]');
  assert('空标题提交触发校验错误', !validation.classList.contains('hidden') && validation.textContent.includes('标题必填'));
  assert('校验失败不渲染进度面板', !doc.querySelector('[data-role="progress"]'));

  // 列表加减与上限
  const tracks = doc.querySelector('[data-role="list-tracks"]');
  const addBtn = tracks.querySelector('[data-action="add"]');
  for (let i = 0; i < 9; i += 1) addBtn.click();
  const rows = tracks.querySelectorAll('input').length;
  assert('列表加到 10 行后禁用', rows === 10 && addBtn.disabled);
  tracks.querySelector('[data-action="remove"]').click();
  assert('列表删除一行', tracks.querySelectorAll('input').length === 9);

  // 标签
  const tagInput = doc.querySelector('[data-field="tags"]');
  tagInput.value = '测试';
  tagInput.dispatchEvent(new page.mainFrame.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert('回车生成标签芯片', doc.querySelector('[data-role="tag-chips"]').textContent.includes('#测试'));
  for (let i = 0; i < 9; i += 1) {
    tagInput.value = `t${i}`;
    tagInput.dispatchEvent(new page.mainFrame.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }
  tagInput.value = 'overflow';
  tagInput.dispatchEvent(new page.mainFrame.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert('第 11 个标签被拒', doc.querySelector('[data-role="tag-chips"]').children.length === 10);

  // Markdown 编辑器
  const body = doc.querySelector('[data-field="body"]');
  body.value = '# hi';
  body.dispatchEvent(new page.mainFrame.window.Event('input', { bubbles: true }));
  doc.querySelector('[data-action="preview"]').click();
  await sleep(300);
  const preview = doc.querySelector('[data-role="preview"]');
  assert('预览渲染正文', !preview.classList.contains('hidden') && preview.textContent.includes('hi'));
  doc.querySelector('[data-action="write"]').click();
  assert('编写/预览切换', !body.classList.contains('hidden'));

  // 类型切换隐藏工程字段
  doc.querySelector('[data-field="type-article"]').click();
  assert('article 隐藏参数/列表/封面/文件',
    doc.querySelector('[data-role="list-tracks"]').parentElement.hidden &&
    doc.querySelector('[data-role="file-rows"]').closest('section').hidden);
  doc.querySelector('[data-field="type-project"]').click();

  // 工程文件：json 默认格式化；加密需密码
  const fileInput = doc.querySelector('[data-field="files"]');
  injectFile(page, fileInput, 'x.json', JSON.stringify({ a: 1 }), 'application/json');
  await waitFor(() => doc.querySelectorAll('[data-role="file-rows"] > div').length === 1);
  const schemeSelect = doc.querySelector('[data-role="select-scheme"]');
  assert('json 文件默认方案为格式化', schemeSelect.value === 'format');
  schemeSelect.value = 'encrypt';
  schemeSelect.dispatchEvent(new page.mainFrame.window.Event('change', { bubbles: true }));
  const passwordInput = doc.querySelector('[data-role="file-password"]');
  assert('加密方案显示密码框', !passwordInput.classList.contains('hidden'));
  doc.querySelector('[data-field="title"]').value = '校验测试';
  doc.querySelector('[data-field="title"]').dispatchEvent(new page.mainFrame.window.Event('input', { bubbles: true }));
  assert('标题更新 slug 占位为日期-标题', slugInput.placeholder === `${todaySlug()}-校验测试`);
  assert('发布简介输入框位于附件前', (() => {
    const summary = doc.querySelector('[data-field="summary"]');
    const attachments = doc.querySelector('[data-field="attachments"]');
    const FOLLOWING = page.mainFrame.window.Node.DOCUMENT_POSITION_FOLLOWING;
    return summary && attachments && summary.compareDocumentPosition(attachments) & FOLLOWING;
  })());
  doc.querySelector('[data-action="submit"]').dispatchEvent(new page.mainFrame.window.MouseEvent('click', { bubbles: true }));
  await sleep(200);
  assert('空密码加密文件校验报错', doc.querySelector('[data-role="validation"]').textContent.includes('加密文件需要密码'));

  // 删除文件行
  doc.querySelector('[data-action="remove-file"]').click();
  assert('文件行可删除', doc.querySelectorAll('[data-role="file-rows"] > div').length === 0);

  const consoleOut = page.virtualConsolePrinter.readAsString();
  assert('页面无 JS 报错', !consoleOut.split('\n').some((l) => /error/i.test(l) && !/stylesheet/i.test(l)));
  await page.close();
}

// ---------- 2. /new 完整发布（演示模式，含压缩与加密文件） ----------
console.log('\n[new] 完整发布流程');
{
  const page = browser.newPage();
  await page.goto(`${BASE}/new`);
  await page.waitUntilComplete();
  patchStreams(page);
  const doc = page.mainFrame.document;
  await waitFor(() => doc.querySelector('[data-field="repo"] option'));

  doc.querySelector('[data-field="title"]').value = '冒烟测试稿件';
  doc.querySelector('[data-field="title"]').dispatchEvent(new page.mainFrame.window.Event('input', { bubbles: true }));
  const body = doc.querySelector('[data-field="body"]');
  body.value = '## 冒烟测试正文';
  body.dispatchEvent(new page.mainFrame.window.Event('input', { bubbles: true }));

  const fileInput = doc.querySelector('[data-field="files"]');
  injectFile(page, fileInput, 'plain.txt', 'hello world', 'text/plain');
  await waitFor(() => doc.querySelectorAll('[data-role="file-rows"] > div').length === 1);
  injectFile(page, fileInput, 'secret.json', JSON.stringify({ k: 'v' }), 'application/json');
  await waitFor(() => doc.querySelectorAll('[data-role="file-rows"] > div').length === 2);
  const selects = doc.querySelectorAll('[data-role="select-scheme"]');
  selects[0].value = 'zip';
  selects[0].dispatchEvent(new page.mainFrame.window.Event('change', { bubbles: true }));
  selects[1].value = 'encrypt';
  selects[1].dispatchEvent(new page.mainFrame.window.Event('change', { bubbles: true }));
  doc.querySelectorAll('[data-role="file-password"]')[1].value = 'pw123';
  doc.querySelectorAll('[data-role="file-password"]')[1].dispatchEvent(new page.mainFrame.window.Event('input', { bubbles: true }));

  const attachInput = doc.querySelector('[data-field="attachments"]');
  injectFile(page, attachInput, 'notes.txt', 'attachment body', 'text/plain');
  await waitFor(() => doc.querySelectorAll('[data-role="attachment-rows"] > div').length === 1);

  doc.querySelector('[data-action="submit"]').dispatchEvent(new page.mainFrame.window.MouseEvent('click', { bubbles: true }));
  const done = await waitFor(() => doc.querySelector('[data-role="done"]'));
  if (!done) console.error(page.virtualConsolePrinter.readAsString());
  assert('发布完成面板出现', done);

  const states = Array.from(doc.querySelectorAll('[data-step]')).map((s) => s.getAttribute('data-state'));
  assert('6 步全部完成', states.length === 6 && states.every((s) => s === 'done'));

  const collection = doc.querySelector('[data-action="goto-collection"]');
  const submission = doc.querySelector('[data-action="goto-submission"]');
  assert('完成链接指向集合页', collection.getAttribute('href') === '/view/demo/svp-demo');
  assert('完成链接指向详情页', (submission.getAttribute('href') ?? '').startsWith(`/view/demo/svp-demo/${todaySlug()}`));
  await page.close();
}

// ---------- 3. /edit 回填与保存 ----------
console.log('\n[edit] 回填与保存');
{
  const page = browser.newPage();
  await page.goto(`${BASE}/edit/demo/svp-demo/260815`);
  await page.waitUntilComplete();
  patchStreams(page);
  const doc = page.mainFrame.document;
  await waitFor(() => doc.querySelector('[data-field="title"]')?.value === '夜航星群' &&
    !!doc.querySelector('[data-role="list-tracks"] input'));

  const repoSelect = doc.querySelector('[data-field="repo"]');
  const slugInput = doc.querySelector('[data-field="slug"]');
  assert('仓库下拉锁定', repoSelect.disabled && repoSelect.value === 'demo/svp-demo');
  assert('slug 只读', slugInput.readOnly && slugInput.value === '260815');
  const chip = doc.querySelector('[data-role="type-chip"]');
  assert('类型显示为芯片「工程」', chip && chip.textContent === '工程' && !chip.classList.contains('hidden'));
  assert('无类型切换按钮', !doc.querySelector('[data-field="type-project"]') && !doc.querySelector('[data-field="type-article"]'));

  const checkedRadio = doc.querySelector('input[data-field="params"]:checked');
  assert('参数回填 with-params', checkedRadio && checkedRadio.value === 'with-params');
  assert('关联曲目回填', doc.querySelector('[data-role="list-tracks"] input').value === '夜航星群');
  assert('合成引擎回填', doc.querySelector('[data-role="list-engines"] input').value === 'Synthesizer V Studio Pro');
  assert('标签回填 2 个', doc.querySelector('[data-role="tag-chips"]').children.length === 2);
  assert('正文回填', doc.querySelector('[data-field="body"]').value.startsWith('## 夜航星群'));
  assert('许可证回填为空（仓库默认）', doc.querySelector('[data-field="license"]').value === '');

  const fileRows = doc.querySelectorAll('[data-role="file-rows"] > div');
  assert('现有文件行 2 条', fileRows.length === 2);
  const schemeSelects = doc.querySelectorAll('[data-role="select-scheme"]');
  assert('现有文件方案下拉禁用', schemeSelects[0].disabled && schemeSelects[1].disabled);
  assert('方案识别：不处理/压缩', schemeSelects[0].value === 'raw' && schemeSelects[1].value === 'zip');
  assert('现有文件徽标', doc.querySelectorAll('[data-role="file-rows"] .chip').length === 2);

  const attachRows = doc.querySelectorAll('[data-role="attachment-rows"] > div');
  assert('附件回填 2 条（260815 release）', attachRows.length === 2);

  assert('无裸 editor.* key 泄漏', !doc.body.innerHTML.includes('editor.'));

  // 不做修改直接保存
  doc.querySelector('[data-action="submit"]').dispatchEvent(new page.mainFrame.window.MouseEvent('click', { bubbles: true }));
  const done = await waitFor(() => doc.querySelector('[data-role="done"]'));
  if (!done) console.error(page.virtualConsolePrinter.readAsString());
  assert('保存完成面板出现', done);
  const states = Array.from(doc.querySelectorAll('[data-step]')).map((s) => s.getAttribute('data-state'));
  assert('5 步全部完成', states.length === 5 && states.every((s) => s === 'done'));
  assert('完成文案为修改已保存', doc.querySelector('[data-role="done"] h2').textContent === '修改已保存');
  await page.close();
}

// ---------- 4. /edit article 稿件 ----------
console.log('\n[edit] article 稿件');
{
  const page = browser.newPage();
  await page.goto(`${BASE}/edit/demo/svp-demo/260802`);
  await page.waitUntilComplete();
  patchStreams(page);
  const doc = page.mainFrame.document;
  await waitFor(() => doc.querySelector('[data-field="title"]')?.value === 'Synthesizer V 参数调校入门指南');

  assert('类型芯片「专栏」', doc.querySelector('[data-role="type-chip"]').textContent === '专栏');
  assert('隐藏工程字段', doc.querySelector('[data-role="list-tracks"]').parentElement.hidden);
  assert('无现有工程文件', doc.querySelectorAll('[data-role="file-rows"] > div').length === 0);
  assert('正文回填非空', doc.querySelector('[data-field="body"]').value.length > 0);
  await page.close();
}

// ---------- 5. 回归：集合页/详情页仍可用 ----------
console.log('\n[regression] 集合页与详情页');
{
  const page = browser.newPage();
  await page.goto(`${BASE}/view/demo/svp-demo/`);
  await page.waitUntilComplete();
  patchStreams(page);
  await waitFor(() => page.mainFrame.document.querySelectorAll('[data-component="list"] article').length > 0);
  assert('集合页仍渲染稿件列表', page.mainFrame.document.querySelectorAll('[data-component="list"] article').length === 7);
  await page.close();

  const detail = browser.newPage();
  await detail.goto(`${BASE}/view/demo/svp-demo/260815/`);
  await detail.waitUntilComplete();
  patchStreams(detail);
  const ok = await waitFor(() => detail.mainFrame.document.querySelector('[data-role="title"]')?.textContent === '夜航星群');
  assert('详情页仍正常', ok);
  await detail.close();
}

await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
