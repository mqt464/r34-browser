import { settings } from './state.js';

async function fetchJSON(url){
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

export async function fetchText(url){
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { 'Accept': 'application/xml,text/xml;q=0.9,*/*;q=0.8' } });
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

export const API = {
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

