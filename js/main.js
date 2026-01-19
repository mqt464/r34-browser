import { $, $$, enableSheetDrag } from './core/utils.js?v=20251007';
import { settings, session } from './core/state.js?v=20251007';
import { initSearch, onAutocomplete as triggerAutocomplete } from './ui/search.js?v=20251007';
import { initFeed, switchTab, loadNext, resetSearchPagination, hideTagsOverlay, getActiveTab, clearFeed, setHomeMode } from './ui/feed.js?v=20251007';
import { initSettings, renderSettings } from './ui/settings.js?v=20251007';
import { initViz, closeViz } from './ui/viz.js?v=20251007';
import { initFeedsManager, closeFeedsManager } from './ui/feeds-manager.js?v=20251007';

const els = {
  feed: $('#feed'),
  feedEnd: $('#feed-end'),
  sentinel: $('#sentinel'),
  toTop: $('#to-top'),
  scrollProgress: $('#scroll-progress>div'),
  topbar: document.querySelector('.topbar'),
  topbarInner: document.querySelector('.topbar-inner'),
  tabbar: $('.tabbar'),
  tabs: $$('.tabbar .tab'),
  homeSwitch: document.querySelector('.home-switch'),
  homePills: $$('.home-switch .pill'),
  homeManage: $('#home-manage'),
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
  settingsPage: $('#settings-page'),
  feedsOverlay: $('#feeds-overlay'),
  feedsClose: $('#feeds-close'),
  feedsAdd: $('#feeds-add'),
  feedsList: $('#feeds-list'),
  vizPage: $('#viz-page'),
};

function boot(){
  // Init modules
  initFeed(els);
  initSettings(els);
  initViz(els);
  initFeedsManager(els);
  const applyTabView = (name) => {
    const isSettings = name === 'settings';
    if (!isSettings) closeViz();
    if (els.settingsPage) els.settingsPage.hidden = !isSettings;
    if (!isSettings && els.vizPage) els.vizPage.hidden = true;
    if (els.feed) els.feed.hidden = isSettings;
    if (isSettings) renderSettings();
  };
  const selectTab = (name) => { switchTab(name); applyTabView(name); };
  initSearch(els, {
    onPerformSearch: () => {
      // If already on Search tab, clear existing results before loading new ones
      if (getActiveTab && getActiveTab() === 'search') {
        clearFeed();
        resetSearchPagination();
        loadNext();
      } else {
        // Switching tabs handles clearing and loading
        selectTab('search');
      }
    },
  });

  // Tabs
  els.tabs.forEach(btn => btn.addEventListener('click', () => selectTab(btn.dataset.tab)));

  // Home switcher
  const applyHomeMode = (mode) => {
    const m = mode === 'following' ? 'following' : 'suggested';
    els.homePills.forEach(btn => {
      const isActive = btn.dataset.home === m;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    setHomeMode(m);
  };
  els.homePills.forEach(btn => btn.addEventListener('click', () => {
    applyHomeMode(btn.dataset.home || 'suggested');
    if (getActiveTab && getActiveTab() !== 'home') selectTab('home');
  }));
  applyHomeMode('suggested');

  // Settings open/close
  if (els.btnSettings){
    els.btnSettings.addEventListener('click', () => { selectTab('settings'); });
  }

  // Provider toggle (session-only override for Search)
  const iconFor = (prov) => prov === 'realbooru' ? 'icons/RealBooru.png' : 'icons/Rule34.png';
  const labelFor = (prov) => prov === 'realbooru' ? 'RealBooru' : 'Rule34';
  const currentProvider = () => String((session.providerOverride) || (settings.provider) || 'rule34');
  const applyProviderBadge = () => {
    const b = els.providerToggle; if (!b) return;
    const p = currentProvider();
    let img = b.querySelector('img');
    if (!img){ img = document.createElement('img'); img.alt = 'Provider'; b.textContent = ''; b.appendChild(img); }
    img.src = iconFor(p);
    b.title = `Provider: ${labelFor(p)}`;
  };
  const updateSearchOptionsVisibility = () => {
    try {
      const opts = document.querySelector('#search-advanced');
      const toggle = document.querySelector('#search-advanced-toggle');
      if (!opts) return;
      const p = currentProvider();
      const hide = (p === 'realbooru');
      opts.hidden = hide ? true : opts.hidden;
      if (toggle) toggle.disabled = hide;
    } catch {}
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
        updateSearchOptionsVisibility();
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
  updateSearchOptionsVisibility();
  syncProviderBtnSize();
  window.addEventListener('resize', syncProviderBtnSize);
  if (els.providerToggle){
    els.providerToggle.addEventListener('click', (e) => { e.stopPropagation(); if (els.providerMenu?.hidden === false) closeMenu(); else openMenu(); });
  }

  // Respond to provider changes coming from Settings
  window.addEventListener('app:provider-changed', () => { applyProviderBadge(); updateSearchOptionsVisibility(); });

  // Overlay drags
  enableSheetDrag(els.tagsOverlay, hideTagsOverlay);
  enableSheetDrag(els.feedsOverlay, closeFeedsManager);

  // Global ESC closes overlays
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape'){
      hideTagsOverlay();
      closeFeedsManager();
    }
  });

  // Initial state
  selectTab('home');
  hideTagsOverlay();
}

boot();
