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
// It returns { smallText, overlaps, badText, lowContrast }:
//   - smallText: visible text whose computed font size is below the floor,
//     as { text, px }, one entry per distinct text and size;
//   - overlaps: pairs of elements marked `data-check-overlap` whose boxes
//     intersect, as { a, b } (the attribute's value, or a short description).
//     An element that is entirely covered by something else (the corner QR
//     under the claim overlay, say) is not on screen, so it is left out;
//   - badText: visible text containing "undefined", "NaN" or "Invalid Date";
//   - lowContrast: visible text that cannot be told from what is behind it, as
//     { text, ratio }: a contrast ratio below 3 (the WCAG floor for large
//     text) between its colour and the background colours of the elements it
//     sits inside. White event text on a white book's screen went out to
//     review this way. It only reads background colours: text over a
//     background image or gradient is left out, as it cannot be judged here.
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

  // Any CSS colour syntax (rgb, oklab, a name) read back as [r, g, b, alpha]
  // by painting it on a 1x1 canvas.
  const colourCanvas = document.createElement('canvas');
  colourCanvas.width = 1;
  colourCanvas.height = 1;
  const colourContext = colourCanvas.getContext('2d', { willReadFrequently: true });
  const colourCache = new Map();
  function readColour(css) {
    if (colourCache.has(css)) return colourCache.get(css);
    colourContext.clearRect(0, 0, 1, 1);
    colourContext.fillStyle = css;
    colourContext.fillRect(0, 0, 1, 1);
    const data = colourContext.getImageData(0, 0, 1, 1).data;
    const colour = [data[0], data[1], data[2], data[3] / 255];
    colourCache.set(css, colour);
    return colour;
  }

  function blend(top, under) {
    const alpha = top[3];
    return [0, 1, 2].map((i) => top[i] * alpha + under[i] * (1 - alpha)).concat(1);
  }

  function luminance(colour) {
    const [r, g, b] = [0, 1, 2].map((i) => {
      const channel = colour[i] / 255;
      return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  // The colour behind an element's text: the background colours of the
  // element and everything it sits inside, painted from the page (white) up.
  // Null when one of them has a background image, which cannot be read here.
  function backgroundBehind(el) {
    const chain = [];
    for (let node = el; node; node = node.parentElement) chain.push(node);
    let colour = [255, 255, 255, 1];
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      const style = getComputedStyle(chain[i]);
      if (style.backgroundImage && style.backgroundImage !== 'none') return null;
      colour = blend(readColour(style.backgroundColor), colour);
    }
    return colour;
  }

  const MIN_CONTRAST = 3;
  function contrastRatio(el) {
    const background = backgroundBehind(el);
    if (!background) return null;
    const text = blend(readColour(getComputedStyle(el).color), background);
    const a = luminance(text);
    const b = luminance(background);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }

  const smallSeen = new Set();
  const smallText = [];
  const badSeen = new Set();
  const badText = [];
  const contrastSeen = new Set();
  const lowContrast = [];

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
    const ratio = contrastRatio(parent);
    if (ratio !== null && ratio < MIN_CONTRAST) {
      const short = text.length > 80 ? text.slice(0, 77) + '...' : text;
      if (!contrastSeen.has(short)) {
        contrastSeen.add(short);
        lowContrast.push({ text: short, ratio: Math.round(ratio * 100) / 100 });
      }
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

  return { smallText, overlaps, badText, lowContrast };
};
