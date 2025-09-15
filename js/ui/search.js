import { $, $$, debounce, escapeHtml } from '../core/utils.js';
import { API } from '../core/api.js';

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
    const items = await API.autocomplete(q);
    const list = (Array.isArray(items) ? items : []).slice(0, 20);
    if (!list.length) { els.autocomplete.hidden = true; return; }
    els.autocomplete.innerHTML = list.map(it => `<div class="item" data-v="${escapeHtml(it.value)}">${escapeHtml(it.value)} <span class="note">${it.type||''}</span></div>`).join('');
    els.autocomplete.hidden = false;
    els.autocomplete.querySelectorAll('.item').forEach(it => it.addEventListener('click', () => {
      addSearchTag(it.dataset.v);
      els.autocomplete.hidden = true;
    }));
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
    c.className = 'chip' + (excluded ? ' excluded minus' : ' plus');
    c.innerHTML = '<span class="toggle" title="Toggle include/exclude">' + (excluded ? '-' : '+') + '</span>' +
                  '<span class="t">' + escapeHtml(tag) + '</span>' +
                  '<span class="x" title="Remove">x</span>';
    const to = $('.toggle', c);
    const x = $('.x', c);
    to.addEventListener('click', () => onToggle && onToggle(tag, excluded));
    let pressT;
    c.addEventListener('pointerdown', () => { pressT = setTimeout(() => onRemove && onRemove(tag, excluded), 500); });
    c.addEventListener('pointerup', () => clearTimeout(pressT));
    x.addEventListener('click', () => onRemove && onRemove(tag, excluded));
    return c;
  }
}

