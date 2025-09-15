/* R34 Browser - HTML/CSS/JS single-page app
 * Notes:
 * - Client-side calls to Rule34 API may be blocked by CORS. Configure a proxy in Settings if needed.
 * - Safety: certain tags (minors) are always excluded and cannot be disabled.
 */

(() => {
  // ---------- Utilities ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  function uid() { return Math.random().toString(36).slice(2, 9); }

  function debounce(fn, ms = 250) {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  function escapeHtml(s=''){
    return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // Touch/gesture helpers
  const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  function haptic(pattern){
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch {}
  }

  // Scroll lock (prevents background from scrolling without jumping to top)
  let scrollLockCount = 0;
  let savedScrollY = 0;
  function lockScroll(){
    if (scrollLockCount === 0){
      savedScrollY = window.scrollY || document.documentElement.scrollTop || 0;
      const sbw = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
      document.documentElement.style.overscrollBehavior = 'contain';
      const b = document.body;
      b.style.position = 'fixed';
      b.style.top = `-${savedScrollY}px`;
      b.style.left = '0';
      b.style.right = '0';
      b.style.width = '100%';
      if (sbw) b.style.paddingRight = sbw + 'px';
    }
    scrollLockCount++;
  }
  function unlockScroll(){
    if (scrollLockCount > 0){
      scrollLockCount--;
      if (scrollLockCount === 0){
        const b = document.body;
        const y = Math.abs(parseInt(b.style.top || '0', 10)) || savedScrollY;
        b.style.position = '';
        b.style.top = '';
        b.style.left = '';
        b.style.right = '';
        b.style.width = '';
        b.style.paddingRight = '';
        document.documentElement.style.overscrollBehavior = '';
        window.scrollTo(0, y);
      }
    }
  }

  // ---------- Persistent state ----------
  const LS = {
    settings: 'r34:settings',
    favorites: 'r34:favorites',
    groups: 'r34:groups',
    filters: 'r34:filters'
  };

  const DEFAULTS = {
    settings: {
      columns: 1,
      theme: 'system',
      accent: '#7c3aed',
      apiUserId: '4521884',
      apiKey: '15119be19dd87c0655837088376c4ae68b2f270f906c28611617a4661981c9531a7c60e3e0ca188ae56b54dd1313017207565f793812311e9c3b20dc6a9a497b',
      perPage: 30,
      doubleTapMs: 300,
      longPressMs: 500,
    },
    filters: {
      excludeShota: true,
      excludeAI: false,
      excludeScat: false,
      customExclude: [],
    },
    groups: [
      // Example: { id: 'g1', name: 'Example', include:['samus_aran'], exclude:[] }
    ],
    favorites: {
      ids: [], // array for stable order
      map: {}, // id -> post
    }
  };

  function loadLS(key, fallback){
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : structuredClone(fallback); } catch { return structuredClone(fallback); }
  }
  function saveLS(key, val){ localStorage.setItem(key, JSON.stringify(val)); }

  let settings = loadLS(LS.settings, DEFAULTS.settings);
  let filters = loadLS(LS.filters, DEFAULTS.filters);
  let groups = loadLS(LS.groups, DEFAULTS.groups);
  let favorites = loadLS(LS.favorites, DEFAULTS.favorites);

  const favSet = new Set(favorites.ids);

  // ---------- API client ----------
  const API = {
    base: 'https://api.rule34.xxx',
    posts({ tags = '', limit = 30, pid = 0 }) {
      const u = new URL(`${API.base}/index.php`);
      u.searchParams.set('page', 'dapi');
      u.searchParams.set('s', 'post');
      u.searchParams.set('q', 'index');
      u.searchParams.set('json', '1');
      u.searchParams.set('limit', String(limit));
      u.searchParams.set('pid', String(pid));
      if (tags) u.searchParams.set('tags', tags);
      if (settings.apiUserId) u.searchParams.set('user_id', settings.apiUserId);
      if (settings.apiKey) u.searchParams.set('api_key', settings.apiKey);
      return fetchJSON(u.toString());
    },
    autocomplete(q) {
      const u = new URL(`${API.base}/autocomplete.php`);
      u.searchParams.set('q', q);
      return fetchJSON(u.toString());
    },
    async tagMeta(name){
      const u = new URL(`${API.base}/index.php`);
      u.searchParams.set('page','dapi');
      u.searchParams.set('s','tag');
      u.searchParams.set('q','index');
      u.searchParams.set('name',name);
      if (settings.apiUserId) u.searchParams.set('user_id', settings.apiUserId);
      if (settings.apiKey) u.searchParams.set('api_key', settings.apiKey);
      const xml = await fetchText(u.toString());
      return parseTagXML(xml);
    }
  };

  async function fetchJSON(url){
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15000);
    try {
      const res = await fetch(url, { signal: ctl.signal, headers: { 'Accept': 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally { clearTimeout(t); }
  }

  // ---------- DOM refs ----------
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

  // ---------- Global UI state ----------
  let activeTab = null;
  let searchState = { include: [], exclude: [] };
  let searchPid = 0; // pagination
  let loading = false;
  let reachedEnd = false;
  let direction = 1; // 1 down, -1 up
  let lastScrollY = 0;
  let currentPost = null; // for overlay actions
  let seen = new Set(); // dedupe posts in feed
  let dataMsgTimer = 0; // timeout id for #data-msg auto-hide

  // Home aggregator state
  let home = {
    round: 0,
    pids: {}, // groupId -> pid number
    exhausted: {}, // groupId -> bool
  };

  // ---------- Initialize UI ----------
  function init(){
    // Theme + accent
    applyTheme();
    applyColumns();

    // Tabs
    els.tabs.forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

    // Search interactions
    els.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addSearchTag(els.searchInput.value.trim()); }
    });
    // Replace spaces with underscores while typing
    els.searchInput.addEventListener('input', (e) => {
      const v = e.target.value;
      if (/\s/.test(v)){
        const pos = e.target.selectionStart;
        e.target.value = v.replace(/\s+/g, '_');
        // restore cursor near end to avoid jumps
        try{ e.target.setSelectionRange(pos, pos); }catch{}
      }
    });
    els.searchInput.addEventListener('input', debounce(onAutocomplete, 150));
    els.searchGo.addEventListener('click', () => performSearch());
    document.addEventListener('click', (e) => { if (!els.autocomplete.contains(e.target) && e.target !== els.searchInput) els.autocomplete.hidden = true; });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape'){ hideTagsOverlay(); hideSettings(); }});

    // Overlay actions
    // Post actions overlay removed
    els.tagsClose.addEventListener('click', () => hideTagsOverlay());
    els.tagsOverlay.addEventListener('click', (e) => { if (e.target === els.tagsOverlay) hideTagsOverlay(); });

    // Settings overlay
    els.btnSettings.addEventListener('click', () => { showSettings(); });
    els.settingsClose.addEventListener('click', () => hideSettings());
    els.settingsOverlay.addEventListener('click', (e) => { if (e.target === els.settingsOverlay) hideSettings(); });

    // Bottom sheet gestures
    enableSheetDrag(els.tagsOverlay, hideTagsOverlay);
    enableSheetDrag(els.settingsOverlay, hideSettings);

    // Scroll UI
    window.addEventListener('scroll', onScroll, { passive: true });
    els.toTop.addEventListener('click', () => window.scrollTo({ top:0, behavior:'smooth' }));

    // Infinite scroll
    const io = new IntersectionObserver(async (entries) => {
      for (const e of entries) {
        if (e.isIntersecting && !loading && !reachedEnd) {
          await loadNext();
        }
      }
    }, { rootMargin: '800px 0px 800px 0px' });
    io.observe(els.sentinel);

    // Chips initial render
    updateSearchChips();

    // Initial tab
    switchTab('home');

    // Ensure overlays are closed on boot
    hideTagsOverlay(); hideSettings();
  }

  // ---------- Theme & layout ----------
  function applyTheme(){
    const theme = settings.theme;
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    document.documentElement.style.setProperty('--accent', settings.accent);
  }
  function applyColumns(){
    const cols = clamp(Number(settings.columns||1),1,4);
    els.feed.dataset.columns = String(cols);
    els.feed.classList.toggle('single', cols === 1);
    els.feed.classList.toggle('masonry', cols > 1);
  }

  // ---------- Tabs ----------
  function switchTab(name){
    if (activeTab === name) return;
    activeTab = name;
    els.tabs.forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    // Close overlays on tab change
    hideTagsOverlay(); hideSettings();

    // Clear feed for content tabs
    if (name === 'favorites') {
      clearFeed();
      renderFavorites();
    } else if (name === 'home') {
      clearFeed();
      resetHome();
      loadNext().catch(()=>{});
    } else if (name === 'search') {
      clearFeed();
      searchPid = 0; reachedEnd = false; seen.clear();
      if (searchState.include.length || searchState.exclude.length) loadNext();
      else renderEmptyState('Add tags above to start a search.');
    }
  }

  function clearFeed(){
    els.feed.innerHTML = '';
    els.feedEnd.hidden = true;
    reachedEnd = false;
    seen.clear();
  }

  function renderEmptyState(text){
    const div = document.createElement('div');
    div.className = 'feed-end';
    div.textContent = text;
    els.feed.appendChild(div);
  }

  function resetHome(){
    home.round = 0; home.pids = {}; home.exhausted = {};
    if (!groups.length) {
      renderEmptyState('No tag groups yet. Add some in Settings.');
      reachedEnd = true;
    }
  }

  // ---------- Search chips ----------
  /* function renderChips(root, include, exclude, { onToggle, onRemove } = {}){
    root.innerHTML = '';
    for (const tag of include){
      root.appendChild(chipEl(tag, false));
    }
    for (const tag of exclude){
      root.appendChild(chipEl(tag, true));
    }
    function chipEl(tag, excluded){
      const c = document.createElement('span');
      c.className = 'chip' + (excluded ? ' excluded' : '');
      c.innerHTML = `<span class="toggle" title="Toggle include/exclude">${excluded ? '−' : '+'}</span><span class="t">${escapeHtml(tag)}</span><span class="x" title="Remove">✕</span>`;
      const to = $('.toggle', c);
      const x = $('.x', c);
      to.addEventListener('click', () => onToggle && onToggle(tag, excluded));
      let pressT;
      c.addEventListener('pointerdown', () => { pressT = setTimeout(() => onRemove && onRemove(tag, excluded), settings.longPressMs); });
      c.addEventListener('pointerup', () => clearTimeout(pressT));
      x.addEventListener('click', () => onRemove && onRemove(tag, excluded));
      return c;
    }
  } */

  function addSearchTag(raw){
    if (!raw) return;
    const t = normalizeTag(raw);
    if (!t) return;
    els.searchInput.value = '';
    // prefix '-' means excluded
    if (t.startsWith('-')) {
      const tag = t.slice(1);
      if (!searchState.exclude.includes(tag)) searchState.exclude.push(tag);
    } else {
      if (!searchState.include.includes(t)) searchState.include.push(t);
    }
    updateSearchChips();
    // Do not auto-run search; user will press the Search button.
  }

  function performSearch(){
    // Switch to Search tab and run a new query
    if (activeTab !== 'search') switchTab('search');
    searchPid = 0; reachedEnd = false; seen.clear();
    clearFeed();
    loadNext();
  }

  function removeSearchTag(tag, wasExcluded){
    if (wasExcluded) searchState.exclude = searchState.exclude.filter(x => x !== tag);
    else searchState.include = searchState.include.filter(x => x !== tag);
    updateSearchChips();
    searchPid = 0; reachedEnd = false; clearFeed(); loadNext();
  }

  function toggleSearchTag(tag, wasExcluded){
    removeSearchTag(tag, wasExcluded);
    addSearchTag(wasExcluded ? tag : ('-' + tag));
  }

  function updateSearchChips(){
    renderChipsFix(els.tagChips, searchState.include, searchState.exclude, {
      onToggle: toggleSearchTag,
      onRemove: removeSearchTag,
    });
  }

  function normalizeTag(s){
    return s.trim().toLowerCase().replace(/\s+/g, '_');
  }

  async function onAutocomplete(){
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
    } catch (e) {
      // likely CORS
      els.autocomplete.hidden = true;
    }
  }

  // ---------- Feed loading ----------
  async function loadNext(){
    loading = true; showSkeletons();
    try {
      if (activeTab === 'search') {
        const tags = composeTags(searchState.include, searchState.exclude);
        const data = await API.posts({ tags, limit: settings.perPage, pid: searchPid });
        const posts = sanitizePosts(data);
        const added = renderPosts(posts);
        if (added === 0) {
          // If no new cards, advance pid and try once more.
          const had = Array.isArray(posts) ? posts.length : 0;
          searchPid++;
          const d2 = await API.posts({ tags, limit: settings.perPage, pid: searchPid });
          const p2 = sanitizePosts(d2);
          const a2 = renderPosts(p2);
          if (a2 === 0) {
            // Only declare end if the second page contains zero items.
            if (Array.isArray(p2) && p2.length === 0) {
              reachedEnd = true;
              if (!els.feed.querySelector('.feed-end.msg')){
                const m = document.createElement('div');
                m.className = 'feed-end msg';
                m.textContent = 'No results for these tags.';
                els.feed.appendChild(m);
              }
            }
          } else {
            searchPid++;
          }
        } else {
          searchPid++;
        }
      } else if (activeTab === 'home') {
        if (!groups.length) { reachedEnd = true; return; }
        // Fetch a small page per group, then interleave for variety
        const perGroup = Math.max(2, Math.ceil(settings.perPage / Math.max(1, groups.length)));
        const buckets = [];
        let anyFetched = false;
        for (const g of groups){
          if (home.exhausted[g.id]) continue;
          const pid = home.pids[g.id] || 0;
          const tags = composeTags(g.include||[], g.exclude||[]);
          try{
            const data = await API.posts({ tags, limit: perGroup, pid });
            const posts = sanitizePosts(data);
            if (!Array.isArray(posts) || posts.length === 0){ home.exhausted[g.id] = true; continue; }
            anyFetched = true;
            home.pids[g.id] = pid + 1;
            // Shuffle within the group for extra randomness
            const arr = posts.slice();
            for (let i = arr.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
            buckets.push(arr);
          }catch{}
        }
        // Round-robin interleave
        const merged = [];
        let idx = 0;
        while (merged.length < settings.perPage){
          let pushed = false;
          for (const b of buckets){
            if (b[idx]){ merged.push(b[idx]); pushed = true; if (merged.length >= settings.perPage) break; }
          }
          if (!pushed) break; // all buckets exhausted at this index
          idx++;
        }
        const added = renderPosts(merged);
        if (!anyFetched || added === 0){ reachedEnd = true; }
      }
    } catch (e) {
      console.warn('Load error', e);
      if (!els.feed.querySelector('.error')){
        const d = document.createElement('div');
        d.className = 'feed-end error';
        const msg = String(e?.message||'').toLowerCase();
        if (msg.includes('missing authentication')) {
          d.innerHTML = 'Missing authentication. Enter your Rule34 user ID and API key in Settings → API.';
        } else {
          d.innerHTML = 'Could not load posts. Set a CORS proxy and/or API credentials in Settings.';
        }
        els.feed.appendChild(d);
      }
      reachedEnd = true;
    } finally {
      hideSkeletons();
      els.feedEnd.hidden = !reachedEnd;
      loading = false;
    }
  }

  function composeTags(include, exclude){
    const extra = [];
    if (filters.excludeAI) extra.push('ai_generated','stable_diffusion','novelai','midjourney');
    if (filters.excludeScat) extra.push('scat','coprophagia','feces');
    if (filters.excludeShota) extra.push('loli', 'shota')
    if (Array.isArray(filters.customExclude) && filters.customExclude.length) extra.push(...filters.customExclude);

    const ex = [...new Set([ ...exclude, ...extra ])];
    let inc = [...new Set(include)];
    // Avoid negative-only queries (some engines return zero for that). Anchor with a neutral meta.
    if (inc.length === 0) inc = ['id:>0'];
    const tags = [...inc, ...ex.map(t => '-' + t)].join(' ');
    return tags;
  }

  function sanitizePosts(data){
    if (data && typeof data === 'object' && data.success === false) {
      const msg = data.message || 'API error';
      throw new Error(msg);
    }
    const arr = Array.isArray(data) ? data : (data?.post ? [].concat(data.post) : []);
    return arr.filter(p => p && p.file_url && p.id).map(p => ({
      id: String(p.id),
      file_url: p.file_url,
      sample_url: p.sample_url || p.file_url,
      preview_url: p.preview_url || p.sample_url || p.file_url,
      file_ext: p.file_ext || (p.file_url.split('.').pop() || '').toLowerCase(),
      width: Number(p.width)||0,
      height: Number(p.height)||0,
      rating: p.rating || 'q',
      tags: (p.tags||'').trim(),
      owner: p.owner || '',
      created_at: p.created_at || p.change || '',
      source: p.source || '',
    }));
  }

  function showSkeletons(count = Math.max(4, Math.min(12, settings.perPage/2))){
    const frag = document.createDocumentFragment();
    for (let i=0;i<count;i++){
      const card = document.createElement('article');
      card.className = 'post-card skeleton';
      card.style.height = (160 + (i%5)*20) + 'px';
      frag.appendChild(card);
    }
    els.feed.appendChild(frag);
  }
  function hideSkeletons(){
    $$('.post-card.skeleton', els.feed).forEach(n => n.remove());
  }

  function renderPosts(posts){
    if (!Array.isArray(posts) || !posts.length) return 0;
    const frag = document.createDocumentFragment();
    let added = 0;
    for (const p of posts){
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      frag.appendChild(postCard(p));
      added++;
    }
    els.feed.appendChild(frag);
    return added;
  }

  function postCard(p){
    const isVideo = ['mp4','webm'].includes(p.file_ext);
    const art = document.createElement('article');
    art.className = 'post-card';
    art.dataset.id = p.id;
    art.innerHTML = `
      <div class="post-media" data-id="${p.id}">
        <div class="like-heart">❤</div>
        ${isVideo ? `<video preload="metadata" playsinline muted controls poster="${escapeHtml(p.preview_url || p.sample_url || '')}" src="${escapeHtml(p.file_url)}"></video>`
                   : `<img loading="lazy" src="${escapeHtml(p.sample_url || p.file_url)}" alt="post" />`}
      </div>
      <div class="post-meta">
        <div class="left">
          <button class="icon-btn fav ${favSet.has(p.id)?'active':''}" title="Favorite">❤</button>
          <button class="icon-btn" data-act="tags" title="View tags">🏷</button>
        </div>
        <div class="right">
          <a class="icon-btn" href="${escapeHtml(p.file_url)}" download title="Download">⬇</a>
        </div>
      </div>`;

    // Polish action layout/text
    const likeIcon = $('.like-heart', art); if (likeIcon) likeIcon.textContent = '❤';
    const leftBox = $('.post-meta .left', art);
    const rightBox = $('.post-meta .right', art);
    const dlLink = $('a[download]', art);
    const media = $('.post-media', art);
    const heart = $('.like-heart', media);
    const favBtn = $('.fav', art);
    const tagsBtn = $('[data-act="tags"]', art);
    const video = $('video', media);
    if (favBtn) favBtn.textContent = 'Favorite';
    if (dlLink) {
      dlLink.textContent = 'Download';
      dlLink.target = '_blank';
      dlLink.rel = 'noopener noreferrer';
      if (leftBox) leftBox.appendChild(dlLink);
    }
    if (tagsBtn) { tagsBtn.textContent = 'View tags'; if (rightBox) rightBox.appendChild(tagsBtn); }

    // Double-tap/double-click like with polished FX
    let lastTap = 0, pressTimer;
    const showLikeFX = (added) => {
      const mediaEl = heart.parentElement;
      if (!mediaEl) return;
      heart.classList.remove('added','removed');
      heart.classList.add(added ? 'added' : 'removed');
      mediaEl.classList.add('show-like');
      if (added){
        const ring = document.createElement('span'); ring.className = 'like-ring'; mediaEl.appendChild(ring);
        const burst = document.createElement('span'); burst.className = 'like-burst';
        for (let i=0;i<8;i++){ const dot = document.createElement('i'); burst.appendChild(dot); }
        mediaEl.appendChild(burst);
        setTimeout(() => { ring.remove(); burst.remove(); }, 900);
      }
      setTimeout(() => mediaEl && mediaEl.classList.remove('show-like'), 900);
    };
    const toggleLike = () => {
      const nowFav = toggleFavorite(p);
      showLikeFX(nowFav);
      if (favBtn){ favBtn.classList.add('pulse'); setTimeout(()=>favBtn.classList.remove('pulse'), 480); }
    };
    if (!isTouch) {
      media.addEventListener('dblclick', (e) => { e.preventDefault(); toggleLike(); });
    }
    // Disable double-tap to favorite on videos; allow on images only
    if (!isVideo) {
      media.addEventListener('touchend', (e) => {
        const now = Date.now();
        if (now - lastTap < settings.doubleTapMs) { e.preventDefault(); toggleLike(); lastTap = 0; }
        else lastTap = now;
      }, { passive: true });
    }

    // Long-press context menu removed per request

    // Favorite button (with subtle pulse)
    favBtn.addEventListener('click', () => { const nowFav = toggleFavorite(p); favBtn.classList.add('pulse'); setTimeout(()=>favBtn.classList.remove('pulse'), 480); });

    // Tags button
    tagsBtn.addEventListener('click', () => showTagsOverlay(p));

    // Video controls: click to toggle play
    if (video){
      video.addEventListener('click', () => { if (video.paused) video.play().catch(()=>{}); else video.pause(); });
      // pause when leaving viewport
      const vis = new IntersectionObserver(entries => {
        entries.forEach(e => { if (!e.isIntersecting) video.pause(); });
      }, { rootMargin: '200px' });
      vis.observe(video);
    }

    return art;
  }

  // ---------- Favorites ----------
  function toggleFavorite(p){
    let nowFav;
    if (favSet.has(p.id)) {
      favSet.delete(p.id);
      favorites.ids = favorites.ids.filter(id => id !== p.id);
      delete favorites.map[p.id];
      haptic(15);
      nowFav = false;
    } else {
      favSet.add(p.id);
      favorites.ids.unshift(p.id);
      favorites.map[p.id] = p;
      haptic(35);
      nowFav = true;
    }
    saveLS(LS.favorites, favorites);
    // Update any visible card
    $$('.post-card').forEach(c => {
      if (c.dataset.id === p.id) $('.fav', c)?.classList.toggle('active', favSet.has(p.id));
    });
    return nowFav;
  }

  function renderFavorites(){
    clearFeed();
    if (!favorites.ids.length){ renderEmptyState('No favorites yet. Double-tap or click ❤ to add.'); return; }
    const posts = favorites.ids.map(id => favorites.map[id]).filter(Boolean);
    renderPosts(posts);
    reachedEnd = true;
  }

  // ---------- Overlays ----------
  async function showTagsOverlay(p){
    els.tagsOverlay.hidden = false;
    els.tagsBody.innerHTML = '<div class="note" style="padding:12px">Loading tags…</div>';
    // Avoid body scroll lock here to prevent jumping to top
    const tags = (p.tags||'').split(/\s+/).filter(Boolean);
    try{
      // attempt to fetch categories for first N tags
      const N = Math.min(25, tags.length);
      const metas = await Promise.allSettled(tags.slice(0,N).map(t => API.tagMeta(t)));
      const typeMap = new Map(); // tag -> type
      metas.forEach((res, idx) => {
        if (res.status !== 'fulfilled') return;
        const v = res.value;
        const arr = Array.isArray(v) ? v : (Array.isArray(v?.tag) ? v.tag : []);
        if (!arr.length) return;
        const nameKey = tags[idx].toLowerCase();
        const obj = arr.find(o => String(o.name||'').toLowerCase() === nameKey) || arr[0];
        const typeNum = Number(obj?.type);
        if (Number.isFinite(typeNum)) typeMap.set(tags[idx], typeNum);
      });
      const groups = {
        'General': [], 'Artists': [], 'Characters': [], 'Copyrights': [], 'Meta': []
      };
      for (const t of tags){
        const ty = typeMap.get(t);
        if (ty === 1) groups['Artists'].push(t);
        else if (ty === 4) groups['Characters'].push(t);
        else if (ty === 3) groups['Copyrights'].push(t);
        else if (ty === 5) groups['Meta'].push(t);
        else groups['General'].push(t);
      }
      const frag = document.createDocumentFragment();
      for (const [name, arr] of Object.entries(groups)){
        if (!arr.length) continue;
        const sec = document.createElement('div');
        sec.innerHTML = `<h4 style="margin:8px 0 6px 0">${name}</h4>`;
        const chips = document.createElement('div'); chips.className = 'chips small';
        for (const t of arr){
          const c = document.createElement('span'); c.className = 'chip';
          c.innerHTML = `<span class="t">${escapeHtml(t)}</span><span class="x" title="Add">＋</span>`;
          c.title = 'Add to search';
          c.addEventListener('click', () => addSearchTag(t));
          chips.appendChild(c);
        }
        // Color-code chips and fix add indicator
        try{
          const cls = name === 'Meta' ? 'tag-meta' : name === 'Characters' ? 'tag-character' : name === 'Copyrights' ? 'tag-copyright' : name === 'Artists' ? 'tag-artist' : 'tag-general';
          chips.querySelectorAll('.chip').forEach(ch => { ch.classList.add(cls); const x = ch.querySelector('.x'); if (x) x.textContent = '+'; });
        }catch{}
        sec.appendChild(chips);
        frag.appendChild(sec);
      }
      els.tagsBody.innerHTML = '';
      els.tagsBody.appendChild(frag);
    }catch(e){
      els.tagsBody.innerHTML = `<div class="note" style="padding:12px">${escapeHtml(p.tags||'No tags')}</div>`;
    }
  }
  function hideTagsOverlay(){ els.tagsOverlay.hidden = true; }

  // Ensure overlay close also restores body scroll
  function hideOverlay(){
    if (els.overlay) els.overlay.hidden = true;
    document.documentElement.classList.remove('no-scroll');
    document.body.classList.remove('no-scroll');
  }

  // Enable drag-to-close for bottom sheets via the grab handle (with kinetic close)
  function enableSheetDrag(overlayEl, onClose){
    if (!overlayEl) return;
    const grab = overlayEl.querySelector('.grab');
    const sheet = overlayEl.querySelector('.sheet');
    if (!grab || !sheet) return;
    let startY = 0; let dragging = false; let dy = 0;
    let lastY = 0; let lastT = 0; let velocity = 0;
    const start = (e) => {
      dragging = true; dy = 0;
      startY = (e.touches ? e.touches[0].clientY : e.clientY) || 0;
      lastY = startY; lastT = performance.now(); velocity = 0;
      sheet.style.transition = 'none';
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('touchmove', move, { passive:false });
      window.addEventListener('touchend', end);
    };
    const move = (e) => {
      if (!dragging) return;
      const y = (e.touches ? e.touches[0].clientY : e.clientY) || 0;
      dy = Math.max(0, y - startY);
      const now = performance.now();
      const dt = Math.max(1, now - lastT);
      velocity = (y - lastY) / dt; // px per ms
      lastY = y; lastT = now;
      sheet.style.transform = `translateY(${dy}px)`;
      if (e.cancelable) e.preventDefault();
    };
    const end = () => {
      if (!dragging) return;
      dragging = false;
      const shouldClose = dy > 120 || velocity > 0.7; // close if dragged far or released quickly
      sheet.style.transition = 'transform .22s ease-out';
      if (shouldClose) {
        sheet.style.transform = 'translateY(100%)';
        setTimeout(()=>{ onClose(); sheet.style.transition = ''; sheet.style.transform = 'translateY(0)'; }, 220);
      } else {
        sheet.style.transform = 'translateY(0)';
        setTimeout(()=>{ sheet.style.transition = ''; }, 220);
      }
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', end);
    };
    grab.addEventListener('pointerdown', start);
    grab.addEventListener('touchstart', start, { passive:true });
  }

  // ---------- Settings overlay ----------
  function showSettings(){
    renderSettings();
    els.settingsOverlay.hidden = false;
    lockScroll();
  }
  function hideSettings(){
    els.settingsOverlay.hidden = true;
    unlockScroll();
  }

  // ---------- Scroll UI ----------
  function onScroll(){
    const y = window.scrollY || window.pageYOffset;
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const pct = clamp(y / max, 0, 1);
    els.scrollProgress.style.width = (pct*100).toFixed(1) + '%';
    const dir = y > lastScrollY ? 1 : (y < lastScrollY ? -1 : direction);
    const showThreshold = 1200;
    const nearTop = y < 200;
    // Show when user scrolls up past threshold; hide when scrolling down or near top
    if (dir < 0 && y > showThreshold) { showToTopBtn(); }
    if (dir > 0 || nearTop) { hideToTopBtn(); }
    direction = dir;
    lastScrollY = y;
  }

  // Animated show/hide for the Back-to-top button
  function showToTopBtn(){
    const b = els.toTop; if (!b) return;
    if (b.classList.contains('visible')) return;
    if (b.hidden) { b.hidden = false; void b.offsetWidth; } // force reflow to enable transition
    b.classList.add('visible');
  }
  function hideToTopBtn(){
    const b = els.toTop; if (!b) return;
    if (!b.classList.contains('visible')) { b.hidden = true; return; }
    b.classList.remove('visible');
    const onEnd = () => {
      // Only hide if it wasn't shown again mid-transition
      if (!b.classList.contains('visible')) { b.hidden = true; }
      b.removeEventListener('transitionend', onEnd);
    };
    b.addEventListener('transitionend', onEnd);
  }

  // ---------- Settings ----------
  function renderSettings(){
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
    $('#opt-accent').value = settings.accent;
    $('#opt-accent').addEventListener('input', (e)=>{
      settings.accent = e.target.value; saveLS(LS.settings, settings); applyTheme();
    });

    $('#f-ai').checked = !!filters.excludeAI;
    $('#f-scat').checked = !!filters.excludeScat;
    $('#f-shota').checked = !!filters.excludeShota;

    $('#f-ai').addEventListener('change', (e)=>{ filters.excludeAI = !!e.target.checked; saveLS(LS.filters, filters); });
    $('#f-scat').addEventListener('change', (e)=>{ filters.excludeScat = !!e.target.checked; saveLS(LS.filters, filters); });
    $('#f-shota').addEventListener('change', (e)=>{ filters.excludeShota = !!e.target.checked; saveLS(LS.filters, filters); });

    // Show filter tag lists in codeboxes
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
      customList.innerHTML = arr.length ? arr.map(t => `<span class="code-tag">-${escapeHtml(t)}<span class="x" title="Remove" data-t="${escapeHtml(t)}">✕</span></span>`).join(' ') : '<span class="note">No custom exclusions</span>';
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
      groups = groups.filter(x => x.id !== g.id); saveLS(LS.groups, groups); renderSettings();
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

    // Collapsible behavior for compactness
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

  // Clean chip renderer (safe ASCII chars)
  function renderChipsFix(root, include, exclude, { onToggle, onRemove } = {}){
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
      c.addEventListener('pointerdown', () => { pressT = setTimeout(() => onRemove && onRemove(tag, excluded), settings.longPressMs); });
      c.addEventListener('pointerup', () => clearTimeout(pressT));
      x.addEventListener('click', () => onRemove && onRemove(tag, excluded));
      return c;
    }
  }

  function onCopy(){
    try {
      const data = { settings, groups, favorites, filters, v: 1 };
      const json = JSON.stringify(data, null, 2);
      const msg = document.querySelector('#data-msg');

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(json)
          .then(() => {
            if (msg){
              msg.textContent = 'Copied data to clipboard.';
              clearTimeout(dataMsgTimer);
              dataMsgTimer = setTimeout(() => { msg.textContent = ''; }, 3500);
            }
          })
          .catch(() => {
            if (msg){
              msg.textContent = 'Copy failed. Using Export instead.';
              clearTimeout(dataMsgTimer);
              dataMsgTimer = setTimeout(() => { msg.textContent = ''; }, 3500);
            }
            try { onExport(); } catch {}
          });
      } else {
        // Fallback: try execCommand, otherwise trigger download via Export
        const ta = document.createElement('textarea');
        ta.value = json; ta.setAttribute('readonly', ''); ta.style.position = 'absolute'; ta.style.left = '-9999px';
        document.body.appendChild(ta); ta.select();
        let ok = false; try { ok = document.execCommand('copy'); } catch {}
        document.body.removeChild(ta);
        if (ok) {
          if (msg){
            msg.textContent = 'Copied data to clipboard.';
            clearTimeout(dataMsgTimer);
            dataMsgTimer = setTimeout(() => { msg.textContent = ''; }, 3500);
          }
        }
        else {
          if (msg){
            msg.textContent = 'Copy unsupported. Using Export instead.';
            clearTimeout(dataMsgTimer);
            dataMsgTimer = setTimeout(() => { msg.textContent = ''; }, 3500);
          }
          try { onExport(); } catch {}
        }
      }
    } catch (e) {
      try { alert('Copy failed: ' + (e?.message || 'Unknown error')); } catch {}
    }
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
        if (data.settings) { settings = { ...DEFAULTS.settings, ...data.settings }; saveLS(LS.settings, settings); }
        if (Array.isArray(data.groups)) { groups = data.groups; saveLS(LS.groups, groups); }
        if (data.favorites) { favorites = data.favorites; saveLS(LS.favorites, favorites); favSet.clear(); favorites.ids.forEach(id=>favSet.add(id)); }
        if (data.filters) { filters = { ...DEFAULTS.filters, ...data.filters }; saveLS(LS.filters, filters); }
        alert('Import complete.');
        renderSettings();
      }catch(err){ alert('Import failed: ' + (err?.message||'')); }
    };
    reader.readAsText(f);
  }

  function onReset(){
    if (!confirm('Reset all data? This cannot be undone.')) return;
    localStorage.removeItem(LS.settings);
    localStorage.removeItem(LS.groups);
    localStorage.removeItem(LS.favorites);
    localStorage.removeItem(LS.filters);
    settings = loadLS(LS.settings, DEFAULTS.settings);
    filters = loadLS(LS.filters, DEFAULTS.filters);
    groups = loadLS(LS.groups, DEFAULTS.groups);
    favorites = loadLS(LS.favorites, DEFAULTS.favorites);
    favSet.clear();
    alert('Data reset.');
    renderSettings();
  }

  async function renderAnalytics(){
    const a = $('#analytics');
    if (!a) return;
    a.innerHTML = '<div class="analytics-loading" role="status" aria-live="polite">'
      + '<span class="spinner" aria-hidden="true"></span>'
      + '<span class="msg">Loading analytics…</span>'
      + '</div>';
    const msgEl = a.querySelector('.msg');
    const favPosts = favorites.ids.map(id => favorites.map[id]).filter(Boolean);
    const favCount = favPosts.length;
    const groupCount = groups.length;
    if (msgEl) msgEl.textContent = 'Summarizing favorites…';
    const uniqueTagsCount = countUniqueTags(favPosts);

    // Top tags (bar list)
    const topTags = topTagsFromFavorites(8);
    const maxTagCount = topTags.length ? topTags[0][1] : 1;
    const bars = topTags.map(([t,c]) => `
      <div class="row"><div class="label" title="${escapeHtml(t)}">${escapeHtml(t)}</div>
        <div class="bar"><div class="fill" style="width:${(c/maxTagCount*100).toFixed(1)}%"></div></div>
        <div class="val">${c}</div></div>`).join('');

    // Top artists (bar list) — same style as Top tags but filtered to artist tags
    if (msgEl) msgEl.textContent = 'Resolving tag types…';
    const topTagsAll = topTagsFromFavorites(100);
    const typeMap = await mapTagTypes(topTagsAll.map(([t]) => t), 6).catch(()=>new Map());
    const artistOnly = topTagsAll.filter(([t]) => typeMap.get(t) === 1).slice(0, 8);
    const maxArtist = artistOnly.length ? artistOnly[0][1] : 1;
    const artistBars = artistOnly.map(([t,c]) => `
      <div class="row"><div class="label" title="${escapeHtml(t)}">${escapeHtml(t)}</div>
        <div class="bar"><div class="fill" style="width:${(c/maxArtist*100).toFixed(1)}%"></div></div>
        <div class="val">${c}</div></div>`).join('');

    // Activity sparkline (per month, last 12 months)
    if (msgEl) msgEl.textContent = 'Rendering charts…';
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

  async function fetchText(url){
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15000);
    try {
      const res = await fetch(url, { signal: ctl.signal, headers: { 'Accept': 'application/xml,text/xml;q=0.9,*/*;q=0.8' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } finally { clearTimeout(t); }
  }

  function parseTagXML(xml){
    try{
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      const nodes = Array.from(doc.getElementsByTagName('tag'));
      return nodes.map(n => ({
        name: String(n.getAttribute('name')||''),
        type: Number(n.getAttribute('type')||'0'),
        id: Number(n.getAttribute('id')||'0'),
        ambiguous: String(n.getAttribute('ambiguous')||'false') === 'true',
        count: Number(n.getAttribute('count')||'0'),
      }));
    }catch{ return []; }
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

  function countRatings(posts){
    const r = { s:0, q:0, e:0 };
    for (const p of posts){ const k = (p.rating||'q')[0]; if (k==='s'||k==='q'||k==='e') r[k]++; }
    return r;
  }

  function countMediaTypes(posts){
    const vids = new Set(['mp4','webm']);
    let images = 0, videos = 0;
    for (const p of posts){
      const ext = ((p.file_ext || (p.file_url||'').split('.').pop() || '')+'').toLowerCase();
      if (vids.has(ext)) videos++; else images++;
    }
    return { images, videos };
  }

  // Resolve tag types for a list of tag names with limited concurrency
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
    return arr; // format YYYY-MM
  }

  function parseMonth(s){
    // Try to parse created_at to YYYY-MM; fall back to empty
    const d = new Date(s);
    if (!isNaN(d)) return d.toISOString().slice(0,7);
    // some posts may have numeric change timestamp
    const n = Number(s); if (!isNaN(n)){ const d2 = new Date(n*1000); if (!isNaN(d2)) return d2.toISOString().slice(0,7); }
    return '';
  }

  function favoritesPerMonth(posts, month){
    let c = 0; for (const p of posts){ const m = parseMonth(p.created_at || p.change || ''); if (m===month) c++; }
    return c;
  }

  function sparkline(values){
    if (!values.length) return '<div class="note">No data</div>';
    const w = 260, h = 60, pad = 4;
    const max = Math.max(1, ...values);
    const step = (w - pad*2) / (values.length - 1 || 1);
    const points = values.map((v,i) => {
      const x = pad + i*step;
      const y = h - pad - (v/max)*(h - pad*2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return `<svg viewBox="0 0 ${w} ${h}"><polyline class="axis" points="${pad},${h-pad} ${w-pad},${h-pad}"/><polyline class="line" points="${points}"/></svg>`;
  }

  function donutChart(pairs, colors){
    const total = pairs.reduce((a,[,v]) => a+v, 0) || 1;
    const r = 24, R = 36, cx = 60, cy = 60; // inner/outer radii, center
    let a0 = -Math.PI/2; // start at top
    const segs = [];
    for(let i=0;i<pairs.length;i++){
      const label = pairs[i][0]; const val = pairs[i][1];
      const frac = val/total; const a1 = a0 + frac*2*Math.PI;
      // SVG arc path
      const p0 = [cx + R*Math.cos(a0), cy + R*Math.sin(a0)];
      const p1 = [cx + R*Math.cos(a1), cy + R*Math.sin(a1)];
      const p2 = [cx + r*Math.cos(a1), cy + r*Math.sin(a1)];
      const p3 = [cx + r*Math.cos(a0), cy + r*Math.sin(a0)];
      const large = (a1 - a0) > Math.PI ? 1 : 0;
      const path = `M ${p0[0].toFixed(1)} ${p0[1].toFixed(1)} A ${R} ${R} 0 ${large} 1 ${p1[0].toFixed(1)} ${p1[1].toFixed(1)} L ${p2[0].toFixed(1)} ${p2[1].toFixed(1)} A ${r} ${r} 0 ${large} 0 ${p3[0].toFixed(1)} ${p3[1].toFixed(1)} Z`;
      segs.push(`<path d="${path}" fill="${colors[i%colors.length]}" opacity="${total?1:0}" />`);
      a0 = a1;
    }
    const legend = pairs.map((p,i) => `<div class="item"><span class="swatch" style="background:${colors[i%colors.length]}"></span>${p[0]} — ${p[1]}</div>`).join('');
    return `<div class="donut"><svg viewBox="0 0 120 120">${segs.join('')}</svg><div class="legend">${legend}</div></div>`;
  }

  // ---------- Boot ----------
  init();
})();


