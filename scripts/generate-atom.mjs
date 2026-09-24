// 从 current.json 生成 RSS 兼容的 Atom feed（index/atom.xml）。
// 条目链接指向主站点详情页：https://svp.lyoko.cn/view/{owner}/{repo}/{slug}
// 取最近 ATOM_LIMIT 条（默认 50），按发布/投稿时间倒序。
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = process.env.SITE_URL ?? "https://svp.lyoko.cn";
const ATOM_LIMIT = Number(process.env.ATOM_LIMIT) > 0 ? Number(process.env.ATOM_LIMIT) : 50;

const { submissions } = JSON.parse(readFileSync(join(root, "index", "current.json"), "utf8"));

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const entryDate = (s) => s.publishedAt ?? s.submittedAt;
const viewUrl = (s) => `${SITE}/view/${s.owner}/${s.repo}/${s.slug}`;

const entries = [...submissions]
  .sort((a, b) => (entryDate(a) < entryDate(b) ? 1 : -1))
  .slice(0, ATOM_LIMIT);

const feedUpdated = entries.length ? entries[0].publishedAt ?? entries[0].submittedAt : new Date().toISOString();

const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Sector Vault Project 投稿</title>
  <id>${SITE}/atom.xml</id>
  <link rel="self" type="application/atom+xml" href="${SITE}/atom.xml"/>
  <link rel="alternate" type="text/html" href="${SITE}/project"/>
  <updated>${feedUpdated}</updated>
${entries
  .map(
    (s) => `  <entry>
    <id>${esc(viewUrl(s))}</id>
    <title>${esc(s.title)}</title>
    <link rel="alternate" type="text/html" href="${esc(viewUrl(s))}"/>
    <published>${s.submittedAt}</published>
    <updated>${entryDate(s)}</updated>
    <author>
      <name>${esc(s.author ?? s.owner)}</name>
    </author>
  </entry>`
  )
  .join("\n")}
</feed>
`;

writeFileSync(join(root, "index", "atom.xml"), xml);
console.log(`atom feed: ${entries.length} entries -> index/atom.xml`);
