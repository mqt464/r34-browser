import { $, $$, enableSheetDrag } from './core/utils.js';
import { initSearch, getSearchState } from './ui/search.js';
import { initFeed, switchTab, loadNext, resetSearchPagination, hideTagsOverlay, getActiveTab, clearFeed } from './ui/feed.js';
import { initSettings, showSettings, hideSettings } from './ui/settings.js';

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
