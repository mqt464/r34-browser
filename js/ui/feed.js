import { $, $$, clamp, escapeHtml, isTouch, haptic } from '../core/utils.js?v=20250922';
import { API, fetchText } from '../core/api.js?v=20250922';
import { LS, saveLS, settings, filters, groups, favorites, favSet, session } from '../core/state.js?v=20250922';
import { getSearchState, addSearchTag, removeSearchTag, toggleSearchTag } from './search.js?v=20250922';

let els;
let masonryCols = [];

let activeTab = null;
let searchPid = 0; // pagination
let loading = false;
let reachedEnd = false;
let direction = 1; // 1 down, -1 up
let lastScrollY = 0;
let seen = new Set(); // dedupe posts in feed
// Scroll deltas to debounce slight up/down jiggles
let upDelta = 0;
let downDelta = 0;
let rbEnrichIO = null;
// Basic UA check for iOS Safari constraints (webm unsupported, stricter cross-origin media)
const IS_IOS = (()=>{ try{ return /iphone|ipad|ipod/.test((navigator.userAgent||'').toLowerCase()); }catch{ return false; } })();

// Limit concurrent RealBooru enrich tasks to avoid bursts
const ENRICH_MAX = 4;
let enrichInFlight = 0;
const enrichQueue = [];
function withEnrichLimit(fn){
  const run = () => {
    if (enrichInFlight >= ENRICH_MAX) return;
    const task = enrichQueue.shift();
    if (!task) return;
    enrichInFlight++;
    Promise.resolve(task())
      .catch(()=>{})
      .finally(()=>{
        enrichInFlight--;
        run();
      });
  };
  enrichQueue.push(fn);
  run();
}

// Home aggregator state
let home = {
  round: 0,
  pids: {}, // groupId -> pid number
  exhausted: {}, // groupId -> bool
};

export function initFeed(domRefs){
  els = domRefs;

  // Tabs handled in main via switchTab

  // Infinite scroll
  const io = new IntersectionObserver(async (entries) => {
    for (const e of entries) {
      if (e.isIntersecting && !loading && !reachedEnd) {
        await loadNext();
      }
    }
  }, { rootMargin: '800px 0px 800px 0px' });
  io.observe(els.sentinel);

  // Scroll UI
  window.addEventListener('scroll', onScroll, { passive: true });
  els.toTop.addEventListener('click', () => window.scrollTo({ top:0, behavior:'smooth' }));

  // Keep tab underline positioned on resize
  window.addEventListener('resize', () => updateTabUnderline());

  // Overlay: tags
  els.tagsClose.addEventListener('click', () => hideTagsOverlay());
  els.tagsOverlay.addEventListener('click', (e) => { if (e.target === els.tagsOverlay) hideTagsOverlay(); });

  // Initial layout
  applyTheme();
  applyColumns();
  // Position underline for initial tab after main calls switchTab
  setTimeout(() => updateTabUnderline(), 0);

  // Observer to enrich RealBooru cards with actual media when visible
  try{
    rbEnrichIO = new IntersectionObserver((entries) => {
      for (const e of entries){
        if (e.isIntersecting){
          const el = e.target; rbEnrichIO.unobserve(el);
          withEnrichLimit(() => enrichRealBooruCard(el));
        }
      }
    }, { rootMargin: '200px' });
  }catch{}
}

export function getActiveTab(){ return activeTab; }

export function applyTheme(){
  const theme = settings.theme;
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  document.documentElement.style.setProperty('--accent', settings.accent);
}
export function applyColumns(){
  const cols = clamp(Number(settings.columns||1),1,4);
  els.feed.dataset.columns = String(cols);
  els.feed.classList.toggle('single', cols === 1);
  els.feed.classList.toggle('masonry', cols > 1);
  try{ els.feed.style.setProperty('--cols', String(cols)); }catch{}
  ensureMasonryStructure();
}

export function switchTab(name){
  if (activeTab === name) return;
  activeTab = name;
  els.tabs.forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  updateTabUnderline();
  // Close overlays on tab change
  hideTagsOverlay();

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
    const st = getSearchState();
    if ((st.include||[]).length || (st.exclude||[]).length) loadNext();
    else renderEmptyState('Add tags above to start a search.');
  }
}

function updateTabUnderline(){
  try{
    const bar = els?.tabbar; if (!bar) return;
    const btn = Array.from(els?.tabs||[]).find(b => b.classList.contains('active'));
    if (!btn) return;
    const br = bar.getBoundingClientRect();
    const ar = btn.getBoundingClientRect();
    const left = Math.max(0, ar.left - br.left);
    const width = Math.max(0, ar.width);
    bar.style.setProperty('--tab-underline-x', left + 'px');
    bar.style.setProperty('--tab-underline-w', width + 'px');
  }catch{}
}

export function resetSearchPagination(){ searchPid = 0; reachedEnd = false; seen.clear(); }

export function clearFeed(){
  els.feed.innerHTML = '';
  masonryCols = [];
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

export async function loadNext(){
  loading = true; showSkeletons();
  try {
    if (activeTab === 'search') {
      const st = getSearchState();
      // Build include tags with optional sort and score filters
      const inc = Array.isArray(st.include) ? st.include.slice() : [];
      const exc = Array.isArray(st.exclude) ? st.exclude.slice() : [];
      // Min score filter
      try{
        const min = Number(st.minScore||0);
        if (Number.isFinite(min) && min > 0) inc.push(`score:>=${Math.floor(min)}`);
      }catch{}
      // Provider-specific sort tokens
      try{
        const s = String(st.sort||'default');
        const prov = String((session?.providerOverride) || (settings?.provider) || 'rule34');
        if (prov === 'rule34'){
          if (s === 'new') inc.push('sort:id');
          else if (s === 'old') inc.push('sort:id_asc');
          else if (s === 'score_desc') inc.push('sort:score');
          else if (s === 'score_asc') inc.push('sort:score_asc');
          else if (s === 'random') inc.push('sort:random');
        } else {
          // Conservative: only pass random to other providers (e.g., RealBooru)
          if (s === 'random') inc.push('sort:random');
        }
      }catch{}
      const tags = composeTags(inc, exc);
      const data = await API.posts({ tags, limit: settings.perPage, pid: searchPid, provider: (session.providerOverride || settings.provider || 'rule34') });
      const posts = sanitizePosts(data);
      const added = renderPosts(posts);
      if (added === 0) {
        searchPid++;
        const d2 = await API.posts({ tags, limit: settings.perPage, pid: searchPid, provider: (session.providerOverride || settings.provider || 'rule34') });
        const p2 = sanitizePosts(d2);
        const a2 = renderPosts(p2);
        if (a2 === 0) {
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
      const perGroup = Math.max(2, Math.ceil(settings.perPage / Math.max(1, groups.length)));
      const buckets = [];
      let anyFetched = false;
      for (const g of groups){
        if (home.exhausted[g.id]) continue;
        const pid = home.pids[g.id] || 0;
        const tags = composeTags(g.include||[], g.exclude||[]);
        try{
          const data = await API.posts({ tags, limit: perGroup, pid, provider: g.provider || 'rule34' });
          const posts = sanitizePosts(data);
          if (!Array.isArray(posts) || posts.length === 0){ home.exhausted[g.id] = true; continue; }
          anyFetched = true;
          home.pids[g.id] = pid + 1;
          const arr = posts.slice();
          for (let i = arr.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
          buckets.push(arr);
        }catch{}
      }
      const merged = [];
      let idx = 0;
      while (merged.length < settings.perPage){
        let pushed = false;
        for (const b of buckets){
          if (b[idx]){ merged.push(b[idx]); pushed = true; if (merged.length >= settings.perPage) break; }
        }
        if (!pushed) break;
        idx++;
      }
      const added = renderPosts(merged);
      if (!anyFetched || added === 0){ reachedEnd = true; }
    } else if (activeTab === 'favorites') {
      // no-op; favorites render in switchTab
    }
  } catch (e) {
    console.warn('Load error', e);
    if (!els.feed.querySelector('.error')){
      const d = document.createElement('div');
      d.className = 'feed-end error';
      const msg = String(e?.message||'').toLowerCase();
      if (msg.includes('missing authentication')) {
        d.innerHTML = 'Missing authentication. Enter your Rule34 user ID and API key in Settings \u001a API.';
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
  return arr.filter(p => p && p.file_url && p.id).map(p => {
    const hasVC = Array.isArray(p.video_candidates) && p.video_candidates.length > 0;
    const ext = String(p.file_ext || (p.file_url.split('.').pop() || '')).toLowerCase();
    return {
      id: String(p.id),
      file_url: p.file_url,
      sample_url: p.sample_url || p.file_url,
      preview_url: p.preview_url || p.sample_url || p.file_url,
      file_ext: hasVC ? 'mp4' : ext,
      width: Number(p.width)||0,
      height: Number(p.height)||0,
      rating: p.rating || 'q',
      tags: (p.tags||'').trim(),
      owner: p.owner || '',
      created_at: p.created_at || p.change || '',
      source: p.source || '',
      video_candidates: hasVC ? p.video_candidates.slice() : [],
    };
  });
}

function showSkeletons(count = Math.max(4, Math.min(12, settings.perPage/2))){
  const useMasonry = isMasonry();
  const parentTargets = useMasonry ? (masonryCols.length ? masonryCols : [els.feed]) : [els.feed];
  for (let i=0;i<count;i++){
    const art = document.createElement('article');
    art.className = 'post-card skeleton';
    // Use aspect-ratio skeletons to avoid reflow once content arrives
    const arW = [1, 4, 3, 16][i % 4];
    const arH = [1, 5, 4, 9][i % 4];
    art.innerHTML = `<div class="post-media" style="aspect-ratio: ${arW} / ${arH}"><div class="media-skel"></div></div>`;
    const target = parentTargets[i % parentTargets.length];
    target.appendChild(art);
  }
}
function hideSkeletons(){
  $$('.post-card.skeleton', els.feed).forEach(n => n.remove());
}

function renderPosts(posts){
  if (!Array.isArray(posts) || !posts.length) return 0;
  // Remove skeletons before inserting real content to minimize layout thrash
  hideSkeletons();
  let added = 0;
  for (const p of posts){
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    const card = postCard(p);
    appendCard(card);
    added++;
  }
  return added;
}

function postCard(p){
  const hasCandidates = Array.isArray(p.video_candidates) && p.video_candidates.length > 0;
  const isVideo = ['mp4','webm'].includes(p.file_ext) || hasCandidates;
  const hasMp4Candidate = hasCandidates && p.video_candidates.some(u => String(u||'').toLowerCase().endsWith('.mp4'));
  // On iOS, avoid rendering inline webm (unsupported). If no MP4 candidate is available, render as image instead.
  const extLower = String(p.file_ext||'').toLowerCase();
  const renderAsVideo = isVideo && !(IS_IOS && extLower === 'webm' && !hasMp4Candidate);
  const art = document.createElement('article');
  art.className = 'post-card';
  art.dataset.id = p.id;
  art.__post = p;
  
  const mediaStyle = (Number(p.width)>0 && Number(p.height)>0) ? `aspect-ratio: ${Number(p.width)} / ${Number(p.height)}` : 'aspect-ratio: 1 / 1';
  // Prefer proxied poster when enabled to avoid CORS/hotlink issues on Chromium
  let posterUrl = '';
  try{ posterUrl = proxyUrlIfNeeded(p.preview_url || p.sample_url || ''); }catch{}
  art.innerHTML = `
      <div class="post-media" data-id="${p.id}" style="${mediaStyle}">
        <div class="like-heart">?</div>
        ${renderAsVideo ? `<video preload="metadata" playsinline webkit-playsinline muted controls referrerpolicy="no-referrer" poster="${escapeHtml(posterUrl)}"></video>`
                   : `<img loading=\"lazy\" referrerpolicy=\"no-referrer\" src=\"${escapeHtml(p.sample_url || p.file_url)}\" alt=\"post\" />`}
        <div class="media-skel"></div>
      </div>
      <div class="post-meta">
        <div class="left">
          <button class="icon-btn fav ${favSet.has(p.id)?'active':''}" title="Favorite">?</button>
          <button class="icon-btn" data-act="tags" title="View tags">??</button>
        </div>
        <div class="right">
          <a class="icon-btn" href="${escapeHtml(p.file_url)}" download title="Download">?</a>
        </div>
      </div>`;

  const likeIcon = $('.like-heart', art); if (likeIcon) likeIcon.textContent = '?';
  const leftBox = $('.post-meta .left', art);
  const rightBox = $('.post-meta .right', art);
  const dlLink = $('a[download]', art);
  const media = $('.post-media', art);
  const imgEl = $('img', media);
  // Sync the media box aspect-ratio to the actual media once it is known
  try{
    const applyAspectFrom = (el) => {
      if (!el || !media) return;
      try{
        let w = 0, h = 0;
        if (el.tagName === 'IMG') { w = el.naturalWidth||0; h = el.naturalHeight||0; }
        else if (el.tagName === 'VIDEO') { w = el.videoWidth||0; h = el.videoHeight||0; }
        if (w > 0 && h > 0){ media.style.aspectRatio = `${w} / ${h}`; }
      }catch{}
    };
    const bindAspect = (el) => {
      if (!el) return;
      if (el.tagName === 'IMG'){
        if (el.complete && el.naturalWidth > 0) applyAspectFrom(el);
        el.addEventListener('load', () => applyAspectFrom(el));
      } else if (el.tagName === 'VIDEO'){
        if (el.readyState >= 1) applyAspectFrom(el);
        el.addEventListener('loadedmetadata', () => applyAspectFrom(el));
        try{ el.addEventListener('resize', () => applyAspectFrom(el)); }catch{}
      }
    };
    bindAspect(imgEl);
  }catch{}
  // Prefer original/high-res image upfront if we can determine it
  if (imgEl){
    try{
      const src0 = imgEl.getAttribute('src') || '';
      const ext0 = String(p?.file_ext || (p?.file_url||'').split('.').pop() || '').toLowerCase();
      const isImageFile = !!p?.file_url && !['mp4','webm'].includes(ext0);
      if (!isVideo && isImageFile && p.file_url !== src0){
        // Always prefer the provider's file_url if it is an image
        imgEl.src = proxyUrlIfNeeded(p.file_url);
      }
    }catch{}
  }
  const heart = $('.like-heart', media);
  const favBtn = $('.fav', art);
  const tagsBtn = $('[data-act="tags"]', art);
  const video = $('video', media);
  // Also bind aspect for initial video elements
  try{ if (video) { const ev = video; if (ev.readyState >= 1) { /* metadata known */ } ; ev.addEventListener('loadedmetadata', () => { try{ const w=ev.videoWidth||0, h=ev.videoHeight||0; if (w>0&&h>0) media.style.aspectRatio = `${w} / ${h}`; }catch{} }); try{ ev.addEventListener('resize', () => { try{ const w=ev.videoWidth||0, h=ev.videoHeight||0; if (w>0&&h>0) media.style.aspectRatio = `${w} / ${h}`; }catch{} }); }catch{} } }catch{}
  if (favBtn) favBtn.textContent = 'Favorite';
  if (dlLink) {
    dlLink.textContent = 'Download';
    dlLink.target = '_blank';
    dlLink.rel = 'noopener noreferrer';
    if (leftBox) leftBox.appendChild(dlLink);
    try { updateDownloadLink(art, p); } catch {}
    dlLink.addEventListener('click', async (e) => {
      try {
        const handled = await handleDownload(art, p);
        if (handled) { e.preventDefault(); e.stopPropagation(); }
      } catch {}
    });
  }
  if (tagsBtn) { tagsBtn.textContent = 'View tags'; if (rightBox) rightBox.appendChild(tagsBtn); }

  // Double-tap/double-click like FX
  let lastTap = 0;
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
  if (!isTouch) { media.addEventListener('dblclick', (e) => { e.preventDefault(); toggleLike(); }); }
  if (!renderAsVideo) {
    media.addEventListener('touchend', (e) => {
      const now = Date.now();
      if (now - lastTap < settings.doubleTapMs) { e.preventDefault(); toggleLike(); lastTap = 0; }
      else lastTap = now;
    }, { passive: true });
    // iOS + webm: clicking the tile should open the media in a new tab
    try{
      if (IS_IOS && extLower === 'webm'){
        media.style.cursor = 'pointer';
        media.addEventListener('click', (e) => {
          try{
            const a = $('a[download]', art);
            const href = a?.href || p.file_url || '';
            if (href) window.open(href, '_blank');
          }catch{}
        });
      }
    }catch{}
  }

  // Favorite button
  favBtn.addEventListener('click', () => { const nowFav = toggleFavorite(p); favBtn.classList.add('pulse'); setTimeout(()=>favBtn.classList.remove('pulse'), 480); });
  // Tags button
  tagsBtn.addEventListener('click', () => showTagsOverlay(p));

  const skel = $('.media-skel', media);
  if (video){
    // Ensure no CORS is enforced on media loads
    try { video.removeAttribute('crossorigin'); video.setAttribute('referrerpolicy','no-referrer'); } catch {}
    // On iOS, prefer mp4 candidate order
    try {
      const ua = (navigator.userAgent||'').toLowerCase();
      const isIOS = /iphone|ipad|ipod/.test(ua);
      if (isIOS && Array.isArray(p.video_candidates)){
        p.video_candidates = p.video_candidates
          .filter(u => u.toLowerCase().endsWith('.mp4'))
          .concat(p.video_candidates.filter(u => !u.toLowerCase().endsWith('.mp4')));
      }
    } catch {}

    const chooseVideoUrl = (u) => {
      try{
        // On iOS, if a CORS proxy is configured, always proxy video loads to avoid
        // stricter cross-origin media policies breaking playback.
        const hasProxy = !!String(settings?.corsProxy||'').trim();
        return (IS_IOS && hasProxy) ? proxyUrlAlways(u) : u;
      }catch{ return u; }
    };
    const setVideoSrc = () => {
      if (Array.isArray(p.video_candidates) && p.video_candidates.length){
        video.src = chooseVideoUrl(p.video_candidates[0]);
        try { p.file_url = p.video_candidates[0]; p.file_ext = (p.file_url.split('.').pop()||'').toLowerCase(); updateDownloadLink(art, p); } catch {}
        return;
      }
      if (p.file_ext === 'mp4' || p.file_ext === 'webm'){
        video.src = chooseVideoUrl(p.file_url);
        try { updateDownloadLink(art, p); } catch {}
      }
    };

    setVideoSrc();
    let vcIdx = 0;
    let vidTriedWithRef = false;
    // Remove skeleton as soon as metadata (poster) is available; also on first frame
    video.addEventListener('loadedmetadata', () => { try{ skel?.remove(); }catch{} }, { once: true });
    video.addEventListener('loadeddata', () => { try{ skel?.remove(); }catch{} }, { once: true });
    video.addEventListener('error', () => {
      // Try next candidate or fallback to image
      if (!vidTriedWithRef){
        vidTriedWithRef = true;
        try { video.setAttribute('referrerpolicy','origin-when-cross-origin'); } catch {}
        // Reattempt current source
        const cur = video.currentSrc || video.src;
        video.src = '';
        setTimeout(()=>{ video.src = cur; }, 0);
        return;
      }
      if (Array.isArray(p.video_candidates) && vcIdx < p.video_candidates.length - 1){
        vcIdx++;
        try{
          const next = p.video_candidates[vcIdx];
          video.src = chooseVideoUrl(next);
        }catch{ video.src = p.video_candidates[vcIdx]; }
      } else {
        // One last attempt: try proxied URL if media proxy is enabled
        try{
          const base = (video.currentSrc || video.src || p.file_url || '').toString();
          const prox = proxyUrlIfNeeded(base);
          if (prox && prox !== base){ video.src = prox; return; }
        }catch{}
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.referrerPolicy = 'no-referrer';
        img.src = p.sample_url || p.file_url || '';
        img.alt = 'post';
        video.replaceWith(img);
        img.addEventListener('load', () => { try{ skel?.remove(); }catch{} try{ const m = media; const w=img.naturalWidth||0, h=img.naturalHeight||0; if (m && w>0 && h>0) m.style.aspectRatio = `${w} / ${h}`; }catch{} }, { once: false });
      }
    }, { passive: true });

    video.addEventListener('click', () => {
      if (video.paused) video.play().catch(()=>{});
      else video.pause();
    });

    const vis = new IntersectionObserver(entries => {
      entries.forEach(e => { if (!e.isIntersecting) video.pause(); });
    }, { rootMargin: '200px' });
    vis.observe(video);
  }

  // If RealBooru item, schedule enrichment when visible (handles videos and images)
  try{
    const rbHint = [p?.file_url||'', p?.preview_url||'', p?.sample_url||'', p?.source||''].join(' ');
    const isRBPost = /realbooru\.com/i.test(rbHint);
    if (isRBPost && rbEnrichIO){
      rbEnrichIO.observe(art);
    }
  }catch{}

  // Image fallback chain (RealBooru upgrade + generic fallbacks)
  if (imgEl){
    try{
      const src0 = imgEl.getAttribute('src') || '';
      // If the initial image already loaded (small thumbs/samples), remove the spinner immediately
      try { if (imgEl.complete && imgEl.naturalWidth > 0) skel?.remove(); } catch {}
      const deproxy = (s) => {
        try{
          if (!s) return '';
          const str = String(s);
          const m1 = /[?&]url=([^&]+)/i.exec(str);
          if (m1) return decodeURIComponent(m1[1]);
          const m2 = /\/http\/(https?:\/\/[^\s]+)/i.exec(str);
          if (m2) return m2[1];
          return str;
        }catch{ return String(s||''); }
      };
      const srcRaw = deproxy(src0);
      const candidates = [];
      const rbHint = [srcRaw, deproxy(p?.file_url||''), deproxy(p?.preview_url||''), deproxy(p?.sample_url||'')].join(' ');
      const isRB = /realbooru\.com/i.test(rbHint);

      // RealBooru: derive full-res candidates from any known URL (samples or images)
      if (isRB){
        const tryDerive = (s) => {
          if (!s) return null;
          let m = /\/samples\/(..\/..\/)(?:sample_)?([a-f0-9]{32})\.(?:jpg|jpeg|png|gif|webp)/i.exec(s);
          if (!m) m = /\/images\/(..\/..\/)([a-f0-9]{32})\.(?:jpg|jpeg|png|gif|webp)/i.exec(s);
          if (!m) m = /\/thumbnails\/(..\/..\/)(?:thumbnail_)?([a-f0-9]{32})\.(?:jpg|jpeg|png|gif|webp)/i.exec(s);
          return m ? { prefix: m[1], md5: m[2] } : null;
        };
        const info = tryDerive(srcRaw) || tryDerive(deproxy(p?.file_url||'')) || tryDerive(deproxy(p?.preview_url||'')) || tryDerive(deproxy(p?.sample_url||''));
        if (info){
          const push = (u) => { if (!u) return; if (u !== src0 && !candidates.includes(u)) candidates.push(u); };
          const order = ['gif','png','jpg','jpeg','webp'];
          // Try direct originals first (gif/png/jpg/jpeg/webp)
          for (const ex of order){ push(`https://realbooru.com/images/${info.prefix}${info.md5}.${ex}`); }
          // Only if proxy toggle is on, add proxied originals as additional options
          const allowProxy = !!settings?.proxyImages && !!String(settings?.corsProxy||'').trim();
          if (allowProxy){
            const toP = (u) => proxyUrlIfNeeded(u);
            for (const ex of order){ push(toP(`https://realbooru.com/images/${info.prefix}${info.md5}.${ex}`)); }
          }
        }
      }

      // Generic fallbacks (only used after original attempts)
      // NOTE: Do NOT add preview_url (thumbnails) here; it can cause visible downgrades
      const addCand = (u) => { if (!u) return; const v = proxyUrlIfNeeded(u); if (v !== src0 && !candidates.includes(v)) candidates.push(v); };
      try{
        if (p.file_url && !['mp4','webm'].includes(String(p.file_ext||'').toLowerCase())) addCand(p.file_url);
      }catch{}

      // First pass: without referer (often helps)
      imgEl.setAttribute('referrerpolicy','no-referrer');
      let idx = 0;
      let triedWithRef = false;
      const TIMEOUT_MS = isTouch ? 18000 : 12000;
      const tryNext = () => {
        if (idx >= candidates.length){
          if (!triedWithRef){
            // Second pass: allow referer
            triedWithRef = true;
            // Explicitly set a permissive referrer policy to override global meta
            try { imgEl.setAttribute('referrerpolicy','origin-when-cross-origin'); } catch {}
            idx = 0;
          } else {
            // Exhausted all options: stop spinner and leave current image as-is
            try{ skel?.remove(); }catch{}
            return;
          }
        }
        const cand = candidates[idx++];
        // Preload candidate with timeout to avoid indefinite pending states
        const test = new Image();
        const rp = imgEl.getAttribute('referrerpolicy') || '';
        if (rp) try{ test.referrerPolicy = rp; }catch{}
        let done = false;
        const to = setTimeout(() => { if (done) return; done = true; tryNext(); }, TIMEOUT_MS);
        test.onload = () => {
          if (done) return; done = true; clearTimeout(to);
          // If we just loaded a non-thumbnail original, stop any further downgrade fallback
          try{
            const isOriginal = /\/images\//i.test(cand) && !/\/thumbnail_/i.test(cand);
            if (isOriginal) { imgEl.removeEventListener('error', onErr); try{ imgEl.dataset.hi = '1'; }catch{} }
            try { p.file_url = cand; p.file_ext = (cand.split('.').pop()||'').toLowerCase(); updateDownloadLink(art, p); } catch {}
          }catch{}
          imgEl.src = cand;
        };
        test.onerror = () => { if (done) return; done = true; clearTimeout(to); tryNext(); };
        test.src = cand;
      };
      // If the element itself errors after a successful preload, advance
      const onErr = () => { if (imgEl?.dataset?.hi === '1') return; tryNext(); };
      imgEl.addEventListener('error', onErr, { passive: true });
      imgEl.addEventListener('load', () => skel?.remove(), { once: true });
      // Proactively advance for RealBooru samples or thumbnails (consider deproxied path)
      if (isRB && (srcRaw.includes('/samples/') || srcRaw.includes('/thumbnails/'))) tryNext();
    }catch{}
  }

  return art;
}

function proxyUrlIfNeeded(url){
  try{
    if (!url) return url;
    const p = String(settings?.corsProxy||'').trim();
    if (!p || !settings?.proxyImages) return url;

    const uLower = String(url).toLowerCase();
    const lower = p.toLowerCase();
    // Detect already-proxied URLs to avoid double-wrapping
    let prefix = p;
    if (p.includes('{url}')) prefix = p.split('{url}')[0];
    else if (/[?&]$/.test(p)) prefix = p; // e.g. https://proxy/?
    else if (/[?&]url=$/i.test(p)) prefix = p; // e.g. https://proxy/?url=
    else if (lower.includes('r.jina.ai') || /\/http\/?$/.test(lower)) prefix = p.replace(/\/?$/,'/');
    else if (/^https?:\/\/[^/]+\/?$/.test(p)) prefix = p.replace(/\/?$/,'/');
    if (uLower.startsWith(prefix.toLowerCase())) return url;

    if (p.includes('{url}')) return p.replace('{url}', encodeURIComponent(url));
    if (/[?&]$/.test(p)) return p + encodeURIComponent(url);
    if (/[?&]url=$/i.test(p)) return p + encodeURIComponent(url);
    if (lower.includes('r.jina.ai') || /\/http\/?$/.test(lower)) return p.replace(/\/?$/,'/') + url;
    if (/^https?:\/\/[^/]+\/?$/.test(p)) return p.replace(/\/?$/,'/') + url;
    return p + url;
  }catch{ return url; }
}

function isRealBooruPost(p){
  try{
    const hint = [p?.file_url||'', p?.preview_url||'', p?.sample_url||'', p?.source||''].join(' ');
    return /realbooru\.com/i.test(hint);
  }catch{ return false; }
}

function deriveRBInfo(str){
  try{
    if (!str) return null;
    let m = /\/images\/(..\/..\/)(?:thumbnail_)?([a-f0-9]{32})\.(?:jpg|jpeg|png|gif|webp)/i.exec(str);
    if (!m) m = /\/samples\/(..\/..\/)(?:sample_)?([a-f0-9]{32})\.(?:jpg|jpeg|png|gif|webp)/i.exec(str);
    if (!m) m = /\/thumbnails\/(..\/..\/)(?:thumbnail_)?([a-f0-9]{32})\.(?:jpg|jpeg|png|gif|webp)/i.exec(str);
    return m ? { prefix: m[1], md5: m[2] } : null;
  }catch{ return null; }
}

function computeDownloadUrl(p){
  try{
    // Prefer explicit video URL when present
    const ext = String(p?.file_ext||'').toLowerCase();
    if (['mp4','webm'].includes(ext) && p?.file_url) return p.file_url;

    if (isRealBooruPost(p)){
      const info = deriveRBInfo(p?.file_url||'') || deriveRBInfo(p?.sample_url||'') || deriveRBInfo(p?.preview_url||'') || deriveRBInfo(p?.source||'');
      if (info){
        const order = ['gif','png','jpg','jpeg','webp'];
        const start = order.includes(ext) ? [ext] : [];
        const exts = [...new Set([...start, ...order])];
        // Build a best-guess original URL (server may 302 to correct ext)
        return `https://realbooru.com/images/${info.prefix}${info.md5}.${exts[0]}`;
      }
    }
    return p?.file_url || '';
  }catch{ return p?.file_url || ''; }
}

function updateDownloadLink(art, p){
  try{
    const a = $('a[download]', art); if (!a) return;
    const url = computeDownloadUrl(p);
    if (url) a.href = url;
    // Give a reasonable filename
    const ext = (url.split('.').pop()||'').toLowerCase() || (p.file_ext||'').toLowerCase() || 'jpg';
    const base = isRealBooruPost(p) ? 'realbooru' : 'rule34';
    a.setAttribute('download', `${base}_${p.id}.${ext}`);
  }catch{}
}

function proxyFetchUrl(url){
  try{
    const p = String(settings?.corsProxy||'').trim();
    if (!p) return url;
    if (p.includes('{url}')) return p.replace('{url}', encodeURIComponent(url));
    if (/[?&]$/.test(p)) return p + encodeURIComponent(url);
    if (/[?&]url=$/i.test(p)) return p + encodeURIComponent(url);
    const lower = p.toLowerCase();
    if (lower.includes('r.jina.ai') || /\/http\/?$/.test(lower)) return p.replace(/\/?$/,'/') + url;
    if (/^https?:\/\/[^/]+\/?$/.test(p)) return p.replace(/\/?$/,'/') + url;
    return p + url;
  }catch{ return url; }
}

async function handleDownload(art, p){
  try{
    const ua = (navigator.userAgent||'').toLowerCase();
    const isIOS = /iphone|ipad|ipod/.test(ua);
    const hasShare = !!(navigator && 'share' in navigator) && !!navigator.canShare;
    if (!(isIOS && hasShare)) return false;

    // Best candidate URL
    const url = computeDownloadUrl(p);
    if (!url) return false;

    // For cross-origin blob fetching (especially RealBooru), require proxy if CORS blocks
    let fetchUrl = url;
    try{
      // Use proxy for media only if toggle is enabled
      const prox = String(settings?.corsProxy||'').trim();
      if (prox && !!settings?.proxyImages) fetchUrl = proxyFetchUrl(url);
    }catch{}

    const res = await fetch(fetchUrl, { credentials: 'omit', cache: 'no-cache', referrer: '' });
    if (!res.ok) return false;
    const blob = await res.blob();
    const ext = (url.split('.').pop()||p.file_ext||'jpg').toLowerCase();
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
               : ext === 'png' ? 'image/png'
               : ext === 'gif' ? 'image/gif'
               : ext === 'webm' ? 'video/webm'
               : ext === 'mp4' ? 'video/mp4'
               : 'application/octet-stream';
    const name = `${isRealBooruPost(p) ? 'realbooru' : 'rule34'}_${p.id}.${ext}`;
    const file = new File([blob], name, { type: mime });
    if (navigator.canShare({ files: [file] })){
      await navigator.share({ files: [file], title: 'Save to Photos' });
      return true;
    }
    return false;
  }catch{
    return false;
  }
}

function isMasonry(){ return els.feed.classList.contains('masonry') && (Number(els.feed.dataset.columns||1) > 1); }

function ensureMasonryStructure(){
  try{
    const cols = clamp(Number(els.feed.dataset.columns||1),1,4);
    if (cols <= 1){
      // Unwrap any column containers
      if (masonryCols.length){
        const cards = Array.from(els.feed.querySelectorAll('.col > .post-card'));
        els.feed.innerHTML = '';
        cards.forEach(c => els.feed.appendChild(c));
        masonryCols = [];
      }
      return;
    }
    // Build/rebuild column wrappers when count mismatches
    let needRebuild = masonryCols.length !== cols || !masonryCols.every(c => c.parentElement === els.feed);
    if (!needRebuild && masonryCols.length){ return; }
    const existingCards = Array.from(els.feed.querySelectorAll('.post-card'));
    els.feed.innerHTML = '';
    masonryCols = [];
    for (let i=0;i<cols;i++){ const d = document.createElement('div'); d.className = 'col'; masonryCols.push(d); els.feed.appendChild(d); }
    // Distribute existing cards into the shortest columns based on current heights
    const colHeights = new Array(cols).fill(0);
    for (const card of existingCards){
      // pick shortest col
      let idx = 0; for (let i=1;i<cols;i++){ if (colHeights[i] < colHeights[idx]) idx = i; }
      masonryCols[idx].appendChild(card);
      try{ colHeights[idx] += card.offsetHeight || 0; }catch{}
    }
  }catch{}
}

function appendCard(card){
  if (!isMasonry()) { els.feed.appendChild(card); return; }
  // Ensure columns exist
  if (!masonryCols.length) ensureMasonryStructure();
  if (!masonryCols.length) { els.feed.appendChild(card); return; }
  // Choose the shortest column by current heights
  let idx = 0; let minH = Infinity;
  for (let i=0;i<masonryCols.length;i++){
    const h = masonryCols[i].scrollHeight || masonryCols[i].offsetHeight || 0;
    if (h < minH){ minH = h; idx = i; }
  }
  masonryCols[idx].appendChild(card);
}

// Build proxy URL ignoring the media toggle; used for last-resort fallbacks
function proxyUrlAlways(url){
  try{
    if (!url) return url;
    const p = String(settings?.corsProxy||'').trim();
    if (!p) return url;

    if (p.includes('{url}')) return p.replace('{url}', encodeURIComponent(url));
    if (/[?&]$/.test(p)) return p + encodeURIComponent(url);
    if (/[?&]url=$/i.test(p)) return p + encodeURIComponent(url);
    const lower = p.toLowerCase();
    if (lower.includes('r.jina.ai') || /\/http\/?$/.test(lower)) return p.replace(/\/?$/,'/') + url;
    if (/^https?:\/\/[^/]+\/?$/.test(p)) return p.replace(/\/?$/,'/') + url;
    return p + url;
  }catch{ return url; }
}

async function enrichRealBooruCard(art){
  const p = art?.__post; if (!p) return;
  try{
    let postUrl = '';
    if (typeof p?.source === 'string' && p.source.includes('realbooru.com')) postUrl = p.source;
    else if (p?.id) postUrl = `https://realbooru.com/index.php?page=post&s=view&id=${encodeURIComponent(p.id)}`;
    else return;
    const cacheKey = 'rb:post:' + postUrl;
    let html = sessionStorage.getItem(cacheKey);
    if (!html) {
      html = await fetchText(postUrl, /*allowProxy*/ true);
      try { sessionStorage.setItem(cacheKey, html); } catch {}
    }

    // Prefer full-resolution images first (especially GIFs), then fall back to video
    const imgUrls = [];
    const reImg = /https?:\/\/realbooru\.com\/images\/[^"'<>\s]+?\.(?:jpg|jpeg|png|gif|webp)/ig;
    let m2; while ((m2 = reImg.exec(html))){ const u = m2[0]; if (!imgUrls.includes(u)) imgUrls.push(u); }
    if (imgUrls.length){
      // Prefer non-thumbnail originals when available; else allow thumbnail_ path (RB often 302s it to original)
      const ordered = (() => {
        const nonThumb = imgUrls.filter(u => !/\/thumbnail_/i.test(u));
        return nonThumb.length ? nonThumb : imgUrls;
      })();
      // Always prefer GIF when present, then PNG/JPG/JPEG/WEBP
      const order = ['gif','png','jpg','jpeg','webp'];
      const best = order.map(ex => ordered.find(u => u.toLowerCase().endsWith('.'+ex))).find(Boolean) || ordered[0];
      const media = $('.post-media', art); if (!media) return;
      try { p.file_url = best; p.file_ext = (best.split('.').pop() || '').toLowerCase(); updateDownloadLink(art, p); } catch {}
      let img = $('img', media);
      if (img){
        // If we already have a non-thumbnail original shown, keep it
        try{
          const cur = img.currentSrc || img.getAttribute('src') || '';
          const curRaw = cur;
          if (/realbooru\.com/i.test(curRaw) && curRaw.includes('/images/') && !/thumbnail_/i.test(curRaw)) {
            return; // don't downgrade an already-upgraded image
          }
        }catch{}

        // Replace node to remove any existing error handlers from the initial fallback chain
        try{
          const clone = img.cloneNode(true);
          img.replaceWith(clone);
          img = clone;
        }catch{}

        img.referrerPolicy = 'no-referrer';
        img.decoding = 'async';
        img.loading = 'lazy';

        // Derive md5/prefix to try canonical originals even if best is a thumbnail link
        const derive = (s) => {
          try{
            if (!s) return null;
            let m = /\/images\/(..\/..\/)(?:thumbnail_)?([a-f0-9]{32})\.(?:jpg|jpeg|png|gif|webp)/i.exec(s);
            if (!m) m = /\/samples\/(..\/..\/)(?:sample_)?([a-f0-9]{32})\.(?:jpg|jpeg|png|gif|webp)/i.exec(s);
            if (!m) m = /\/thumbnails\/(..\/..\/)(?:thumbnail_)?([a-f0-9]{32})\.(?:jpg|jpeg|png|gif|webp)/i.exec(s);
            return m ? { prefix: m[1], md5: m[2] } : null;
          }catch{ return null; }
        };
        const info = derive(best) || derive(imgUrls[0]) || null;
        const directCandidates = [];
        if (info){
          for (const ex of order){ directCandidates.push(`https://realbooru.com/images/${info.prefix}${info.md5}.${ex}`); }
          // Also include thumbnail_ variant as a late fallback (server may 302 to original)
          directCandidates.push(`https://realbooru.com/images/${info.prefix}thumbnail_${info.md5}.jpg`);
        }
        // Ensure we also consider the discovered best URL as a fallback
        if (!directCandidates.includes(best)) directCandidates.push(best);

        // One-shot proxy fallback will be applied only after direct attempts
        let idx = 0;
        let triedWithRef = false;
        let proxiedUsed = false;
        const next = () => {
          if (idx >= directCandidates.length){
            if (!triedWithRef){
              triedWithRef = true;
              try { img.setAttribute('referrerpolicy','origin-when-cross-origin'); } catch {}
              idx = 0;
              // retry list with a permissive referrer policy
            } else if (!proxiedUsed){
              proxiedUsed = true;
              // Try proxied version of the first candidate (or best) as a final fallback
              const base = directCandidates[0] || best;
              img.onerror = null;
              img.src = proxyUrlIfNeeded(base);
              return;
            } else {
              return;
            }
          }
          const cand = directCandidates[idx++];
          // Try direct first; on error advance to next
          img.onerror = next;
          img.src = cand;
        };
        img.addEventListener('load', () => {
          try{
            const u = img.currentSrc || img.getAttribute('src') || '';
            const isOriginal = /\/images\//i.test(u) && !/\/thumbnail_/i.test(u);
            if (isOriginal) { try{ img.dataset.hi = '1'; }catch{}; img.onerror = null; }
            const sk = $('.media-skel', media); sk && sk.remove();
            // Update aspect ratio to match loaded image
            try{ const w=img.naturalWidth||0, h=img.naturalHeight||0; if (w>0&&h>0) media.style.aspectRatio = `${w} / ${h}`; }catch{}
          }catch{}
        }, { once: false });
        next();
      }
      return;
    }

    // If no full-res image found, check for video URLs and prefer those
    const vidUrls = [];
    const reVid = /https?:\/\/realbooru\.com\/(?:images|videos)\/[^"'<>\s]+?\.(?:mp4|webm)/ig;
    let m; while ((m = reVid.exec(html))){ const u = m[0]; if (!vidUrls.includes(u)) vidUrls.push(u); }
    if (vidUrls.length){
      vidUrls.sort((a,b)=> (b.endsWith('.mp4')?0:1) - (a.endsWith('.mp4')?0:1));
      const chooseVideoUrlRB = (u) => {
        try{
          const hasProxy = !!String(settings?.corsProxy||'').trim();
          return (IS_IOS && hasProxy) ? proxyUrlAlways(u) : u;
        }catch{ return u; }
      };
      const direct = vidUrls[0];
      const proxied = proxyUrlIfNeeded(direct);
      p.video_candidates = vidUrls.slice(0,4);
      p.file_ext = (direct.split('.').pop()||'').toLowerCase();
      p.file_url = direct;
      try { updateDownloadLink(art, p); } catch {}
      const media = $('.post-media', art); if (!media) return;
      const img = $('img', media);
      let video = $('video', media);
      if (!video){
        video = document.createElement('video');
        video.preload = 'metadata'; video.playsInline = true; video.muted = true; video.controls = true;
        try{ video.poster = proxyUrlIfNeeded(p.preview_url || p.sample_url || ''); }catch{ video.poster = p.preview_url || p.sample_url || ''; }
        try { video.removeAttribute('crossorigin'); video.setAttribute('referrerpolicy','no-referrer'); } catch {}
        // iOS: if this is a webm and no mp4 available, avoid inline and keep image (tap opens new tab via Download)
        if (IS_IOS && String(direct||'').toLowerCase().endsWith('.webm') && !vidUrls.some(u => u.toLowerCase().endsWith('.mp4'))){
          // Do not replace image with an unsupported video element
        } else {
          video.src = chooseVideoUrlRB(direct); // direct first (with optional proxy on iOS)
        }
        let vidTriedWithRef2 = false;
        video.onerror = () => {
          if (!vidTriedWithRef2){
            vidTriedWithRef2 = true;
            try { video.setAttribute('referrerpolicy','origin-when-cross-origin'); } catch {}
            const cur = direct;
            video.src = '';
            setTimeout(()=>{ video.src = cur; }, 0);
          } else {
            video.onerror = null; video.src = proxied;
          }
        };
        if (video.src){ if (img) img.replaceWith(video); else media.appendChild(video); }
        try{ const sk = $('.media-skel', media); video.addEventListener('loadedmetadata', () => { try{ sk?.remove(); }catch{} }, { once: true }); video.addEventListener('loadeddata', () => { try{ sk?.remove(); }catch{} }, { once: true }); }catch{}
        try{
          const applyAspect = () => { try{ const w=video.videoWidth||0, h=video.videoHeight||0; if (w>0&&h>0) media.style.aspectRatio = `${w} / ${h}`; }catch{} };
          if (video.readyState >= 1) applyAspect();
          video.addEventListener('loadedmetadata', applyAspect);
          try{ video.addEventListener('resize', applyAspect); }catch{}
        }catch{}
        video.addEventListener('click', () => { if (video.paused) video.play().catch(()=>{}); else video.pause(); });
        const vis = new IntersectionObserver(entries => { entries.forEach(e => { if (!e.isIntersecting) video.pause(); }); }, { rootMargin: '200px' });
        vis.observe(video);
      } else {
        video.src = direct;
        let vidTriedWithRef3 = false;
        video.onerror = () => {
          if (!vidTriedWithRef3){
            vidTriedWithRef3 = true;
            try { video.setAttribute('referrerpolicy','origin-when-cross-origin'); } catch {}
            const cur = direct; video.src = ''; setTimeout(()=>{ video.src = cur; }, 0);
          } else {
            video.onerror = null; video.src = proxied;
          }
        };
      }
      return;
    }
  }catch{}
}

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
  $$('.post-card').forEach(c => {
    if (c.dataset.id === p.id) $('.fav', c)?.classList.toggle('active', favSet.has(p.id));
  });
  return nowFav;
}

function renderFavorites(){
  clearFeed();
  if (!favorites.ids.length){ renderEmptyState('No favorites yet. Double-tap or click ? to add.'); return; }
  const posts = favorites.ids.map(id => favorites.map[id]).filter(Boolean);
  renderPosts(posts);
  reachedEnd = true;
}

export async function showTagsOverlay(p){
  els.tagsOverlay.hidden = false;
  const skel = Array.from({ length: 18 }, (_, i) => `<span class="skel" style="width:${40 + ((i*27)%80)}px"></span>`).join('');
  els.tagsBody.innerHTML = `<div class="tags-loading">${skel}</div>`;
  const tags = (p.tags||'').split(/\s+/).filter(Boolean);
  try{
    const N = Math.min(25, tags.length);
    const metas = await Promise.allSettled(tags.slice(0,N).map(t => API.tagMeta(t)));
    const typeMap = new Map();
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
    const groupsMap = { 'General': [], 'Artists': [], 'Characters': [], 'Copyrights': [], 'Meta': [] };
    for (const t of tags){
      const ty = typeMap.get(t);
      if (ty === 1) groupsMap['Artists'].push(t);
      else if (ty === 4) groupsMap['Characters'].push(t);
      else if (ty === 3) groupsMap['Copyrights'].push(t);
      else if (ty === 5) groupsMap['Meta'].push(t);
      else groupsMap['General'].push(t);
    }
    const frag = document.createDocumentFragment();
    const st = getSearchState();
    for (const [name, arr] of Object.entries(groupsMap)){
      if (!arr.length) continue;
      const sec = document.createElement('div');
      sec.innerHTML = `<h4 style="margin:8px 0 6px 0">${name}</h4>`;
      const chips = document.createElement('div'); chips.className = 'chips small';
      for (const t of arr){
        const key = String(t||'').toLowerCase(); const inInc = (st.include||[]).includes(key); const inExc = (st.exclude||[]).includes(key);
        const c = document.createElement('span'); c.className = 'chip' + (inExc ? ' excluded' : (inInc ? ' in-search' : ''));
        c.innerHTML = `<span class="t">${escapeHtml(t)}</span><span class="x" title="Add">+</span>`;
        c.title = 'Add to search';
        c.addEventListener('click', () => addSearchTag(t));
        chips.appendChild(c);
      }
      try{
        const cls = name === 'Meta' ? 'tag-meta' : name === 'Characters' ? 'tag-character' : name === 'Copyrights' ? 'tag-copyright' : name === 'Artists' ? 'tag-artist' : 'tag-general';
        chips.querySelectorAll('.chip').forEach(ch => {
          ch.classList.add(cls);
          // Remove original click listener by cloning the node
          const node = ch.cloneNode(true);
          ch.parentNode.replaceChild(node, ch);
          const label = node.querySelector('.t')?.textContent || '';
          const key2 = label.toLowerCase();
          const inInc2 = (st.include||[]).includes(key2);
          const inExc2 = (st.exclude||[]).includes(key2);
          node.classList.toggle('in-search', inInc2);
          node.classList.toggle('excluded', inExc2);
          const x = node.querySelector('.x');
          if (x) x.textContent = inInc2 ? '✓' : (inExc2 ? '-' : '+');
          node.title = inInc2 ? 'In search — click to remove' : (inExc2 ? 'Excluded — click to include' : 'Add to search');
          node.addEventListener('click', () => {
            const cur = getSearchState();
            const isInc = (cur.include||[]).includes(key2);
            const isExc = (cur.exclude||[]).includes(key2);
            if (isExc) { toggleSearchTag(key2, true); }
            else if (isInc) { removeSearchTag(key2, false); }
            else { addSearchTag(label); }
            const st3 = getSearchState();
            const ni2 = (st3.include||[]).includes(key2);
            const ne2 = (st3.exclude||[]).includes(key2);
            node.classList.toggle('in-search', ni2);
            node.classList.toggle('excluded', ne2);
            const x2 = node.querySelector('.x');
            if (x2) x2.textContent = ni2 ? '✓' : (ne2 ? '-' : '+');
            node.title = ni2 ? 'In search — click to remove' : (ne2 ? 'Excluded — click to include' : 'Add to search');
          });
        });
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
export function hideTagsOverlay(){ els.tagsOverlay.hidden = true; }

export function onScroll(){
  const y = window.scrollY || window.pageYOffset;
  const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  const pct = clamp(y / max, 0, 1);
  els.scrollProgress.style.width = (pct*100).toFixed(1) + '%';
  const dy = y - lastScrollY;
  const dir = dy > 0 ? 1 : (dy < 0 ? -1 : direction);
  // Distance thresholds to avoid instant show/hide on tiny scrolls
  const showThreshold = 1200; // only consider button after this scroll depth
  const showMinDelta = 90;    // need to scroll up at least this much to show
  const hideMinDelta = 120;   // need to scroll down at least this much to hide
  const nearTop = y < 200;
  // Accumulate deltas in current direction; reset when direction flips
  if (dy < 0) { upDelta += -dy; downDelta = 0; }
  else if (dy > 0) { downDelta += dy; upDelta = 0; }

  if (dir < 0 && y > showThreshold && upDelta >= showMinDelta) { showToTopBtn(); upDelta = 0; }
  if ((dir > 0 && downDelta >= hideMinDelta) || nearTop) { hideToTopBtn(); downDelta = 0; }
  direction = dir;
  lastScrollY = y;
}

function showToTopBtn(){
  const b = els.toTop; if (!b) return;
  if (b.classList.contains('visible')) return;
  if (b.hidden) { b.hidden = false; void b.offsetWidth; }
  b.classList.add('visible');
  // Reset deltas to avoid immediate hide on minor scrolls
  upDelta = 0; downDelta = 0;
}
function hideToTopBtn(){
  const b = els.toTop; if (!b) return;
  if (!b.classList.contains('visible')) { b.hidden = true; return; }
  b.classList.remove('visible');
  // Reset deltas to avoid immediate show on minor scrolls
  upDelta = 0; downDelta = 0;
  const onEnd = () => {
    if (!b.classList.contains('visible')) { b.hidden = true; }
    b.removeEventListener('transitionend', onEnd);
  };
  b.addEventListener('transitionend', onEnd);
}



