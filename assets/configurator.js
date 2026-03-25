import { Component } from '@theme/component';
import { CartAddEvent } from '@theme/events';

/**
 * Step labels used for navigation button text.
 * @type {string[]}
 */
const STEP_LABELS = ['Toe Shape', 'Heel', 'Sole', 'Leather & Colour', 'Finishing'];

/**
 * Phase mapping — which phase each step belongs to.
 * @type {string[]}
 */
const STEP_PHASES = ['build', 'build', 'build', 'customise', 'personalise'];

/**
 * Phase index lookup for the progress indicator.
 * @type {Record<string, number>}
 */
const PHASE_INDEX = { build: 0, customise: 1, personalise: 2 };

/**
 * Boot Configurator — 5-step Made to Order wizard with layered preview.
 *
 * @typedef {{
 *   stepTabs: HTMLButtonElement[],
 *   stepPanels: HTMLElement[],
 *   phases: HTMLElement[],
 *   prevButton: HTMLButtonElement,
 *   nextButton: HTMLButtonElement,
 *   addToCartButton: HTMLButtonElement,
 *   priceValue: HTMLElement,
 *   layerBody: HTMLImageElement,
 *   layerToe: HTMLImageElement,
 *   layerHeel: HTMLImageElement,
 *   layerSole: HTMLImageElement,
 *   layerTug: HTMLImageElement,
 *   layerElastic: HTMLImageElement,
 *   layerEngraving: HTMLElement,
 *   liveRegion: HTMLElement,
 *   engravingInput: HTMLInputElement,
 *   engravingCount: HTMLElement,
 *   previewCanvas: HTMLElement
 * }} ConfiguratorRefs
 *
 * @extends {Component<ConfiguratorRefs>}
 */
class BootConfigurator extends Component {
  /** @type {number} */
  #currentStep = 0;

  /** @type {number} */
  #basePrice = 0;

  /** @type {number | undefined} */
  #announceTimeout;

  connectedCallback() {
    super.connectedCallback();
    this.#basePrice = parseInt(this.dataset.basePrice || '795', 10) * 100;
    this.#updatePrice();
    this.#updateNavButtons();
  }

  // ─── Tab / Step Navigation ─────────────────────────────

  /**
   * Handles click on a step tab.
   * @param {Event} event
   */
  activateStep(event) {
    const tab = /** @type {HTMLButtonElement} */ (event.target.closest('[role="tab"]'));
    if (!tab) return;
    const index = this.refs.stepTabs.indexOf(tab);
    if (index !== -1) {
      this.#switchToStep(index);
    }
  }

  /**
   * Keyboard navigation for step tabs (Arrow keys, Home, End).
   * @param {KeyboardEvent} event
   */
  handleStepKeydown(event) {
    const tabs = this.refs.stepTabs;
    if (!tabs || !Array.isArray(tabs)) return;

    const currentIndex = tabs.indexOf(/** @type {HTMLButtonElement} */ (event.target));
    if (currentIndex === -1) return;

    /** @type {number | null} */
    let nextIndex = null;

    switch (event.key) {
      case 'ArrowRight':
        nextIndex = (currentIndex + 1) % tabs.length;
        break;
      case 'ArrowLeft':
        nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = tabs.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    const nextTab = tabs[nextIndex];
    nextTab.focus();
    this.#switchToStep(nextIndex);
  }

  /**
   * Go to next step.
   */
  nextStep() {
    if (this.#currentStep < STEP_LABELS.length - 1) {
      this.#switchToStep(this.#currentStep + 1);
    }
  }

  /**
   * Go to previous step.
   */
  prevStep() {
    if (this.#currentStep > 0) {
      this.#switchToStep(this.#currentStep - 1);
    }
  }

  /**
   * Switch to a specific step index.
   * @param {number} index
   */
  #switchToStep(index) {
    const { stepTabs, stepPanels, phases } = this.refs;
    if (!stepTabs || !stepPanels) return;

    this.#currentStep = index;

    // Update tabs
    for (const [i, tab] of stepTabs.entries()) {
      const isActive = i === index;
      tab.classList.toggle('Configurator__step-tab--active', isActive);
      tab.setAttribute('aria-selected', String(isActive));
      tab.setAttribute('tabindex', isActive ? '0' : '-1');
    }

    // Update panels
    for (const [i, panel] of stepPanels.entries()) {
      const isActive = i === index;
      panel.hidden = !isActive;
    }

    // Update phase indicator
    const currentPhase = STEP_PHASES[index];
    const currentPhaseIndex = PHASE_INDEX[currentPhase];

    if (phases && Array.isArray(phases)) {
      for (const [i, phase] of phases.entries()) {
        phase.classList.toggle('Configurator__phase--active', i === currentPhaseIndex);
        phase.classList.toggle('Configurator__phase--completed', i < currentPhaseIndex);
        if (i === currentPhaseIndex) {
          phase.setAttribute('aria-current', 'step');
        } else {
          phase.removeAttribute('aria-current');
        }
      }
    }

    // Update navigation buttons
    this.#updateNavButtons();

    // Focus first focusable in panel
    const activePanel = stepPanels[index];
    if (activePanel) {
      const firstInput = activePanel.querySelector('input, button, [tabindex="0"]');
      if (firstInput) {
        /** @type {HTMLElement} */ (firstInput).focus({ preventScroll: true });
      }
    }

    // Announce step change
    this.#announce(`Step ${index + 1} of ${STEP_LABELS.length}: ${STEP_LABELS[index]}`);
  }

  /**
   * Update prev/next/add-to-cart button states.
   */
  #updateNavButtons() {
    const { prevButton, nextButton, addToCartButton } = this.refs;
    const isFirst = this.#currentStep === 0;
    const isLast = this.#currentStep === STEP_LABELS.length - 1;

    if (prevButton) {
      prevButton.hidden = isFirst;
    }

    if (nextButton) {
      nextButton.hidden = isLast;
      if (!isLast) {
        const nextLabel = STEP_LABELS[this.#currentStep + 1];
        nextButton.innerHTML = `Next: ${nextLabel} <span aria-hidden="true">&rarr;</span>`;
      }
    }

    if (addToCartButton) {
      addToCartButton.hidden = !isLast;
      if (isLast) {
        addToCartButton.textContent = `Add to Cart — ${this.#formatPrice(this.#calculateTotal())}`;
      }
    }
  }

  // ─── Option Selection ──────────────────────────────────

  /**
   * Handles radio option change — updates preview and price.
   * @param {Event} event
   */
  handleOptionChange(event) {
    const input = /** @type {HTMLInputElement} */ (event.target);
    const layer = input.dataset.layer;
    const imageSrc = input.dataset.image;
    const bodyFilter = input.dataset.bodyFilter;

    if (layer === 'body' && bodyFilter !== undefined) {
      // Leather/colour step — apply CSS filter to body layer
      this.#updateBodyFilter(bodyFilter);
    } else if (imageSrc && layer) {
      // Swap the corresponding image layer
      this.#swapLayer(layer, imageSrc);
    }

    this.#updatePrice();
    this.#updateNavButtons();
  }

  /**
   * Handles engraving text input.
   * @param {Event} event
   */
  handleEngravingInput(event) {
    const input = /** @type {HTMLInputElement} */ (event.target);
    const text = input.value;

    // Update preview
    if (this.refs.layerEngraving) {
      this.refs.layerEngraving.textContent = text;
    }

    // Update character count
    if (this.refs.engravingCount) {
      this.refs.engravingCount.textContent = `${text.length} / 20`;
    }
  }

  // ─── Preview Layer Management ──────────────────────────

  /**
   * Layer ref name mapping.
   * @type {Record<string, string>}
   */
  static LAYER_REFS = {
    toe: 'layerToe',
    heel: 'layerHeel',
    sole: 'layerSole',
    tug: 'layerTug',
    elastic: 'layerElastic',
  };

  /**
   * Swap an image layer with a fade transition.
   * @param {string} layerName
   * @param {string} newSrc
   */
  #swapLayer(layerName, newSrc) {
    const refName = BootConfigurator.LAYER_REFS[layerName];
    if (!refName) return;

    const img = /** @type {HTMLImageElement | undefined} */ (this.refs[refName]);
    if (!img) return;

    // Check reduced motion preference
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      img.src = newSrc;
      return;
    }

    // Fade out → swap src → fade in
    img.classList.add('Configurator__layer--fading');

    const onTransitionEnd = () => {
      img.removeEventListener('transitionend', onTransitionEnd);
      img.src = newSrc;

      // Wait for image load before fading back in
      img.onload = () => {
        img.classList.remove('Configurator__layer--fading');
        img.onload = null;
      };

      // Fallback: if image fails to load, still fade back in
      img.onerror = () => {
        img.classList.remove('Configurator__layer--fading');
        img.style.opacity = '0.1';
        img.onerror = null;
      };
    };

    img.addEventListener('transitionend', onTransitionEnd);
  }

  /**
   * Apply CSS filter to the body layer for leather colour.
   * @param {string} filterValue
   */
  #updateBodyFilter(filterValue) {
    if (this.refs.layerBody) {
      this.refs.layerBody.style.filter = filterValue;
    }
  }

  // ─── Price Calculation ─────────────────────────────────

  /**
   * Calculate total price in cents from all checked radio inputs.
   * @returns {number}
   */
  #calculateTotal() {
    let total = this.#basePrice;

    const checkedInputs = this.querySelectorAll('input[type="radio"]:checked[data-price-adjust]');
    for (const input of checkedInputs) {
      const adjust = parseInt(/** @type {HTMLInputElement} */ (input).dataset.priceAdjust || '0', 10);
      total += adjust;
    }

    return total;
  }

  /**
   * Update the displayed price.
   */
  #updatePrice() {
    const total = this.#calculateTotal();

    if (this.refs.priceValue) {
      this.refs.priceValue.textContent = this.#formatPrice(total);
    }
  }

  /**
   * Format cents as a dollar string.
   * @param {number} cents
   * @returns {string}
   */
  #formatPrice(cents) {
    const dollars = cents / 100;
    return `$${dollars.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  }

  // ─── Add to Cart ───────────────────────────────────────

  /**
   * Add the configured boot to cart with line item properties.
   */
  async addToCart() {
    const { addToCartButton } = this.refs;
    const variantId = this.dataset.variantId;

    if (!variantId || !addToCartButton) return;

    // Gather selections
    const properties = {};

    // Radio-based selections
    const radioGroups = [
      { name: 'config-toe', property: 'Toe Shape' },
      { name: 'config-heel', property: 'Heel' },
      { name: 'config-sole', property: 'Sole' },
      { name: 'config-leather', property: 'Leather' },
      { name: 'config-tug', property: 'Tug Colour' },
      { name: 'config-elastic', property: 'Elastic Colour' },
    ];

    for (const { name, property } of radioGroups) {
      const checked = /** @type {HTMLInputElement | null} */ (
        this.querySelector(`input[name="${name}"]:checked`)
      );
      if (checked) {
        properties[property] = checked.dataset.label || checked.value;
      }
    }

    // Engraving
    const engravingText = this.refs.engravingInput?.value?.trim() || '';
    properties['Engraving'] = engravingText || 'None';

    // Hidden properties (prefixed with _ so they don't show in cart)
    const totalCents = this.#calculateTotal();
    properties['_configurator_price'] = String(totalCents / 100);
    properties['_configuration_id'] = `cfg_${Date.now().toString(36)}`;

    const body = {
      items: [{
        id: parseInt(variantId, 10),
        quantity: 1,
        properties,
      }],
    };

    try {
      addToCartButton.disabled = true;
      const originalText = addToCartButton.textContent;
      addToCartButton.textContent = 'Adding\u2026';

      const response = await fetch(Theme.routes.cart_add_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (data.status) {
        // Error response
        this.#announce(`Error: ${data.message}`);
        addToCartButton.disabled = false;
        addToCartButton.textContent = originalText;
        return;
      }

      // Success — dispatch event so cart drawer/icon badge updates
      this.dispatchEvent(
        new CartAddEvent({}, this.id, {
          source: 'boot-configurator',
          itemCount: 1,
          productId: this.dataset.productId,
        })
      );

      this.#announce('Your custom boot has been added to cart');
      addToCartButton.textContent = 'Added to Cart \u2713';

      setTimeout(() => {
        addToCartButton.disabled = false;
        addToCartButton.textContent = `Add to Cart \u2014 ${this.#formatPrice(this.#calculateTotal())}`;
      }, 2500);
    } catch (error) {
      console.error('Add to cart failed:', error);
      addToCartButton.disabled = false;
      addToCartButton.textContent = `Add to Cart \u2014 ${this.#formatPrice(this.#calculateTotal())}`;
      this.#announce('Failed to add to cart. Please try again.');
    }
  }

  // ─── Accessibility ─────────────────────────────────────

  /**
   * Announce a message to screen readers via the live region.
   * @param {string} text
   */
  #announce(text) {
    if (this.#announceTimeout) {
      clearTimeout(this.#announceTimeout);
    }

    if (this.refs.liveRegion) {
      this.refs.liveRegion.textContent = text;

      this.#announceTimeout = setTimeout(() => {
        if (this.refs.liveRegion) {
          this.refs.liveRegion.textContent = '';
        }
      }, 5000);
    }
  }
}

customElements.define('boot-configurator', BootConfigurator);
