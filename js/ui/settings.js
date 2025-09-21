import { $, uid, lockScroll, unlockScroll, escapeHtml, sparkline, debounce } from '../core/utils.js?v=20250919';
import { LS, DEFAULTS, saveLS, loadLS, settings, filters, groups, favorites, setSettings, setFilters, setGroups, setFavorites, resetAllData, APP_VERSION } from '../core/state.js?v=20250919';
import { API, parseTagXML, fetchText } from '../core/api.js?v=20250919';
import { renderChipsFix, normalizeTag } from './search.js?v=20250919';
import { applyTheme, applyColumns } from './feed.js?v=20250919';

let els;
let dataMsgTimer = 0;

export function initSettings(domRefs){
  els = domRefs;
  els.settingsClose.addEventListener('click', () => hideSettings());
  els.settingsOverlay.addEventListener('click', (e) => { if (e.target === els.settingsOverlay) hideSettings(); });
}

export function showSettings(){
  renderSettings();
  els.settingsOverlay.hidden = false;
  lockScroll();
}
export function hideSettings(){
  els.settingsOverlay.hidden = true;
  unlockScroll();
}

export function renderSettings(){
  els.settingsContainer.innerHTML = '';
  const tpl = $('#tpl-settings');
  const node = tpl.content.cloneNode(true);
  els.settingsContainer.appendChild(node);

  // Source (provider) + CORS proxy controls
  try{
    const settingsRoot = els.settingsContainer.querySelector('.settings');
    if (settingsRoot) {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <h3>Default Provider</h3>
        <div class="row fields">
          <div class="provider-dd" style="flex:1; position:relative">
            <button id="opt-provider-dd" class="prov-dd" type="button" aria-haspopup="listbox" aria-expanded="false">
              <img alt="" />
              <span class="lbl"></span>
              <span class="caret" aria-hidden="true">▾</span>
            </button>
            <div class="prov-menu" role="listbox" hidden>
              <button class="item" data-prov="rule34" role="option"><img src="icons/Rule34.png" alt="" /><span>Rule34</span></button>
              <button class="item" data-prov="realbooru" role="option"><img src="icons/RealBooru.png" alt="" /><span>RealBooru</span></button>
            </div>
          </div>
          <label class="stack proxy-wrap" style="flex:2; position:relative">CORS Proxy (optional)
            <input id="opt-proxy" type="text" placeholder="https://r.jina.ai/http/ or https://cors.isomorphic-git.org/" />
            <span class="input-spinner" aria-hidden="true"></span>
          </label>
        </div>
        <div class="fields">
          <label class="switch">
            <input id="opt-proxy-images" type="checkbox" />
            <span class="switch-ui" aria-hidden="true"></span>
            <span class="label">Use proxy for media</span>
          </label>
          <div class="note">Turn off to reduce proxy bandwidth. If images fail to load due to hotlink protection, turn back on.</div>
        </div>
        <div class="note">Rule34: no proxy needed. RealBooru: proxy required for search/autocomplete (images usually load direct).</div>
      `;
      // Move provider + proxy controls into the API Access card, not a separate card
      const apiInput = $('#opt-user-id');
      let apiCard = apiInput;
      while (apiCard && apiCard.classList && !apiCard.classList.contains('card')) apiCard = apiCard.parentElement;
      // Build two rows: (1) Default Provider above User ID, (2) CORS Proxy below it
      // Remove any previous injections
      apiCard.querySelector('#provider-row')?.remove();
      apiCard.querySelector('#proxy-row')?.remove();

      const providerRow = document.createElement('div');
      providerRow.className = 'row fields'; providerRow.id = 'provider-row';
      providerRow.innerHTML = `
        <label class="stack" style="flex:1">
          <span class="label">Default Provider</span>
          <div class="provider-dd" style="position:relative">
            <button id="opt-provider-dd" class="prov-dd" type="button" aria-haspopup="listbox" aria-expanded="false">
              <img alt="" />
              <span class="lbl"></span>
              <span class="caret" aria-hidden="true">▾</span>
            </button>
            <div class="prov-menu" role="listbox" hidden>
              <button class="item" data-prov="rule34" role="option"><img src="icons/Rule34.png" alt="" /><span>Rule34</span></button>
              <button class="item" data-prov="realbooru" role="option"><img src="icons/RealBooru.png" alt="" /><span>Realbooru</span></button>
            </div>
          </div>
        </label>
      `;

      const proxyRow = document.createElement('div');
      proxyRow.className = 'row fields'; proxyRow.id = 'proxy-row';
      proxyRow.innerHTML = `
        <label class="stack proxy-wrap" style="flex:1; position:relative">
          <span class="label">CORS Proxy</span>
          <div class="note">Proxies are only used on sites that require them to fetch media. For instance, Realbooru requires a proxy as media from it needs to be scraped as its API is offline.</div>
          <div class="input-wrap">
            <input id="opt-proxy" type="text" placeholder="https://r.jina.ai/http/ or https://cors.isomorphic-git.org/" />
            <span class="input-spinner" aria-hidden="true"></span>
          </div>
          <label class="switch" style="margin-top:8px">
            <input id="opt-proxy-images" type="checkbox" />
            <span class="switch-ui" aria-hidden="true"></span>
            <span class="label">Use proxy for media</span>
          </label>
        </label>
      `;

      const credsRow = apiCard.querySelector('.row.fields');
      if (credsRow){ apiCard.insertBefore(providerRow, credsRow); apiCard.insertBefore(proxyRow, credsRow); }
      else { apiCard.appendChild(providerRow); apiCard.appendChild(proxyRow); }

      // Toggle is now part of the proxy row directly under the textbox

      const provBtn = providerRow.querySelector('#opt-provider-dd');
      const provMenu = providerRow.querySelector('.prov-menu');
      const provWrap = providerRow.querySelector('.provider-dd');
      const provImg = provBtn?.querySelector('img');
      const provLbl = provBtn?.querySelector('.lbl');
      const prox = proxyRow.querySelector('#opt-proxy');
      const proxyWrap = proxyRow.querySelector('.proxy-wrap');
      if (prox) prox.value = settings.corsProxy || '';
      const proxyImages = apiCard.querySelector('#opt-proxy-images');
      if (proxyImages) proxyImages.checked = !!settings.proxyImages;
    // Custom full-width dropdown (icon + name + caret)
    const iconFor = (p) => p==='realbooru' ? 'icons/RealBooru.png' : 'icons/Rule34.png';
    const labelFor = (p) => p==='realbooru' ? 'RealBooru' : 'Rule34';
    const applyProvDD = () => { const p = settings.provider||'rule34'; if (provImg) provImg.src = iconFor(p); if (provLbl) provLbl.textContent = labelFor(p); };
    applyProvDD();
    let provDocHandler = null;
    const openProvMenu = () => {
      if (!provMenu) return; provMenu.hidden = false; provBtn?.setAttribute('aria-expanded','true');
      provDocHandler = (e) => {
        if (provWrap && (provWrap.contains(e.target))) return;
        closeProvMenu();
      };
      document.addEventListener('click', provDocHandler);
    };
    const closeProvMenu = () => {
      if (!provMenu) return; provMenu.hidden = true; provBtn?.setAttribute('aria-expanded','false');
      if (provDocHandler){ document.removeEventListener('click', provDocHandler); provDocHandler = null; }
    };
      provBtn?.addEventListener('click', (e)=>{ e.stopPropagation(); if (provMenu?.hidden===false) closeProvMenu(); else openProvMenu(); });
    provMenu?.querySelectorAll('.item').forEach(it => it.addEventListener('click', ()=>{ const p = it.getAttribute('data-prov')||'rule34'; settings.provider = p; saveLS(LS.settings, settings); applyProvDD(); closeProvMenu(); try{ window.dispatchEvent(new CustomEvent('app:provider-changed')); }catch{} }));

    // Proxy test with spinner + subtle outline
    const testProxy = debounce(async ()=>{
      const val = (prox?.value||'').trim();
      if (!val) { settings.corsProxy = ''; saveLS(LS.settings, settings); proxyWrap?.classList.remove('testing'); prox?.classList.remove('ok','err'); try{ window.dispatchEvent(new CustomEvent('app:proxy-changed')); }catch{} return; }
      // Persist proxy and announce change immediately so requests start using it without waiting for test
      settings.corsProxy = val; saveLS(LS.settings, settings);
      try{ window.dispatchEvent(new CustomEvent('app:proxy-changed')); }catch{}
      proxyWrap?.classList.add('testing'); prox?.classList.remove('ok','err');
      try{
        // RealBooru HTML endpoint requires proxy; this verifies the proxy format works
        await fetchText('https://realbooru.com/index.php?page=autocomplete&term=mi', /*allowProxy*/ true);
        proxyWrap?.classList.remove('testing'); prox?.classList.add('ok');
        // Successful test already announced; nothing further needed
      }catch{ proxyWrap?.classList.remove('testing'); prox?.classList.add('err'); }
    }, 600);
    prox?.addEventListener('input', testProxy);
    prox?.addEventListener('change', testProxy);
    proxyImages?.addEventListener('change', (e)=>{ settings.proxyImages = !!e.target.checked; saveLS(LS.settings, settings); });

      // Auto-test initial proxy value
      if ((prox?.value||'').trim()) { proxyWrap?.classList.add('testing'); testProxy(); }
    }
  }catch{}

  $('#opt-columns').value = String(settings.columns);
  $('#opt-columns-val').textContent = String(settings.columns);
  $('#opt-columns').addEventListener('input', (e)=>{
    settings.columns = Number(e.target.value);
    saveLS(LS.settings, settings);
    $('#opt-columns-val').textContent = String(settings.columns);
    applyColumns();
  });

  $('#opt-theme').value = settings.theme;
  $('#opt-theme').addEventListener('change', (e)=>{
    settings.theme = e.target.value; saveLS(LS.settings, settings); applyTheme();
  });
  $('#opt-accent').value = settings.accent || '#7c3aed';
  $('#opt-accent').addEventListener('input', (e)=>{ settings.accent = e.target.value; saveLS(LS.settings, settings); applyTheme(); });

  // Filters
  $('#f-ai').checked = !!filters.excludeAI;
  $('#f-scat').checked = !!filters.excludeScat;
  $('#f-shota').checked = !!filters.excludeShota;
  $('#f-ai').addEventListener('change', (e)=>{ filters.excludeAI = !!e.target.checked; saveLS(LS.filters, filters); });
  $('#f-scat').addEventListener('change', (e)=>{ filters.excludeScat = !!e.target.checked; saveLS(LS.filters, filters); });
  $('#f-shota').addEventListener('change', (e)=>{ filters.excludeShota = !!e.target.checked; saveLS(LS.filters, filters); });

  const setCode = (el, arr) => { if (!el) return; el.innerHTML = (arr||[]).map(t => `<span class="code-tag">-${escapeHtml(t)}</span>`).join(' '); };
  setCode($('#f-ai-tags'), ['ai_generated','stable_diffusion','novelai','midjourney']);
  setCode($('#f-scat-tags'), ['scat','coprophagia','feces']);
  setCode($('#f-shota-tags'), ['loli','shota']);

  // Custom exclusions
  const customInput = $('#f-custom-input');
  const customAdd = $('#f-custom-add');
  const customList = $('#f-custom-list');
  function renderCustom(){
    const arr = Array.isArray(filters.customExclude) ? filters.customExclude : (filters.customExclude = []);
    customList.innerHTML = arr.length ? arr.map(t => `<span class="code-tag">-${escapeHtml(t)}<span class="x" title="Remove" data-t="${escapeHtml(t)}">?</span></span>`).join(' ') : '<span class="note">No custom exclusions</span>';
    customList.querySelectorAll('.code-tag .x').forEach(x => x.addEventListener('click', () => {
      const t = x.getAttribute('data-t');
      filters.customExclude = filters.customExclude.filter(v => v !== t);
      saveLS(LS.filters, filters);
      renderCustom();
    }));
  }
  renderCustom();
  customAdd.addEventListener('click', () => {
    const v = normalizeTag(customInput.value||''); if (!v) return;
    const tag = v.startsWith('-') ? v.slice(1) : v;
    const arr = Array.isArray(filters.customExclude) ? filters.customExclude : (filters.customExclude = []);
    if (!arr.includes(tag)) arr.push(tag);
    saveLS(LS.filters, filters);
    customInput.value = '';
    renderCustom();
  });

  // Groups
  const groupsWrap = $('#groups');
  const renderGroups = () => {
    groupsWrap.innerHTML = '';
    for (const g of groups){ groupsWrap.appendChild(groupEditor(g)); }
  };
  renderGroups();
  $('#group-add').addEventListener('click', () => { groups.push({ id: uid(), name: 'New group', provider: settings.provider||'rule34', include: [], exclude: [] }); saveLS(LS.groups, groups); renderGroups(); });

  // Data
  $('#data-copy').addEventListener('click', onCopy);
  $('#data-export').addEventListener('click', onExport);
  $('#data-import').addEventListener('change', onImport);
  $('#data-reset').addEventListener('click', onReset);
  renderAnalytics();

  // Version footer
  try{
    const root = els.settingsContainer.querySelector('.settings');
    if (root){
      const ver = document.createElement('div');
      ver.className = 'note';
      ver.style.textAlign = 'center';
      ver.style.margin = '12px 0 6px 0';
      ver.textContent = `Version ${APP_VERSION}`;
      root.appendChild(ver);
    }
  }catch{}

  // API
  $('#opt-user-id').value = settings.apiUserId || '';
  $('#opt-api-key').value = settings.apiKey || '';
  $('#opt-user-id').addEventListener('change', (e)=>{ settings.apiUserId = e.target.value.trim(); saveLS(LS.settings, settings); });
  $('#opt-api-key').addEventListener('change', (e)=>{ settings.apiKey = e.target.value.trim(); saveLS(LS.settings, settings); });

  // Auto-test Rule34 credentials with inline spinner + outline
  try{
    const uid = $('#opt-user-id'); const key = $('#opt-api-key');
    const getLabelWrap = (el) => el ? el.parentElement : null;
    const uidWrap = getLabelWrap(uid); const keyWrap = getLabelWrap(key);
    [uidWrap, keyWrap].forEach(w => {
      if (!w) return;
      w.classList.add('proxy-wrap');
      let inner = w.querySelector('.input-wrap');
      if (!inner){
        inner = document.createElement('div'); inner.className = 'input-wrap';
        const input = w.querySelector('input');
        if (input){ w.insertBefore(inner, input); inner.appendChild(input); }
      }
      if (inner && !inner.querySelector('.input-spinner')){
        const s = document.createElement('span'); s.className = 'input-spinner'; s.setAttribute('aria-hidden','true'); inner.appendChild(s);
      }
    });
    const clearStates = () => { [uid,key].forEach(el => el && el.classList.remove('ok','err')); [uidWrap,keyWrap].forEach(w => w && w.classList.remove('testing')); };
    const setTesting = () => { [uidWrap,keyWrap].forEach(w => w && w.classList.add('testing')); };
    const setResult = (ok) => { [uid,key].forEach(el => el && el.classList.add(ok?'ok':'err')); };
    const testCreds = debounce(async()=>{
      const hasVals = (uid?.value||'').trim() || (key?.value||'').trim();
      clearStates();
      if (!hasVals) return;
      setTesting();
      try{
        await API.posts({ tags: 'id:>0', limit: 1, pid: 0, provider: 'rule34' });
        clearStates(); setResult(true);
      } catch { clearStates(); setResult(false); }
    }, 600);
    uid?.addEventListener('input', testCreds);
    key?.addEventListener('input', testCreds);
    if ((uid?.value||'').trim() || (key?.value||'').trim()) testCreds();
  }catch{}
}

function groupEditor(g){
  const tpl = $('#tpl-group');
  const node = tpl.content.cloneNode(true);
  const root = node.firstElementChild;
  const name = $('.group-name', root);
  const del = $('.group-del', root);
  const chips = $('.chips', root);
  const search = $('.group-search', root);
  const addBtn = $('.group-add-tag', root);
  const ac = $('.autocomplete', root);

  // Default provider for legacy groups
  if (!g.provider) { g.provider = 'rule34'; saveLS(LS.groups, groups); }

  // Provider icon dropdown inline with the group search input
  try{
    const searchbox = $('.searchbox.small', root);
    if (searchbox && search){
      const btn = document.createElement('button');
      btn.className = 'provider-btn'; btn.title = 'Change provider'; btn.setAttribute('aria-label','Change provider');
      const img = document.createElement('img'); img.alt = '';
      btn.appendChild(img);
      const menu = document.createElement('div');
      menu.className = 'provider-menu'; menu.hidden = true;
      menu.innerHTML = `
        <button class="item" data-prov="rule34"><img src="icons/Rule34.png" alt="" /><span>Rule34</span></button>
        <button class="item" data-prov="realbooru"><img src="icons/RealBooru.png" alt="" /><span>RealBooru</span></button>
      `;
      const setIcon = () => { img.src = (g.provider==='realbooru') ? 'icons/RealBooru.png' : 'icons/Rule34.png'; };
      setIcon();
      // Insert before the input
      searchbox.insertBefore(btn, search);
      searchbox.insertBefore(menu, search);
      // Match button size to input height
      const syncSize = () => { const h = search.offsetHeight || 32; btn.style.width = h+'px'; btn.style.height = h+'px'; };
      syncSize();
      window.addEventListener('resize', syncSize);
      // interactions
      btn.addEventListener('click', (e)=>{ e.stopPropagation(); menu.hidden = !menu.hidden; if (!menu.hidden){ const onDoc=(ev)=>{ if (!menu.contains(ev.target) && ev.target!==btn){ menu.hidden = true; document.removeEventListener('click', onDoc); } }; setTimeout(()=>document.addEventListener('click', onDoc),0); } });
      menu.querySelectorAll('.item').forEach(it => it.addEventListener('click', ()=>{ g.provider = it.getAttribute('data-prov')||'rule34'; saveLS(LS.groups, groups); setIcon(); menu.hidden = true; }));
    }
  }catch{}

  name.value = g.name || '';
  name.addEventListener('input', ()=>{ g.name = name.value; saveLS(LS.groups, groups); });
  del.addEventListener('click', ()=>{
    const idx = groups.findIndex(x => x.id === g.id);
    if (idx >= 0) { groups.splice(idx, 1); saveLS(LS.groups, groups); renderSettings(); }
  });

  const render = () => renderChipsFix(chips, g.include||[], g.exclude||[], {
    onToggle: (tag, wasEx) => {
      if (wasEx){ g.exclude = (g.exclude||[]).filter(x=>x!==tag); if (!g.include.includes(tag)) g.include.push(tag); }
      else { g.include = (g.include||[]).filter(x=>x!==tag); if (!g.exclude.includes(tag)) g.exclude.push(tag); }
      saveLS(LS.groups, groups); render();
    },
    onRemove: (tag, wasEx) => {
      if (wasEx) g.exclude = (g.exclude||[]).filter(x=>x!==tag);
      else g.include = (g.include||[]).filter(x=>x!==tag);
      saveLS(LS.groups, groups); render();
    }
  });
  render();

  const toggle = $('.group-toggle', root);
  const summary = $('.group-summary', root);
  if (typeof g.collapsed !== 'boolean') g.collapsed = true;
  const applyCollapsed = () => {
    root.classList.toggle('collapsed', !!g.collapsed);
    if (toggle) toggle.setAttribute('aria-expanded', (!g.collapsed).toString());
    const inc = (g.include||[]).slice(0,6);
    const exc = (g.exclude||[]).slice(0,6);
    const incStr = inc.join(', ');
    const excStr = exc.map(t=>'-'+t).join(', ');
    if (summary) summary.innerHTML = (inc.length||exc.length) ? `${escapeHtml(incStr)}${(inc.length&&exc.length)?', ':''}${escapeHtml(excStr)}` : '<span class="note">No tags</span>';
  };
  applyCollapsed();
  if (toggle) toggle.addEventListener('click', () => { g.collapsed = !g.collapsed; saveLS(LS.groups, groups); applyCollapsed(); });

  addBtn.addEventListener('click', ()=>{ const t = normalizeTag(search.value); if (t){ (t.startsWith('-') ? (g.exclude||(g.exclude=[])).push(t.slice(1)) : (g.include||(g.include=[])).push(t)); saveLS(LS.groups, groups); search.value=''; render(); }});
  search.addEventListener('keydown', (e)=>{ if (e.key==='Enter'){ e.preventDefault(); addBtn.click(); }});
  search.addEventListener('input', debounce(async ()=>{
    const q = search.value.trim(); if(!q){ ac.hidden = true; return; }
    try{ const items = await API.autocomplete(q, g.provider || 'rule34'); ac.innerHTML = (items||[]).slice(0,10).map(i=>`<div class="item" data-v="${escapeHtml(i.value)}">${escapeHtml(i.value)}</div>`).join(''); ac.hidden = false; ac.querySelectorAll('.item').forEach(it=>it.addEventListener('click', ()=>{ search.value=it.dataset.v; addBtn.click(); ac.hidden = true; })); }
    catch{ ac.hidden = true; }
  }, 150));

  return root;
}

function onCopy(){
  try {
    const data = { settings, groups, favorites, filters, v: 1 };
    const json = JSON.stringify(data, null, 2);
    const msg = document.querySelector('#data-msg');

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(json)
        .then(() => { if (msg){ msg.textContent = 'Copied data to clipboard.'; clearTimeout(dataMsgTimer); dataMsgTimer = setTimeout(() => { msg.textContent = ''; }, 3500); } })
        .catch(() => { if (msg){ msg.textContent = 'Copy failed. Using Export instead.'; clearTimeout(dataMsgTimer); dataMsgTimer = setTimeout(() => { msg.textContent = ''; }, 3500); } try { onExport(); } catch {} });
    } else {
      const ta = document.createElement('textarea');
      ta.value = json; ta.setAttribute('readonly', ''); ta.style.position = 'absolute'; ta.style.left = '-9999px';
      document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch {}
      document.body.removeChild(ta);
      if (ok) { if (msg){ msg.textContent = 'Copied data to clipboard.'; clearTimeout(dataMsgTimer); dataMsgTimer = setTimeout(() => { msg.textContent = ''; }, 3500); } }
      else { if (msg){ msg.textContent = 'Copy unsupported. Using Export instead.'; clearTimeout(dataMsgTimer); dataMsgTimer = setTimeout(() => { msg.textContent = ''; }, 3500); } try { onExport(); } catch {} }
    }
  } catch (e) { try { alert('Copy failed: ' + (e?.message || 'Unknown error')); } catch {} }
}

function onExport(){
  const data = { settings, groups, favorites, filters, v: 1 };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'r34-browser-data.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url), 5000);
}

function onImport(e){
  const f = e.target.files?.[0]; if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const data = JSON.parse(String(reader.result||'{}'));
      if (data.settings) { setSettings({ ...DEFAULTS.settings, ...data.settings }); }
      if (Array.isArray(data.groups)) { setGroups(data.groups); }
      if (data.favorites) { setFavorites(data.favorites); }
      if (data.filters) { setFilters({ ...DEFAULTS.filters, ...data.filters }); }
      alert('Import complete.');
      renderSettings();
    }catch(err){ alert('Import failed: ' + (err?.message||'')); }
  };
  reader.readAsText(f);
}

function onReset(){
  if (!confirm('Reset all data? This cannot be undone.')) return;
  resetAllData();
  alert('Data reset.');
  renderSettings();
}

async function renderAnalytics(){
  const a = $('#analytics');
  if (!a) return;
  a.innerHTML = '<div class="analytics-loading" role="status" aria-live="polite">'
    + '<span class="spinner" aria-hidden="true"></span>'
    + '<span class="msg">Loading analytics.</span>'
    + '</div>';
  const msgEl = a.querySelector('.msg');
  const favPosts = favorites.ids.map(id => favorites.map[id]).filter(Boolean);
  const favCount = favPosts.length;
  const groupCount = groups.length;
  if (msgEl) msgEl.textContent = 'Summarizing favorites.';
  const uniqueTagsCount = countUniqueTags(favPosts);

  const topTags = topTagsFromFavorites(8);
  const maxTagCount = topTags.length ? topTags[0][1] : 1;
  const bars = topTags.map(([t,c]) => `
      <div class="row"><div class="label" title="${escapeHtml(t)}">${escapeHtml(t)}</div>
        <div class="bar"><div class="fill" style="width:${(c/maxTagCount*100).toFixed(1)}%"></div></div>
        <div class="val">${c}</div></div>`).join('');

  if (msgEl) msgEl.textContent = 'Resolving tag types.';
  const topTagsAll = topTagsFromFavorites(100);
  const typeMap = await mapTagTypes(topTagsAll.map(([t]) => t), 6).catch(()=>new Map());
  const artistOnly = topTagsAll.filter(([t]) => typeMap.get(t) === 1).slice(0, 8);
  const maxArtist = artistOnly.length ? artistOnly[0][1] : 1;
  const artistBars = artistOnly.map(([t,c]) => `
      <div class="row"><div class="label" title="${escapeHtml(t)}">${escapeHtml(t)}</div>
        <div class="bar"><div class="fill" style="width:${(c/maxArtist*100).toFixed(1)}%"></div></div>
        <div class="val">${c}</div></div>`).join('');

  if (msgEl) msgEl.textContent = 'Rendering charts.';
  const months = lastNMonths(12);
  const series = months.map(m => favoritesPerMonth(favPosts, m));
  const spark = sparkline(series);

  a.innerHTML = `
      <div class="stats">
        <div class="stat"><div class="value">${favCount}</div><div class="label">Favorites</div></div>
        <div class="stat"><div class="value">${groupCount}</div><div class="label">Tag groups</div></div>
        <div class="stat"><div class="value">${uniqueTagsCount}</div><div class="label">Unique tags</div></div>
      </div>
      <div class="grid">
        <div class="chart barlist">
          <h4>Top tags</h4>
          ${bars || '<div class="note">No data yet</div>'}
        </div>
        <div class="chart barlist">
          <h4>Top artists</h4>
          ${artistBars || '<div class="note">No artist data yet</div>'}
        </div>
        <div class="chart spark">
          <h4>Favorites by month</h4>
          ${spark}
        </div>
      </div>
    `;
}

function topTagsFromFavorites(n=10){
  const counts = new Map();
  for (const id of favorites.ids){
    const p = favorites.map[id]; if (!p?.tags) continue;
    for (const t of p.tags.split(/\s+/)) counts.set(t, (counts.get(t)||0)+1);
  }
  return Array.from(counts.entries()).sort((a,b)=>b[1]-a[1]).slice(0,n);
}

function countUniqueTags(posts){
  const s = new Set();
  for (const p of posts){ if (!p?.tags) continue; for (const t of p.tags.split(/\s+/)) s.add(t); }
  return s.size;
}

async function mapTagTypes(tagList, concurrency = 6){
  const result = new Map();
  let i = 0, active = 0;
  return await new Promise((resolve) => {
    const step = () => {
      if (i >= tagList.length && active === 0) return resolve(result);
      while (active < concurrency && i < tagList.length){
        const tag = tagList[i++];
        active++;
        API.tagMeta(tag)
          .then(arr => {
            const list = Array.isArray(arr) ? arr : [];
            if (!list.length) return;
            const low = String(tag).toLowerCase();
            const obj = list.find(o => String(o.name||'').toLowerCase() === low) || list[0];
            const typeNum = Number(obj?.type);
            if (Number.isFinite(typeNum)) result.set(tag, typeNum);
          })
          .catch(()=>{})
          .finally(() => { active--; step(); });
      }
    };
    step();
  });
}

function lastNMonths(n){
  const arr = []; const d = new Date(); d.setDate(1);
  for (let i=n-1;i>=0;i--){ const dt = new Date(d.getFullYear(), d.getMonth()-i, 1); arr.push(dt.toISOString().slice(0,7)); }
  return arr;
}

function parseMonth(s){
  const d = new Date(s);
  if (!isNaN(d)) return d.toISOString().slice(0,7);
  const n = Number(s); if (!isNaN(n)){ const d2 = new Date(n*1000); if (!isNaN(d2)) return d2.toISOString().slice(0,7); }
  return '';
}

function favoritesPerMonth(posts, month){
  let c = 0; for (const p of posts){ const m = parseMonth(p.created_at || p.change || ''); if (m===month) c++; }
  return c;
}

