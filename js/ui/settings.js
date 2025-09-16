import { $, uid, lockScroll, unlockScroll, escapeHtml, sparkline, debounce } from '../core/utils.js?v=20250916';
import { LS, DEFAULTS, saveLS, loadLS, settings, filters, groups, favorites, setSettings, setFilters, setGroups, setFavorites, resetAllData } from '../core/state.js?v=20250916';
import { API, parseTagXML } from '../core/api.js?v=20250916';
import { renderChipsFix, normalizeTag } from './search.js?v=20250916';
import { applyTheme, applyColumns } from './feed.js?v=20250916';

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
  $('#group-add').addEventListener('click', () => { groups.push({ id: uid(), name: 'New group', include: [], exclude: [] }); saveLS(LS.groups, groups); renderGroups(); });

  // Data
  $('#data-copy').addEventListener('click', onCopy);
  $('#data-export').addEventListener('click', onExport);
  $('#data-import').addEventListener('change', onImport);
  $('#data-reset').addEventListener('click', onReset);
  renderAnalytics();

  // API
  $('#opt-user-id').value = settings.apiUserId || '';
  $('#opt-api-key').value = settings.apiKey || '';
  $('#opt-user-id').addEventListener('change', (e)=>{ settings.apiUserId = e.target.value.trim(); saveLS(LS.settings, settings); });
  $('#opt-api-key').addEventListener('change', (e)=>{ settings.apiKey = e.target.value.trim(); saveLS(LS.settings, settings); });
  $('#api-test').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    const msg = $('#api-msg');
    btn.disabled = true; msg.textContent = 'Testing...';
    try{
      await API.posts({ tags: 'rating:safe', limit: 1, pid: 0 });
      msg.textContent = 'Success! API credentials are valid.';
    }catch(e){
      msg.textContent = 'Failed: ' + (e?.message||'Unknown error');
    } finally {
      btn.disabled = false;
    }
  });
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
    try{ const items = await API.autocomplete(q); ac.innerHTML = (items||[]).slice(0,10).map(i=>`<div class="item" data-v="${escapeHtml(i.value)}">${escapeHtml(i.value)}</div>`).join(''); ac.hidden = false; ac.querySelectorAll('.item').forEach(it=>it.addEventListener('click', ()=>{ search.value=it.dataset.v; addBtn.click(); ac.hidden = true; })); }
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
