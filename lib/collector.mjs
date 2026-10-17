import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
export const dataDir = resolve(process.env.DATA_DIR || 'data');
export async function readData(name, fallback) { try { return JSON.parse(await readFile(resolve(dataDir, name + '.json'), 'utf8')); } catch (e) { if(e.code === 'ENOENT') return fallback; throw e; } }
export async function saveData(name, value) { await mkdir(dataDir, { recursive: true }); const dest = resolve(dataDir, name + '.json'); await writeFile(dest + '.tmp', JSON.stringify(value)); await rename(dest + '.tmp', dest); }
const pause = ms => new Promise(r => setTimeout(r, ms));
async function get(url, github = false) {
  const headers = { 'User-Agent': 'SkillAtlas/1.0 (+https://github.com/ASunYC/skill-atlas)' };
  if (github && process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);
  return response.json();
}
export function repoItem(r, category) {
  return { id: `gh:${r.full_name}`, name: r.name, owner: r.owner.login, description: r.description || '项目暂无简介，前往源仓库了解更多。', url: r.html_url, category, source: 'GitHub', stars: r.stargazers_count, forks: r.forks_count, metric: r.stargazers_count, metricLabel: 'Stars', pushedAt: r.pushed_at, archived: r.archived, tags: (r.topics || []).slice(0, 5), language: r.language, discoveredAt: new Date().toISOString() };
}
const queries = [
  ['skills', 'topic:agent-skills archived:false', 2],
  ['skills', 'topic:claude-skills archived:false', 2],
  ['skills', '"SKILL.md" in:readme stars:>20 archived:false', 2],
  ['dsh', '"deepseek-harness" in:name,description,readme archived:false', 2],
  ['dsh', 'dsh-plugin in:name,description archived:false', 1],
  ['apps', 'topic:ai-agent stars:>1000 archived:false', 1],
];
const curated = ['langgenius/dify', 'n8n-io/n8n', 'open-webui/open-webui', 'FlowiseAI/Flowise', 'lobehub/lobe-chat', 'infiniflow/ragflow', 'Anionex/banana-slides', 'Mintplex-Labs/anything-llm'];
const skillSources = ['anthropics/skills', 'openai/skills', 'huggingface/skills'];
export async function collect() {
  const old = await readData('catalog', { items: [], sources: [] });
  const entries = new Map(old.items.map(i => [i.id, i]));
  const sources = [];
  const cursors = { ...(old.cursors || {}) };
  for (const [category, query, pages] of queries) {
    let count = 0, total = null;
    try {
      // Rotate search pages between refreshes, retaining discoveries instead of
      // fetching the same top 200 forever. GitHub caps each query at 1,000.
      const startPage = cursors[query] || 1;
      let nextPage = startPage;
      for (let page = startPage; page < startPage + pages && page <= 10; page++) {
        const data = await get(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=100&page=${page}`, true);
        total = data.total_count;
        for (const r of data.items) { const item = repoItem(r, category); const prev = entries.get(item.id); if (prev?.category === 'dsh' && category !== 'dsh') continue; entries.set(item.id, { ...prev, ...item }); count++; }
        if (!process.env.GITHUB_TOKEN) await pause(7000);
        nextPage = page >= 10 || data.items.length < 100 ? 1 : page + 1;
        if (data.items.length < 100) break;
      }
      cursors[query] = nextPage;
      sources.push({ name: `GitHub · ${category}`, query, page: startPage, count, matched: total, status: 'ok', checkedAt: new Date().toISOString() });
    } catch(e) { sources.push({ name: `GitHub · ${category}`, query, count, status: 'error', error: e.message, checkedAt: new Date().toISOString() }); }
  }
  for (const repo of curated) {
    try { const r = await get(`https://api.github.com/repos/${repo}`, true); entries.set(`gh:${repo}`, repoItem(r, 'apps')); }
    catch(e) { sources.push({ name: repo, status: 'error', error: e.message }); }
  }
  // A repository match is a candidate, never a claimed verified plugin or skill.
  for (const repo of skillSources) {
    try {
      const r = await get(`https://api.github.com/repos/${repo}`, true);
      const tree = await get(`https://api.github.com/repos/${repo}/git/trees/${r.default_branch}?recursive=1`, true);
      const manifests = tree.tree.filter(p => p.type === 'blob' && /(^|\/)SKILL\.md$/.test(p.path));
      for (const p of manifests) { const base = repoItem(r, 'skills'); const folder = p.path.split('/').slice(-2, -1)[0] || r.name; entries.set(`skill:${repo}:${p.path}`, { ...base, id: `skill:${repo}:${p.path}`, name: folder, description: `${repo} 中含 SKILL.md 清单的技能。点击查看使用方式与权限要求。`, url: `https://github.com/${repo}/blob/${r.default_branch}/${p.path}`, verified: true, metricLabel: '仓库 Stars', tags: ['SKILL.md', repo.split('/')[0]], manifest: p.path }); }
      sources.push({ name: repo, count: manifests.length, status: tree.truncated ? 'partial' : 'ok', checkedAt: new Date().toISOString() });
    } catch(e) { sources.push({ name: repo, status: 'error', error: e.message }); }
  }
  for (const [endpoint, category, label] of [['models', 'models', '下载 / 月'], ['spaces', 'spaces', 'Likes']]) {
    try {
      const list = await get(`https://huggingface.co/api/${endpoint}?sort=trendingScore&direction=-1&limit=80`);
      for (const [key, entry] of entries) if (entry.category === category) entries.delete(key);
      for (const r of list) { const id = r.id; entries.set(`hf:${endpoint}:${id}`, { id: `hf:${endpoint}:${id}`, name: id.split('/').pop(), owner: id.split('/')[0], description: r.pipeline_tag || r.cardData?.short_description || `${endpoint === 'models' ? '模型' : '交互应用'} · ${id}`, url: `https://huggingface.co/${endpoint === 'models' ? '' : 'spaces/'}${id}`, category, source: 'Hugging Face', metric: endpoint === 'models' ? (r.downloads || 0) : (r.likes || 0), metricLabel: label, likes: r.likes || 0, trendingScore: r.trendingScore || 0, tags: (r.tags || []).filter(t=>!t.includes(':')).slice(0,4), pushedAt: r.lastModified || null }); }
      sources.push({ name: `Hugging Face · ${endpoint}`, count: list.length, status: 'ok', checkedAt: new Date().toISOString() });
    } catch(e) { sources.push({ name: `Hugging Face · ${endpoint}`, status: 'error', error: e.message }); }
  }
  const now = new Date().toISOString();
  const items = [...entries.values()].map(i => ({ ...i, history: [...(old.items.find(o=>o.id===i.id)?.history || []).filter(p=>p.date !== now.slice(0,10)), { date: now.slice(0,10), value: i.metric }].slice(-30) }));
  const result = { updatedAt: now, items, sources, cursors, coverage: '公开仓库关键词与主题搜索、精选技能清单及 Hugging Face trendingScore 榜单。每轮滚动分页，逐步扩大收录；单查询最多 1,000 项。候选仓库不代表已通过安装或安全审查；非全量索引。' };
  await saveData('catalog', result);
  console.log(`Collected ${items.length} entries; ${sources.filter(s=>s.status==='error').length} source failures`);
  return result;
}
export const probeTargets = [ ['Dify', 'https://dify.ai'], ['n8n', 'https://n8n.io'], ['Open WebUI', 'https://openwebui.com'], ['Hugging Face', 'https://huggingface.co'], ['GitHub API', 'https://api.github.com'] ];
export async function probe() {
  const previous = await readData('probes', { targets: [] });
  const targets = await Promise.all(probeTargets.map(async ([name, url]) => {
    const start = Date.now(); let status = 'unreachable', code = null;
    try { const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(12000), redirect: 'follow' }); code = r.status; status = r.ok ? 'up' : 'limited'; } catch {}
    const sample = { at: new Date().toISOString(), status, ms: Date.now() - start, code };
    return { name, url, ...sample, history: [...(previous.targets.find(t=>t.name===name)?.history || []), sample].slice(-288) };
  }));
  const result = { checkedAt: new Date().toISOString(), targets }; await saveData('probes', result); return result;
}
