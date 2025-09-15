import { $, $$, clamp, escapeHtml, isTouch, haptic } from '../core/utils.js';
import { API } from '../core/api.js';
import { LS, saveLS, settings, filters, groups, favorites, favSet } from '../core/state.js';
import { getSearchState, addSearchTag } from './search.js';

let els;

let activeTab = null;
let searchPid = 0; // pagination
let loading = false;
let reachedEnd = false;
let direction = 1; // 1 down, -1 up
let lastScrollY = 0;
let seen = new Set(); // dedupe posts in feed

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

  // Overlay: tags
  els.tagsClose.addEventListener('click', () => hideTagsOverlay());
  els.tagsOverlay.addEventListener('click', (e) => { if (e.target === els.tagsOverlay) hideTagsOverlay(); });

  // Initial layout
  applyTheme();
  applyColumns();
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
}

export function switchTab(name){
  if (activeTab === name) return;
  activeTab = name;
  els.tabs.forEach(b => b.classList.toggle('active', b.dataset.tab === name));
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

export function resetSearchPagination(){ searchPid = 0; reachedEnd = false; seen.clear(); }

export function clearFeed(){
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

export async function loadNext(){
  loading = true; showSkeletons();
  try {
    if (activeTab === 'search') {
      const st = getSearchState();
      const tags = composeTags(st.include||[], st.exclude||[]);
      const data = await API.posts({ tags, limit: settings.perPage, pid: searchPid });
      const posts = sanitizePosts(data);
      const added = renderPosts(posts);
      if (added === 0) {
        searchPid++;
        const d2 = await API.posts({ tags, limit: settings.perPage, pid: searchPid });
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
          const data = await API.posts({ tags, limit: perGroup, pid });
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
        <div class="like-heart">?</div>
        ${isVideo ? `<video preload="metadata" playsinline muted controls poster="${escapeHtml(p.preview_url || p.sample_url || '')}" src="${escapeHtml(p.file_url)}"></video>`
                   : `<img loading=\"lazy\" src=\"${escapeHtml(p.sample_url || p.file_url)}\" alt=\"post\" />`}
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
  if (!isVideo) {
    media.addEventListener('touchend', (e) => {
      const now = Date.now();
      if (now - lastTap < settings.doubleTapMs) { e.preventDefault(); toggleLike(); lastTap = 0; }
      else lastTap = now;
    }, { passive: true });
  }

  // Favorite button
  favBtn.addEventListener('click', () => { const nowFav = toggleFavorite(p); favBtn.classList.add('pulse'); setTimeout(()=>favBtn.classList.remove('pulse'), 480); });
  // Tags button
  tagsBtn.addEventListener('click', () => showTagsOverlay(p));

  if (video){
    video.addEventListener('click', () => { if (video.paused) video.play().catch(()=>{}); else video.pause(); });
    const vis = new IntersectionObserver(entries => { entries.forEach(e => { if (!e.isIntersecting) video.pause(); }); }, { rootMargin: '200px' });
    vis.observe(video);
  }

  return art;
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
  els.tagsBody.innerHTML = '<div class="note" style="padding:12px">Loading tags.</div>';
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
    for (const [name, arr] of Object.entries(groupsMap)){
      if (!arr.length) continue;
      const sec = document.createElement('div');
      sec.innerHTML = `<h4 style="margin:8px 0 6px 0">${name}</h4>`;
      const chips = document.createElement('div'); chips.className = 'chips small';
      for (const t of arr){
        const c = document.createElement('span'); c.className = 'chip';
        c.innerHTML = `<span class="t">${escapeHtml(t)}</span><span class="x" title="Add">+</span>`;
        c.title = 'Add to search';
        c.addEventListener('click', () => addSearchTag(t));
        chips.appendChild(c);
      }
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
export function hideTagsOverlay(){ els.tagsOverlay.hidden = true; }

export function onScroll(){
  const y = window.scrollY || window.pageYOffset;
  const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  const pct = clamp(y / max, 0, 1);
  els.scrollProgress.style.width = (pct*100).toFixed(1) + '%';
  const dir = y > lastScrollY ? 1 : (y < lastScrollY ? -1 : direction);
  const showThreshold = 1200;
  const nearTop = y < 200;
  if (dir < 0 && y > showThreshold) { showToTopBtn(); }
  if (dir > 0 || nearTop) { hideToTopBtn(); }
  direction = dir;
  lastScrollY = y;
}

function showToTopBtn(){
  const b = els.toTop; if (!b) return;
  if (b.classList.contains('visible')) return;
  if (b.hidden) { b.hidden = false; void b.offsetWidth; }
  b.classList.add('visible');
}
function hideToTopBtn(){
  const b = els.toTop; if (!b) return;
  if (!b.classList.contains('visible')) { b.hidden = true; return; }
  b.classList.remove('visible');
  const onEnd = () => {
    if (!b.classList.contains('visible')) { b.hidden = true; }
    b.removeEventListener('transitionend', onEnd);
  };
  b.addEventListener('transitionend', onEnd);
}

