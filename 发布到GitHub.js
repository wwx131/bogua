#!/usr/bin/env node
/**
 * 一键发布到 GitHub Pages（可重复运行，用于更新站点）
 *
 * 用法：
 *   Windows PowerShell:
 *     $env:GH_TOKEN = "<你的PAT>"; node 发布到GitHub.js
 *   Git Bash / macOS / Linux:
 *     GH_TOKEN=<你的PAT> node 发布到GitHub.js
 *
 * 可选环境变量：
 *   GH_OWNER   默认 wwx131
 *   GH_REPO    默认 bogua
 *   GH_BRANCH  默认 main
 *   GH_ROOT    默认脚本所在目录
 *   GH_MSG     自定义提交说明
 *
 * PAT 权限：经典令牌勾 repo；细粒度令牌需 Contents: Read and write + Pages: Read and write
 * （若要脚本自动建仓库，还需 Administration: Read and write，或你先手动建好空仓库）
 *
 * 站点地址：https://<owner>.github.io/<repo>/
 * 令牌只从环境变量读取，脚本不会打印它。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const OWNER = process.env.GH_OWNER || 'wwx131';
const REPO = process.env.GH_REPO || 'bogua';
const BRANCH = process.env.GH_BRANCH || 'main';
const ROOT = process.env.GH_ROOT || __dirname;
const TOKEN = process.env.GH_TOKEN;
const MESSAGE = process.env.GH_MSG || '周易卜卦 手机版：响应式单文件网页（64卦数据 + 变爻变卦 + 离线可用）';

if (!TOKEN) {
  console.error('[!] 未设置环境变量 GH_TOKEN');
  process.exit(1);
}
const API = 'https://api.github.com';
const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  'User-Agent': 'dsh-deploy',
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28'
};
const scrub = (s) => String(s).split(TOKEN).join('***');

async function api(method, p, body, { allowFail = false, retries = 3 } = {}) {
  const url = p.startsWith('http') ? p : API + p;
  let lastErr = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      method,
      headers: Object.assign({}, HEADERS, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    if (res.ok) { try { return text ? JSON.parse(text) : {}; } catch { return text; } }
    if ((res.status >= 500 || res.status === 429) && attempt < retries) {
      console.log(`    (HTTP ${res.status}，第 ${attempt} 次重试…)`);
      await new Promise(r => setTimeout(r, 1500 * attempt));
      lastErr = `${method} ${p} -> HTTP ${res.status}`;
      continue;
    }
    if (allowFail) return null;
    throw new Error(`${method} ${p} -> HTTP ${res.status}\n${scrub(text).slice(0, 800)}`);
  }
  throw new Error(lastErr || 'unknown');
}

function collectFiles() {
  const skip = /^(\.git|node_modules|_.*|.*\.zip)$/;
  return fs.readdirSync(ROOT, { withFileTypes: true })
    .filter(d => d.isFile() && !skip.test(d.name))
    .map(d => ({ name: d.name, full: path.join(ROOT, d.name), buf: fs.readFileSync(path.join(ROOT, d.name)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

(async () => {
  console.log(`== 发布 ${OWNER}/${REPO} （分支 ${BRANCH}）==`);
  console.log(`   源目录: ${ROOT}`);

  const me = await api('GET', '/user');
  console.log(`   令牌账号: ${me.login}${me.login === OWNER ? '' : '  [!] 与目标账号不一致'}`);

  let repo = await api('GET', `/repos/${OWNER}/${REPO}`, null, { allowFail: true });
  if (!repo) {
    repo = await api('POST', '/user/repos', {
      name: REPO,
      description: '周易卜卦 · 三币起卦（手机版单文件网页，支持变爻变卦、离线使用）',
      homepage: `https://${OWNER}.github.io/${REPO}/`,
      private: false, has_issues: true, has_wiki: false, auto_init: false
    });
    console.log('   已新建公开仓库');
  } else {
    console.log(`   仓库已存在（大小 ${repo.size}KB，Pages ${repo.has_pages ? '已开启' : '未开启'}）`);
  }

  // 空仓库不能用 Git Data API，需要先建立首个提交
  let ref = await api('GET', `/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`, null, { allowFail: true });
  let parentSha = ref && ref.object ? ref.object.sha : null;
  if (!parentSha) {
    console.log('   仓库为空：先建首个提交');
    const boot = await api('PUT', `/repos/${OWNER}/${REPO}/contents/README.md`, {
      message: '初始化仓库',
      content: Buffer.from('# ' + REPO + '\n\n源码站点，稍后自动填充。\n', 'utf8').toString('base64'),
      branch: BRANCH
    });
    parentSha = boot.commit.sha;
    console.log('   初始提交 ' + parentSha.slice(0, 7));
  }

  console.log('== 上传文件 ==');
  const files = collectFiles();
  const tree = [];
  for (const f of files) {
    const blob = await api('POST', `/repos/${OWNER}/${REPO}/git/blobs`, {
      content: f.buf.toString('base64'), encoding: 'base64'
    });
    tree.push({ path: f.name, mode: '100644', type: 'blob', sha: blob.sha });
    console.log(`   + ${f.name.padEnd(24)} ${String(f.buf.length).padStart(7)} 字节`);
  }
  const nj = await api('POST', `/repos/${OWNER}/${REPO}/git/blobs`, { content: '', encoding: 'base64' });
  tree.push({ path: '.nojekyll', mode: '100644', type: 'blob', sha: nj.sha });
  console.log('   + .nojekyll（关闭 Jekyll 处理）');

  const newTree = await api('POST', `/repos/${OWNER}/${REPO}/git/trees`, { tree });
  const commit = await api('POST', `/repos/${OWNER}/${REPO}/git/commits`, {
    message: MESSAGE, tree: newTree.sha, parents: [parentSha]
  });
  await api('PATCH', `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, { sha: commit.sha });
  console.log(`   提交 ${commit.sha.slice(0, 7)} 已推送到 ${BRANCH}`);

  console.log('== 启用 Pages ==');
  let pages = await api('GET', `/repos/${OWNER}/${REPO}/pages`, null, { allowFail: true });
  if (!pages) {
    pages = await api('POST', `/repos/${OWNER}/${REPO}/pages`, {
      source: { branch: BRANCH, path: '/' }
    }, { allowFail: true });
    console.log(pages ? '   Pages 已创建' : '   [!] 自动开启失败，请在仓库 Settings → Pages 手动选 ' + BRANCH + ' 分支');
  } else {
    console.log('   Pages 已存在，沿用现有配置');
  }

  const url = `https://${OWNER}.github.io/${REPO}/`;
  console.log('== 探测站点 ==');
  console.log('   网址 ' + url);
  let ok = false;
  for (let i = 1; i <= 20; i++) {
    await new Promise(r => setTimeout(r, 15000));
    try {
      const r = await fetch(url + '?t=' + Date.now(), { headers: { 'User-Agent': 'dsh-probe' } });
      if (r.status === 200) {
        const body = await r.text();
        console.log(`   第 ${i} 次: HTTP 200（${body.length} 字节）`);
        ok = true; break;
      }
      console.log(`   第 ${i} 次: HTTP ${r.status}`);
    } catch (e) { console.log(`   第 ${i} 次: ${scrub(e.message).slice(0, 60)}`); }
  }
  console.log(ok ? `\n发布成功：${url}` : `\n已推送，Pages 构建中（1~3 分钟），稍后访问：${url}`);
  console.log('仓库：https://github.com/' + OWNER + '/' + REPO);
  process.exit(ok ? 0 : 2);
})().catch(e => { console.error('\n[失败] ' + scrub(e.message)); process.exit(1); });
