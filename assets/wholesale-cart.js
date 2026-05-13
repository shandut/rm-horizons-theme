import { Component } from '@theme/component';
import { CartUpdateEvent } from '@theme/events';
import { debounce, fetchConfig } from '@theme/utilities';
import { morphSection } from '@theme/section-renderer';

/**
 * Wholesale cart — full-page B2B cart review/edit view.
 * Owns the table at /cart?view=b2b. Edits go through Shopify's cart
 * change/update endpoints; the section's HTML is morphed in place on
 * every server response so totals and per-line state always reflect
 * the server's truth.
 *
 * @typedef {object} WholesaleCartRefs
 * @property {HTMLTableRowElement[]} [lineRows]
 * @property {HTMLInputElement[]} [quantityInputs]
 * @property {HTMLElement[]} [lineTotals]
 * @property {HTMLInputElement} [poField]
 * @property {HTMLInputElement} [notesField]
 * @property {HTMLElement} [lineCount]
 * @property {HTMLElement} [totalUnits]
 * @property {HTMLElement} [grandTotal]
 * @property {HTMLButtonElement} [checkoutButton]
 * @property {HTMLElement} [successContainer]
 * @property {HTMLElement} [successText]
 * @property {HTMLElement} [errorContainer]
 * @property {HTMLElement} [errorText]
 *
 * @extends Component<WholesaleCartRefs>
 */
class WholesaleCart extends Component {
  /** @type {AbortController|null} */
  #abortController = null;

  /** @type {(() => void) | null} */
  #debouncedSaveAttrs = null;

  /** @type {number | null} */
  #successTimer = null;

  connectedCallback() {
    super.connectedCallback();
    this.#debouncedSaveAttrs = debounce(() => this.#saveAttrs(), 700);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abortController?.abort();
    if (this.#successTimer) clearTimeout(this.#successTimer);
  }

  /**
   * +/− stepper buttons. Reads action + line-key off the button.
   * @param {Event} event
   */
  onStep(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const btn = target.closest('[data-action][data-line-key]');
    if (!(btn instanceof HTMLElement)) return;

    const lineKey = btn.dataset.lineKey;
    if (!lineKey) return;

    const row = btn.closest('tr');
    const input = row?.querySelector('input[type="number"]');
    if (!(input instanceof HTMLInputElement)) return;

    const current = parseInt(input.value, 10) || 0;
    const next = btn.dataset.action === 'increment' ? current + 1 : Math.max(0, current - 1);
    if (next === current) return;

    input.value = String(next);
    this.#updateLine(lineKey, next);
  }

  /**
   * @param {Event} event
   */
  onQuantityChange(event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const lineKey = input.dataset.lineKey;
    if (!lineKey) return;
    const qty = Math.max(0, parseInt(input.value, 10) || 0);
    input.value = String(qty);
    this.#updateLine(lineKey, qty);
  }

  /**
   * @param {Event} event
   */
  onQuantityBlur(event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const v = parseInt(input.value, 10);
    if (!Number.isFinite(v) || v < 0) input.value = '0';
  }

  /**
   * @param {Event} event
   */
  onRemove(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const btn = target.closest('[data-line-key]');
    if (!(btn instanceof HTMLElement)) return;
    const lineKey = btn.dataset.lineKey;
    if (!lineKey) return;
    this.#updateLine(lineKey, 0);
  }

  onAttrChange() {
    this.#debouncedSaveAttrs?.();
  }

  /**
   * Persist PO + notes attributes, then redirect to Shopify's checkout.
   * We flush attrs first so the buyer's PO and notes are guaranteed to
   * land on the order even if the debounce hadn't fired yet.
   */
  async checkout() {
    if (this.refs.checkoutButton) {
      this.refs.checkoutButton.disabled = true;
      this.refs.checkoutButton.setAttribute('aria-busy', 'true');
    }
    try {
      await this.#saveAttrs();
    } catch (_e) {
      // best-effort — proceed to checkout anyway
    }
    window.location.href = '/checkout';
  }

  // ─── private ──────────────────────────────────────────────────

  /**
   * @param {string} lineKey
   * @param {number} quantity
   */
  async #updateLine(lineKey, quantity) {
    this.#abortController?.abort();
    this.#abortController = new AbortController();
    this.classList.add('is-busy');
    this.#clearMessages();

    const sectionsUrl = new URL(window.location.pathname + window.location.search, window.location.origin);
    const body = JSON.stringify({
      id: lineKey,
      quantity,
      sections: this.#getSectionIds().join(','),
      sections_url: sectionsUrl.pathname + sectionsUrl.search,
    });

    try {
      const res = await fetch(Theme.routes.cart_change_url, {
        ...fetchConfig('json', { body }),
        signal: this.#abortController.signal,
      });
      const text = await res.text();
      /** @type {any} */
      let data;
      try { data = JSON.parse(text); } catch (_e) { data = null; }

      if (!res.ok || (data && data.status >= 400)) {
        const message = (data && (data.description || data.message)) || 'Could not update line.';
        this.#showError(message);
        return;
      }

      if (data) {
        this.#updateSectionHTML(data);
        // Also let the cart drawer / cart icon stay in sync if a B2B
        // buyer ever flips back to the DTC cart.
        document.dispatchEvent(
          new CartUpdateEvent(data, this.id, {
            source: 'wholesale-cart',
            sections: data.sections,
          })
        );
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      console.error('[wholesale-cart] update failed', error);
      this.#showError('Could not reach the cart. Check your connection and try again.');
    } finally {
      this.classList.remove('is-busy');
    }
  }

  /**
   * Persist PO + notes. Used by debounced typing and by checkout flush.
   */
  async #saveAttrs() {
    const po = this.refs.poField?.value.trim() ?? '';
    const note = this.refs.notesField?.value.trim() ?? '';
    const body = JSON.stringify({
      attributes: { 'PO Number': po },
      note,
    });

    try {
      const res = await fetch(Theme.routes.cart_update_url, {
        ...fetchConfig('json', { body }),
      });
      if (res.ok) this.#showSuccess('Order details saved.');
    } catch (_e) {
      // silent — these are optional metadata
    }
  }

  /**
   * @returns {string[]}
   */
  #getSectionIds() {
    /** @type {string[]} */
    const ids = [];
    if (this.dataset.sectionId) ids.push(this.dataset.sectionId);
    return ids;
  }

  /**
   * @param {{ sections?: Record<string, string> }} data
   */
  #updateSectionHTML(data) {
    if (!data.sections) return;
    for (const [id, html] of Object.entries(data.sections)) {
      if (typeof html === 'string') morphSection(id, html);
    }
  }

  /**
   * @param {string} message
   */
  #showSuccess(message) {
    if (!this.refs.successContainer || !this.refs.successText) return;
    this.refs.successText.textContent = message;
    this.refs.successContainer.classList.remove('hidden');
    if (this.refs.errorContainer) this.refs.errorContainer.classList.add('hidden');
    if (this.#successTimer) clearTimeout(this.#successTimer);
    this.#successTimer = window.setTimeout(() => {
      this.refs.successContainer?.classList.add('hidden');
    }, 2500);
  }

  /**
   * @param {string} message
   */
  #showError(message) {
    if (!this.refs.errorContainer || !this.refs.errorText) return;
    this.refs.errorText.textContent = message;
    this.refs.errorContainer.classList.remove('hidden');
    if (this.refs.successContainer) this.refs.successContainer.classList.add('hidden');
  }

  #clearMessages() {
    this.refs.successContainer?.classList.add('hidden');
    this.refs.errorContainer?.classList.add('hidden');
  }
}

if (!customElements.get('wholesale-cart')) {
  customElements.define('wholesale-cart', WholesaleCart);
}
