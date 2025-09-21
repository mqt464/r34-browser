import { $, $$, debounce, escapeHtml } from '../core/utils.js?v=20250919';
import { API } from '../core/api.js?v=20250919';
import { settings, session } from '../core/state.js?v=20250919';

export const searchState = { include: [], exclude: [] };

let els;
let onPerformSearchCb = () => {};

export function initSearch(domRefs, { onPerformSearch } = {}){
  els = domRefs; onPerformSearchCb = onPerformSearch || (()=>{});

  // Input: Enter adds a tag
  els.searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addSearchTag(els.searchInput.value.trim()); }
  });
  // Replace spaces with underscores while typing
  els.searchInput.addEventListener('input', (e) => {
    const v = e.target.value;
    if (/\s/.test(v)){
      const pos = e.target.selectionStart;
      e.target.value = v.replace(/\s+/g, '_');
      try{ e.target.setSelectionRange(pos, pos); }catch{}
    }
  });
  els.searchInput.addEventListener('input', debounce(onAutocomplete, 150));
  els.searchGo.addEventListener('click', () => performSearch());
  document.addEventListener('click', (e) => { if (!els.autocomplete.contains(e.target) && e.target !== els.searchInput) els.autocomplete.hidden = true; });

  updateSearchChips();
}

export function getSearchState(){ return searchState; }

export function normalizeTag(s){ return s.trim().toLowerCase().replace(/\s+/g, '_'); }

export function addSearchTag(raw){
  if (!raw) return;
  const t = normalizeTag(raw);
  if (!t) return;
  els.searchInput.value = '';
  if (t.startsWith('-')) {
    const tag = t.slice(1);
    if (!searchState.exclude.includes(tag)) searchState.exclude.push(tag);
  } else {
    if (!searchState.include.includes(t)) searchState.include.push(t);
  }
  updateSearchChips();
}

export function performSearch(){
  onPerformSearchCb && onPerformSearchCb();
}

export function removeSearchTag(tag, wasExcluded){
  if (wasExcluded) searchState.exclude = searchState.exclude.filter(x => x !== tag);
  else searchState.include = searchState.include.filter(x => x !== tag);
  updateSearchChips();
}

export function toggleSearchTag(tag, wasExcluded){
  removeSearchTag(tag, wasExcluded);
  addSearchTag(wasExcluded ? tag : ('-' + tag));
}

export function updateSearchChips(){
  renderChipsFix(els.tagChips, searchState.include, searchState.exclude, {
    onToggle: toggleSearchTag,
    onRemove: removeSearchTag,
  });
}

export async function onAutocomplete(){
  const q = els.searchInput.value.trim();
  if (!q) { els.autocomplete.hidden = true; return; }
  try {
    const provider = String((session?.providerOverride) || (settings?.provider) || 'rule34');
    const items = await API.autocomplete(q, provider);
    const list = (Array.isArray(items) ? items : []).slice(0, 20);
    if (!list.length) { els.autocomplete.hidden = true; return; }

    const typeClassFromName = (t)=>{
      const s = String(t||'').toLowerCase();
      if (s.includes('meta')) return 'meta';
      if (s.includes('artist')) return 'artist';
      if (s.includes('char')) return 'character';
      if (s.includes('copy')) return 'copyright';
      return 'general';
    };
    const fmtNum = (n)=>{ const v = Number(n); return Number.isFinite(v) ? v.toLocaleString() : ''; };

    els.autocomplete.innerHTML = list.map(it => {
      const v = String(it.value||'');
      const ty = it.type || '';
      const tcls = typeClassFromName(ty);
      return `
        <div class="item" data-v="${escapeHtml(v)}" data-k="${escapeHtml(v.toLowerCase())}">
          <div class="left">
            <span class="tag">${escapeHtml(v)}</span>
            ${ty ? `<span class="type ${tcls}">${escapeHtml(String(ty))}</span>` : `<span class="type skel"></span>`}
          </div>
          <div class="right">
            <span class="count skel" title="Posts"></span>
          </div>
        </div>`;
    }).join('');
    els.autocomplete.hidden = false;
    els.autocomplete.querySelectorAll('.item').forEach(it => it.addEventListener('click', () => {
      addSearchTag(it.dataset.v);
      els.autocomplete.hidden = true;
    }));

    // Enrich with metadata: type + count
    const version = (++onAutocomplete._ver || (onAutocomplete._ver = 1));
    const rows = Array.from(els.autocomplete.querySelectorAll('.item'));
    const names = rows.map(r => r.dataset.v);
    // If provider lacks tag meta (e.g. RealBooru), remove skeletons and skip enrichment
    if (provider === 'realbooru'){
      rows.forEach(row => {
        const tEl = row.querySelector('.type'); if (tEl){ tEl.classList.remove('skel'); tEl.textContent = 'General'; tEl.classList.add('general'); }
        const cEl = row.querySelector('.count'); if (cEl){ cEl.classList.remove('skel'); cEl.textContent = ''; }
      });
      return;
    }
    // Limit concurrency and requests to top 12 to stay snappy
    const limit = Math.min(12, names.length);
    const tasks = names.slice(0, limit).map((name, idx) => (async () => {
      try{
        const meta = await API.tagMeta(name, provider);
        // Ignore if another query happened
        if (version !== onAutocomplete._ver) return;
        const arr = Array.isArray(meta) ? meta : (Array.isArray(meta?.tag) ? meta.tag : []);
        if (!arr.length) return;
        const low = String(name).toLowerCase();
        const obj = arr.find(o => String(o.name||'').toLowerCase() === low) || arr[0];
        const count = Number(obj?.count || 0);
        const type = Number(obj?.type);
        const row = rows[idx]; if (!row) return;
        const cEl = row.querySelector('.count');
        if (cEl) { cEl.textContent = fmtNum(count); cEl.classList.remove('skel'); }
        const tEl = row.querySelector('.type');
        if (tEl){
          tEl.classList.remove('general','meta','artist','character','copyright');
          const cls = type === 1 ? 'artist' : type === 4 ? 'character' : type === 3 ? 'copyright' : type === 5 ? 'meta' : 'general';
          tEl.classList.add(cls);
          if (!tEl.textContent){ tEl.textContent = cls.charAt(0).toUpperCase() + cls.slice(1); }
          tEl.classList.remove('skel');
        }
      }catch{}
    })());
    await Promise.allSettled(tasks);
  } catch {
    els.autocomplete.hidden = true;
  }
}

// Clean chip renderer (safe ASCII chars)
export function renderChipsFix(root, include, exclude, { onToggle, onRemove } = {}){
  root.innerHTML = '';
  for (const tag of include){ root.appendChild(chipEl(tag, false)); }
  for (const tag of exclude){ root.appendChild(chipEl(tag, true)); }
  function chipEl(tag, excluded){
    const c = document.createElement('span');
    // Match the look of post tag chips and use dotted outline when excluded
    c.className = 'chip tag-general' + (excluded ? ' excluded' : '');
    c.innerHTML = '<span class="t">' + escapeHtml(tag) + '</span>';

    // Apply color class based on tag metadata (cached)
    applyTagClass(c, tag).catch(()=>{});

    // Interactions:
    // - Tap/click: remove from search
    // - Long-press: toggle include/exclude (adds/removes '-' prefix)
    let pressT; let didLong = false;
    const longMs = Number(settings?.longPressMs || 500);
    const onDown = (e) => {
      didLong = false;
      // Only primary button / touch
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      clearTimeout(pressT);
      pressT = setTimeout(() => {
        didLong = true;
        onToggle && onToggle(tag, excluded);
      }, longMs);
    };
    c.addEventListener('pointerdown', onDown);
    c.addEventListener('pointerup', () => { clearTimeout(pressT); });
    c.addEventListener('pointercancel', () => clearTimeout(pressT));
    c.addEventListener('pointerleave', () => clearTimeout(pressT));
    c.addEventListener('click', (e) => {
      // If we just long-pressed, swallow the click
      if (didLong) { didLong = false; e.preventDefault(); return; }
      if (excluded) { onToggle && onToggle(tag, excluded); }
      else { onRemove && onRemove(tag, excluded); }
    });
    // Prevent accidental text selection while pressing
    c.style.userSelect = 'none';
    return c;
  }
}

// ------- Tag coloring (metadata) -------
const tagTypeCache = new Map(); // tag(lowercase) -> type number

function classForType(t){
  if (t === 1) return 'tag-artist';
  if (t === 4) return 'tag-character';
  if (t === 3) return 'tag-copyright';
  if (t === 5) return 'tag-meta';
  return 'tag-general';
}

async function applyTagClass(el, rawTag){
  const tag = String(rawTag||'').toLowerCase();
  let type = tagTypeCache.get(tag);
  if (typeof type !== 'number'){
    try{
      const res = await API.tagMeta(tag);
      const arr = Array.isArray(res) ? res : (Array.isArray(res?.tag) ? res.tag : []);
      const found = arr.find(o => String(o?.name||'').toLowerCase() === tag) || arr[0];
      type = Number(found?.type);
      if (!Number.isFinite(type)) type = 0;
      tagTypeCache.set(tag, type);
    }catch{
      type = 0; tagTypeCache.set(tag, type);
    }
  }
  // Remove any previous tag-* class
  el.classList.remove('tag-general','tag-artist','tag-character','tag-copyright','tag-meta');
  el.classList.add(classForType(type));
}
