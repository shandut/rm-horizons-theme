import { Component } from '@theme/component';
import { CartAddEvent } from '@theme/events';

/**
 * Step labels for navigation button text.
 * @type {string[]}
 */
const STEP_LABELS = ['Toe Shape', 'Heel', 'Sole', 'Leather & Colour', 'Finishing'];

/**
 * Phase mapping — which phase each step belongs to.
 * @type {string[]}
 */
const STEP_PHASES = ['build', 'build', 'build', 'customise', 'personalise'];

/**
 * Phase index lookup.
 * @type {Record<string, number>}
 */
const PHASE_INDEX = { build: 0, customise: 1, personalise: 2 };

/**
 * Boot Configurator — 5-step MTO wizard with composite preview images.
 *
 * The preview shows a single pre-generated image for each combination of
 * toe × heel × sole × leather × elastic. The filename is constructed from
 * the current selections.
 *
 * @typedef {{
 *   stepTabs: HTMLButtonElement[],
 *   stepPanels: HTMLElement[],
 *   phases: HTMLElement[],
 *   prevButton: HTMLButtonElement,
 *   nextButton: HTMLButtonElement,
 *   addToCartButton: HTMLButtonElement,
 *   priceValue: HTMLElement,
 *   bootPreview: HTMLImageElement,
 *   layerEngraving: HTMLElement,
 *   liveRegion: HTMLElement,
 *   engravingInput: HTMLInputElement,
 *   engravingCount: HTMLElement,
 *   previewCanvas: HTMLElement,
 *   soleView: HTMLElement,
 *   soleEngravingText: HTMLElement,
 *   summaryItems: HTMLElement[],
 *   summaryToe: HTMLElement,
 *   summaryHeel: HTMLElement,
 *   summarySole: HTMLElement,
 *   summaryLeather: HTMLElement,
 *   summaryElastic: HTMLElement,
 *   summaryTug: HTMLElement,
 *   summaryEngraving: HTMLElement
 * }} ConfiguratorRefs
 *
 * @extends {Component<ConfiguratorRefs>}
 */
class BootConfigurator extends Component {
  /** @type {number} */
  #currentStep = 0;

  /** @type {number} */
  #basePrice = 0;

  /** @type {string} */
  #assetBase = '';

  /** @type {number | undefined} */
  #announceTimeout;

  connectedCallback() {
    super.connectedCallback();
    this.#basePrice = parseInt(this.dataset.basePrice || '795', 10) * 100;
    this.#assetBase = this.dataset.assetBase || '';
    this.#updatePrice();
    this.#updateNavButtons();
  }

  // ─── Current Selections ────────────────────────────────

  /**
   * Get the current value of a radio group.
   * @param {string} name
   * @returns {string}
   */
  #getSelection(name) {
    const checked = /** @type {HTMLInputElement | null} */ (
      this.querySelector(`input[name="${name}"]:checked`)
    );
    return checked?.value || '';
  }

  /**
   * Build the composite image URL from current selections.
   * Pattern: configurator-boot-{toe}-{heel}-{sole}-{leather}-{elastic}.png
   * @returns {string}
   */
  #buildCompositeUrl() {
    const toe = this.#getSelection('config-toe') || 'round';
    const heel = this.#getSelection('config-heel') || 'flat';
    const sole = this.#getSelection('config-sole') || 'leather';
    const leather = this.#getSelection('config-leather') || 'chestnut';
    const elastic = this.#getSelection('config-elastic') || 'brown';

    return `${this.#assetBase}${toe}-${heel}-${sole}-${leather}-${elastic}.png`;
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

  /** Go to next step. */
  nextStep() {
    if (this.#currentStep < STEP_LABELS.length - 1) {
      this.#switchToStep(this.#currentStep + 1);
    }
  }

  /** Go to previous step. */
  prevStep() {
    if (this.#currentStep > 0) {
      this.#switchToStep(this.#currentStep - 1);
    }
  }

  /**
   * Switch to a specific step.
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
      panel.hidden = i !== index;
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

    this.#updateNavButtons();

    // Focus first focusable in panel
    const activePanel = stepPanels[index];
    if (activePanel) {
      const firstInput = activePanel.querySelector('input, button, [tabindex="0"]');
      if (firstInput) {
        /** @type {HTMLElement} */ (firstInput).focus({ preventScroll: true });
      }
    }

    this.#announce(`Step ${index + 1} of ${STEP_LABELS.length}: ${STEP_LABELS[index]}`);
  }

  /**
   * Update prev/next/add-to-cart button states.
   */
  #updateNavButtons() {
    const { prevButton, nextButton, addToCartButton } = this.refs;
    const isFirst = this.#currentStep === 0;
    const isLast = this.#currentStep === STEP_LABELS.length - 1;

    if (prevButton) prevButton.hidden = isFirst;

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
        addToCartButton.textContent = `Add to Cart \u2014 ${this.#formatPrice(this.#calculateTotal())}`;
      }
    }
  }

  // ─── Option Selection ──────────────────────────────────

  /**
   * Handles any option change — updates preview + summary.
   * @param {Event} event
   */
  handleOptionChange(event) {
    this.#updateCompositePreview();
    this.#updatePrice();
    this.#updateNavButtons();
    this.#updateSummary();
  }

  /**
   * Handles engraving text input.
   * @param {Event} event
   */
  handleEngravingInput(event) {
    const input = /** @type {HTMLInputElement} */ (event.target);
    const text = input.value;

    // Update side-view engraving overlay
    if (this.refs.layerEngraving) {
      this.refs.layerEngraving.textContent = text;
    }

    // Update sole bottom view
    if (this.refs.soleEngravingText) {
      this.refs.soleEngravingText.textContent = text;
    }

    // Show/hide sole view
    if (this.refs.soleView) {
      this.refs.soleView.hidden = text.length === 0;
    }

    // Update character count
    if (this.refs.engravingCount) {
      this.refs.engravingCount.textContent = `${text.length} / 20`;
    }

    this.#updateSummary();
  }

  // ─── Selection Summary ──────────────────────────────────

  /**
   * Map of radio group names to summary ref names.
   * @type {Array<{name: string, ref: string, step: string}>}
   */
  static SUMMARY_MAP = [
    { name: 'config-toe', ref: 'summaryToe', step: 'toe' },
    { name: 'config-heel', ref: 'summaryHeel', step: 'heel' },
    { name: 'config-sole', ref: 'summarySole', step: 'sole' },
    { name: 'config-leather', ref: 'summaryLeather', step: 'leather' },
    { name: 'config-elastic', ref: 'summaryElastic', step: 'elastic' },
    { name: 'config-tug', ref: 'summaryTug', step: 'tug' },
  ];

  /**
   * Update the selection summary chips based on current radio values.
   */
  #updateSummary() {
    for (const { name, ref, step } of BootConfigurator.SUMMARY_MAP) {
      const checked = /** @type {HTMLInputElement | null} */ (
        this.querySelector(`input[name="${name}"]:checked`)
      );
      const summaryEl = this.refs[ref];
      const itemEl = summaryEl?.closest('.Configurator__summary-item');

      if (checked && summaryEl && itemEl) {
        const label = checked.dataset.label || checked.value;
        summaryEl.textContent = label;
        itemEl.hidden = false;
      }
    }

    // Engraving
    const engravingText = this.refs.engravingInput?.value?.trim();
    const engravingSummary = this.refs.summaryEngraving;
    const engravingItem = engravingSummary?.closest('.Configurator__summary-item');
    if (engravingSummary && engravingItem) {
      if (engravingText) {
        engravingSummary.textContent = `"${engravingText}"`;
        engravingItem.hidden = false;
      } else {
        engravingItem.hidden = true;
      }
    }
  }

  // ─── Composite Preview ─────────────────────────────────

  /**
   * Update the boot preview to the composite matching current selections.
   */
  #updateCompositePreview() {
    const url = this.#buildCompositeUrl();
    const img = this.refs.bootPreview;
    if (!img || img.src === url) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      img.src = url;
      return;
    }

    // Crossfade: fade out → swap → fade in
    img.style.opacity = '0';
    setTimeout(() => {
      img.src = url;
      img.onload = () => {
        img.style.opacity = '1';
        img.onload = null;
      };
      img.onerror = () => {
        // Fallback to base boot if composite not found
        img.style.opacity = '1';
        img.onerror = null;
      };
    }, 300);
  }

  // ─── Price Calculation ─────────────────────────────────

  /**
   * Calculate total price in cents.
   * @returns {number}
   */
  #calculateTotal() {
    let total = this.#basePrice;
    const checkedInputs = this.querySelectorAll('input[type="radio"]:checked[data-price-adjust]');
    for (const input of checkedInputs) {
      total += parseInt(/** @type {HTMLInputElement} */ (input).dataset.priceAdjust || '0', 10);
    }
    return total;
  }

  /** Update the displayed price. */
  #updatePrice() {
    const total = this.#calculateTotal();
    if (this.refs.priceValue) {
      this.refs.priceValue.textContent = this.#formatPrice(total);
    }
  }

  /**
   * Format cents as dollar string.
   * @param {number} cents
   * @returns {string}
   */
  #formatPrice(cents) {
    return `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  }

  // ─── Add to Cart ───────────────────────────────────────

  /**
   * Add configured boot to cart with line item properties.
   */
  async addToCart() {
    const { addToCartButton } = this.refs;
    const variantId = this.dataset.variantId;
    if (!variantId || !addToCartButton) return;

    // Gather selections with human-readable labels
    const properties = {};
    const radioGroups = [
      { name: 'config-toe', property: 'Toe Shape' },
      { name: 'config-heel', property: 'Heel' },
      { name: 'config-sole', property: 'Sole' },
      { name: 'config-leather', property: 'Leather' },
      { name: 'config-elastic', property: 'Elastic Colour' },
      { name: 'config-tug', property: 'Tug Colour' },
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
    properties['Engraving'] = this.refs.engravingInput?.value?.trim() || 'None';

    // Hidden properties
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
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (data.status) {
        this.#announce(`Error: ${data.message}`);
        addToCartButton.disabled = false;
        addToCartButton.textContent = originalText;
        return;
      }

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
   * Announce to screen readers via live region.
   * @param {string} text
   */
  #announce(text) {
    if (this.#announceTimeout) clearTimeout(this.#announceTimeout);
    if (this.refs.liveRegion) {
      this.refs.liveRegion.textContent = text;
      this.#announceTimeout = setTimeout(() => {
        if (this.refs.liveRegion) this.refs.liveRegion.textContent = '';
      }, 5000);
    }
  }
}

customElements.define('boot-configurator', BootConfigurator);
