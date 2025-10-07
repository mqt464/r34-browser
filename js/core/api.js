import { settings, session } from './state.js?v=20251007';

function withProxy(url){
  const p = String(settings?.corsProxy||'').trim();
  if (!p) return url;
  const lower = p.toLowerCase();
  try {
    // Pattern 1: placeholder e.g. "https://proxy.example/?url={url}"
    if (p.includes('{url}')) return p.replace('{url}', encodeURIComponent(url));
    // Pattern 2: ends with ? or & (append encoded target)
    if (/[?&]$/.test(p)) return p + encodeURIComponent(url);
    // Pattern 3: ends with ...url= (append encoded target)
    if (/[?&]url=$/i.test(p)) return p + encodeURIComponent(url);
    // Pattern 4: r.jina.ai style path passthrough (expects raw full URL after /http/)
    if (lower.includes('r.jina.ai') || /\/http\/?$/.test(lower)) return p.replace(/\/?$/,'/') + url;
    // Pattern 5: cors.isomorphic-git.org and similar accept raw URL after base path
    if (/^https?:\/\/[^/]+\/?$/.test(p)) return p.replace(/\/?$/,'/') + url;
    // Default: concat raw (best-effort)
    return p + url;
  } catch { return url; }
}

function providerNeedsProxy(provider){
  return String(provider||'').toLowerCase() === 'realbooru';
}

async function fetchJSON(url, allowProxy = false){
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const finalUrl = allowProxy ? withProxy(url) : url;
    const res = await fetch(finalUrl, { signal: ctl.signal, headers: { 'Accept': 'application/json,text/plain;q=0.8,*/*;q=0.6' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const txt = await res.text();
    try { return JSON.parse(txt); } catch { throw new Error('Bad JSON'); }
  } finally { clearTimeout(t); }
}

export async function fetchText(url, allowProxy = false){
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const finalUrl = allowProxy ? withProxy(url) : url;
    const res = await fetch(finalUrl, { signal: ctl.signal, headers: { 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally { clearTimeout(t); }
}

export function parseTagXML(xml){
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

function normalizeTagsFromCsv(titleAttr){
  // RealBooru list page puts tags in the <img title> as comma+space separated
  if (!titleAttr) return '';
  const parts = String(titleAttr).split(',').map(s => s.trim()).filter(Boolean);
  return parts.map(t => t.replace(/\s+/g,'_').toLowerCase()).join(' ');
}

function mapRBThumbToSample(url){
  try{
    // Accept jpg/jpeg/png/gif/webp and optional query/hash; case-insensitive
    const m = /\/thumbnails\/(..\/..\/)(?:thumbnail_)?([a-fA-F0-9]{32})\.(?:jpg|jpeg|png|gif|webp)(?:[?#].*)?$/i.exec(url);
    if (!m) return url;
    const prefix = m[1];
    const md5 = m[2];
    // RB samples are always .jpg under /samples/
    return `https://realbooru.com/samples/${prefix}sample_${md5}.jpg`;
  }catch{ return url; }
}

export const API = {
  base: 'https://api.rule34.xxx',
  async posts({ tags = '', limit = 30, pid = 0, provider } = {}) {
    const prov = String(provider || session.providerOverride || settings?.provider || 'rule34');
    if (prov === 'realbooru'){
      // RealBooru: scrape list HTML. pid is page index; RB pid is offset (42 per page)
      const offset = Math.max(0, Number(pid)||0) * 42;
      const u = new URL(`https://realbooru.com/index.php`);
      u.searchParams.set('page','post');
      u.searchParams.set('s','list');
      if (tags) u.searchParams.set('tags', tags);
      u.searchParams.set('pid', String(offset));
      const html = await fetchText(u.toString(), /*allowProxy*/ providerNeedsProxy(prov));
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const nodes = Array.from(doc.querySelectorAll('div.col.thumb > a'));
      const items = [];
      for (const a of nodes){
        const img = a.querySelector('img');
        const id = (a.getAttribute('id')||'').replace(/^p/, '');
        const preview = img?.getAttribute('src') || '';
        const toAbs = (u) => { try { return new URL(u, 'https://realbooru.com').toString(); } catch { return u; } };
        const previewAbs = toAbs(preview);
        const sampleAbs = mapRBThumbToSample(previewAbs);
        // Derive original path prefix + md5 to try video originals when available
        let prefix = ''; let md5 = '';
        try{
          const m = /\/thumbnails\/(..\/..\/)(?:thumbnail_)?([a-fA-F0-9]{32})\.jpg$/i.exec(preview);
          if (m){ prefix = m[1]; md5 = m[2]; }
        }catch{}
        const style = String(img?.getAttribute('style')||'').toLowerCase();
        const title = String(img?.getAttribute('title')||'').toLowerCase();
        const looksLikeVideo = style.includes('#0000ff') || /(video|webm|mp4)/.test(title);
        const videoCandidates = [];
        if (looksLikeVideo && prefix && md5){
          videoCandidates.push(`https://realbooru.com/images/${prefix}${md5}.mp4`);
          videoCandidates.push(`https://realbooru.com/images/${prefix}${md5}.webm`);
        }
        // Only proxy images if explicitly enabled to avoid burning proxy bandwidth
        const useProxyForImages = !!settings.proxyImages && !!settings.corsProxy;
        const previewUrl = useProxyForImages ? withProxy(previewAbs) : previewAbs;
        const sampleUrl = useProxyForImages ? withProxy(sampleAbs) : sampleAbs;
        const tagsCsv = img?.getAttribute('title') || '';
        items.push({
          id,
          file_url: sampleUrl, // best-effort; original URL/extension unknown without JS on view page
          sample_url: sampleUrl,
          preview_url: previewUrl || sampleUrl,
          file_ext: looksLikeVideo ? 'mp4' : 'jpg',
          width: 0,
          height: 0,
          rating: 'q',
          tags: normalizeTagsFromCsv(tagsCsv),
          owner: '',
          created_at: '',
          source: `https://realbooru.com/index.php?page=post&s=view&id=${id}`,
          video_candidates: videoCandidates,
        });
        if (items.length >= limit) break;
      }
      return items;
    }
    // Default: Rule34 API
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
    return fetchJSON(u.toString(), /*allowProxy*/ false);
  },
  autocomplete(q, provider) {
    const prov = String(provider || session.providerOverride || settings?.provider || 'rule34');
    if (prov === 'realbooru'){
      const u = new URL(`https://realbooru.com/index.php`);
      u.searchParams.set('page','autocomplete');
      u.searchParams.set('term', q);
      return fetchJSON(u.toString(), /*allowProxy*/ providerNeedsProxy(prov)).then(arr => Array.isArray(arr) ? arr.map(v => ({ value: String(v), type: '' })) : []);
    }
    const u = new URL(`${API.base}/autocomplete.php`);
    u.searchParams.set('q', q);
    return fetchJSON(u.toString(), /*allowProxy*/ false);
  },
  async tagMeta(name, provider){
    const prov = String(provider || session.providerOverride || settings?.provider || 'rule34');
    if (prov === 'realbooru'){
      // Not available on RB (API offline). Return empty to fall back to General tag styling.
      return [];
    }
    const u = new URL(`${API.base}/index.php`);
    u.searchParams.set('page','dapi');
    u.searchParams.set('s','tag');
    u.searchParams.set('q','index');
    u.searchParams.set('name',name);
    if (settings.apiUserId) u.searchParams.set('user_id', settings.apiUserId);
    if (settings.apiKey) u.searchParams.set('api_key', settings.apiKey);
    const xml = await fetchText(u.toString(), /*allowProxy*/ false);
    return parseTagXML(xml);
  }
};
