// scripts/check-render.js
//
// Render check for the readable-text floors (spec 5.7). Self-contained, no
// imports: paste the whole file into a page (the browser tool's JavaScript
// runner, or the devtools console) and call it, for example
//
//   checkRender({ floorPx: 32 })   // the TV at 1920x1080
//   checkRender({ floorPx: 22 })   // the TV at 1280x720
//   checkRender({ floorPx: 14 })   // a phone at 375x812
//
// The file is one assignment, so evaluating it also returns the function:
// `eval(source)({ floorPx: 32 })`.
//
// It returns { smallText, overlaps, badText }:
//   - smallText: visible text whose computed font size is below the floor,
//     as { text, px }, one entry per distinct text and size;
//   - overlaps: pairs of elements marked `data-check-overlap` whose boxes
//     intersect, as { a, b } (the attribute's value, or a short description).
//     An element that is entirely covered by something else (the corner QR
//     under the claim overlay, say) is not on screen, so it is left out;
//   - badText: visible text containing "undefined", "NaN" or "Invalid Date".
//
// "Visible" means rendered with a size, not display:none, not
// visibility:hidden, not transparent and not clipped away like screen-reader
// only text. Text below the fold still counts: a phone scrolls.

globalThis.checkRender = function checkRender(options) {
  const floorPx = typeof options === 'number' ? options : Number(options && options.floorPx);
  if (!Number.isFinite(floorPx) || floorPx <= 0) {
    throw new Error('checkRender needs a font-size floor in pixels, for example checkRender({ floorPx: 32 })');
  }

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TITLE', 'HEAD']);
  const BAD_TEXT = /undefined|NaN|Invalid Date/;
  const visibilityCache = new Map();

  function describe(el) {
    const label = el.getAttribute('data-check-overlap');
    if (label) return label;
    const aria = el.getAttribute('aria-label');
    if (aria) return el.tagName.toLowerCase() + '[' + aria + ']';
    const firstClass = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean)[0];
    return el.tagName.toLowerCase() + (firstClass ? '.' + firstClass : '');
  }

  // Not rendered, hidden, fully transparent, or clipped down to nothing by
  // an ancestor (the sr-only pattern: a 1px box with overflow hidden).
  function isElementVisible(el) {
    if (visibilityCache.has(el)) return visibilityCache.get(el);
    let visible = true;
    if (typeof el.checkVisibility === 'function') {
      visible = el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    }
    if (visible) {
      for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
          visible = false;
          break;
        }
        if (style.overflow !== 'visible' || style.clip !== 'auto') {
          const rect = node.getBoundingClientRect();
          if (rect.width <= 1 || rect.height <= 1) {
            visible = false;
            break;
          }
        }
      }
    }
    visibilityCache.set(el, visible);
    return visible;
  }

  function hasRenderedBox(textNode) {
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const rects = Array.from(range.getClientRects());
    range.detach();
    return rects.some((r) => r.width > 0 && r.height > 0);
  }

  const smallSeen = new Set();
  const smallText = [];
  const badSeen = new Set();
  const badText = [];

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const parent = node.parentElement;
    if (!parent || SKIP_TAGS.has(parent.tagName) || parent.closest('svg title, svg desc')) continue;
    if (!isElementVisible(parent) || !hasRenderedBox(node)) continue;

    const px = parseFloat(getComputedStyle(parent).fontSize);
    // A hundredth of a pixel of rounding is not a failure.
    if (Number.isFinite(px) && px < floorPx - 0.01) {
      const short = text.length > 80 ? text.slice(0, 77) + '...' : text;
      const rounded = Math.round(px * 10) / 10;
      const key = short + '|' + rounded;
      if (!smallSeen.has(key)) {
        smallSeen.add(key);
        smallText.push({ text: short, px: rounded });
      }
    }
    if (BAD_TEXT.test(text) && !badSeen.has(text)) {
      badSeen.add(text);
      badText.push(text);
    }
  }

  // On screen: some part of the box is the topmost thing at that point. A
  // 5x5 grid of sample points, inset so borders and rounding do not count.
  function isOnTop(el, rect) {
    for (let i = 0; i < 5; i += 1) {
      for (let j = 0; j < 5; j += 1) {
        const x = rect.left + (rect.width * (i + 0.5)) / 5;
        const y = rect.top + (rect.height * (j + 0.5)) / 5;
        if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue;
        const hit = document.elementFromPoint(x, y);
        if (hit && (hit === el || el.contains(hit))) return true;
      }
    }
    return false;
  }

  const marked = Array.from(document.querySelectorAll('[data-check-overlap]'))
    .map((el) => ({ el, rect: el.getBoundingClientRect() }))
    .filter(({ el, rect }) => rect.width > 0 && rect.height > 0 && isElementVisible(el) && isOnTop(el, rect));

  const overlaps = [];
  // Boxes that only touch, or overlap by a pixel of rounding, are fine.
  const TOLERANCE_PX = 1;
  for (let i = 0; i < marked.length; i += 1) {
    for (let j = i + 1; j < marked.length; j += 1) {
      const a = marked[i];
      const b = marked[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const width = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
      const height = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
      if (width > TOLERANCE_PX && height > TOLERANCE_PX) {
        overlaps.push({ a: describe(a.el), b: describe(b.el) });
      }
    }
  }

  return { smallText, overlaps, badText };
};
