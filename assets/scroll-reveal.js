/**
 * Global scroll-reveal animation utility.
 *
 * Apply `data-scroll-reveal` to any element to animate it into view.
 * Supports staggered delays via `data-scroll-delay="150"` (ms).
 * Respects `prefers-reduced-motion: reduce`.
 */

const THRESHOLD = 0.15;
const ROOT_MARGIN = '0px 0px -40px 0px';

/** @type {IntersectionObserver | null} */
let observer = null;

/**
 * Initialises the scroll-reveal IntersectionObserver.
 * Called once on DOMContentLoaded; re-scans on Shopify section render events.
 */
function init() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    for (const el of document.querySelectorAll('[data-scroll-reveal]')) {
      el.classList.add('is-visible');
    }
    return;
  }

  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;

        const el = /** @type {HTMLElement} */ (entry.target);
        const delay = parseInt(el.dataset.scrollDelay ?? '0', 10);

        if (delay > 0) {
          setTimeout(() => el.classList.add('is-visible'), delay);
        } else {
          el.classList.add('is-visible');
        }

        observer?.unobserve(el);
      }
    },
    { threshold: THRESHOLD, rootMargin: ROOT_MARGIN }
  );

  observe();
}

/**
 * Observes all un-revealed `[data-scroll-reveal]` elements.
 */
function observe() {
  if (!observer) return;

  for (const el of document.querySelectorAll('[data-scroll-reveal]:not(.is-visible)')) {
    observer.observe(el);
  }
}

document.addEventListener('DOMContentLoaded', init);
document.addEventListener('shopify:section:load', observe);
