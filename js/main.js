import { $, $$, enableSheetDrag } from './core/utils.js?v=20250919';
import { settings, session } from './core/state.js?v=20250919';
import { initSearch, getSearchState, onAutocomplete as triggerAutocomplete } from './ui/search.js?v=20250919';
import { initFeed, switchTab, loadNext, resetSearchPagination, hideTagsOverlay, getActiveTab, clearFeed } from './ui/feed.js?v=20250919';
import { initSettings, showSettings, hideSettings } from './ui/settings.js?v=20250919';

const els = {
  feed: $('#feed'),
  feedEnd: $('#feed-end'),
  sentinel: $('#sentinel'),
  toTop: $('#to-top'),
  scrollProgress: $('#scroll-progress>div'),
  tabbar: $('.tabbar'),
  tabs: $$('.tabbar .tab'),
  searchInput: $('#search-input'),
  searchGo: $('#search-go'),
  autocomplete: $('#autocomplete'),
  tagChips: $('#tag-chips'),
  providerToggle: $('#provider-toggle'),
  providerMenu: null,
  tagsOverlay: $('#tags-overlay'),
  tagsBody: $('#tags-body'),
  tagsClose: $('#tags-close'),
  main: $('#main'),
  btnSettings: $('#btn-settings'),
  settingsOverlay: $('#settings-overlay'),
  settingsContainer: $('#settings-container'),
  settingsClose: $('#settings-close'),
};

function boot(){
  // Init modules
  initFeed(els);
  initSettings(els);
  initSearch(els, {
    onPerformSearch: () => {
      // If already on Search tab, clear existing results before loading new ones
      if (getActiveTab && getActiveTab() === 'search') {
        clearFeed();
        resetSearchPagination();
        loadNext();
      } else {
        // Switching tabs handles clearing and loading
        switchTab('search');
      }
    },
  });

  // Tabs
  els.tabs.forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

  // Settings open/close
  els.btnSettings.addEventListener('click', () => { showSettings(); });

  // Provider toggle (session-only override for Search)
  const iconFor = (prov) => prov === 'realbooru' ? 'icons/RealBooru.png' : 'icons/Rule34.png';
  const labelFor = (prov) => prov === 'realbooru' ? 'RealBooru' : 'Rule34';
  const applyProviderBadge = () => {
    const b = els.providerToggle; if (!b) return;
    const p = session.providerOverride || settings.provider || 'rule34';
    let img = b.querySelector('img');
    if (!img){ img = document.createElement('img'); img.alt = 'Provider'; b.textContent = ''; b.appendChild(img); }
    img.src = iconFor(p);
    b.title = `Provider: ${labelFor(p)}`;
  };
  const syncProviderBtnSize = () => {
    const b = els.providerToggle; const inp = els.searchInput;
    if (!b || !inp) return;
    const h = inp.offsetHeight || 40;
    b.style.width = h + 'px';
    b.style.height = h + 'px';
  };
  const openMenu = () => {
    if (!els.providerMenu){
      const m = document.createElement('div');
      m.id = 'provider-menu'; m.className = 'provider-menu';
      m.innerHTML = `
        <button class="item" data-prov="rule34"><img src="icons/Rule34.png" alt="" /><span>Rule34</span></button>
        <button class="item" data-prov="realbooru"><img src="icons/RealBooru.png" alt="" /><span>RealBooru</span></button>
      `;
      els.searchInput?.parentElement?.insertBefore(m, els.searchInput);
      els.providerMenu = m;
      // click handlers
      m.querySelectorAll('.item').forEach(btn => btn.addEventListener('click', () => {
        const prov = btn.getAttribute('data-prov') || 'rule34';
        session.providerOverride = prov;
        applyProviderBadge();
        closeMenu();
        if (getActiveTab && getActiveTab() === 'search'){
          clearFeed();
          resetSearchPagination();
          loadNext();
        }
        // Refresh autocomplete suggestions for current input with new provider
        try{ if ((els.searchInput?.value||'').trim()) triggerAutocomplete(); }catch{}
      }));
    }
    els.providerMenu.hidden = false;
    els.providerToggle?.setAttribute('aria-expanded','true');
    setTimeout(() => document.addEventListener('click', onDocClick, { once: true }), 0);
  };
  const closeMenu = () => {
    if (els.providerMenu){ els.providerMenu.hidden = true; }
    els.providerToggle?.setAttribute('aria-expanded','false');
  };
  const onDocClick = (e) => {
    if (e.target === els.providerToggle || els.providerMenu?.contains(e.target)) return;
    closeMenu();
  };
  applyProviderBadge();
  syncProviderBtnSize();
  window.addEventListener('resize', syncProviderBtnSize);
  if (els.providerToggle){
    els.providerToggle.addEventListener('click', (e) => { e.stopPropagation(); if (els.providerMenu?.hidden === false) closeMenu(); else openMenu(); });
  }

  // Overlay drags
  enableSheetDrag(els.tagsOverlay, hideTagsOverlay);
  enableSheetDrag(els.settingsOverlay, hideSettings);

  // Global ESC closes overlays
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape'){ hideTagsOverlay(); hideSettings(); }});

  // Initial state
  switchTab('home');
  hideTagsOverlay(); hideSettings();
}

boot();
