import { Component } from '@theme/component';

/**
 * @typedef {{
 *   slides: HTMLElement[],
 *   dots: HTMLButtonElement[],
 *   prevBtn: HTMLButtonElement,
 *   nextBtn: HTMLButtonElement,
 *   pauseBtn: HTMLButtonElement,
 *   liveRegion: HTMLElement
 * }} VideoHeroRefs
 */

/**
 * Video Hero Slideshow — full-screen video carousel with autoplay,
 * dot progress indicators, and full keyboard/a11y support.
 *
 * @extends {Component<VideoHeroRefs>}
 */
class VideoHeroSlideshow extends Component {
  /** @type {number} */
  #current = 0;

  /** @type {ReturnType<typeof setTimeout> | null} */
  #timer = null;

  /** @type {boolean} */
  #isPaused = false;

  /** @type {boolean} */
  #isUserPaused = false;

  /** @type {number} */
  #fallbackSpeed = 10000;

  /** @type {number} */
  #slideCount = 0;

  /** @type {MediaQueryList} */
  #reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  connectedCallback() {
    super.connectedCallback();

    this.#fallbackSpeed = parseInt(this.dataset.autoplaySpeed ?? '10', 10) * 1000;
    this.#slideCount = parseInt(this.dataset.slideCount ?? '0', 10);

    if (this.#slideCount <= 1) return;

    if (this.#reducedMotion.matches) {
      this.#isPaused = true;
      this.#isUserPaused = true;
    } else {
      this.#initAutoplay();
    }

    this.#reducedMotion.addEventListener('change', (e) => {
      if (e.matches) {
        this.#stopAutoplay();
      } else if (!this.#isPaused) {
        this.#scheduleAutoplay();
      }
    });
  }

  /**
   * Go to next slide.
   */
  nextSlide() {
    this.#goToSlide((this.#current + 1) % this.#slideCount);
    this.#scheduleAutoplay();
  }

  /**
   * Go to previous slide.
   */
  prevSlide() {
    this.#goToSlide((this.#current - 1 + this.#slideCount) % this.#slideCount);
    this.#scheduleAutoplay();
  }

  /**
   * Handle dot click — jump to specific slide.
   *
   * @param {Event} event
   */
  goToSlideFromDot(event) {
    const dot = /** @type {HTMLButtonElement} */ (event.target).closest('.video-hero-slideshow__dot');
    if (!dot) return;

    const index = parseInt(dot.dataset.slideIndex ?? '0', 10);
    this.#goToSlide(index);
    this.#scheduleAutoplay();
  }

  /**
   * Toggle pause/play for autoplay.
   */
  togglePause() {
    this.#isUserPaused = !this.#isUserPaused;
    this.#isPaused = this.#isUserPaused;

    const btn = this.refs.pauseBtn;
    if (btn) {
      btn.setAttribute('aria-label', this.#isUserPaused ? 'Play slideshow' : 'Pause slideshow');
      btn.setAttribute('aria-pressed', String(this.#isUserPaused));
    }

    if (this.#isUserPaused) {
      this.#stopAutoplay();
    } else {
      this.#scheduleAutoplay();
    }
  }

  /**
   * Pause on mouse enter.
   */
  onMouseEnter() {
    if (!this.#isUserPaused) {
      this.#isPaused = true;
      this.#stopAutoplay();
    }
  }

  /**
   * Resume on mouse leave.
   */
  onMouseLeave() {
    if (!this.#isUserPaused) {
      this.#isPaused = false;
      this.#scheduleAutoplay();
    }
  }

  /**
   * Handle keyboard navigation on the slideshow.
   *
   * @param {KeyboardEvent} event
   */
  handleKeydown(event) {
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        this.prevSlide();
        break;
      case 'ArrowRight':
        event.preventDefault();
        this.nextSlide();
        break;
    }
  }

  /**
   * @param {HTMLElement} slide
   * @returns {HTMLVideoElement | null}
   */
  #getActiveVideo(slide) {
    const desktop = slide.querySelector('.video-hero-slideshow__video--desktop');
    const mobile = slide.querySelector('.video-hero-slideshow__video--mobile');
    if (mobile instanceof HTMLVideoElement && window.innerWidth < 750 && mobile.src) return mobile;
    return desktop instanceof HTMLVideoElement ? desktop : null;
  }

  /**
   * @param {HTMLElement} slide
   * @returns {number}
   */
  #getSlideDuration(slide) {
    const video = this.#getActiveVideo(slide);
    if (video && video.duration && isFinite(video.duration)) {
      return video.duration * 1000;
    }
    return this.#fallbackSpeed;
  }

  /** @param {HTMLElement} slide */
  #pauseSlideVideos(slide) {
    for (const v of slide.querySelectorAll('video')) {
      v.pause();
    }
  }

  /** @param {HTMLElement} slide */
  #playSlideVideos(slide) {
    for (const v of slide.querySelectorAll('video')) {
      v.currentTime = 0;
      v.play().catch(() => {});
    }
  }

  /**
   * @param {HTMLButtonElement} dot
   * @param {number} duration
   */
  #resetDotProgress(dot, duration) {
    const prog = dot.querySelector('.video-hero-slideshow__dot-progress');
    if (prog instanceof HTMLElement) {
      prog.style.animation = 'none';
      prog.offsetHeight; /* reflow */
      prog.style.animation = `dotProgress ${duration}ms linear forwards`;
    }
  }

  /** @param {HTMLButtonElement} dot */
  #clearDotProgress(dot) {
    const prog = dot.querySelector('.video-hero-slideshow__dot-progress');
    if (prog instanceof HTMLElement) {
      prog.style.animation = 'none';
      prog.style.width = '0';
    }
  }

  /** @param {number} index */
  #goToSlide(index) {
    const slides = this.refs.slides;
    const dots = this.refs.dots;
    if (!slides || !dots || !Array.isArray(slides) || !Array.isArray(dots)) return;

    this.#pauseSlideVideos(slides[this.#current]);
    slides[this.#current].classList.remove('video-hero-slideshow__slide--active');
    dots[this.#current].classList.remove('video-hero-slideshow__dot--active');
    dots[this.#current].setAttribute('aria-selected', 'false');
    this.#clearDotProgress(dots[this.#current]);

    this.#current = index;

    slides[this.#current].classList.add('video-hero-slideshow__slide--active');
    dots[this.#current].classList.add('video-hero-slideshow__dot--active');
    dots[this.#current].setAttribute('aria-selected', 'true');
    this.#playSlideVideos(slides[this.#current]);

    // Update live region for screen readers
    const liveRegion = this.refs.liveRegion;
    if (liveRegion) {
      liveRegion.textContent = `Slide ${this.#current + 1} of ${this.#slideCount}`;
    }
  }

  #scheduleAutoplay() {
    this.#stopAutoplay();
    if (this.#isPaused || this.#reducedMotion.matches) return;

    const slides = this.refs.slides;
    const dots = this.refs.dots;
    if (!slides || !dots || !Array.isArray(slides) || !Array.isArray(dots)) return;

    const duration = this.#getSlideDuration(slides[this.#current]);
    this.#resetDotProgress(dots[this.#current], duration);
    this.#timer = setTimeout(() => this.nextSlide(), duration);
  }

  #stopAutoplay() {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  #initAutoplay() {
    const slides = this.refs.slides;
    if (!slides || !Array.isArray(slides) || slides.length === 0) return;

    const firstVideo = this.#getActiveVideo(slides[0]);

    if (firstVideo && firstVideo.readyState >= 1) {
      this.#scheduleAutoplay();
    } else if (firstVideo) {
      firstVideo.addEventListener('loadedmetadata', () => this.#scheduleAutoplay(), { once: true });
      setTimeout(() => { if (!this.#timer) this.#scheduleAutoplay(); }, 3000);
    } else {
      this.#scheduleAutoplay();
    }
  }
}

customElements.define('video-hero-component', VideoHeroSlideshow);
