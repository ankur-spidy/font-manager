/**
 * ============================================================
 *  Font Manager — Main Script
 *  Browse, search, filter by language & alphabet, preview fonts.
 * ============================================================
 */

// ── Default preview text ────────────────────────────────────
const DEFAULT_PREVIEW = `The quick brown fox jumps over the lazy dog\nABCDEFGHIJKLMNOPQRSTUVWXYZ\nabcdefghijklmnopqrstuvwxyz\n1234567890`;

// ── Unicode ranges for language detection ──────────────────
const LANG_RANGES = {
  bengali: /[\u0980-\u09FF]/,   // Bengali / Bangla script
  hindi:   /[\u0900-\u097F]/,   // Devanagari (Hindi, Marathi, etc.)
  arabic:  /[\u0600-\u06FF\u0750-\u077F]/,
  chinese: /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/,
};

// ── State ───────────────────────────────────────────────────
let allFonts       = [];
let displayedFonts = [];
let currentSort    = 'asc';
let currentFontSize = 24;
let previewText    = DEFAULT_PREVIEW;
let searchQuery    = '';
let activeLang     = 'all';   // 'all' | 'english' | 'bengali' | 'hindi' | 'arabic' | 'chinese'
let activeLetter   = 'all';   // 'all' | '0' | 'A' … 'Z'

let loadedFontFaces = new Set();
let batchSize  = 50;
let currentBatch = 0;
let isLoading  = false;
let observer   = null;
let fontObserver = null;

// ── DOM refs ────────────────────────────────────────────────
let fontGrid, skeletonGrid, searchInput, searchClear, previewInput,
    fontSizeSlider, fontSizeLabel, sortBtn, sortLabel, themeToggle,
    fontCountBadge, noFontsMessage, toastContainer, sentinel,
    langTabs, alphaFilter;

// ─────────────────────────────────────────────────────────────
//  Init
// ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  cacheDOMRefs();
  loadThemePreference();
  buildAlphaFilter();   // render A–Z buttons dynamically
  showSkeletons();
  fetchFonts();
  setupEventListeners();
  adjustLayout();
});

// Recalculate sticky bar offsets dynamically
function adjustLayout() {
  const header = document.getElementById('main-header');
  const controlsBar = document.getElementById('controls-bar');
  const filterBar = document.getElementById('filter-bar');
  const gridContainer = document.querySelector('.font-grid-container');

  if (!header || !controlsBar || !filterBar || !gridContainer) return;

  const headerH = header.offsetHeight;
  const ctrlH   = controlsBar.offsetHeight;
  const filtH   = filterBar.offsetHeight;

  // Keep filter bar sticky right below controls bar
  filterBar.style.top = `${headerH + ctrlH}px`;

  // Push grid below all sticky bars
  gridContainer.style.paddingTop = `${headerH + ctrlH + filtH}px`;
}

// Re-adjust on resize (controls bar can change height when wrapping)
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(adjustLayout, 100);
});

function cacheDOMRefs() {
  fontGrid       = document.getElementById('font-grid');
  skeletonGrid   = document.getElementById('skeleton-grid');
  searchInput    = document.getElementById('search-input');
  searchClear    = document.getElementById('search-clear');
  previewInput   = document.getElementById('preview-input');
  fontSizeSlider = document.getElementById('font-size-slider');
  fontSizeLabel  = document.getElementById('font-size-value');
  sortBtn        = document.getElementById('sort-btn');
  sortLabel      = document.getElementById('sort-label');
  themeToggle    = document.getElementById('theme-toggle');
  fontCountBadge = document.getElementById('font-count');
  noFontsMessage = document.getElementById('no-fonts-message');
  toastContainer = document.getElementById('toast-container');
  langTabs       = document.getElementById('lang-tabs');
  alphaFilter    = document.getElementById('alpha-filter');

  sentinel = document.createElement('div');
  sentinel.className = 'scroll-sentinel';
  sentinel.setAttribute('aria-hidden', 'true');
}

// ─────────────────────────────────────────────────────────────
//  Build A–Z alphabet buttons
// ─────────────────────────────────────────────────────────────
function buildAlphaFilter() {
  if (!alphaFilter) return;
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  letters.forEach(letter => {
    const btn = document.createElement('button');
    btn.className = 'alpha-btn';
    btn.dataset.letter = letter;
    btn.textContent = letter;
    alphaFilter.appendChild(btn);
  });
}

// ─────────────────────────────────────────────────────────────
//  Data
// ─────────────────────────────────────────────────────────────
async function fetchFonts() {
  try {
    isLoading = true;
    const response = await fetch('/api/fonts');
    if (!response.ok) throw new Error(`Server responded with ${response.status}`);

    const data = await response.json();
    allFonts = Array.isArray(data) ? data : (data.fonts || []);

    updateFontCount(allFonts.length);
    hideSkeletons();
    filterAndRender();
    requestAnimationFrame(adjustLayout);
  } catch (err) {
    console.error('Failed to fetch fonts:', err);
    hideSkeletons();
    showToast('Failed to load fonts. Please refresh.', 'error');
  } finally {
    isLoading = false;
  }
}

// ─────────────────────────────────────────────────────────────
//  Language detection
// ─────────────────────────────────────────────────────────────

/**
 * Detect which script a font name primarily belongs to.
 * Returns: 'bengali' | 'hindi' | 'arabic' | 'chinese' | 'english'
 */
function detectLanguage(fontName) {
  const lower = fontName.toLowerCase();
  
  // 1. Check Unicode character ranges first (Devanagari, Bengali, Arabic, Chinese)
  for (const [lang, regex] of Object.entries(LANG_RANGES)) {
    if (regex.test(fontName)) return lang;
  }
  
  // 2. Fallback to common keyword matching for Latin-transliterated names in the library
  // Bengali font keywords
  if (
    /bangla|bengali|charu|ekushey|ador|bornomala|bongodesh|boshonto|sutonny|solaiman|nikosh|kalpurush|likhon|akash|arpita|choity|durbar|durga|bitopi|anirban|asavari|bijoy|biplobi|shahid|tonoya|buriganga|chankharpul|chano|chandaraboti|bokul|dhaleshwari/i.test(lower)
  ) {
    return 'bengali';
  }
  
  // Devanagari/Hindi/Marathi font keywords
  if (
    /ams|hindi|devanagari|sanskrit|marathi|baloo|akshar|hind|kalam|karma|yatra/i.test(lower)
  ) {
    return 'hindi';
  }
  
  return 'english'; // default
}

// ─────────────────────────────────────────────────────────────
//  Filtering, Sorting & Rendering
// ─────────────────────────────────────────────────────────────
function filterAndRender() {
  const query = searchQuery.toLowerCase().trim();

  displayedFonts = allFonts.filter(font => {
    const name = font.name;

    // 1. Search query
    if (query && !name.toLowerCase().includes(query)) return false;

    // 2. Language filter
    if (activeLang !== 'all') {
      const detected = detectLanguage(name);
      if (detected !== activeLang) return false;
    }

    // 3. Alphabet filter (only applies to English / A-Z names)
    if (activeLetter !== 'all') {
      const first = name.trim()[0]?.toUpperCase() || '';
      if (activeLetter === '0') {
        // 0–9 bucket
        if (!/^[0-9]/.test(name.trim())) return false;
      } else {
        if (first !== activeLetter) return false;
      }
    }

    return true;
  });

  // Sort
  displayedFonts.sort((a, b) => {
    const cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    return currentSort === 'asc' ? cmp : -cmp;
  });

  // Reset & render
  currentBatch = 0;
  fontGrid.innerHTML = '';
  fontGrid.appendChild(sentinel);
  renderBatch();

  noFontsMessage && (noFontsMessage.style.display = displayedFonts.length === 0 ? 'flex' : 'none');
  updateFontCount(displayedFonts.length);
}

function renderBatch() {
  const start = currentBatch * batchSize;
  const end   = Math.min(start + batchSize, displayedFonts.length);
  if (start >= displayedFonts.length) return;

  const fragment = document.createDocumentFragment();
  for (let i = start; i < end; i++) {
    fragment.appendChild(createFontCard(displayedFonts[i], i - start));
  }

  fontGrid.insertBefore(fragment, sentinel);
  currentBatch++;

  requestAnimationFrame(observeNewCards);
  setupLazyLoading();
}

// ─────────────────────────────────────────────────────────────
//  Font Card
// ─────────────────────────────────────────────────────────────
function createFontCard(font, index) {
  const card = document.createElement('div');
  card.className = 'font-card';
  card.style.animationDelay = `${(index % batchSize) * 0.03}s`;

  const familyName = buildFontFamilyName(font);
  const lang = detectLanguage(font.name);
  const langBadge = lang !== 'english'
    ? `<span class="font-lang-badge lang-${lang}">${lang}</span>`
    : '';

  card.innerHTML = `
    <div class="font-card-header">
      <button class="font-name" title="Click to copy font name" data-name="${escapeHTML(font.name)}">
        ${escapeHTML(font.name)}
        <svg class="copy-icon" width="14" height="14" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
      </button>
      <div class="font-badges">
        ${langBadge}
        <span class="font-extension">${escapeHTML(font.extension)}</span>
      </div>
    </div>
    <div class="font-preview"
         style="font-family: '${familyName}', sans-serif; font-size: ${currentFontSize}px;"
         data-font-file="${escapeAttr(font.fileName)}"
         data-font-name="${escapeAttr(font.name)}">
      ${formatPreviewText(previewText)}
    </div>
    <div class="font-card-footer">
      <span class="font-size-info">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
        </svg>
        ${escapeHTML(font.size)}
      </span>
      <a href="/api/fonts/download/${encodeURIComponent(font.fileName)}"
         class="download-btn" download>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
        Download
      </a>
    </div>
  `;

  return card;
}

// ─────────────────────────────────────────────────────────────
//  Font loading
// ─────────────────────────────────────────────────────────────
function buildFontFamilyName(font) {
  const sanitised = font.name.replace(/[^a-zA-Z0-9\s-]/g, '').trim();
  return `font-${sanitised}`;
}

async function loadFontFace(font) {
  const familyName = buildFontFamilyName(font);
  if (loadedFontFaces.has(familyName)) return familyName;
  loadedFontFaces.add(familyName); // Mark immediately to prevent concurrent duplicate load calls
  try {
    const ff = new FontFace(familyName, `url('/fonts/${encodeURIComponent(font.fileName)}')`);
    const loaded = await ff.load();
    document.fonts.add(loaded);
  } catch (err) {
    console.warn(`Could not load font "${font.name}":`, err.message);
    loadedFontFaces.delete(familyName); // Cleanup if loading failed
  }
  return familyName;
}

function observeNewCards() {
  if (!fontObserver) {
    fontObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const preview = entry.target.querySelector('.font-preview');
          if (preview?.dataset.fontFile) {
            loadFontFace({ name: preview.dataset.fontName, fileName: preview.dataset.fontFile });
          }
          fontObserver.unobserve(entry.target);
        }
      });
    }, { rootMargin: '200px' });
  }

  fontGrid.querySelectorAll('.font-card:not([data-observed])').forEach(card => {
    card.setAttribute('data-observed', 'true');
    fontObserver.observe(card);
  });
}

// ─────────────────────────────────────────────────────────────
//  Infinite scroll
// ─────────────────────────────────────────────────────────────
function setupLazyLoading() {
  if (observer) observer.disconnect();
  if (currentBatch * batchSize >= displayedFonts.length) return;

  observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting && !isLoading) renderBatch();
    });
  }, { rootMargin: '400px' });

  observer.observe(sentinel);
}

// ─────────────────────────────────────────────────────────────
//  Event listeners
// ─────────────────────────────────────────────────────────────
function setupEventListeners() {
  // Search
  if (searchInput) {
    searchInput.addEventListener('input', debounce(e => {
      searchQuery = e.target.value;
      if (searchClear) searchClear.style.display = searchQuery ? 'flex' : 'none';
      filterAndRender();
    }, 300));
  }

  if (searchClear) {
    searchClear.addEventListener('click', () => {
      searchQuery = '';
      if (searchInput) searchInput.value = '';
      searchClear.style.display = 'none';
      filterAndRender();
    });
  }

  // Preview text
  if (previewInput) {
    previewInput.addEventListener('input', e => updatePreviewText(e.target.value));
  }

  // Font size slider
  if (fontSizeSlider) {
    fontSizeSlider.addEventListener('input', e => updateFontSize(Number(e.target.value)));
  }

  // Sort
  if (sortBtn) sortBtn.addEventListener('click', toggleSort);

  // Theme
  if (themeToggle) themeToggle.addEventListener('click', toggleTheme);

  // ── Language tabs ──
  if (langTabs) {
    langTabs.addEventListener('click', e => {
      const tab = e.target.closest('.lang-tab');
      if (!tab) return;
      langTabs.querySelectorAll('.lang-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeLang = tab.dataset.lang;
      // Reset alphabet when switching language
      activeLetter = 'all';
      alphaFilter?.querySelectorAll('.alpha-btn').forEach(b => b.classList.remove('active'));
      alphaFilter?.querySelector('[data-letter="all"]')?.classList.add('active');
      filterAndRender();
    });
  }

  // ── Alphabet filter ──
  if (alphaFilter) {
    alphaFilter.addEventListener('click', e => {
      const btn = e.target.closest('.alpha-btn');
      if (!btn) return;
      alphaFilter.querySelectorAll('.alpha-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeLetter = btn.dataset.letter;
      filterAndRender();
    });
  }

  // Font grid delegation
  if (fontGrid) {
    fontGrid.addEventListener('click', e => {
      const nameBtn = e.target.closest('.font-name');
      if (nameBtn) { e.preventDefault(); copyFontName(nameBtn.dataset.name, e); return; }
    });
  }

  // Scroll fallback
  window.addEventListener('scroll', debounce(() => {
    if (isLoading) return;
    if (currentBatch * batchSize >= displayedFonts.length) return;
    if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 800) renderBatch();
  }, 150));
}

// ─────────────────────────────────────────────────────────────
//  Controls
// ─────────────────────────────────────────────────────────────
function toggleSort() {
  currentSort = currentSort === 'asc' ? 'desc' : 'asc';
  if (sortLabel) sortLabel.textContent = currentSort === 'asc' ? 'A–Z' : 'Z–A';
  if (sortBtn) sortBtn.classList.toggle('sort-desc', currentSort === 'desc');
  filterAndRender();
}

function updatePreviewText(text) {
  previewText = text.trim() === '' ? DEFAULT_PREVIEW : text;
  const formatted = formatPreviewText(previewText);
  document.querySelectorAll('.font-preview').forEach(el => { el.innerHTML = formatted; });
}

function updateFontSize(size) {
  currentFontSize = size;
  if (fontSizeLabel) fontSizeLabel.textContent = `${size}px`;
  document.querySelectorAll('.font-preview').forEach(el => { el.style.fontSize = `${size}px`; });
}

// ─────────────────────────────────────────────────────────────
//  Skeletons
// ─────────────────────────────────────────────────────────────
function showSkeletons() {
  if (!skeletonGrid) return;
  skeletonGrid.innerHTML = '';
  skeletonGrid.style.display = 'grid';
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 8; i++) {
    const s = document.createElement('div');
    s.className = 'skeleton-card';
    s.innerHTML = `
      <div class="skeleton-header">
        <div class="skeleton-line skeleton-title"></div>
        <div class="skeleton-line skeleton-badge"></div>
      </div>
      <div class="skeleton-body">
        <div class="skeleton-line skeleton-text-lg"></div>
        <div class="skeleton-line skeleton-text-md"></div>
        <div class="skeleton-line skeleton-text-sm"></div>
      </div>
      <div class="skeleton-footer">
        <div class="skeleton-line skeleton-size"></div>
        <div class="skeleton-line skeleton-btn"></div>
      </div>`;
    frag.appendChild(s);
  }
  skeletonGrid.appendChild(frag);
}

function hideSkeletons() {
  if (!skeletonGrid) return;
  skeletonGrid.style.display = 'none';
  skeletonGrid.innerHTML = '';
}

// ─────────────────────────────────────────────────────────────
//  Clipboard
// ─────────────────────────────────────────────────────────────
async function copyFontName(name, event) {
  try {
    await navigator.clipboard.writeText(name);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = name;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
  showCopyTooltip(event.currentTarget || event.target);
  showToast('Font name copied!', 'success');
}

function showCopyTooltip(targetEl) {
  document.querySelector('.copy-tooltip-float')?.remove();
  const tip = document.createElement('span');
  tip.className = 'copy-tooltip-float';
  tip.textContent = 'Copied!';
  const rect = targetEl.getBoundingClientRect();
  tip.style.cssText = `position:fixed;top:${rect.top - 32}px;left:${rect.left + rect.width / 2}px;
    transform:translateX(-50%);background:var(--accent);color:#fff;padding:4px 10px;
    border-radius:6px;font-size:12px;font-weight:600;pointer-events:none;z-index:9999;
    opacity:0;transition:opacity .2s;`;
  document.body.appendChild(tip);
  requestAnimationFrame(() => { tip.style.opacity = '1'; });
  setTimeout(() => { tip.style.opacity = '0'; setTimeout(() => tip.remove(), 200); }, 1200);
}

// ─────────────────────────────────────────────────────────────
//  Toast
// ─────────────────────────────────────────────────────────────
function showToast(message, type = 'info') {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    document.body.appendChild(toastContainer);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  const icons = {
    success: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    error:   `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    info:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
  };
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span class="toast-message">${escapeHTML(message)}</span>
    <button class="toast-close" aria-label="Close">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>`;
  toast.querySelector('.toast-close').addEventListener('click', () => dismissToast(toast));
  toastContainer.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast-visible'));
  setTimeout(() => dismissToast(toast), 3000);
}

function dismissToast(toast) {
  if (!toast?.parentNode) return;
  toast.classList.remove('toast-visible');
  toast.classList.add('toast-exit');
  setTimeout(() => toast.remove(), 300);
}

// ─────────────────────────────────────────────────────────────
//  Theme
// ─────────────────────────────────────────────────────────────
function loadThemePreference() {
  if (localStorage.getItem('font-manager-theme') === 'light') {
    document.body.classList.add('light-mode');
  }
  updateThemeIcon();
}

function toggleTheme() {
  document.body.classList.toggle('light-mode');
  const isLight = document.body.classList.contains('light-mode');
  localStorage.setItem('font-manager-theme', isLight ? 'light' : 'dark');
  updateThemeIcon();
}

function updateThemeIcon() {
  // Rely entirely on CSS rules defined under body.light-mode for visibility toggling
}

// ─────────────────────────────────────────────────────────────
//  Utilities
// ─────────────────────────────────────────────────────────────
function debounce(fn, wait) {
  let t;
  return function(...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), wait); };
}

function formatPreviewText(text) {
  return escapeHTML(text).replace(/\n/g, '<br>');
}

function escapeHTML(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[c]));
}

function escapeAttr(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function updateFontCount(count) {
  if (fontCountBadge) fontCountBadge.textContent = count.toLocaleString();
}
