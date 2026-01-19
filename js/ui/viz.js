import { $, clamp } from '../core/utils.js?v=20251007';
import { favorites, settings } from '../core/state.js?v=20251007';
import { API } from '../core/api.js?v=20251007';

let els;
let currentGraph = null;
let resizeObserver = null;
let raf = 0;
const view = { scale: 1, tx: 0, ty: 0 };
const drag = { mode: '', node: -1, x: 0, y: 0, vx: 0, vy: 0, active: null, settleUntil: 0, settleRaf: 0 };
const hover = { idx: -1 };
let lastLayout = null;
const tagTypeCache = new Map();
const TAG_TYPE_GROUPS = {
  0: 'general',
  1: 'artist',
  2: 'copyright',
  3: 'copyright',
  4: 'character',
  5: 'meta',
};
const sim = { running: false, fixed: -1, lastTime: 0, settleUntil: 0, velocities: [], width: 0, height: 0 };
let simRaf = 0;

export function initViz(domRefs){
  els = domRefs;
}

export function openViz(data){
  if (!els?.vizPage) return;
  if (!els.vizPage.hasChildNodes()) renderViz();
  if (data) {
    currentGraph = normalizeGraph(data);
  } else {
    const favGraph = buildGraphFromFavorites();
    currentGraph = favGraph ? normalizeGraph(favGraph) : normalizeGraph(buildDemoGraph());
  }
  currentGraph.layout = null;
  if (els.settingsPage) els.settingsPage.hidden = true;
  els.vizPage.hidden = false;
  try{ document.documentElement.dataset.viz = 'true'; }catch{}
  primeVizTagTypes();
  scheduleDraw();
}

export function closeViz(){
  if (!els?.vizPage) return;
  els.vizPage.hidden = true;
  if (els.settingsPage) els.settingsPage.hidden = false;
  try{ delete document.documentElement.dataset.viz; }catch{ document.documentElement.removeAttribute('data-viz'); }
}

export function setVizData(data){
  currentGraph = normalizeGraph(data);
  if (currentGraph) currentGraph.layout = null;
  scheduleDraw();
}

function renderViz(){
  const page = els?.vizPage;
  if (!page) return;
  page.innerHTML = '';
  const tpl = $('#tpl-viz');
  if (!tpl) return;
  page.appendChild(tpl.content.cloneNode(true));
  const back = page.querySelector('#viz-back');
  back?.addEventListener('click', () => closeViz());
  const stage = page.querySelector('.viz-stage');
  const canvas = page.querySelector('#viz-canvas');
  if (canvas && !page._vizBound){
    page._vizBound = true;
    canvas.addEventListener('pointerdown', (e) => startDrag(e, stage, canvas));
    canvas.addEventListener('pointermove', (e) => updateHover(e, canvas));
    canvas.addEventListener('pointerleave', clearHover);
    window.addEventListener('pointermove', moveDrag);
    window.addEventListener('pointerup', endDrag);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', () => resetView(stage));
  }
  if (stage && !resizeObserver){
    resizeObserver = new ResizeObserver(() => scheduleDraw());
    resizeObserver.observe(stage);
  }
}

function scheduleDraw(){
  if (!els?.vizPage || els.vizPage.hidden) return;
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    draw();
  });
}

function draw(){
  const page = els?.vizPage;
  if (!page || page.hidden) return;
  const stage = page.querySelector('.viz-stage');
  const canvas = page.querySelector('#viz-canvas');
  if (!stage || !canvas) return;
  const rect = stage.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.save();
  ctx.translate(view.tx, view.ty);
  ctx.scale(view.scale, view.scale);

  if (!currentGraph) currentGraph = normalizeGraph(buildDemoGraph());
  const positions = getLayout(currentGraph, rect.width, rect.height);
  lastLayout = positions;
  ensureSimState(currentGraph, rect.width, rect.height);
  drawLinks(ctx, currentGraph, positions);
  drawNodes(ctx, currentGraph, positions);
  drawHover(ctx, currentGraph, positions);
  ctx.restore();
  drawLabel(ctx, rect, currentGraph, positions);
}

function buildDemoGraph(){
  const nodes = [{ id: 'core', label: 'Core', weight: 1 }];
  const links = [];
  const clusters = 3;
  const perCluster = 9;
  for (let c = 0; c < clusters; c++){
    const hubId = `hub-${c}`;
    const group = `cluster-${c + 1}`;
    nodes.push({ id: hubId, weight: 0.65 + hash01(hubId) * 0.25, group });
    links.push({ source: 'core', target: hubId, weight: 0.7 });
    for (let i = 0; i < perCluster; i++){
      const id = `c${c}-n${i}`;
      nodes.push({ id, weight: 0.2 + hash01(id) * 0.75, group });
      links.push({ source: hubId, target: id, weight: 0.45 + (i % 3) * 0.1 });
      if (i % 4 === 0){
        const buddy = `c${c}-n${(i + 2) % perCluster}`;
        links.push({ source: id, target: buddy, weight: 0.25 });
      }
    }
  }
  links.push({ source: 'hub-0', target: 'hub-1', weight: 0.25 });
  links.push({ source: 'hub-1', target: 'hub-2', weight: 0.25 });
  return { nodes, links };
}

function buildGraphFromFavorites(){
  const posts = favorites.ids.map(id => favorites.map[id]).filter(Boolean);
  if (!posts.length) return null;
  const tagCounts = new Map();
  const exclude = new Set([
    'scat','coprophagia','feces',
    'loli','shota',
    'ai_generated','stable_diffusion','novelai','midjourney'
  ]);
  for (const p of posts){
    if (!p?.tags) continue;
    const tags = Array.from(new Set(String(p.tags).toLowerCase().split(/\s+/).filter(Boolean)));
    for (const t of tags){
      if (!t || exclude.has(t) || t.includes(':')) continue;
      tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
    }
  }
  const sorted = Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1]);
  const maxNodes = clamp(sorted.length, 18, 110);
  const topTags = sorted.slice(0, maxNodes);
  const topSet = new Set(topTags.map(([t]) => t));
  if (!topSet.size) return null;

  const pairCounts = new Map();
  for (const p of posts){
    if (!p?.tags) continue;
    const tags = Array.from(new Set(String(p.tags).toLowerCase().split(/\s+/).filter(t => topSet.has(t))));
    if (tags.length < 2) continue;
    const limited = tags.slice(0, 28);
    for (let i = 0; i < limited.length; i++){
      for (let j = i + 1; j < limited.length; j++){
        const a = limited[i];
        const b = limited[j];
        const key = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
        pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
      }
    }
  }
  const minCo = posts.length > 80 ? 3 : (posts.length > 30 ? 2 : 1);
  let edges = [];
  let maxCo = 1;
  for (const [key, count] of pairCounts.entries()){
    if (count < minCo) continue;
    if (count > maxCo) maxCo = count;
    const [a, b] = key.split('\u0000');
    edges.push({ source: a, target: b, weight: count });
  }
  if (edges.length > 1200){
    edges.sort((a, b) => b.weight - a.weight);
    edges = edges.slice(0, 1200);
  }

  const maxCount = topTags[0]?.[1] || 1;
  const nodes = topTags.map(([tag, count]) => ({
    id: tag,
    label: tag,
    weight: clamp(count / maxCount, 0.1, 1)
  }));
  const linkWeightMax = Math.max(1, maxCo);
  let links = edges.map((e) => ({
    source: e.source,
    target: e.target,
    weight: clamp(e.weight / linkWeightMax, 0.1, 1)
  }));
  links = filterEdges(links, nodes.length);
  return { nodes, links };
}

function filterEdges(links, nodeCount){
  if (!links.length) return links;
  const minWeight = nodeCount > 90 ? 0.32 : (nodeCount > 60 ? 0.24 : 0.18);
  let filtered = links.filter(l => l.weight >= minWeight);
  const maxPerNode = nodeCount > 80 ? 3 : 4;
  const buckets = new Map();
  filtered.forEach((l, idx) => {
    const listA = buckets.get(l.source) || []; listA.push({ idx, w: l.weight }); buckets.set(l.source, listA);
    const listB = buckets.get(l.target) || []; listB.push({ idx, w: l.weight }); buckets.set(l.target, listB);
  });
  const keep = new Set();
  for (const [, list] of buckets){
    list.sort((a, b) => b.w - a.w);
    for (const item of list.slice(0, maxPerNode)) keep.add(item.idx);
  }
  filtered = filtered.filter((_, idx) => keep.has(idx));
  return filtered.length ? filtered : links.slice(0, Math.min(200, links.length));
}

function normalizeGraph(data, allowFallback = true){
  const rawNodes = Array.isArray(data?.nodes) ? data.nodes : [];
  if (!rawNodes.length && allowFallback){
    return normalizeGraph(buildDemoGraph(), false);
  }
  const nodes = rawNodes.map((n, i) => {
    const rawId = (n && (n.id ?? n.name ?? n.label)) ?? String(i);
    const id = String(rawId);
    const weight = clamp(Number(n?.weight ?? n?.size ?? n?.value ?? 0.5), 0.1, 1);
    const group = n?.group ?? n?.category ?? n?.cluster ?? n?.folder ?? '';
    return {
      id,
      label: n?.label ? String(n.label) : id,
      weight,
      group: group ? String(group) : '',
    };
  });
  const idIndex = new Map(nodes.map((n, i) => [n.id, i]));
  const rawLinks = Array.isArray(data?.links)
    ? data.links
    : (Array.isArray(data?.edges) ? data.edges : []);
  const resolveIndex = (val) => {
    if (typeof val === 'number') return Number.isFinite(val) ? val : null;
    if (val && typeof val === 'object'){
      const objId = val.id ?? val.name ?? val.label;
      return idIndex.get(String(objId));
    }
    return idIndex.get(String(val));
  };
  const links = rawLinks.map((l) => {
    const s = resolveIndex(l?.source);
    const t = resolveIndex(l?.target);
    if (s == null || t == null) return null;
    return {
      source: s,
      target: t,
      weight: clamp(Number(l?.weight ?? l?.value ?? 0.5), 0.1, 1),
    };
  }).filter(Boolean);
  const graph = { nodes, links };
  applyTagTypeStyles(graph);
  graph.adj = buildAdjacency(graph);
  return graph;
}

function applyGroups(graph){
  const nodes = graph.nodes;
  const links = graph.links;
  const palette = [
    '#ff6b6b', '#f06595', '#cc5de8', '#845ef7',
    '#5c7cfa', '#339af0', '#22b8cf', '#20c997',
    '#51cf66', '#94d82d', '#fcc419', '#ff922b'
  ];
  const typeColors = {
    character: getCssVar('--tag-character', '#f27aa8'),
    copyright: getCssVar('--tag-copyright', '#f97373'),
    artist: getCssVar('--tag-artist', '#f2b35e'),
    general: getCssVar('--tag-general', '#6c8df5'),
    meta: getCssVar('--tag-meta', '#9aa3b3'),
    unknown: getCssVar('--tag-unknown', '#6b7280'),
  };
  const rawGroups = nodes.map(n => n.group && n.group.trim());
  let groups = rawGroups.some(Boolean) ? rawGroups : nodes.map(n => inferGroup(n.label));
  if (!groups.some(Boolean) && links.length){
    groups = labelPropagation(nodes, links).map(id => `cluster-${id}`);
  }
  if (!groups.some(Boolean)){
    groups = nodes.map((n, i) => `cluster-${i % palette.length}`);
  }
  const unique = new Map();
  groups = groups.map((g, i) => {
    const key = g || `hash-${Math.floor(hash01(nodes[i].id) * palette.length)}`;
    if (!unique.has(key)) unique.set(key, unique.size);
    return key;
  });
  graph.groups = groups;
  graph.nodeColors = groups.map((g) => {
    const normalized = String(g || '').toLowerCase();
    if (typeColors[normalized]) return typeColors[normalized];
    const idx = unique.get(g) ?? 0;
    return palette[idx % palette.length];
  });
}

function labelPropagation(nodes, links){
  const n = nodes.length;
  const labels = Array.from({ length: n }, (_, i) => i);
  const neighbors = Array.from({ length: n }, () => []);
  links.forEach((l) => {
    neighbors[l.source]?.push([l.target, l.weight || 1]);
    neighbors[l.target]?.push([l.source, l.weight || 1]);
  });
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => hash01(nodes[a].id) - hash01(nodes[b].id));
  for (let iter = 0; iter < 10; iter++){
    for (const i of order){
      const votes = new Map();
      for (const [j, w] of neighbors[i]){
        const lab = labels[j];
        votes.set(lab, (votes.get(lab) || 0) + w);
      }
      if (!votes.size) continue;
      let best = labels[i];
      let bestScore = -Infinity;
      for (const [lab, score] of votes.entries()){
        if (score > bestScore){
          bestScore = score;
          best = lab;
        }
      }
      labels[i] = best;
    }
  }
  return labels;
}

function applyTagTypeStyles(graph){
  graph.nodes.forEach((n) => {
    if (typeof n.baseWeight !== 'number') n.baseWeight = n.weight || 0.1;
    const type = getTagType(n.id);
    const group = typeToGroup(type);
    if (group) n.group = group;
    else if (!n.group) n.group = 'unknown';
    const mult = tagTypeMultiplier(type);
    n.weight = clamp(n.baseWeight * mult, 0.1, 1.4);
  });
  applyGroups(graph);
}

function typeToGroup(type){
  if (!Number.isFinite(type)) return 'general';
  return TAG_TYPE_GROUPS[type] || 'general';
}

function tagTypeMultiplier(type){
  switch (Number(type)){
    case 4: return 1.6; // character
    case 3: return 1.5; // copyright
    case 2: return 1.35; // copyright-ish
    case 1: return 1.15; // artist
    case 5: return 0.75; // meta
    case 0: return 0.9; // general
    default: return 1;
  }
}

function getTagType(tag){
  if (!tag) return undefined;
  const key = String(tag).toLowerCase();
  return tagTypeCache.get(key);
}

function inferGroup(label){
  if (!label) return '';
  const raw = String(label);
  if (raw.includes('/')) return raw.split('/')[0];
  if (raw.includes('\\')) return raw.split('\\')[0];
  if (raw.includes('::')) return raw.split('::')[0];
  if (raw.includes('-')) return raw.split('-')[0];
  return '';
}

function buildComponents(count, links){
  const adj = Array.from({ length: count }, () => []);
  links.forEach((l) => {
    adj[l.source]?.push(l.target);
    adj[l.target]?.push(l.source);
  });
  const comp = new Array(count).fill(-1);
  let idx = 0;
  for (let i = 0; i < count; i++){
    if (comp[i] !== -1) continue;
    const stack = [i];
    comp[i] = idx;
    while (stack.length){
      const cur = stack.pop();
      for (const n of adj[cur]){
        if (comp[n] === -1){
          comp[n] = idx;
          stack.push(n);
        }
      }
    }
    idx++;
  }
  return comp;
}

function buildAdjacency(graph){
  const count = graph?.nodes?.length || 0;
  const adj = Array.from({ length: count }, () => []);
  if (!count || !graph?.links?.length) return adj;
  graph.links.forEach((l) => {
    const s = Number(l?.source);
    const t = Number(l?.target);
    if (!Number.isInteger(s) || !Number.isInteger(t)) return;
    if (s < 0 || t < 0 || s >= count || t >= count) return;
    const w = clamp(Number(l?.weight || 0.5), 0.1, 1);
    adj[s].push({ i: t, w });
    adj[t].push({ i: s, w });
  });
  return adj;
}

function buildDragActive(graph, positions, root){
  if (!graph || !positions) return null;
  if (!graph.adj || graph.adj.length !== graph.nodes.length){
    graph.adj = buildAdjacency(graph);
  }
  const adj = graph.adj;
  if (!adj?.length) return null;
  const maxDepth = 2;
  const set = new Set([root]);
  const list = [root];
  const depths = new Array(graph.nodes.length).fill(-1);
  depths[root] = 0;
  const queue = [{ idx: root, depth: 0 }];
  for (let qi = 0; qi < queue.length; qi++){
    const item = queue[qi];
    if (item.depth >= maxDepth) continue;
    for (const edge of adj[item.idx] || []){
      const ni = edge.i;
      if (set.has(ni)) continue;
      set.add(ni);
      list.push(ni);
      depths[ni] = item.depth + 1;
      queue.push({ idx: ni, depth: item.depth + 1 });
    }
  }
  const rest = new Map();
  for (const i of list){
    const pi = positions[i];
    if (!pi) continue;
    for (const edge of adj[i] || []){
      const j = edge.i;
      if (!set.has(j) || j <= i) continue;
      const pj = positions[j];
      if (!pj) continue;
      const dist = Math.hypot(pi.x - pj.x, pi.y - pj.y) || 0.001;
      rest.set(`${i}:${j}`, dist);
    }
  }
  return {
    root,
    list,
    set,
    rest,
    depths,
    fx: new Float32Array(graph.nodes.length),
    fy: new Float32Array(graph.nodes.length),
  };
}

function applyLocalPhysics(graph, positions, dragState, moveX, moveY, settle = false){
  const active = dragState?.active;
  if (!active || !positions || !graph) return;
  if (!graph.adj || graph.adj.length !== graph.nodes.length){
    graph.adj = buildAdjacency(graph);
  }
  const adj = graph.adj;
  const list = active.list;
  const set = active.set;
  const rest = active.rest;
  const fx = active.fx;
  const fy = active.fy;
  const root = active.root;
  const distMove = Math.hypot(moveX, moveY);
  const step = clamp(distMove * 0.04 + (settle ? 0.04 : 0.06), 0.04, 0.2);
  const spring = settle ? 0.045 : 0.072;
  const damping = settle ? 0.9 : 0.82;
  const follow = settle ? 0 : 0.12;

  for (const idx of list){
    fx[idx] = 0;
    fy[idx] = 0;
  }

  if (follow){
    for (const idx of list){
      if (idx === root) continue;
      fx[idx] += moveX * follow;
      fy[idx] += moveY * follow;
    }
  }

  for (const i of list){
    const pi = positions[i];
    if (!pi) continue;
    for (const edge of adj[i] || []){
      const j = edge.i;
      if (!set.has(j) || j <= i) continue;
      const pj = positions[j];
      if (!pj) continue;
      const dx = pi.x - pj.x;
      const dy = pi.y - pj.y;
      const dist = Math.hypot(dx, dy) || 0.001;
      const key = `${i}:${j}`;
      const restLen = rest.get(key) || dist;
      const weight = clamp(Number(edge.w || 0.5), 0.1, 1);
      const force = (dist - restLen) * spring * (0.6 + weight * 0.6);
      const fxij = (dx / dist) * force;
      const fyij = (dy / dist) * force;
      fx[i] -= fxij;
      fy[i] -= fyij;
      fx[j] += fxij;
      fy[j] += fyij;
    }
  }

  for (const idx of list){
    if (!settle && idx === root) continue;
    const v = sim.velocities[idx];
    v.x = (v.x + fx[idx]) * damping;
    v.y = (v.y + fy[idx]) * damping;
    positions[idx].x += v.x * step;
    positions[idx].y += v.y * step;
  }
  if (!settle && sim.velocities[root]){
    sim.velocities[root].x = 0;
    sim.velocities[root].y = 0;
  }
}

function seedLocalInertia(dragState, vx, vy){
  const active = dragState?.active;
  if (!active) return;
  const list = active.list || [];
  const depths = active.depths || [];
  const maxV = 10;
  for (const idx of list){
    const d = depths[idx] ?? 0;
    const scale = d === 0 ? 0.6 : (d === 1 ? 0.4 : 0.25);
    const v = sim.velocities[idx];
    v.x = clamp(v.x + vx * scale, -maxV, maxV);
    v.y = clamp(v.y + vy * scale, -maxV, maxV);
  }
}

function cancelLocalSettle(){
  drag.settleUntil = 0;
  if (drag.settleRaf){
    cancelAnimationFrame(drag.settleRaf);
    drag.settleRaf = 0;
  }
}

function startLocalSettle(){
  if (!drag.active) return;
  drag.settleUntil = performance.now() + 1200;
  if (!drag.settleRaf){
    drag.settleRaf = requestAnimationFrame(tickLocalSettle);
  }
}

function tickLocalSettle(ts){
  drag.settleRaf = 0;
  if (!drag.active || !currentGraph || !lastLayout) return;
  if (ts > drag.settleUntil){
    drag.settleUntil = 0;
    return;
  }
  applyLocalPhysics(currentGraph, lastLayout, drag, 0, 0, true);
  scheduleDraw();
  drag.settleRaf = requestAnimationFrame(tickLocalSettle);
}

function layoutGraph(graph, width, height){
  const nodes = graph.nodes;
  if (!nodes.length){
    return [];
  }
  const center = { x: width / 2, y: height / 2 };
  const pad = 28;
  const positions = new Array(nodes.length);
  const sizes = nodes.map(n => nodeSize(n.weight));
  const spreadX = Math.max(80, width * 0.32);
  const spreadY = Math.max(80, height * 0.32);
  nodes.forEach((n, i) => {
    const gx = (hash01(n.id) - 0.5) * 2;
    const gy = (hash01(`${n.id}-y`) - 0.5) * 2;
    positions[i] = {
      x: center.x + gx * spreadX,
      y: center.y + gy * spreadY,
      size: sizes[i],
    };
  });

  const n = nodes.length;
  const area = Math.max(1, width * height);
  const k = Math.sqrt(area / Math.max(1, n)) * 0.42;
  const iterations = clamp(240 - n, 100, 200);
  let temp = k * 0.22;
  const disp = new Array(n);
  const gravity = 0.035;
  const boundary = 0.015;

  for (let iter = 0; iter < iterations; iter++){
    for (let i = 0; i < n; i++){
      disp[i] = { x: 0, y: 0 };
    }
    for (let i = 0; i < n; i++){
      const pi = positions[i];
      for (let j = i + 1; j < n; j++){
        const pj = positions[j];
        let dx = pi.x - pj.x;
        let dy = pi.y - pj.y;
        let dist = Math.hypot(dx, dy) || 0.001;
        const minDist = pi.size + pj.size + 6;
        if (dist < minDist){
          dist = minDist;
        }
        const rep = (k * k) / dist;
        const rx = (dx / dist) * rep;
        const ry = (dy / dist) * rep;
        disp[i].x += rx;
        disp[i].y += ry;
        disp[j].x -= rx;
        disp[j].y -= ry;
      }
    }
    for (const link of graph.links){
      const s = positions[link.source];
      const t = positions[link.target];
      if (!s || !t) continue;
      let dx = s.x - t.x;
      let dy = s.y - t.y;
      let dist = Math.hypot(dx, dy) || 0.001;
      const weight = clamp(Number(link.weight || 0.5), 0.1, 1);
      const force = (dist - k) * (0.08 + weight * 0.18);
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      disp[link.source].x -= fx;
      disp[link.source].y -= fy;
      disp[link.target].x += fx;
      disp[link.target].y += fy;
    }
    for (let i = 0; i < n; i++){
      const p = positions[i];
      const d = disp[i];
      d.x += (center.x - p.x) * gravity;
      d.y += (center.y - p.y) * gravity;
      if (p.x < pad) d.x += (pad - p.x) * boundary;
      if (p.x > width - pad) d.x -= (p.x - (width - pad)) * boundary;
      if (p.y < pad) d.y += (pad - p.y) * boundary;
      if (p.y > height - pad) d.y -= (p.y - (height - pad)) * boundary;
      const dist = Math.hypot(d.x, d.y) || 0.001;
      const step = Math.min(dist, temp);
      p.x += (d.x / dist) * step;
      p.y += (d.y / dist) * step;
    }
    temp *= 0.97;
  }
  const bounds = positions.reduce((acc, p) => {
    acc.minX = Math.min(acc.minX, p.x);
    acc.maxX = Math.max(acc.maxX, p.x);
    acc.minY = Math.min(acc.minY, p.y);
    acc.maxY = Math.max(acc.maxY, p.y);
    return acc;
  }, { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanY = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY, 1) * 0.9;
  const shrink = 0.9;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  positions.forEach((p) => {
    p.x = center.x + (p.x - centerX) * scale * shrink;
    p.y = center.y + (p.y - centerY) * scale * shrink;
    p.x = clamp(p.x, pad, width - pad);
    p.y = clamp(p.y, pad, height - pad);
  });
  return positions;
}

function getLayout(graph, width, height){
  if (!graph.layout || graph.layout.width !== width || graph.layout.height !== height){
    graph.layout = { width, height, positions: layoutGraph(graph, width, height) };
  }
  return graph.layout.positions;
}

function ensureSimState(graph, width, height){
  sim.width = width;
  sim.height = height;
  if (sim.velocities.length !== graph.nodes.length){
    sim.velocities = graph.nodes.map(() => ({ x: 0, y: 0 }));
  }
}

function drawHover(ctx, graph, positions){
  if (hover.idx < 0) return;
  const p = positions[hover.idx];
  if (!p) return;
  const node = graph.nodes?.[hover.idx];
  const color = graph.nodeColors?.[hover.idx] || getGroupColor(node?.group);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.size + 3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawLabel(ctx, rect, graph, positions){
  if (hover.idx < 0) return;
  const p = positions[hover.idx];
  if (!p) return;
  const label = graph.nodes?.[hover.idx]?.label || graph.nodes?.[hover.idx]?.id;
  if (!label) return;
  const group = String(graph.nodes?.[hover.idx]?.group || '').toLowerCase();
  const groupLabel = formatGroupLabel(group);
  const weight = Number(graph.nodes?.[hover.idx]?.weight);
  const weightText = Number.isFinite(weight) ? `w ${weight.toFixed(2)}` : '';
  const labelText = [label, groupLabel, weightText].filter(Boolean).join(' | ');
  const fontFamily = getFontFamily();
  ctx.save();
  ctx.font = `12px ${fontFamily}`;
  const padX = 8;
  const padY = 6;
  const textW = ctx.measureText(labelText).width;
  const boxW = textW + padX * 2;
  const boxH = 22;
  const sx = p.x * view.scale + view.tx;
  const sy = p.y * view.scale + view.ty;
  let x = sx + 10;
  let y = sy - boxH - 6;
  if (x + boxW > rect.width - 6) x = rect.width - boxW - 6;
  if (x < 6) x = 6;
  if (y < 6) y = sy + 10;
  ctx.fillStyle = 'rgba(10, 12, 18, 0.78)';
  const stroke = graph.nodeColors?.[hover.idx] || getGroupColor(graph.nodes?.[hover.idx]?.group);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  ctx.beginPath();
  roundRect(ctx, x, y, boxW, boxH, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = getCssVar('--text', '#f2f5fb');
  ctx.globalAlpha = 0.92;
  ctx.fillText(labelText, x + padX, y + boxH - padY);
  ctx.restore();
}

function drawLinks(ctx, graph, positions){
  const edge = getCssVar('--border', '#2a303b');
  ctx.save();
  ctx.strokeStyle = edge;
  graph.links.forEach((link) => {
    const s = positions[link.source];
    const t = positions[link.target];
    if (!s || !t) return;
    const w = clamp(Number(link.weight || 0.5), 0.1, 1);
    ctx.globalAlpha = 0.12 + w * 0.16;
    ctx.lineWidth = 0.4 + w * 0.4;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(t.x, t.y);
    ctx.stroke();
  });
  ctx.restore();
}

function drawNodes(ctx, graph, positions){
  const nodeColor = getCssVar('--text', '#f2f5fb');
  const edge = getCssVar('--border', '#2a303b');
  graph.nodes.forEach((node, i) => {
    const p = positions[i];
    if (!p) return;
    const w = clamp(Number(node.weight || 0.5), 0.1, 1);
    const r = p.size;
    ctx.save();
    ctx.beginPath();
    ctx.fillStyle = graph.nodeColors?.[i] || getGroupColor(node.group) || nodeColor;
    ctx.globalAlpha = 0.35 + w * 0.5;
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 8 + w * 10;
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = edge;
    ctx.lineWidth = 0.5;
    ctx.stroke();
    ctx.restore();
  });
}

function nodeSize(weight){
  return 2 + weight * 6;
}

function hash01(str){
  let h = 2166136261;
  for (let i = 0; i < str.length; i++){
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

function getCssVar(name, fallback){
  try{
    const v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return v ? v.trim() : fallback;
  }catch{
    return fallback;
  }
}

function getFontFamily(){
  try{
    return getComputedStyle(document.body).fontFamily || 'sans-serif';
  }catch{
    return 'sans-serif';
  }
}

function getGroupColor(group){
  const g = String(group || 'general').toLowerCase();
  if (g.startsWith('cluster-')){
    return getClusterColor(g);
  }
  switch (g){
    case 'character': return getCssVar('--tag-character', '#f27aa8');
    case 'copyright': return getCssVar('--tag-copyright', '#f97373');
    case 'artist': return getCssVar('--tag-artist', '#f2b35e');
    case 'meta': return getCssVar('--tag-meta', '#9aa3b3');
    case 'general': return getCssVar('--tag-general', '#6c8df5');
    default: return getCssVar('--tag-general', '#6c8df5');
  }
}

const clusterColorCache = new Map();
function getClusterColor(group){
  if (clusterColorCache.has(group)) return clusterColorCache.get(group);
  const palette = [
    '#ff6b6b', '#f06595', '#cc5de8', '#845ef7',
    '#5c7cfa', '#339af0', '#22b8cf', '#20c997',
    '#51cf66', '#94d82d', '#fcc419', '#ff922b'
  ];
  const idx = Math.floor(hash01(group) * palette.length);
  const color = palette[idx % palette.length];
  clusterColorCache.set(group, color);
  return color;
}

function formatGroupLabel(group){
  if (!group || group === 'unknown') return '';
  return group.charAt(0).toUpperCase() + group.slice(1);
}

async function primeVizTagTypes(){
  if (!currentGraph || !currentGraph.nodes?.length) return;
  if (String(settings?.provider || 'rule34') !== 'rule34') return;
  const tags = currentGraph.nodes.map(n => String(n.id || '').toLowerCase()).filter(Boolean);
  const toFetch = tags.filter(t => !tagTypeCache.has(t)).slice(0, 120);
  if (!toFetch.length) return;
  await fetchTagTypes(toFetch, 6);
  if (!currentGraph) return;
  applyTagTypeStyles(currentGraph);
  currentGraph.layout = null;
  scheduleDraw();
}

async function fetchTagTypes(tags, concurrency = 6){
  let i = 0;
  let active = 0;
  return await new Promise((resolve) => {
    const step = () => {
      if (i >= tags.length && active === 0) return resolve();
      while (active < concurrency && i < tags.length){
        const tag = tags[i++];
        active++;
        API.tagMeta(tag, 'rule34')
          .then((meta) => {
            const arr = Array.isArray(meta) ? meta : (Array.isArray(meta?.tag) ? meta.tag : []);
            if (!arr.length) return;
            const low = String(tag).toLowerCase();
            const obj = arr.find(o => String(o.name||'').toLowerCase() === low) || arr[0];
            const type = Number(obj?.type);
            if (Number.isFinite(type)) tagTypeCache.set(low, type);
          })
          .catch(()=>{})
          .finally(() => { active--; step(); });
      }
    };
    step();
  });
}

function roundRect(ctx, x, y, w, h, r){
  const radius = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
}

function startDrag(e, stage, canvas){
  cancelLocalSettle();
  drag.x = e.clientX;
  drag.y = e.clientY;
  drag.vx = 0;
  drag.vy = 0;
  hover.idx = -1;
  const hit = pickNodeAt(e.clientX, e.clientY, canvas);
  if (hit >= 0){
    drag.mode = 'node';
    drag.node = hit;
    stopSim();
    drag.active = buildDragActive(currentGraph, lastLayout, hit);
  } else {
    drag.mode = 'pan';
    drag.node = -1;
    drag.active = null;
    stage?.classList.add('grabbing');
    stopSim();
  }
  try{ canvas?.setPointerCapture(e.pointerId); }catch{}
}

function moveDrag(e){
  if (!drag.mode) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  drag.x = e.clientX;
  drag.y = e.clientY;
  if (drag.mode === 'node' && lastLayout && lastLayout[drag.node]){
    const moveX = dx / view.scale;
    const moveY = dy / view.scale;
    drag.vx = drag.vx * 0.6 + moveX * 0.4;
    drag.vy = drag.vy * 0.6 + moveY * 0.4;
    lastLayout[drag.node].x += moveX;
    lastLayout[drag.node].y += moveY;
    applyLocalPhysics(currentGraph, lastLayout, drag, moveX, moveY, false);
    if (sim.velocities[drag.node]){
      sim.velocities[drag.node].x = 0;
      sim.velocities[drag.node].y = 0;
    }
  } else if (drag.mode === 'pan'){
    view.tx += dx;
    view.ty += dy;
  }
  scheduleDraw();
}

function endDrag(){
  if (!drag.mode) return;
  if (drag.mode === 'node'){
    sim.fixed = -1;
    for (const v of sim.velocities){
      v.x *= 0.1;
      v.y *= 0.1;
    }
    stopSim();
    seedLocalInertia(drag, drag.vx, drag.vy);
    startLocalSettle();
  }
  drag.mode = '';
  drag.node = -1;
  const stage = els?.vizPage?.querySelector('.viz-stage');
  stage?.classList.remove('grabbing');
}

function onWheel(e){
  const canvas = e.currentTarget;
  if (!canvas) return;
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const scale = view.scale;
  const next = clamp(scale * (e.deltaY < 0 ? 1.1 : 0.9), 0.4, 2.2);
  const k = next / scale;
  view.tx = mx - (mx - view.tx) * k;
  view.ty = my - (my - view.ty) * k;
  view.scale = next;
  scheduleDraw();
}

function resetView(stage){
  view.scale = 1;
  view.tx = 0;
  view.ty = 0;
  drag.mode = '';
  drag.node = -1;
  drag.active = null;
  hover.idx = -1;
  stage?.classList.remove('grabbing');
  stopSim();
  cancelLocalSettle();
  scheduleDraw();
}

function pickNodeAt(clientX, clientY, canvas){
  if (!lastLayout || !canvas) return -1;
  const rect = canvas.getBoundingClientRect();
  const x = (clientX - rect.left - view.tx) / view.scale;
  const y = (clientY - rect.top - view.ty) / view.scale;
  let hit = -1;
  let best = Infinity;
  for (let i = 0; i < lastLayout.length; i++){
    const p = lastLayout[i];
    if (!p) continue;
    const dx = x - p.x;
    const dy = y - p.y;
    const dist = Math.hypot(dx, dy);
    const radius = p.size + 6 / Math.max(0.6, view.scale);
    if (dist <= radius && dist < best){
      best = dist;
      hit = i;
    }
  }
  return hit;
}

function startSim(fixedIndex){
  sim.fixed = fixedIndex;
  sim.running = true;
  sim.lastTime = 0;
  if (!simRaf){
    simRaf = requestAnimationFrame(tickSim);
  }
}

function stopSim(){
  sim.running = false;
  sim.fixed = -1;
  sim.settleUntil = 0;
}

function tickSim(ts){
  if (!sim.running){
    simRaf = 0;
    return;
  }
  const dt = Math.min(0.05, (ts - sim.lastTime) / 1000 || 0.016);
  sim.lastTime = ts;
  if (currentGraph && lastLayout && sim.width && sim.height){
    stepSim(currentGraph, lastLayout, dt, sim.width, sim.height);
  }
  draw();
  if (!drag.mode && sim.settleUntil && ts > sim.settleUntil){
    stopSim();
  }
  simRaf = requestAnimationFrame(tickSim);
}

function stepSim(graph, positions, dt, width, height){
  const n = graph.nodes.length;
  if (!n) return;
  const k = Math.sqrt((width * height) / n) * 0.5;
  const repulsion = 900;
  const spring = 0.06;
  const centerPull = 0.02;
  const boundary = 0.03;
  const damping = 0.78;
  const pad = 40;
  const step = dt * 40;
  const fx = new Array(n).fill(0);
  const fy = new Array(n).fill(0);
  for (let i = 0; i < n; i++){
    const pi = positions[i];
    for (let j = i + 1; j < n; j++){
      const pj = positions[j];
      const dx = pi.x - pj.x;
      const dy = pi.y - pj.y;
      const dist = Math.hypot(dx, dy) || 0.001;
      const force = repulsion / (dist * dist);
      const rx = (dx / dist) * force;
      const ry = (dy / dist) * force;
      fx[i] += rx; fy[i] += ry;
      fx[j] -= rx; fy[j] -= ry;
    }
  }
  for (const link of graph.links){
    const s = positions[link.source];
    const t = positions[link.target];
    if (!s || !t) continue;
    const dx = s.x - t.x;
    const dy = s.y - t.y;
    const dist = Math.hypot(dx, dy) || 0.001;
    const weight = clamp(Number(link.weight || 0.5), 0.1, 1);
    const target = k * (1.05 + (1 - weight) * 0.35);
    const force = (dist - target) * spring * (0.4 + weight);
    const sx = (dx / dist) * force;
    const sy = (dy / dist) * force;
    fx[link.source] -= sx; fy[link.source] -= sy;
    fx[link.target] += sx; fy[link.target] += sy;
  }
  const cx = width / 2;
  const cy = height / 2;
  for (let i = 0; i < n; i++){
    const p = positions[i];
    fx[i] += (cx - p.x) * centerPull;
    fy[i] += (cy - p.y) * centerPull;
    if (p.x < pad) fx[i] += (pad - p.x) * boundary;
    if (p.x > width - pad) fx[i] -= (p.x - (width - pad)) * boundary;
    if (p.y < pad) fy[i] += (pad - p.y) * boundary;
    if (p.y > height - pad) fy[i] -= (p.y - (height - pad)) * boundary;
  }
  for (let i = 0; i < n; i++){
    if (i === sim.fixed){
      sim.velocities[i].x = 0;
      sim.velocities[i].y = 0;
      continue;
    }
    const v = sim.velocities[i];
    v.x = (v.x + fx[i] * step) * damping;
    v.y = (v.y + fy[i] * step) * damping;
    const maxV = 80;
    if (v.x > maxV) v.x = maxV;
    if (v.x < -maxV) v.x = -maxV;
    if (v.y > maxV) v.y = maxV;
    if (v.y < -maxV) v.y = -maxV;
    positions[i].x += v.x * step;
    positions[i].y += v.y * step;
  }
}

function updateHover(e, canvas){
  if (!currentGraph || !lastLayout) return;
  if (drag.mode) return;
  const hit = pickNodeAt(e.clientX, e.clientY, canvas);
  if (hit !== hover.idx){
    hover.idx = hit;
    scheduleDraw();
  }
}

function clearHover(){
  if (hover.idx !== -1){
    hover.idx = -1;
    scheduleDraw();
  }
}
