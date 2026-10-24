/* Learn V6: dependency-free offline reader. */
(function () {
  'use strict';
  const D = window.LEARN;
  const main = document.getElementById('main');
  if (!D || !Array.isArray(D.articles) || !Array.isArray(D.glossary)) {
    main.innerHTML = '<div class="page"><h1>学习资料未能加载</h1><p>请完整解压下载的文件，保留“学习资料”文件夹内的原有结构，再双击“开始学习.cmd”。</p></div>';
    return;
  }
  const articles = new Map(D.articles.map(a => [a.id, a]));
  const terms = new Map(D.glossary.map(t => [t.id, t]));
  const available = D.articles.filter(a => a.status !== 'unavailable');
  const sections = D.sections || [];
  const sectionRank = new Map(sections.map((s,i) => [s.id,i]));
  const articleOrder = new Map(D.articles.map((a,i) => [a.id,i]));
  const sectionTitle = id => (sections.find(s => s.id === id) || {}).title || id || '文档';
  // Keep the V1 keys stable so an in-place upgrade does not hide existing progress.
  const STORAGE_KEY = 'learn-chinese-v1.reading';
  const THEME_KEY = 'learn-chinese-v1.theme';
  const LEGACY_V2_KEY = 'learn-chinese-v2.reading';
  const MIGRATION_KEY = 'learn-chinese-v2.reading-migrated';
  const schema = 'learn-reading-v2';
  let reading = Object.create(null), storageOK = true, language = 'zh', renderToken = 0, toastTimer;
  const contentCache = new Map(), contentPending = new Map();
  const CONTENT_CACHE_LIMIT = 3, CONTENT_CACHE_BYTE_LIMIT = 16 * 1024 * 1024;
  let contentCacheBytes = 0, activeArticle = null;
  const docsState = {query:'', state:'all', section:'', group:'', page:1, open:new Set()};
  const glossaryState = {query:'', sort:'en', module:'', usage:'', product:'', axis:'module'};
  const DOCS_PAGE_SIZE = 40;
  const articleSearchText = new Map(D.articles.map(a => [a.id, (a.title + ' ' + (a.text || '')).toLocaleLowerCase()]));
  const glossarySearchText = new Map(D.glossary.map(t => [t.id, (t.title + ' ' + (t.en || '') + ' ' + (t.text || '')).toLocaleLowerCase()]));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const articleHref = a => '#/article/' + encodeURIComponent(a.id);
  const termHref = t => '#/glossary/' + encodeURIComponent(t.id);
  const safeURL = url => { try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.href : ''; } catch (_) { return ''; } };
  function storageWarning(message) { storageOK = false; const el = document.getElementById('storage-warning'); el.textContent = message || '浏览器未允许保存阅读记录。当前记录仅在本次打开期间有效，请及时在“阅读记录”中导出备份。'; el.hidden = false; }
  function validRecords(value, allowUnknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('阅读记录格式不正确');
    const out = Object.create(null);
    for (const [id, date] of Object.entries(value)) {
      if (!articles.has(id) || articles.get(id).status === 'unavailable') { if (allowUnknown) continue; throw new Error('文件中包含本学习库没有的文章记录'); }
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString() !== date) throw new Error('阅读日期格式不正确');
      out[id] = date;
    }
    return out;
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) reading = validRecords(JSON.parse(saved), true);
    if (localStorage.getItem(MIGRATION_KEY) !== '1') {
      const legacy = localStorage.getItem(LEGACY_V2_KEY);
      if (legacy) {
        const records = validRecords(JSON.parse(legacy), true);
        for (const [id,date] of Object.entries(records)) if (!reading[id] || reading[id] < date) reading[id] = date;
        localStorage.setItem(STORAGE_KEY,JSON.stringify(reading));
      }
      localStorage.setItem(MIGRATION_KEY,'1');
    }
    const probe = STORAGE_KEY + '.probe'; localStorage.setItem(probe, '1'); localStorage.removeItem(probe);
    if ((localStorage.getItem(THEME_KEY) || localStorage.getItem('learn-chinese-v2.theme')) === 'dark') document.body.classList.add('dark');
  } catch (_) { storageWarning(); }
  function saveReading() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(reading)); } catch (_) { storageWarning(); } refreshCount(); }
  function refreshCount() { document.getElementById('nav-read-count').textContent = Object.keys(reading).length; }
  function toast(message) { const el = document.getElementById('toast'); clearTimeout(toastTimer); el.textContent = message; el.hidden = false; toastTimer = setTimeout(() => { el.hidden = true; }, 3000); }
  function toggleRead(id) {
    const a = articles.get(id); if (!a || a.status === 'unavailable') return;
    if (reading[id]) delete reading[id]; else reading[id] = new Date().toISOString();
    saveReading();
    document.querySelectorAll('[data-read-id]').forEach(b => {
      if (b.dataset.readId !== id) return;
      const read = !!reading[id]; b.classList.toggle('is-read', read); b.setAttribute('aria-pressed', String(read));
      if (b.classList.contains('read-dot')) { b.textContent = read ? '✓' : ''; b.setAttribute('aria-label', (read ? '标为未读：' : '标为已读：') + a.title); }
      else b.textContent = read ? '✓ 已读' : '标为已读';
    });
    toast(reading[id] ? '已记为已读' : '已记为未读');
    if (location.hash.startsWith('#/progress')) progress();
    const stateFilter = document.getElementById('docs-state'); if (stateFilter) stateFilter.dispatchEvent(new Event('change'));
  }
  function readDot(a) { if (a.status === 'unavailable') return '<span class="read-dot" aria-hidden="true">—</span>'; const read = !!reading[a.id]; return '<button class="read-dot' + (read ? ' is-read' : '') + '" data-read-id="' + esc(a.id) + '" aria-pressed="' + read + '" aria-label="' + esc((read ? '标为未读：' : '标为已读：') + a.title) + '">' + (read ? '✓' : '') + '</button>'; }
  function row(a) { return '<div class="document-row">' + readDot(a) + '<a href="' + articleHref(a) + '">' + esc(a.title) + (a.status === 'unavailable' ? ' <span class="unavailable-tag">来源未取得</span>' : '') + '<small>' + esc(a.group || sectionTitle(a.section)) + '</small></a></div>'; }
  function setNav(route) {
    const type = route === '' ? 'home' : route === 'article' ? 'docs' : route;
    document.querySelectorAll('[data-nav]').forEach(a => { const active = a.dataset.nav === type; a.classList.toggle('active', active); if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    document.body.classList.toggle('home-view', type === 'home');
  }
  function home() {
    const read = Object.keys(reading).length;
    const first = available.find(a => /\/docs\/quickstart$/.test(a.url)) || available.find(a => /概览|入门/.test(a.title)) || available[0];
    const resume = available.filter(a => reading[a.id]).sort((a,b) => reading[b.id].localeCompare(reading[a.id]))[0];
    const count = available.length;
    main.innerHTML = '<div class="home"><section class="home-hero"><div class="hero-copy"><div class="eyebrow">让知识更容易抵达</div><h1>用中文，读懂 Learn。</h1><p class="home-intro">从基础概念到日常应用，把官方学习资料放在手边。<br>离线阅读、随时查词，用自己的节奏继续学习。</p></div><div class="hero-mark" aria-hidden="true"><span>↗</span></div></section><div class="home-stats"><span><strong>' + count + '</strong>篇中文文档</span><span><strong>' + D.glossary.length + '</strong>个词汇解释</span><span><strong>' + read + '</strong>篇已读</span><span>资料快照 ' + esc(D.meta.snapshot || '2026-10-21') + '</span></div><section class="home-cards" aria-label="开始学习"><a class="home-card primary" href="' + (resume ? articleHref(resume) : '#/docs') + '"><div class="card-icon">↗</div><span class="card-arrow">↗</span><h2>' + (resume ? '继续上次阅读' : '开始阅读') + '</h2><p>' + (resume ? esc(resume.title) : '打开完整目录，找到你现在想了解的内容。') + '</p></a><a class="home-card" href="#/glossary"><div class="card-icon">Aa</div><span class="card-arrow">↗</span><h2>词汇表</h2><p>把陌生术语变成熟悉概念，中英对照，随时查阅。</p></a><a class="home-card" href="#/progress"><div class="card-icon">◷</div><span class="card-arrow">↗</span><h2>我的阅读记录</h2><p>查看已读与未读，导出备份，把学习进度带走。</p></a></section><div class="home-bottom"><p class="snapshot"><span>非官方中文译本 · 产品名与代码保留原文</span><span> · </span>' + (D.extras || []).filter(x => safeURL(x.url)).map(x => '<a href="' + esc(safeURL(x.url)) + '" target="_blank" rel="noopener noreferrer" title="' + esc(x.note || '需联网') + '">' + esc(x.title) + ' ↗</a>').join(' · ') + '</p><p><a href="' + (first ? articleHref(first) : '#/docs') + '">从入门文档开始 →</a><span aria-hidden="true">　·　</span><a href="#/help">使用说明</a></p></div></div>';
    document.title = 'Learn 中文学习库 · V6';
  }
  function listPager(total,page,size,label) {
    const pages = Math.max(1,Math.ceil(total / size));
    return '<nav class="list-pager" aria-label="' + esc(label) + '分页"><button type="button" class="button secondary" data-list-page="' + (page-1) + '"' + (page <= 1 ? ' disabled' : '') + '>上一页</button><span>第 ' + page + ' / ' + pages + ' 页 · 每页 ' + size + ' 项</span><button type="button" class="button secondary" data-list-page="' + (page+1) + '"' + (page >= pages ? ' disabled' : '') + '>下一页</button></nav>';
  }
  function rememberListHash(type,state) {
    const p = new URLSearchParams();
    if (state.query) p.set('q',state.query);
    if (type === 'docs') { if (state.section) p.set('section',state.section); if (state.group) p.set('group',state.group); if (state.state !== 'all') p.set('state',state.state); }
    else { if (state.sort !== 'en') p.set('sort',state.sort); for (const key of ['module','usage','product']) if (state[key]) p.set(key,state[key]); }
    if (type === 'docs' && state.page > 1) p.set('page',String(state.page));
    history.replaceState(null,'','#/' + type + (p.size ? '?' + p.toString() : ''));
  }
  function docs(params) {
    if (params && params.size) {
      docsState.query = params.get('q') || '';
      docsState.section = sections.some(s => s.id === params.get('section')) ? params.get('section') : '';
      docsState.group = params.get('group') || '';
      docsState.state = ['all','read','unread','unavailable'].includes(params.get('state')) ? params.get('state') : 'all';
      docsState.page = Math.max(1,parseInt(params.get('page'),10) || 1);
    }
    if (docsState.section) docsState.open.add(docsState.section);
    const tree = sections.map(s => {
      const items = D.articles.filter(a => a.section === s.id), groups = [...new Set(items.map(a => a.group || '更多内容'))];
      return '<details class="docs-tree-section" data-tree-section="' + esc(s.id) + '"' + (docsState.open.has(s.id) ? ' open' : '') + '><summary><span>' + esc(s.title) + '</span><b>' + items.length + '</b></summary><button class="docs-tree-section-link" type="button" data-section-nav="' + esc(s.id) + '">本主题全部文档</button>' + groups.map(g => '<button class="docs-tree-group-link" type="button" data-group-nav="' + esc(s.id) + '|' + esc(g) + '"><span>' + esc(g) + '</span><b>' + items.filter(a => (a.group || '更多内容') === g).length + '</b></button>').join('') + '</details>';
    }).join('');
    main.innerHTML = '<div class="page docs-page"><div class="docs-shell"><aside class="docs-tree" aria-label="文档目录"><div class="docs-tree-title">目录 · 点击主题展开</div><button class="docs-tree-all" type="button" data-section-nav="">全部文档 <b>' + D.articles.length + '</b></button>' + tree + '</aside><section class="docs-results"><div class="page-heading"><div><div class="eyebrow">Learn 文档</div><h1>文档</h1><p class="page-description">展开左侧主题选择目录，再用搜索与阅读状态缩小范围。</p></div><span class="page-description">' + available.length + ' 篇正文 · ' + (D.articles.length-available.length) + ' 个来源未取得</span></div><div class="filter-bar"><input id="docs-query" class="input" type="search" placeholder="搜索文档标题与正文…" aria-label="搜索文档"><select id="docs-state" class="input" aria-label="筛选阅读状态"><option value="all">全部状态</option><option value="unread">未读</option><option value="read">已读</option><option value="unavailable">来源未取得</option></select><button id="docs-reset" class="button secondary" type="button">清除筛选</button></div><div id="docs-filter-summary" class="docs-filter-summary"></div><div id="docs-list"></div></section></div></div>';
    const query = document.getElementById('docs-query'), state = document.getElementById('docs-state'), summary = document.getElementById('docs-filter-summary'), treeEl = document.querySelector('.docs-tree');
    query.value = docsState.query; state.value = docsState.state;
    let frame = 0;
    const update = () => {
      frame = 0; if (!query.isConnected) return;
      const q = docsState.query.trim().toLocaleLowerCase();
      const list = D.articles.filter(a => (!docsState.section || a.section === docsState.section) && (!docsState.group || (a.group || '更多内容') === docsState.group) && (!q || (articleSearchText.get(a.id) || '').includes(q)) && (docsState.state === 'all' || (docsState.state === 'read' ? !!reading[a.id] : docsState.state === 'unavailable' ? a.status === 'unavailable' : a.status !== 'unavailable' && !reading[a.id]))).sort((a,b) => (sectionRank.get(a.section) ?? sections.length) - (sectionRank.get(b.section) ?? sections.length) || articleOrder.get(a.id) - articleOrder.get(b.id));
      docsState.page = Math.min(docsState.page,Math.max(1,Math.ceil(list.length / DOCS_PAGE_SIZE)));
      const pageItems = list.slice((docsState.page-1)*DOCS_PAGE_SIZE,docsState.page*DOCS_PAGE_SIZE), groups = new Map();
      pageItems.forEach(a => { const key = a.section || 'other'; if (!groups.has(key)) groups.set(key,[]); groups.get(key).push(a); });
      summary.textContent = (docsState.section ? sectionTitle(docsState.section) : '全部文档') + (docsState.group ? ' / ' + docsState.group : '') + ' · 共 ' + list.length + ' 项，当前显示 ' + pageItems.length + ' 项';
      document.getElementById('docs-list').innerHTML = list.length ? [...groups].map(([key,items]) => '<section class="section-group"><h2 class="section-heading">' + esc(sectionTitle(key)) + '<span>本页 ' + items.length + ' 项</span></h2><div class="document-list">' + items.map(row).join('') + '</div></section>').join('') + listPager(list.length,docsState.page,DOCS_PAGE_SIZE,'文档') : '<div class="empty-state">没有找到匹配的文档，试试其他关键词或清除筛选。</div>';
      treeEl.querySelectorAll('[data-section-nav]').forEach(b => b.classList.toggle('active',b.dataset.sectionNav === docsState.section && !docsState.group));
      treeEl.querySelectorAll('[data-group-nav]').forEach(b => b.classList.toggle('active',b.dataset.groupNav === docsState.section + '|' + docsState.group));
      rememberListHash('docs',docsState);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    treeEl.addEventListener('toggle',e => { const d = e.target; if (!d.matches('details[data-tree-section]')) return; if (d.open) docsState.open.add(d.dataset.treeSection); else docsState.open.delete(d.dataset.treeSection); },true);
    treeEl.addEventListener('click',e => {
      const s = e.target.closest('[data-section-nav]'), g = e.target.closest('[data-group-nav]');
      if (s) { docsState.section = s.dataset.sectionNav; docsState.group = ''; }
      else if (g) { const [sectionId,...parts] = g.dataset.groupNav.split('|'); docsState.section = sectionId; docsState.group = parts.join('|'); }
      else return;
      docsState.page = 1; schedule();
    });
    document.querySelector('.docs-results').addEventListener('click',e => { const b = e.target.closest('[data-list-page]'); if (b && !b.disabled) { docsState.page = Math.max(1,Number(b.dataset.listPage)); update(); summary.scrollIntoView({block:'start'}); } });
    query.addEventListener('input',() => { docsState.query = query.value; docsState.page = 1; schedule(); });
    state.addEventListener('change',() => { if (docsState.state !== state.value) docsState.page = 1; docsState.state = state.value; schedule(); });
    document.getElementById('docs-reset').addEventListener('click',() => { query.value = ''; state.value = 'all'; Object.assign(docsState,{query:'',state:'all',section:'',group:'',page:1}); schedule(); query.focus(); });
    update(); document.title = '文档 · Learn 中文学习库 V6';
  }

  // Show one classification directory at a time; selected filters remain shared
  // across the three directories and are listed beside the result controls.
  const glossaryFacets = [
    {key:'module',title:'功能模块',label:'模块',description:'按照词汇所属的功能模块浏览。'},
    {key:'usage',title:'主要用途',label:'用途',description:'按照词汇常见的使用场景浏览。'},
    {key:'product',title:'适用产品',label:'产品',description:'按照词汇适用的产品浏览；一个词汇可属于多个产品。'}
  ];
  function glossaryTermFacetValues(t,key) {
    const raw = t[key] || '未分类';
    // The source uses 顿号 to list several applicable products. Reuse those
    // existing labels separately, while retaining the original metadata value.
    return key === 'product' ? [...new Set(raw.split('、').map(v => v.trim()).filter(Boolean))] : [raw];
  }
  const glossaryFacetValues = Object.fromEntries(glossaryFacets.map(f => [f.key,
    [...new Set(D.glossary.flatMap(t => glossaryTermFacetValues(t,f.key)))].sort((a,b) => a === '未分类' ? 1 : b === '未分类' ? -1 : a.localeCompare(b,'zh-CN'))
  ]));
  function glossaryListHref() {
    const p = new URLSearchParams();
    if (glossaryState.query) p.set('q',glossaryState.query);
    if (glossaryState.sort !== 'en') p.set('sort',glossaryState.sort);
    glossaryFacets.forEach(f => { if (glossaryState[f.key]) p.set(f.key,glossaryState[f.key]); });
    if (glossaryState.axis !== 'module') p.set('axis',glossaryState.axis);
    return '#/glossary' + (p.size ? '?' + p.toString() : '');
  }
  function glossaryTermHref(t) {
    const query = glossaryListHref().split('?')[1] || '';
    return termHref(t) + (query ? '?return=' + encodeURIComponent(query) : '');
  }
  function glossaryReturnHref(params) {
    if (!params || !params.has('return')) return glossaryListHref();
    const source = new URLSearchParams(params.get('return') || ''), safe = new URLSearchParams();
    if (source.get('q')) safe.set('q',source.get('q'));
    if (source.get('sort') === 'zh') safe.set('sort','zh');
    glossaryFacets.forEach(f => { const value = source.get(f.key); if (glossaryFacetValues[f.key].includes(value)) safe.set(f.key,value); });
    if (glossaryFacets.some(f => f.key === source.get('axis')) && source.get('axis') !== 'module') safe.set('axis',source.get('axis'));
    return '#/glossary' + (safe.size ? '?' + safe.toString() : '');
  }
  function glossaryMatches(t,q,skipFacet) {
    return (!q || (glossarySearchText.get(t.id) || '').includes(q)) && glossaryFacets.every(f =>
      f.key === skipFacet || !glossaryState[f.key] || glossaryTermFacetValues(t,f.key).includes(glossaryState[f.key]));
  }
  function glossary(params) {
    if (params) {
      glossaryState.query = params.get('q') || '';
      glossaryState.sort = params.get('sort') === 'zh' ? 'zh' : 'en';
      glossaryFacets.forEach(f => {
        const value = params.get(f.key) || '';
        glossaryState[f.key] = glossaryFacetValues[f.key].includes(value) ? value : '';
      });
      const selected = glossaryFacets.filter(f => glossaryState[f.key]);
      glossaryState.axis = glossaryFacets.some(f => f.key === params.get('axis')) ? params.get('axis') : selected.length === 1 ? selected[0].key : 'module';
    }
    // Legacy page= links deliberately display the same continuous list; no items are omitted.
    main.innerHTML = '<div class="page glossary-page"><div class="glossary-shell"><aside class="glossary-sidebar" aria-label="词汇分类"><h2 class="glossary-sidebar-title">词汇分类</h2><p class="glossary-sidebar-hint">先选一种分类方式，再点击目录中的分类。</p><div class="glossary-axis-switch" aria-label="词汇分类方式">' + glossaryFacets.map(f => '<button class="category-axis' + (glossaryState.axis === f.key ? ' active' : '') + '" type="button" data-axis="' + f.key + '" aria-pressed="' + (glossaryState.axis === f.key) + '">' + f.label + '</button>').join('') + '</div><div id="glossary-taxonomy" class="glossary-taxonomy"></div></aside><section class="glossary-content" aria-label="词汇列表"><div class="page-heading"><div><div class="eyebrow">中英词汇对照</div><h1>词汇表</h1><p class="page-description">按模块、用途或产品查找词汇，也可以搜索中文解释与英文术语。</p></div><span class="page-description">完整收录 ' + D.glossary.length + ' 个词条</span></div><div class="filter-bar"><input id="glossary-query" class="input" type="search" placeholder="搜索中文解释或英文术语…" aria-label="搜索词汇"><select id="glossary-sort" class="input" aria-label="词汇排序"><option value="en">按英文 A–Z</option><option value="zh">按中文排序</option></select><button id="glossary-reset" class="button secondary" type="button">清除筛选</button></div><div id="glossary-active-filters" class="glossary-active-filters"></div><p id="glossary-result-count" class="result-count" role="status" aria-live="polite" aria-atomic="true"></p><div id="glossary-list"></div></section></div></div>';
    const query = document.getElementById('glossary-query'), sort = document.getElementById('glossary-sort');
    const taxonomy = document.getElementById('glossary-taxonomy'), listEl = document.getElementById('glossary-list');
    const resultCount = document.getElementById('glossary-result-count'), activeFilters = document.getElementById('glossary-active-filters');
    const axisSwitch = document.querySelector('.glossary-axis-switch');
    query.value = glossaryState.query; sort.value = glossaryState.sort;
    let frame = 0;
    const remember = () => { history.replaceState(null,'',glossaryListHref()); };
    const renderTaxonomy = (changedAxis) => {
      // Facet counts include the search and all other selected facets. The current
      // facet is excluded, so each number states the result of selecting that option.
      const q = glossaryState.query.trim().toLocaleLowerCase();
      const f = glossaryFacets.find(item => item.key === glossaryState.axis) || glossaryFacets[0];
      const focused = taxonomy.contains(document.activeElement) ? document.activeElement : null;
      const focusKey = focused && focused.dataset.facet, focusValue = focused && focused.dataset.value;
      const previousScroll = taxonomy.scrollTop;
      const hasCategories = glossaryFacets.some(item => glossaryState[item.key]);
      const counts = new Map(glossaryFacetValues[f.key].map(v => [v,0]));
      const candidates = D.glossary.filter(t => glossaryMatches(t,q,f.key));
      candidates.forEach(t => { glossaryTermFacetValues(t,f.key).forEach(v => counts.set(v,(counts.get(v) || 0)+1)); });
      taxonomy.innerHTML = '<button class="category-filter glossary-all' + (!hasCategories ? ' active' : '') + '" type="button" data-all-glossary aria-pressed="' + (!hasCategories) + '"><span>全部词汇</span><b>' + D.glossary.filter(t => !q || (glossarySearchText.get(t.id) || '').includes(q)).length + '</b></button><h3 class="facet-heading">' + f.title + '</h3><p class="facet-description">' + f.description + '</p><div class="glossary-category-options"><button class="category-filter' + (!glossaryState[f.key] ? ' active' : '') + '" type="button" data-facet="' + f.key + '" data-value="" aria-pressed="' + (!glossaryState[f.key]) + '"><span>全部' + f.title + '</span><b>' + candidates.length + '</b></button>' + glossaryFacetValues[f.key].map(v => '<button class="category-filter' + (glossaryState[f.key] === v ? ' active' : '') + '" type="button" data-facet="' + f.key + '" data-value="' + esc(v) + '" aria-pressed="' + (glossaryState[f.key] === v) + '"><span>' + esc(v) + '</span><b>' + counts.get(v) + '</b></button>').join('') + '</div>';
      axisSwitch.querySelectorAll('[data-axis]').forEach(b => { const active = b.dataset.axis === f.key; b.classList.toggle('active',active); b.setAttribute('aria-pressed',String(active)); });
      taxonomy.scrollTop = changedAxis ? 0 : previousScroll;
      if (focusKey != null) {
        const target = [...taxonomy.querySelectorAll('[data-facet]')].find(b => b.dataset.facet === focusKey && b.dataset.value === focusValue);
        if (target) target.focus({preventScroll:true});
      } else if (focused && focused.hasAttribute('data-all-glossary')) {
        taxonomy.querySelector('[data-all-glossary]').focus({preventScroll:true});
      }
    };
    const renderActiveFilters = () => {
      const focused = activeFilters.contains(document.activeElement) ? document.activeElement : null;
      const focusKey = focused && (focused.dataset.clearFacet || (focused.hasAttribute('data-clear-query') ? 'query' : ''));
      const chips = glossaryFacets.filter(f => glossaryState[f.key]).map(f => '<button class="filter-chip" type="button" data-clear-facet="' + f.key + '" aria-label="清除' + f.title + '：' + esc(glossaryState[f.key]) + '">' + f.title + '：' + esc(glossaryState[f.key]) + ' <span aria-hidden="true">×</span></button>');
      if (glossaryState.query.trim()) chips.unshift('<button class="filter-chip" type="button" data-clear-query aria-label="清除关键词：' + esc(glossaryState.query.trim()) + '">关键词：' + esc(glossaryState.query.trim()) + ' <span aria-hidden="true">×</span></button>');
      activeFilters.innerHTML = chips.length ? '<p class="active-filter-hint">以下条件共同筛选结果，点击任一条件可单独清除。</p><div class="active-filter-chips" aria-label="已选筛选条件">' + chips.join('') + '</div>' : '';
      activeFilters.hidden = !chips.length;
      if (focusKey) {
        const target = [...activeFilters.querySelectorAll('.filter-chip')].find(b => (b.dataset.clearFacet || (b.hasAttribute('data-clear-query') ? 'query' : '')) === focusKey) || activeFilters.querySelector('.filter-chip');
        if (target) target.focus({preventScroll:true}); else query.focus({preventScroll:true});
      }
    };
    const update = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0; if (!query.isConnected) return;
      const q = glossaryState.query.trim().toLocaleLowerCase();
      const list = D.glossary.filter(t => glossaryMatches(t,q)).sort((a,b) =>
        (glossaryState.sort === 'zh' ? a.title.localeCompare(b.title,'zh-CN') : (a.en || a.title).localeCompare(b.en || b.title,'en')) || a.id.localeCompare(b.id));
      resultCount.textContent = '共 ' + list.length + ' / ' + D.glossary.length + ' 个词条 · 连续显示，无需翻页（按列从上到下阅读）';
      listEl.innerHTML = list.length ? '<div class="glossary-grid">' + list.map(t =>
        '<a class="term-card" data-term-id="' + esc(t.id) + '" href="' + glossaryTermHref(t) + '"><div class="term-category">' + esc(t.module || '未分类') + '</div><div class="term-en">' + esc(t.en) + '</div><h2>' + esc(t.title) + '</h2><p>' + esc(t.summary || '暂无简明解释，请打开词条查看原有内容。') + '</p></a>'
      ).join('') + '</div>' : '<div class="empty-state"><h2>没有找到匹配的词汇</h2><p>可以缩短关键词、选择其他分类，或清除筛选查看全部词汇。</p><button class="button secondary" type="button" data-reset-glossary>清除筛选</button></div>';
      renderActiveFilters(); renderTaxonomy(false); remember();
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const reset = () => {
      Object.assign(glossaryState,{query:'',sort:'en',module:'',usage:'',product:''});
      query.value = ''; sort.value = 'en'; update(); query.focus({preventScroll:true});
    };
    axisSwitch.addEventListener('click',e => {
      const button = e.target.closest('[data-axis]');
      if (!button || !glossaryFacets.some(f => f.key === button.dataset.axis) || glossaryState.axis === button.dataset.axis) return;
      glossaryState.axis = button.dataset.axis;
      renderTaxonomy(true); remember();
      // Switching the directory does not change the result set or detach cards.
      // Refresh only the return links so detail-page refresh preserves the directory.
      listEl.querySelectorAll('[data-term-id]').forEach(a => { const t = terms.get(a.dataset.termId); if (t) a.href = glossaryTermHref(t); });
    });
    taxonomy.addEventListener('click',e => {
      const all = e.target.closest('[data-all-glossary]'), button = e.target.closest('[data-facet]');
      if (all) { glossaryFacets.forEach(f => { glossaryState[f.key] = ''; }); }
      else if (button && glossaryFacets.some(f => f.key === button.dataset.facet) && (!button.dataset.value || glossaryFacetValues[button.dataset.facet].includes(button.dataset.value))) { glossaryState[button.dataset.facet] = button.dataset.value; }
      else return;
      update();
    });
    activeFilters.addEventListener('click',e => {
      const queryChip = e.target.closest('[data-clear-query]'), facetChip = e.target.closest('[data-clear-facet]');
      if (queryChip) { glossaryState.query = ''; query.value = ''; }
      else if (facetChip && glossaryFacets.some(f => f.key === facetChip.dataset.clearFacet)) glossaryState[facetChip.dataset.clearFacet] = '';
      else return;
      update();
    });
    query.addEventListener('input',() => { glossaryState.query = query.value; schedule(); });
    sort.addEventListener('change',() => { glossaryState.sort = sort.value === 'zh' ? 'zh' : 'en'; schedule(); });
    document.getElementById('glossary-reset').addEventListener('click',reset);
    listEl.addEventListener('click',e => { if (e.target.closest('[data-reset-glossary]')) reset(); });
    update();
    document.title = '词汇表 · Learn 中文学习库 V6';
  }

  function exportProgress() {
    const data = {schema, exportedAt:new Date().toISOString(), version:'V6', read:reading};
    const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json;charset=utf-8'}), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'Learn-阅读记录-' + new Date().toISOString().slice(0,10) + '.json'; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('阅读记录已导出，请保留下载的文件');
  }
  function parseReadingImport(data) {
    if (!data || Array.isArray(data) || !((data.schema === 'learn-reading-v1' && data.version === 'V1') || (data.schema === schema && ['V2','V3','V4','V5','V6'].includes(data.version)))) throw new Error('请选择从 Learn V1、V2、V3、V4、V5 或 V6 导出的阅读记录文件');
    return validRecords(data.read,false);
  }
  function importProgress() {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json';
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0]; if (!file) return;
      try {
        if (file.size > 1024 * 1024) throw new Error('记录文件过大，请选择从本学习库导出的 JSON 文件');
        const data = JSON.parse(await file.text());
        const imported = parseReadingImport(data);
        for (const [id,date] of Object.entries(imported)) if (!reading[id] || reading[id] < date) reading[id] = date;
        saveReading(); progress(); toast('已合并 ' + Object.keys(imported).length + ' 篇已读记录');
      } catch (e) { toast('导入失败：' + e.message); }
    });
    input.click();
  }
  function progress() {
    const readCount = Object.keys(reading).length, percent = available.length ? Math.round(readCount / available.length * 100) : 0;
    const list = available.filter(a => reading[a.id]).sort((a,b) => reading[b.id].localeCompare(reading[a.id]));
    main.innerHTML = '<div class="page"><div class="page-heading"><div><div class="eyebrow">按自己的节奏</div><h1>阅读记录</h1><p class="page-description">每读懂一点，都是进步。</p></div><a class="button secondary" href="#/docs">查看全部文档 →</a></div><div class="reading-summary"><div class="reading-total"><strong>' + readCount + '</strong><span>/ ' + available.length + ' 篇已读</span><div class="progress-track"><div class="progress-fill" style="width:' + percent + '%"></div></div><span>' + percent + '% 已完成</span></div><div class="reading-note">记录保存在当前浏览器中，不会自动跨浏览器或跨电脑同步。清理浏览器数据、移动学习库路径，都可能影响记录。建议定期导出备份。</div></div><div class="progress-actions"><div class="button-row"><button id="export-progress" class="button secondary">导出记录</button><button id="import-progress" class="button secondary">导入记录</button><button id="clear-progress" class="button secondary danger">清空记录</button></div><p>导入会合并已读记录，不会覆盖已有进度。</p></div><h2 class="section-heading">已读文档<span>最近标记的在前</span></h2>' + (list.length ? '<div class="document-list">' + list.map(row).join('') + '</div>' : '<div class="empty-state">还没有已读记录。打开一篇文档，点击“标为已读”即可。<br><a class="text-link" href="#/docs">去文档目录 →</a></div>') + '</div>';
    document.getElementById('export-progress').addEventListener('click', exportProgress);
    document.getElementById('import-progress').addEventListener('click', importProgress);
    document.getElementById('clear-progress').addEventListener('click', () => { if (confirm('确定清空当前浏览器中的全部已读记录？建议先导出备份。此操作无法撤销。')) { reading = Object.create(null); saveReading(); progress(); toast('已清空当前浏览器中的阅读记录'); } });
    document.title = '阅读记录 · Learn 中文学习库';
  }
  function help() {
    main.innerHTML = '<div class="page help-body"><div class="eyebrow">从这里开始</div><h1>随时打开，继续学习。</h1><p class="page-description">Learn 中文学习库 · V6 使用说明</p><h2>如何开始</h2><p>双击根目录中的“开始学习.cmd”，浏览器会打开首页。也可以直接打开“学习资料”文件夹里的 index.html。请完整解压后使用，保留文件夹内的结构。</p><h2>阅读、搜索与查词</h2><ul><li>在“文档”中按分类浏览，或搜索标题和正文；顶部搜索同时查找文档与词汇，快捷键为 Ctrl K（Mac 为 ⌘ K）。</li><li>文档页可以切换中文译文和已保存的英文原文。产品名、代码、命令、参数及网址保留原文，便于准确使用。</li><li>长篇手册按章节显示，可使用章节选择器、上一节/下一节或本页目录阅读全部内容；原有章节链接会自动定位。浏览器的页内查找只查当前章节，顶部搜索会检索全部文档。</li><li>提示词与模板中的英文原始示例完整保留，旁边提供中文参考。点击“复制中文”可以复制参考文本；命令、文件名和占位符保留原样。浏览器不允许直接写入剪贴板时，会选中文本供你手动复制。</li><li>点击“标为已读”保存进度。在“阅读记录”中可导出、导入 JSON 备份，导入会合并已读记录。</li><li>词条页可尝试朗读英文术语。声音由当前浏览器和系统提供，是否能离线发音取决于本机已安装的语音。</li><li>右上角可切换深浅模式；全站采用黑白灰，文档目录与词汇表沿用文章页的宽度、细分割线与留白，浅色模式使用柔和灰底。桌面文章右侧同时提供章节目录与本篇词汇，随页面滚动保持可见，两块均可独立滚动；较窄窗口会将它们放在正文后。词汇表左侧可切换模块、用途或产品目录，当前筛选条件可单独清除，全部结果连续展示，无需翻页；可叠加搜索和排序。</li></ul><h2>离线可读的范围</h2><p>已保存的中文正文、英文原文、词汇解释、搜索和阅读标记均可离线使用。外部网站、视频、在线演示及部分原站媒体需要联网；页面中的原始链接会保留。来源未取得的项目会明确提示，不会以虚构内容补齐。</p><h2>请保留阅读记录备份</h2><p>阅读记录只属于当前浏览器，本学习库不会向服务器上传记录。同一电脑换浏览器、浏览器隐私模式、清理网站数据、移动本地文件路径或改变本地网站地址，都可能导致看不到原记录。请先导出，再到新位置导入。浏览器不允许持久化时，页面顶部会显示提示。</p><h2>关于内容与译文</h2><p>本库是从原中文学习库提取的 Learn 独立版 V6，资料快照日期为 ' + esc(D.meta.snapshot || '2026-10-21') + '。包含 ' + available.length + ' 篇已保存正文和 ' + D.glossary.length + ' 个已发布词条；' + D.articles.filter(a => a.status === 'unavailable').length + ' 个来源未取得的项目单独保留提示。词汇表保留原学习库完整的已发布词条，部分术语可能涉及开发话题。</p><p>这是非官方中文译本，译文由 AI 辅助制作，尚未逐篇完成独立人工审校。内容可能存在译文偏差，且产品功能、价格、政策等可能随时间变化。涉及实际操作时请结合每篇文档的官方来源确认。</p><h2>版权与来源</h2><p>原始文档及相关产品名称归其权利人所有。本项目不代表 OpenAI，也不声称获得官方认可或完整镜像的公开转载授权。翻译与离线整理不改变原始内容的权利归属。公开再分发前需确认相应授权范围；详细来源与说明见同目录中的项目说明文件。</p><p><a href="https://learn.chatgpt.com/" target="_blank" rel="noopener noreferrer">访问官方 Learn ↗</a>　<a href="https://openai.com/policies/terms-of-use/" target="_blank" rel="noopener noreferrer">OpenAI 使用条款 ↗</a></p></div>';
    document.title = '使用帮助 · Learn 中文学习库';
  }
  function sidebar(active) {
    const groups = new Map(); D.articles.forEach(a => { const key = a.section || 'other'; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(a); });
    return '<aside class="sidebar" aria-label="文档目录"><div class="sidebar-heading">LEARN / 文档目录</div><a href="#/docs">← 全部文档与筛选</a>' + [...groups].map(([key,items]) => '<details' + (items.some(a => a.id === active.id) ? ' open' : '') + '><summary>' + esc(sectionTitle(key)) + '</summary>' + items.map(a => '<a href="' + articleHref(a) + '"' + (a.id === active.id ? ' class="active" aria-current="page"' : '') + '>' + esc(a.title) + (a.status === 'unavailable' ? ' · 未取得' : '') + '</a>').join('') + '</details>').join('') + '</aside>';
  }
  function loadContent(id, kind) {
    const key = kind + ':' + id;
    if (contentCache.has(key)) {
      const entry = contentCache.get(key);
      contentCache.delete(key); contentCache.set(key, entry);
      return Promise.resolve(entry.value);
    }
    if (contentPending.has(key)) return contentPending.get(key);
    window.LEARN_CONTENT = window.LEARN_CONTENT || Object.create(null);
    const pending = new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = kind + '/' + encodeURIComponent(id) + '.js?v=' + encodeURIComponent(D.meta.build || D.meta.version || 'V2'); script.charset = 'utf-8';
      script.onload = () => {
        script.remove();
        const value = Object.prototype.hasOwnProperty.call(window.LEARN_CONTENT,id) ? window.LEARN_CONTENT[id] : null;
        delete window.LEARN_CONTENT[id];
        if (!value || typeof value !== 'object') { reject(new Error('正文资料不完整')); return; }
        // A conservative UTF-16 payload budget; DOM and the active chapter are separate.
        const bytes = Object.values(value).reduce((n,v) => n + (typeof v === 'string' ? v.length * 2 : 0),0);
        if (bytes <= CONTENT_CACHE_BYTE_LIMIT) {
          contentCache.set(key,{value,bytes}); contentCacheBytes += bytes;
          while (contentCache.size > CONTENT_CACHE_LIMIT || contentCacheBytes > CONTENT_CACHE_BYTE_LIMIT) {
            const oldest = contentCache.keys().next().value;
            contentCacheBytes -= contentCache.get(oldest).bytes; contentCache.delete(oldest);
          }
        }
        resolve(value);
      };
      script.onerror = () => { script.remove(); reject(new Error('无法加载正文文件，请确认学习资料已完整解压')); };
      document.head.append(script);
    }).finally(() => contentPending.delete(key));
    contentPending.set(key, pending);
    return pending;
  }
  function sourceMeta(a, params) {
    const url = safeURL(a.url);
    const missingSection = (params || new URLSearchParams(location.hash.split('?')[1] || '')).has('sectionMissing');
    const state = a.translationStatus === 'reviewed' ? '原库已复核' : a.translationStatus === 'draft' ? '初译，待进一步审校' : '';
    return '<div class="source-meta">非官方译本 · 快照 ' + esc(D.meta.snapshot || '2026-10-21') + (state ? ' · ' + esc(state) : '') + (url ? ' · <a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">查看官方来源 ↗</a>' : '') + '</div>' + (missingSection ? '<p class="notice">旧链接中的章节未能在此快照定位，已打开文章首页。你可以使用本页目录，或查看官方来源。</p>' : '');
  }
  function htmlText(value) {
    const text = String(value).replace(/<[^>]*>/g,'').trim();
    return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,e) => {
      if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2),16) : parseInt(e.slice(1),10); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''; }
      return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[e.toLowerCase()] || _;
    });
  }
  function normalizeAnchors(html) {
    // Keep the saved source untouched. Give rendered headings priority over
    // repeated empty aliases so chapter links reach the actual heading.
    const tags = [], groups = new Map(), reserved = new Set();
    const tagPattern = /<!--[\s\S]*?-->|<([a-z][\w:-]*)\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi;
    let match, headingIndex = 0;
    while ((match = tagPattern.exec(html))) {
      if (!match[1]) continue;
      const tag = {start:match.index,raw:match[0],name:match[1].toLowerCase()};
      const attribute = /\s+id\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag.raw);
      if (attribute) {
        tag.attribute = attribute; tag.id = htmlText(attribute[1] || attribute[2] || attribute[3] || '');
        if (tag.id) { reserved.add(tag.id); if (!groups.has(tag.id)) groups.set(tag.id,[]); groups.get(tag.id).push(tag); }
      }
      if (/^h[23]$/.test(tag.name)) tag.ordinal = headingIndex++;
      tags.push(tag);
    }
    const unique = base => { let id = base, n = 2; while (reserved.has(id)) id = base + '--learn-' + n++; reserved.add(id); return id; };
    for (const [id,group] of groups) {
      const owner = group.find(t => /^h[1-6]$/.test(t.name)) || group[0];
      for (const tag of group) if (tag !== owner) tag.nextId = unique(id);
    }
    for (const tag of tags) if (tag.ordinal !== undefined && !tag.id) tag.nextId = unique('heading-' + tag.ordinal);
    let result = '', offset = 0;
    for (const tag of tags) {
      if (!tag.nextId) continue;
      let replacement;
      if (tag.attribute) {
        const attribute = tag.attribute;
        replacement = tag.raw.slice(0,attribute.index) + ' id="' + esc(tag.nextId) + '"' + tag.raw.slice(attribute.index+attribute[0].length);
      } else replacement = tag.raw.replace(/\s*\/?>$/,end => ' id="' + esc(tag.nextId) + '"' + end);
      result += html.slice(offset,tag.start) + replacement; offset = tag.start+tag.raw.length;
    }
    return offset ? result + html.slice(offset) : html;
  }
  function chapterPlan(html) {
    if (html.length < 180000) return null;
    // Split only at top-level block boundaries; never cut a table, list, or code block.
    const tags = /<!--[\s\S]*?-->|<\/?([a-z][\w:-]*)\b[^>]*>/gi, stack = [], cuts = [0];
    const voidTags = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
    const blocks = new Set('h1 h2 h3 h4 p pre ul ol table blockquote div section details hr'.split(' '));
    let match, sawHeading = false;
    while ((match = tags.exec(html))) {
      if (!match[1]) continue;
      const name = match[1].toLowerCase(), closing = /^<\//.test(match[0]);
      if (closing) { const at = stack.lastIndexOf(name); if (at >= 0) stack.length = at; continue; }
      if (stack.length === 0) {
        const heading = name === 'h2' || name === 'h3';
        if ((heading && (sawHeading || match.index >= 4000)) || (blocks.has(name) && match.index-cuts[cuts.length-1] >= 64000)) cuts.push(match.index);
        if (heading) sawHeading = true;
      }
      if (!voidTags.has(name) && !/\/\s*>$/.test(match[0])) stack.push(name);
    }
    cuts.push(html.length);
    const points = [...new Set(cuts)], chapters = [], anchors = new Map();
    for (let i=0;i<points.length-1;i++) {
      const chunk = html.slice(points[i],points[i+1]); if (!chunk.trim()) continue;
      const heading = /<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/i.exec(chunk);
      const chapter = {html:chunk,start:points[i],end:points[i+1],title:heading ? htmlText(heading[1]).replace(/¶|/g,'').slice(0,130) : (chapters.length ? '继续阅读' : '开篇说明')};
      const index = chapters.length;
      const ids = /<[a-z][\w:-]*\b[^>]*?\s+id\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
      let id; while ((id = ids.exec(chunk))) { const key = htmlText(id[1] || id[2] || id[3] || ''); if (key && !anchors.has(key)) anchors.set(key,index); }
      chapters.push(chapter);
    }
    const headings = [...html.matchAll(/<(h[1-6])\b([^>]*)>[\s\S]*?<\/\1>/gi)].map(m => {
      const id = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[2]);
      return {tag:m[1].toLowerCase(),id:id ? htmlText(id[1] || id[2] || '') : '',offset:m.index};
    });
    return chapters.length > 1 ? {chapters,anchors,headings} : null;
  }
  function renderArticleBody(body,html,a,params,preparedPlan) {
    const plan = preparedPlan === undefined ? chapterPlan(html) : preparedPlan, view = {id:a.id,language,body,plan,current:-1};
    const toolbar = n => '<div class="chapter-toolbar"><button class="button secondary" type="button" data-chapter="' + (n-1) + '"' + (n === 0 ? ' disabled' : '') + '>上一节</button><label><span>章节</span><select class="input" data-chapter-select aria-label="选择手册章节">' + plan.chapters.map((c,i) => '<option value="' + i + '"' + (i === n ? ' selected' : '') + '>' + (i+1) + '. ' + esc(c.title) + '</option>').join('') + '</select></label><button class="button secondary" type="button" data-chapter="' + (n+1) + '"' + (n === plan.chapters.length-1 ? ' disabled' : '') + '>下一节</button></div>';
    view.navigate = next => {
      const meta = document.getElementById('article-source'); if (meta) meta.innerHTML = sourceMeta(a,next);
      const anchor = next.get('anchor');
      let index = Math.max(0,parseInt(next.get('chapter'),10) || 0);
      if (plan) { if (anchor && plan.anchors.has(anchor)) index = plan.anchors.get(anchor); index = Math.min(index,plan.chapters.length-1); }
      else index = 0;
      if (view.current !== index) {
        body.innerHTML = plan ? '<p class="chapter-note">这篇长文按章节显示。全部 ' + plan.chapters.length + ' 节均可通过目录或章节选择器阅读；原有章节链接会自动定位。</p>' + toolbar(index) + '<section class="chapter-text">' + plan.chapters[index].html + '</section><nav class="chapter-bottom" aria-label="手册章节翻页"><button class="button secondary" type="button" data-chapter="' + (index-1) + '"' + (index === 0 ? ' disabled' : '') + '>← 上一节</button><span>' + (index+1) + ' / ' + plan.chapters.length + '</span><button class="button secondary" type="button" data-chapter="' + (index+1) + '"' + (index === plan.chapters.length-1 ? ' disabled' : '') + '>下一节 →</button></nav>' : html;
        const firstHeading = body.querySelector('h1'); if (firstHeading && index === 0) { if (firstHeading.id) { const mark = document.createElement('span'); mark.id = firstHeading.id; firstHeading.before(mark); } firstHeading.remove(); }
        enhanceBody(body,a,!!plan); view.current = index;
      }
      if (plan) {
        const toc = document.getElementById('article-toc');
        toc.innerHTML = '<strong>全部章节 · ' + plan.chapters.length + ' 节</strong>' + plan.chapters.map((c,i) => '<a' + (i === index ? ' class="active" aria-current="location"' : '') + ' href="' + articleHref(a) + '?chapter=' + i + '">' + (i+1) + '. ' + esc(c.title) + '</a>').join('');
      }
      syncArticleRail();
      requestAnimationFrame(() => {
        if (activeArticle !== view || !body.isConnected) return;
        const target = anchor ? document.getElementById(anchor) : null;
        if (target && body.contains(target)) target.scrollIntoView({block:'start'});
        else if (next.has('chapter')) body.scrollIntoView({block:'start'});
        else if (anchor) toast('此快照未能定位该章节，请使用章节目录查找');
      });
    };
    activeArticle = view; view.navigate(params);
  }
  function alignLanguageAnchor(previousView,html,params) {
    const oldAnchor = params.get('anchor');
    params.delete('anchor'); params.delete('chapter');
    const oldHeadings = [...previousView.body.querySelectorAll('h2,h3')];
    const template = document.createElement('template'); template.innerHTML = html;
    const newHeadings = [...template.content.querySelectorAll('h2,h3')];
    const index = oldHeadings.findIndex(h => h.id === oldAnchor || [...h.querySelectorAll('[id]')].some(child => child.id === oldAnchor));
    if (index >= 0 && oldHeadings.length === newHeadings.length && oldHeadings.every((h,i) => h.tagName === newHeadings[i].tagName)) {
      params.set('anchor',newHeadings[index].id || 'heading-' + index);
    } else toast('两种语言的章节结构无法对应，已回到开篇说明');
  }
  function syncArticleRail() {
    const toc = document.getElementById('article-toc');
    const rail = toc && toc.closest('.article-rail');
    if (rail) rail.classList.toggle('single-panel',!toc.textContent.trim());
  }
  function articleTerms(a) {
    const hits = (a.terms || []).map(id => terms.get(id)).filter(Boolean);
    const reviewed = a.termMappingStatus === 'reviewed';
    return '<section id="related-terms" class="related-terms" aria-label="本篇词汇"><div class="article-terms"><h2>本篇词汇 <span>' + hits.length + '</span></h2><p class="related-terms-note">' + (reviewed ? '已整理的关联词汇，点击查看释义。' : '根据正文自动匹配，点击查看释义。') + '</p>' + (hits.length ? '<nav class="related-term-list" aria-label="本篇词汇链接">' + hits.map(t => '<a class="related-term" href="' + termHref(t) + '"><strong>' + esc(t.title) + '</strong><span>' + esc(t.en || '') + '</span></a>').join('') : '<p class="related-terms-note">这篇文档暂未关联词汇。</p>') + '<a class="related-all" href="#/glossary">查看完整词汇表 →</a></div></section>';
  }
  async function article(id, params, token) {
    const a = articles.get(id); if (!a) { notFound(); return; }
    const read = !!reading[id];
    main.innerHTML = '<div class="article-layout">' + sidebar(a) + '<div class="article-main"><div class="article-breadcrumb"><a href="#/docs">文档</a><span>/</span><span>' + esc(sectionTitle(a.section)) + '</span></div><header class="article-header"><h1>' + esc(a.title) + '</h1><div class="article-tools"><a class="button secondary mobile-directory" href="#/docs">全部目录</a>' + (a.status === 'unavailable' ? '' : '<div class="language-toggle" aria-label="正文语言"><button id="lang-zh" class="' + (language === 'zh' ? 'active' : '') + '" aria-pressed="' + (language === 'zh') + '">中文译文</button><button id="lang-en" class="' + (language === 'en' ? 'active' : '') + '" aria-pressed="' + (language === 'en') + '">英文原文</button></div><button class="button secondary read-button' + (read ? ' is-read' : '') + '" data-read-id="' + esc(id) + '" aria-pressed="' + read + '">' + (read ? '✓ 已读' : '标为已读') + '</button>') + '</div></header><div id="article-source">' + sourceMeta(a,params) + '</div><article id="article-body" class="article-body">' + (a.status === 'unavailable' ? '<div class="notice"><h2>这篇资料的来源尚未取得</h2><p>制作原学习库时，官方来源未能成功取得，因此没有可提供的完整译文。此项目保留在目录中，方便你确认范围并访问官方链接。它不计入已保存的中文正文数量。</p></div>' : '<p class="loading">正在打开正文…</p>') + '</article><div id="article-bottom"></div></div><aside class="article-rail" aria-label="阅读辅助"><nav id="article-toc" class="article-toc" aria-label="本页目录"></nav>' + articleTerms(a) + '</aside></div>';
    document.title = a.title + ' · Learn 中文学习库';
    syncArticleRail();
    if (a.status === 'unavailable') return;
    let languageRequest = 0;
    const setLanguage = async lang => {
      const request = ++languageRequest, previousView = activeArticle;
      language = lang;
      try {
        const data = await loadContent(id,'pages'); if (token !== renderToken || request !== languageRequest) return;
        const body = document.getElementById('article-body');
        const html = normalizeAnchors(data[lang] || (lang === 'en' ? '<p class="notice">此页没有单独保存的英文原文，请通过官方来源查看。</p>' : '<p class="notice">此页中文正文未能加载。</p>'));
        const nextParams = new URLSearchParams(location.hash.split('?')[1] || '');
        let preparedPlan;
        if (previousView && previousView.id === id && previousView.language !== lang && previousView.plan) {
          preparedPlan = chapterPlan(html);
          const oldPlan = previousView.plan, oldChapter = oldPlan.chapters[previousView.current];
          const aligned = preparedPlan && oldPlan.headings.length === preparedPlan.headings.length && oldPlan.headings.every((h,i) => h.tag === preparedPlan.headings[i].tag);
          nextParams.delete('anchor'); nextParams.delete('chapter');
          if (aligned && oldChapter) {
            let ordinal = oldPlan.headings.findIndex(h => h.offset >= oldChapter.start && h.offset < oldChapter.end);
            if (ordinal < 0) { for (let i=oldPlan.headings.length-1;i>=0;i--) if (oldPlan.headings[i].offset <= oldChapter.start) { ordinal=i; break; } }
            const target = preparedPlan.headings[Math.max(0,ordinal)];
            const index = target && target.id && preparedPlan.anchors.has(target.id) ? preparedPlan.anchors.get(target.id) : Math.max(0,preparedPlan.chapters.findIndex(c => target && c.start <= target.offset && c.end > target.offset));
            nextParams.set('chapter',String(index)); if (target && target.id) nextParams.set('anchor',target.id);
          } else toast('两种语言的章节结构不同，已回到开篇说明');
          history.replaceState(null,'',articleHref(a) + (nextParams.toString() ? '?' + nextParams.toString() : ''));
        }
        if (previousView && previousView.id === id && previousView.language !== lang && !previousView.plan && nextParams.has('anchor')) {
          alignLanguageAnchor(previousView,html,nextParams);
          history.replaceState(null,'',articleHref(a) + (nextParams.toString() ? '?' + nextParams.toString() : ''));
          if (!nextParams.has('anchor')) window.scrollTo(0,0);
        }
        renderArticleBody(body,html,a,nextParams,preparedPlan);
        body.lang = lang === 'zh' ? 'zh-CN' : 'en';
        document.getElementById('lang-zh').classList.toggle('active',lang === 'zh'); document.getElementById('lang-en').classList.toggle('active',lang === 'en');
        document.getElementById('lang-zh').setAttribute('aria-pressed',String(lang === 'zh')); document.getElementById('lang-en').setAttribute('aria-pressed',String(lang === 'en'));
        const index = available.findIndex(x => x.id === id), prev = available[index-1], next = available[index+1];
        document.getElementById('article-bottom').innerHTML = '<nav class="article-bottom" aria-label="相邻文章">' + (prev ? '<a href="' + articleHref(prev) + '"><small>← 上一篇</small>' + esc(prev.title) + '</a>' : '<span></span>') + (next ? '<a href="' + articleHref(next) + '"><small>下一篇 →</small>' + esc(next.title) + '</a>' : '<span></span>') + '</nav>';
      } catch (e) { if (token === renderToken && request === languageRequest) document.getElementById('article-body').innerHTML = '<div class="error-box">' + esc(e.message) + '</div>'; }
    };
    document.getElementById('lang-zh').addEventListener('click',() => setLanguage('zh'));
    document.getElementById('lang-en').addEventListener('click',() => setLanguage('en'));
    await setLanguage(language);
  }
  function enhanceBody(body,a,skipToc) {
    body.querySelectorAll('a').forEach(link => {
      const href = link.getAttribute('href') || '';
      if (/^https?:/i.test(href)) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
      if (href.startsWith('#') && !href.startsWith('#/')) {
        link.href = articleHref(a) + '?anchor=' + encodeURIComponent(href.slice(1));
      }
    });
    body.querySelectorAll('pre').forEach(pre => {
      const wrap = document.createElement('div'); wrap.className = 'code-wrap'; pre.before(wrap); wrap.append(pre);
      const button = document.createElement('button'); button.type = 'button'; button.className = 'copy-code'; button.textContent = '复制'; button.setAttribute('aria-label','复制代码');
      wrap.append(button);
    });
    const toc = document.getElementById('article-toc');
    if (toc && !skipToc) {
      let headings = [...body.querySelectorAll('h2,h3')].filter(h => h.textContent.trim());
      if (headings.length > 100 && headings.some(h => h.tagName === 'H2')) headings = headings.filter(h => h.tagName === 'H2');
      headings.forEach((h,i) => { if (!h.id) h.id = 'heading-' + i; });
      toc.innerHTML = headings.length ? '<strong>本页内容</strong>' + headings.slice(0,180).map(h => '<a class="' + (h.tagName === 'H3' ? 'toc-sub' : '') + '" href="' + articleHref(a) + '?anchor=' + encodeURIComponent(h.id) + '">' + esc(h.textContent.replace(/¶|/g,'').trim()) + '</a>').join('') : '';
    }
  }
  async function term(id,token,params) {
    const t = terms.get(id); if (!t) { notFound(); return; }
    main.innerHTML = '<div class="term-layout"><div class="article-breadcrumb"><a href="' + esc(glossaryReturnHref(params)) + '">词汇表</a><span>/</span><span>' + esc(t.en || t.title) + '</span></div><header class="article-header"><h1>' + esc(t.title) + '</h1><div class="term-en-title">' + esc(t.en) + '</div><div class="article-tools"><button id="pronounce-term" class="button secondary">▶ 朗读英文术语</button><a class="button secondary" href="' + esc(glossaryReturnHref(params)) + '">返回词汇表</a></div></header><div class="source-meta">非官方中文解释 · 词汇表同时保留原库的开发相关术语</div><article id="term-body" class="article-body"><p class="loading">正在打开词条…</p></article><section id="term-backlinks" class="article-terms"></section></div>';
    document.title = t.title + ' · Learn 词汇表';
    document.getElementById('pronounce-term').addEventListener('click',() => {
      if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) { toast('当前浏览器没有可用的语音功能'); return; }
      const voice = new SpeechSynthesisUtterance(t.en || t.title); voice.lang = t.locale || 'en-US'; voice.rate = .85;
      voice.onerror = () => toast('朗读不可用；请检查系统英文语音或联网后重试');
      speechSynthesis.cancel(); speechSynthesis.speak(voice); toast('发音由本机浏览器提供；部分语音需要联网');
    });
    try {
      const data = await loadContent(id,'glossary'); if (token !== renderToken) return;
      const body = document.getElementById('term-body'); body.innerHTML = normalizeAnchors(data.zh || data.html || '<p>暂无词条解释。</p>');
      const firstHeading = body.querySelector('h1'); if (firstHeading) { if (firstHeading.id) { const anchor = document.createElement('span'); anchor.id = firstHeading.id; firstHeading.before(anchor); } firstHeading.remove(); }
      body.querySelectorAll('a[href^="http"]').forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
      const backlinks = available.filter(a => (a.terms || []).includes(id));
      document.getElementById('term-backlinks').innerHTML = backlinks.length ? '<h2>相关 Learn 文档（含自动匹配）</h2><div class="document-list">' + backlinks.map(row).join('') + '</div>' : '<p class="page-description">当前 Learn 文档没有关联此词条；词条作为完整词汇表的一部分保留。</p>';
    } catch(e) { if (token === renderToken) document.getElementById('term-body').innerHTML = '<div class="error-box">' + esc(e.message) + '</div>'; }
  }
  function notFound() { main.innerHTML = '<div class="page"><h1>没有找到这篇资料</h1><p class="page-description">这个链接可能来自其他版本，试试在文档或词汇表中搜索。</p><p><a class="button secondary" href="#/docs">返回文档目录</a></p></div>'; document.title = '未找到资料 · Learn 中文学习库'; }
  function route() {
    const path = location.hash.replace(/^#\/?/,''), [base,query=''] = path.split('?');
    let parts; try { parts = base.split('/').map(decodeURIComponent); } catch (_) { notFound(); return; }
    const type = parts[0] || '', params = new URLSearchParams(query);
    if (type === 'article' && activeArticle && activeArticle.id === parts.slice(1).join('/') && activeArticle.body.isConnected && activeArticle.language === language) {
      activeArticle.navigate(params); if (!params.has('anchor') && !params.has('chapter')) window.scrollTo(0,0); return;
    }
    activeArticle = null;
    const token = ++renderToken;
    setNav(type); refreshCount();
    if (!query.includes('anchor=')) window.scrollTo(0,0);
    if (type === '') home(); else if (type === 'docs') docs(params); else if (type === 'glossary' && parts[1]) term(parts.slice(1).join('/'),token,params); else if (type === 'glossary') glossary(params); else if (type === 'progress') progress(); else if (type === 'help') help(); else if (type === 'article' && parts[1]) article(parts.slice(1).join('/'),params,token); else notFound();
  }
  main.addEventListener('click',async e => {
    const b = e.target.closest('[data-read-id]'); if (b) { e.preventDefault(); toggleRead(b.dataset.readId); return; }
    const chapter = e.target.closest('[data-chapter]');
    if (chapter && activeArticle && !chapter.disabled) { e.preventDefault(); location.hash = '#/article/' + encodeURIComponent(activeArticle.id) + '?chapter=' + chapter.dataset.chapter; return; }
    const copy = e.target.closest('.copy-code');
    if (copy) {
      const prompt = copy.classList.contains('copy-prompt-translation');
      const wrapper = prompt ? copy.closest('.prompt-translation') : copy.parentElement;
      const block = wrapper && wrapper.querySelector(prompt ? '.prompt-reference-text' : 'pre'); if (!block) return;
      const target = prompt ? block : (block.querySelector('code') || block), text = target.textContent;
      const label = copy.dataset.copyLabel || copy.textContent; copy.dataset.copyLabel = label;
      try { if (!navigator.clipboard || !window.isSecureContext) throw new Error(); await navigator.clipboard.writeText(text); copy.textContent = '已复制'; setTimeout(() => { if (copy.isConnected) copy.textContent = label; },1800); }
      catch (_) { const range = document.createRange(); range.selectNodeContents(target); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); toast((prompt ? '中文参考' : '代码') + '已选中，请按 Ctrl C（Mac 为 ⌘ C）复制'); }
      return;
    }
    const link = e.target.closest('a[href]');
    if (link && activeArticle && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.button === 0) {
      const href = link.getAttribute('href');
      if (href && href.startsWith('#/article/' + encodeURIComponent(activeArticle.id) + '?')) {
        e.preventDefault(); if (location.hash !== href) history.pushState(null,'',href); activeArticle.navigate(new URLSearchParams(href.split('?')[1]));
      }
    }
  });
  main.addEventListener('change',e => { if (e.target.matches('[data-chapter-select]') && activeArticle) location.hash = '#/article/' + encodeURIComponent(activeArticle.id) + '?chapter=' + e.target.value; });
  document.querySelector('.skip-link').addEventListener('click',e => { e.preventDefault(); main.focus(); main.scrollIntoView(); });
  window.addEventListener('hashchange',route);
  window.addEventListener('storage',e => { if (e.key === STORAGE_KEY) { try { reading = e.newValue ? validRecords(JSON.parse(e.newValue),true) : Object.create(null); refreshCount(); activeArticle = null; route(); } catch (_) { storageWarning('另一个窗口的阅读记录格式异常；当前记录没有被替换，请先导出备份。'); } } });
  function syncThemeControl() {
    const label = document.body.classList.contains('dark') ? '切换浅色模式' : '切换深色模式';
    const button = document.getElementById('theme-toggle');
    button.setAttribute('aria-label',label); button.setAttribute('title',label);
  }
  document.getElementById('theme-toggle').addEventListener('click', () => { const dark = document.body.classList.toggle('dark'); try { localStorage.setItem(THEME_KEY,dark ? 'dark' : 'light'); } catch (_) {} syncThemeControl(); });
  syncThemeControl();
  const dialog = document.getElementById('search-dialog'), searchInput = document.getElementById('search-input'), searchResults = document.getElementById('search-results');
  function indexedLower(text) {
    const lower = text.toLocaleLowerCase();
    if (lower.length === text.length) return {lower,map:null};
    const map = []; let offset = 0;
    for (const char of text) { for (let i=0;i<char.toLocaleLowerCase().length;i++) map.push(offset); offset += char.length; }
    map.push(text.length); return {lower,map};
  }
  const searchItems = D.articles.map(a => ({id:a.id,title:a.title,text:a.text || '',kind:'文档',group:sectionTitle(a.section),href:articleHref(a)})).concat(D.glossary.map(t => ({id:t.id,title:t.title + (t.en ? ' · ' + t.en : ''),text:t.text || '',kind:'词汇',group:'词汇表',href:termHref(t)}))).map(item => ({...item,titleLower:item.title.toLocaleLowerCase(),bodyIndex:indexedLower(item.text)}));
  function highlight(text,q) { const normalized = indexedLower(text), index = normalized.lower.indexOf(q); if (index < 0) return esc(text); const start = normalized.map ? normalized.map[index] : index, last = normalized.map ? normalized.map[index+q.length-1] : 0, end = normalized.map ? last + (text.codePointAt(last) > 0xffff ? 2 : 1) : index+q.length; return esc(text.slice(0,start)) + '<mark>' + esc(text.slice(start,end)) + '</mark>' + esc(text.slice(end)); }
  let searchPage = 1;
  function search(reset) {
    if (reset !== false) searchPage = 1;
    const q = searchInput.value.trim().toLocaleLowerCase();
    if (!q) { searchResults.innerHTML = '<div class="search-empty">从一个问题或一个术语开始。</div>'; return; }
    const results = searchItems.map(item => ({...item,index:item.bodyIndex.lower.indexOf(q),titleMatch:item.titleLower.includes(q)})).filter(item => item.titleMatch || item.index >= 0).sort((a,b) => Number(b.titleMatch) - Number(a.titleMatch));
    const pages = Math.max(1,Math.ceil(results.length/50)); searchPage = Math.min(searchPage,pages);
    searchResults.innerHTML = '<div class="search-result-count">找到 ' + results.length + ' 项 · 第 ' + searchPage + ' / ' + pages + ' 页</div>' + (results.length ? results.slice((searchPage-1)*50,searchPage*50).map(r => { const rawIndex = r.bodyIndex.map && r.index >= 0 ? r.bodyIndex.map[r.index] : r.index, start = Math.max(0,rawIndex - 25), snippet = r.text.slice(start,start+115); return '<a class="search-result" href="' + r.href + '"><small>' + esc(r.kind) + ' / ' + esc(r.group) + '</small><h3>' + highlight(r.title,q) + '</h3>' + (snippet ? '<p>' + (start ? '…' : '') + highlight(snippet,q) + '…</p>' : '') + '</a>'; }).join('') + (pages > 1 ? '<nav class="list-pager"><button type="button" class="button secondary" data-search-page="' + (searchPage-1) + '"' + (searchPage === 1 ? ' disabled' : '') + '>上一页</button><span>' + searchPage + ' / ' + pages + '</span><button type="button" class="button secondary" data-search-page="' + (searchPage+1) + '"' + (searchPage === pages ? ' disabled' : '') + '>下一页</button></nav>' : '') : '<div class="search-empty">没有匹配的结果，试试较短的关键词。</div>');
  }
  function openSearch() { if (typeof dialog.showModal !== 'function') { location.hash = '#/docs'; toast('请使用目录中的搜索框，或更新浏览器'); return; } if (!dialog.open) dialog.showModal(); search(); searchInput.focus(); }
  document.getElementById('search-open').addEventListener('click',openSearch);
  document.getElementById('search-close').addEventListener('click',() => dialog.close());
  dialog.addEventListener('click',e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); } const page = e.target.closest('[data-search-page]'); if (page && !page.disabled) { searchPage = Math.max(1,Number(page.dataset.searchPage)); search(false); searchResults.scrollTop = 0; } if (e.target.closest('.search-result')) dialog.close(); });
  searchInput.addEventListener('input',search);
  document.addEventListener('keydown',e => { if ((e.ctrlKey || e.metaKey) && e.key.toLocaleLowerCase() === 'k') { e.preventDefault(); openSearch(); } });
  refreshCount(); route();
})();
