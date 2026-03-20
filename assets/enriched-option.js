/**
 * EnrichedOptionDescription
 * Toggles the visible description when a sibling fieldset's radio input changes.
 * Used by the sole-type (or any enriched) variant option.
 */
class EnrichedOptionDescription extends HTMLElement {
  connectedCallback() {
    const fieldset = this.closest('fieldset');
    if (fieldset) {
      fieldset.addEventListener('change', (event) => this.#handleChange(event));
    }
  }

  #handleChange(event) {
    const selectedValue = event.target.value;
    if (!selectedValue) return;

    const descriptions = this.querySelectorAll('[data-option-description]');
    for (const desc of descriptions) {
      desc.hidden = desc.dataset.optionDescription !== selectedValue;
    }

    // Also update the legend's selected value display
    const legend = this.closest('fieldset')?.querySelector('.variant-option__swatch-value');
    if (legend) {
      legend.textContent = selectedValue;
    }
  }
}

if (!customElements.get('enriched-option-description')) {
  customElements.define('enriched-option-description', EnrichedOptionDescription);
}
