// Core utilities used across the app

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

export function uid() { return Math.random().toString(36).slice(2, 9); }

export function debounce(fn, ms = 250) {
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function escapeHtml(s=''){
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

export const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
export function haptic(pattern){
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch {}
}

// Scroll lock helpers
let scrollLockCount = 0;
let savedScrollY = 0;
export function lockScroll(){
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
export function unlockScroll(){
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

// Bottom sheet drag helper used by overlays
export function enableSheetDrag(overlayEl, onClose){
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

// Small SVG helpers used by Analytics
export function sparkline(values){
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

export function donutChart(pairs, colors){
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
  const legend = pairs.map((p,i) => `<div class="item"><span class="swatch" style="background:${colors[i%colors.length]}"></span>${p[0]} - ${p[1]}</div>`).join('');
  return `<div class="donut"><svg viewBox="0 0 120 120">${segs.join('')}</svg><div class="legend">${legend}</div></div>`;
}

