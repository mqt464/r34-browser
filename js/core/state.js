// Persistent state (localStorage) and helpers

export const LS = {
  settings: 'r34:settings',
  favorites: 'r34:favorites',
  groups: 'r34:groups',
  filters: 'r34:filters'
};

export const DEFAULTS = {
  settings: {
    columns: 1,
    theme: 'system',
    accent: '#7c3aed',
    autoHideTopbar: true,
    // Data source: 'rule34' | 'realbooru'
    provider: 'rule34',
    // Optional CORS proxy prefix (e.g. https://r.jina.ai/http/)
    corsProxy: '',
    // When using RealBooru, proxy images too (saves hotlink issues but uses proxy bandwidth)
    proxyImages: false,
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

export function loadLS(key, fallback){
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : structuredClone(fallback); } catch { return structuredClone(fallback); }
}
export function saveLS(key, val){ localStorage.setItem(key, JSON.stringify(val)); }

export let settings = loadLS(LS.settings, DEFAULTS.settings);
export let filters = loadLS(LS.filters, DEFAULTS.filters);
export let groups = loadLS(LS.groups, DEFAULTS.groups);
export let favorites = loadLS(LS.favorites, DEFAULTS.favorites);

export const favSet = new Set(favorites.ids);

// Ephemeral session state (not persisted)
export const session = {
  // Empty string means no override; use settings.provider
  providerOverride: ''
};

// App version for display in Settings
export const APP_VERSION = 'v2025.09.26';

export function setSettings(next){ settings = next; saveLS(LS.settings, settings); }
export function setFilters(next){ filters = next; saveLS(LS.filters, filters); }
export function setGroups(next){ groups = next; saveLS(LS.groups, groups); }
export function setFavorites(next){ favorites = next; saveLS(LS.favorites, favorites); favSet.clear(); favorites.ids.forEach(id=>favSet.add(id)); }

export function resetAllData(){
  localStorage.removeItem(LS.settings);
  localStorage.removeItem(LS.groups);
  localStorage.removeItem(LS.favorites);
  localStorage.removeItem(LS.filters);
  settings = loadLS(LS.settings, DEFAULTS.settings);
  filters = loadLS(LS.filters, DEFAULTS.filters);
  groups = loadLS(LS.groups, DEFAULTS.groups);
  favorites = loadLS(LS.favorites, DEFAULTS.favorites);
  favSet.clear();
}
