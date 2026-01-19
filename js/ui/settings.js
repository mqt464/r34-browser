import { $, escapeHtml, sparkline, debounce } from '../core/utils.js?v=20251007';
import { LS, DEFAULTS, saveLS, settings, filters, groups, favorites, savedSearches, recentTags, setSettings, setFilters, setGroups, setFavorites, setSavedSearches, setRecentTags, resetAllData, APP_VERSION } from '../core/state.js?v=20251007';
import { API, fetchText } from '../core/api.js?v=20251007';
import { normalizeTag } from './search.js?v=20251007';
import { applyTheme, applyColumns, applyTopbarPref, refreshSuggested } from './feed.js?v=20251007';
import { openViz } from './viz.js?v=20251007';
import { openFeedsManager, updateFeedsSummary } from './feeds-manager.js?v=20251007';

let els;
let dataMsgTimer = 0;

export function initSettings(domRefs){
  els = domRefs;
}

export function renderSettings(){
  if (!els?.settingsPage) return;
  els.settingsPage.innerHTML = '';
  const tpl = $('#tpl-settings');
  const node = tpl.content.cloneNode(true);
  els.settingsPage.appendChild(node);
  setupSettingsNav();
  els.settingsPage.querySelector('#open-viz')?.addEventListener('click', () => openViz());

  // Source (provider) + CORS proxy controls
  try{
    const settingsRoot = els.settingsPage.querySelector('.settings-view');
    if (settingsRoot) {
      const provBtn = settingsRoot.querySelector('#opt-provider-dd');
      const provMenu = settingsRoot.querySelector('.prov-menu');
      const provWrap = settingsRoot.querySelector('.provider-dd');
      const provImg = provBtn?.querySelector('img');
      const provLbl = provBtn?.querySelector('.lbl');
      const prox = settingsRoot.querySelector('#opt-proxy');
      const proxyWrap = settingsRoot.querySelector('.proxy-wrap');
      if (prox) prox.value = settings.corsProxy || '';
      const proxyImages = settingsRoot.querySelector('#opt-proxy-images');
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

  const tuning = $('#opt-suggest-tuning');
  const tuningVal = $('#opt-suggest-tuning-val');
  if (tuning){
    tuning.value = String(settings.suggestTuning ?? 65);
    if (tuningVal) tuningVal.textContent = tuning.value;
    tuning.addEventListener('input', (e) => {
      settings.suggestTuning = Number(e.target.value);
      saveLS(LS.settings, settings);
      if (tuningVal) tuningVal.textContent = String(settings.suggestTuning);
      refreshSuggested();
    });
  }

  // Appearance: sticky + auto-hide topbar on scroll
  const stickyEl = $('#opt-sticky-topbar');
  const autoHideEl = $('#opt-auto-hide-topbar');
  const syncAutoHideState = () => {
    if (!autoHideEl) return;
    const stickyOn = settings.stickyTopbar !== false;
    autoHideEl.disabled = !stickyOn;
    const wrapper = autoHideEl.closest('.switch');
    if (wrapper) wrapper.classList.toggle('is-disabled', !stickyOn);
  };
  if (stickyEl){
    stickyEl.checked = settings.stickyTopbar !== false;
    stickyEl.addEventListener('change', (e) => {
      settings.stickyTopbar = !!e.target.checked;
      saveLS(LS.settings, settings);
      syncAutoHideState();
      applyTopbarPref();
    });
  }
  if (autoHideEl){
    autoHideEl.checked = settings.autoHideTopbar !== false;
    autoHideEl.addEventListener('change', (e) => {
      if (autoHideEl.disabled) return;
      settings.autoHideTopbar = !!e.target.checked;
      saveLS(LS.settings, settings);
      applyTopbarPref();
    });
  }
  syncAutoHideState();

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

  // Feeds manager link
  const feedsManage = $('#feeds-manage');
  if (feedsManage){ feedsManage.addEventListener('click', () => openFeedsManager()); }
  updateFeedsSummary();

  // Data
  $('#data-copy').addEventListener('click', onCopy);
  $('#data-export').addEventListener('click', onExport);
  $('#data-import').addEventListener('change', onImport);
  $('#data-reset').addEventListener('click', onReset);
  renderAnalytics();

  // Version footer
  try{
    const root = els.settingsPage.querySelector('.settings-main');
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

function setupSettingsNav(){
  try{
    const page = els?.settingsPage;
    if (!page) return;
    if (page._settingsNavCleanup){
      try{ page._settingsNavCleanup(); }catch{}
      page._settingsNavCleanup = null;
    }
    const navItems = Array.from(page.querySelectorAll('.settings-nav .nav-item'));
    if (!navItems.length) return;
    const sections = navItems.map(btn => {
      const id = btn.getAttribute('data-target') || '';
      return { id, btn, section: id ? page.querySelector('#' + id) : null };
    }).filter(entry => !!entry.section && !!entry.id);
    if (!sections.length) return;
    const setActive = (id) => {
      if (!id) return;
      navItems.forEach(b => b.classList.toggle('active', (b.getAttribute('data-target') || '') === id));
    };
    navItems.forEach(btn => btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-target') || '';
      const section = page.querySelector('#' + id);
      setActive(id);
      if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    let raf = 0;
    const getTopOffset = () => {
      let h = 0;
      try{
        const css = getComputedStyle(document.documentElement).getPropertyValue('--topbar-h');
        h = parseFloat(css) || 0;
      }catch{}
      return h + 96;
    };
    const updateActive = () => {
      if (page.hidden) return;
      const offset = getTopOffset();
      let best = sections[0];
      let bestTop = -Infinity;
      sections.forEach(({ id, section }) => {
        const top = section.getBoundingClientRect().top - offset;
        if (top <= 0 && top > bestTop){
          bestTop = top;
          best = { id, section };
        }
      });
      if (best?.id) setActive(best.id);
    };
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; updateActive(); });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    page._settingsNavCleanup = () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
    updateActive();
  }catch{}
}

function onCopy(){
  try {
    const data = { settings, groups, favorites, filters, savedSearches, recentTags, v: 1 };
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
  const data = { settings, groups, favorites, filters, savedSearches, recentTags, v: 1 };
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
      if (Array.isArray(data.savedSearches)) { setSavedSearches(data.savedSearches); }
      if (Array.isArray(data.recentTags)) { setRecentTags(data.recentTags); }
      try{ window.dispatchEvent(new CustomEvent('app:search-state-changed')); }catch{}
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
  try{ window.dispatchEvent(new CustomEvent('app:search-state-changed')); }catch{}
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
