import { $, uid, lockScroll, unlockScroll, escapeHtml, debounce } from '../core/utils.js?v=20251007';
import { API } from '../core/api.js?v=20251007';
import { LS, saveLS, settings, groups } from '../core/state.js?v=20251007';
import { renderChipsFix, normalizeTag } from './search.js?v=20251007';

let els;
let onChangeCb = () => {};

export function initFeedsManager(domRefs, { onChange } = {}){
  els = domRefs;
  onChangeCb = onChange || (()=>{});

  if (els.feedsClose){
    els.feedsClose.addEventListener('click', () => closeFeedsManager());
  }
  if (els.feedsOverlay){
    els.feedsOverlay.addEventListener('click', (e) => { if (e.target === els.feedsOverlay) closeFeedsManager(); });
  }
  if (els.feedsAdd){
    els.feedsAdd.addEventListener('click', () => addFeed());
  }
  if (els.homeManage){
    els.homeManage.addEventListener('click', () => openFeedsManager());
  }

  const manageBtn = document.querySelector('#feeds-manage');
  if (manageBtn){
    manageBtn.addEventListener('click', () => openFeedsManager());
  }

  updateFeedsSummary();
}

export function openFeedsManager(){
  renderFeedsList();
  updateFeedsSummary();
  if (els.feedsOverlay){
    els.feedsOverlay.hidden = false;
    lockScroll();
  }
}

export function closeFeedsManager(){
  if (els.feedsOverlay){
    els.feedsOverlay.hidden = true;
    unlockScroll();
  }
}

export function updateFeedsSummary(){
  const el = document.querySelector('#feeds-summary');
  if (!el) return;
  const count = groups.length;
  if (!count){
    el.textContent = 'No feeds yet.';
    return;
  }
  el.textContent = `${count} feed${count === 1 ? '' : 's'} saved.`;
}

function notifyChange(){
  updateFeedsSummary();
  onChangeCb && onChangeCb(groups);
  try{ window.dispatchEvent(new CustomEvent('app:groups-changed')); }catch{}
}

function addFeed(){
  groups.push({
    id: uid(),
    name: 'New feed',
    provider: settings.provider || 'rule34',
    include: [],
    exclude: [],
    collapsed: false,
  });
  saveLS(LS.groups, groups);
  renderFeedsList();
  notifyChange();
}

function renderFeedsList(){
  const list = els?.feedsList;
  if (!list) return;
  list.innerHTML = '';
  if (!groups.length){
    const empty = document.createElement('div');
    empty.className = 'feed-empty note';
    empty.textContent = 'No feeds yet. Add one to start following tags.';
    list.appendChild(empty);
    return;
  }
  for (const g of groups){
    list.appendChild(groupEditor(g));
  }
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

  if (!g.provider) { g.provider = settings.provider || 'rule34'; saveLS(LS.groups, groups); }

  try{
    const searchbox = $('.searchbox.small', root);
    if (searchbox && search){
      const btn = document.createElement('button');
      btn.className = 'provider-btn';
      btn.title = 'Change provider';
      btn.setAttribute('aria-label','Change provider');
      const img = document.createElement('img');
      img.alt = '';
      btn.appendChild(img);
      const menu = document.createElement('div');
      menu.className = 'provider-menu';
      menu.hidden = true;
      menu.innerHTML = `
        <button class="item" data-prov="rule34"><img src="icons/Rule34.png" alt="" /><span>Rule34</span></button>
        <button class="item" data-prov="realbooru"><img src="icons/RealBooru.png" alt="" /><span>RealBooru</span></button>
      `;
      const setIcon = () => { img.src = (g.provider === 'realbooru') ? 'icons/RealBooru.png' : 'icons/Rule34.png'; };
      setIcon();
      searchbox.insertBefore(btn, search);
      searchbox.insertBefore(menu, search);
      const syncSize = () => { const h = search.offsetHeight || 32; btn.style.width = h + 'px'; btn.style.height = h + 'px'; };
      syncSize();
      window.addEventListener('resize', syncSize);
      btn.addEventListener('click', (e)=>{
        e.stopPropagation();
        menu.hidden = !menu.hidden;
        if (!menu.hidden){
          const onDoc = (ev) => {
            if (!menu.contains(ev.target) && ev.target !== btn){
              menu.hidden = true;
              document.removeEventListener('click', onDoc);
            }
          };
          setTimeout(()=>document.addEventListener('click', onDoc), 0);
        }
      });
      menu.querySelectorAll('.item').forEach(it => it.addEventListener('click', () => {
        g.provider = it.getAttribute('data-prov') || 'rule34';
        saveLS(LS.groups, groups);
        setIcon();
        menu.hidden = true;
        notifyChange();
      }));
    }
  }catch{}

  name.value = g.name || '';
  name.addEventListener('input', () => { g.name = name.value; saveLS(LS.groups, groups); notifyChange(); });
  del.addEventListener('click', () => {
    const idx = groups.findIndex(x => x.id === g.id);
    if (idx >= 0) {
      groups.splice(idx, 1);
      saveLS(LS.groups, groups);
      renderFeedsList();
      notifyChange();
    }
  });

  const render = () => renderChipsFix(chips, g.include || [], g.exclude || [], {
    onToggle: (tag, wasEx) => {
      if (wasEx){ g.exclude = (g.exclude || []).filter(x=>x!==tag); if (!g.include.includes(tag)) g.include.push(tag); }
      else { g.include = (g.include || []).filter(x=>x!==tag); if (!g.exclude.includes(tag)) g.exclude.push(tag); }
      saveLS(LS.groups, groups);
      render();
      notifyChange();
    },
    onRemove: (tag, wasEx) => {
      if (wasEx) g.exclude = (g.exclude || []).filter(x=>x!==tag);
      else g.include = (g.include || []).filter(x=>x!==tag);
      saveLS(LS.groups, groups);
      render();
      notifyChange();
    }
  });
  render();

  const toggle = $('.group-toggle', root);
  const summary = $('.group-summary', root);
  if (typeof g.collapsed !== 'boolean') g.collapsed = true;
  const applyCollapsed = () => {
    root.classList.toggle('collapsed', !!g.collapsed);
    if (toggle) toggle.setAttribute('aria-expanded', (!g.collapsed).toString());
    const inc = (g.include || []).slice(0, 6);
    const exc = (g.exclude || []).slice(0, 6);
    const incStr = inc.join(', ');
    const excStr = exc.map(t=>'-' + t).join(', ');
    if (summary) summary.innerHTML = (inc.length || exc.length) ? `${escapeHtml(incStr)}${(inc.length && exc.length) ? ', ' : ''}${escapeHtml(excStr)}` : '<span class="note">No tags</span>';
  };
  applyCollapsed();
  if (toggle) toggle.addEventListener('click', () => { g.collapsed = !g.collapsed; saveLS(LS.groups, groups); applyCollapsed(); notifyChange(); });

  addBtn.addEventListener('click', () => {
    const t = normalizeTag(search.value);
    if (t){
      if (t.startsWith('-')) { (g.exclude || (g.exclude = [])).push(t.slice(1)); }
      else { (g.include || (g.include = [])).push(t); }
      saveLS(LS.groups, groups);
      search.value = '';
      render();
      notifyChange();
    }
  });
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter'){ e.preventDefault(); addBtn.click(); } });
  search.addEventListener('input', debounce(async () => {
    const q = search.value.trim();
    if (!q){ ac.hidden = true; return; }
    try{
      const items = await API.autocomplete(q, g.provider || 'rule34');
      ac.innerHTML = (items || []).slice(0, 10).map(i => `<div class="item" data-v="${escapeHtml(i.value)}">${escapeHtml(i.value)}</div>`).join('');
      ac.hidden = false;
      ac.querySelectorAll('.item').forEach(it => it.addEventListener('click', () => {
        search.value = it.dataset.v;
        addBtn.click();
        ac.hidden = true;
      }));
    } catch {
      ac.hidden = true;
    }
  }, 150));

  return root;
}
