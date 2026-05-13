import { Component } from '@theme/component';
import { CartAddEvent } from '@theme/events';
import { fetchConfig } from '@theme/utilities';
import { formatMoney } from '@theme/money-formatting';

/**
 * Wholesale order pad — multi-product, row-per-product, size-columns grid.
 * Reads B2B-contextualized prices/quantity rules from the rendered DOM
 * (Liquid did the work) and bulk-submits the order in a single cart-update POST.
 *
 * @typedef {object} WholesaleOrderListRefs
 * @property {HTMLTableRowElement[]} [rows]
 * @property {HTMLInputElement[]} [quantityInputs]
 * @property {HTMLElement[]} [rowTotals]
 * @property {HTMLInputElement} [searchInput]
 * @property {HTMLElement} [grandTotal]
 * @property {HTMLElement} [lineCount]
 * @property {HTMLElement} [totalUnits]
 * @property {HTMLButtonElement} [submitButton]
 * @property {HTMLInputElement} [poField]
 * @property {HTMLInputElement} [notesField]
 * @property {HTMLSelectElement} [locationSwitcher]
 * @property {HTMLElement} [successContainer]
 * @property {HTMLElement} [successText]
 * @property {HTMLElement} [errorContainer]
 * @property {HTMLElement} [errorText]
 *
 * @extends Component<WholesaleOrderListRefs>
 */
class WholesaleOrderList extends Component {
  /** @type {AbortController|null} */
  #abortController = null;

  /** @type {string} */
  #currency = 'USD';

  /** @type {string} */
  #moneyFormat = '${{amount}}';

  connectedCallback() {
    super.connectedCallback();
    this.#currency = this.dataset.currency || 'USD';
    this.#moneyFormat = this.dataset.moneyFormat || '${{amount}}';
    this.#recalculate();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abortController?.abort();
  }

  /**
   * Search/filter rows by product title or SKU.
   * @param {Event} event
   */
  onSearch(event) {
    if (!(event.target instanceof HTMLInputElement)) return;
    const q = event.target.value.trim().toLowerCase();
    const rows = this.refs.rows || [];
    for (const row of rows) {
      const haystack = row.dataset.searchString || '';
      row.hidden = q.length > 0 && !haystack.includes(q);
    }
  }

  /**
   * Live recalc on every keystroke.
   * @param {Event} event
   */
  onQuantityChange(event) {
    if (!(event.target instanceof HTMLInputElement)) return;
    this.#updateRowTotal(event.target);
    this.#updateGrandTotal();
    this.#clearMessages();
  }

  /**
   * Clamp to min/increment/max from data-attrs on blur.
   * @param {Event} event
   */
  onQuantityBlur(event) {
    if (!(event.target instanceof HTMLInputElement)) return;
    const input = event.target;
    const raw = parseInt(input.value, 10);
    const qty = Number.isFinite(raw) && raw > 0 ? raw : 0;

    const min = parseInt(input.dataset.min || '0', 10) || 0;
    const inc = Math.max(1, parseInt(input.dataset.increment || '1', 10) || 1);
    const max = input.dataset.max ? parseInt(input.dataset.max, 10) : Infinity;

    let clamped = qty;
    if (clamped > 0 && clamped < min) clamped = min;
    if (clamped > max) clamped = max;
    if (clamped > 0 && inc > 1) {
      // Round up to the next multiple of inc, starting from min.
      const base = min > 0 ? min : 0;
      const offset = clamped - base;
      const steps = Math.max(0, Math.ceil(offset / inc));
      clamped = base + steps * inc;
      if (clamped > max) clamped = max;
    }

    if (clamped !== qty) {
      input.value = String(clamped);
      this.#updateRowTotal(input);
      this.#updateGrandTotal();
    }
  }

  /**
   * Location switch — reload so Shopify re-prices everything for the new location.
   * @param {Event} event
   */
  onLocationChange(event) {
    if (!(event.target instanceof HTMLSelectElement)) return;
    const locationId = event.target.value;
    if (!locationId) return;

    const select = event.target;
    select.disabled = true;
    // Standard Shopify B2B endpoint to set the active location for the buyer's session.
    fetch('/cart/update.js', {
      ...fetchConfig('json', {
        body: JSON.stringify({ attributes: { company_location_id: locationId } }),
      }),
    })
      .catch(() => {})
      .finally(() => {
        window.location.reload();
      });
  }

  /**
   * Bulk add — one POST containing every non-zero variant qty.
   */
  async submitOrder() {
    this.#clearMessages();

    const inputs = this.refs.quantityInputs || [];
    /** @type {Record<string, number>} */
    const updates = {};
    let lineCount = 0;

    for (const input of inputs) {
      if (input.disabled) continue;
      const qty = parseInt(input.value, 10) || 0;
      const variantId = input.dataset.variantId;
      if (qty > 0 && variantId) {
        updates[variantId] = qty;
        lineCount++;
      }
    }

    if (lineCount === 0) {
      this.#showError('Enter at least one quantity to add to cart.');
      return;
    }

    /** @type {Record<string, string>} */
    const attributes = {};
    const po = this.refs.poField?.value.trim();
    if (po) attributes['PO Number'] = po;

    const note = this.refs.notesField?.value.trim() || '';

    const sectionIds = this.#getSectionIds();
    const sectionsUrl = new URL(window.location.pathname, window.location.origin);

    /** @type {Record<string, unknown>} */
    const payload = {
      updates,
      sections: sectionIds.join(','),
      sections_url: sectionsUrl.pathname + sectionsUrl.search,
    };
    if (Object.keys(attributes).length > 0) payload.attributes = attributes;
    if (note) payload.note = note;

    this.#setBusy(true);
    this.#abortController?.abort();
    this.#abortController = new AbortController();

    try {
      const response = await fetch(Theme.routes.cart_update_url, {
        ...fetchConfig('json', { body: JSON.stringify(payload) }),
        signal: this.#abortController.signal,
      });

      const text = await response.text();
      const data = JSON.parse(text);

      if (data.errors || data.status >= 400) {
        const message = typeof data.errors === 'string'
          ? data.errors
          : data.description || 'Some items could not be added. Please review and try again.';
        this.#showError(message);
        return;
      }

      // Dispatch so any cart drawer/icon on this page (or any rendered in
      // subsequent navigation) stays in sync if a B2B buyer flips views.
      document.dispatchEvent(
        new CartAddEvent(data, this.id, {
          source: 'wholesale-order-list',
          sections: data.sections,
        })
      );

      // Side cart can't comfortably display dozens of size-run lines —
      // send the buyer to the dedicated full-page B2B cart view to
      // review, edit qtys, attach PO, and check out.
      window.location.href = '/cart?view=b2b';
      return;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      console.error('[wholesale-order-list] submit failed', error);
      this.#showError('Could not reach the cart. Check your connection and try again.');
    } finally {
      this.#setBusy(false);
    }
  }

  // ─── internals ────────────────────────────────────────────────

  #recalculate() {
    const inputs = this.refs.quantityInputs || [];
    for (const input of inputs) this.#updateRowTotal(input);
    this.#updateGrandTotal();
  }

  /**
   * @param {HTMLInputElement} input
   */
  #updateRowTotal(input) {
    const rowId = input.dataset.rowId;
    if (!rowId) return;
    const rowTotals = this.refs.rowTotals || [];
    const totalEl = rowTotals.find((el) => el.dataset.rowId === rowId);
    if (!totalEl) return;

    // Sum every input in the same row (covers multi-size products).
    const inputs = this.refs.quantityInputs || [];
    let cents = 0;
    for (const i of inputs) {
      if (i.dataset.rowId !== rowId) continue;
      const qty = parseInt(i.value, 10) || 0;
      if (qty <= 0) continue;
      const price = parseInt(i.dataset.price || '0', 10) || 0;
      cents += qty * price;
    }
    totalEl.textContent = this.#formatMoney(cents);
  }

  #updateGrandTotal() {
    const inputs = this.refs.quantityInputs || [];
    let cents = 0;
    let units = 0;
    /** @type {Set<string>} */
    const lineRows = new Set();

    for (const i of inputs) {
      const qty = parseInt(i.value, 10) || 0;
      if (qty <= 0) continue;
      const price = parseInt(i.dataset.price || '0', 10) || 0;
      cents += qty * price;
      units += qty;
      if (i.dataset.rowId) lineRows.add(i.dataset.rowId);
    }

    if (this.refs.grandTotal) this.refs.grandTotal.textContent = this.#formatMoney(cents);
    if (this.refs.totalUnits) this.refs.totalUnits.textContent = String(units);
    if (this.refs.lineCount) this.refs.lineCount.textContent = String(lineRows.size);

    const btn = this.refs.submitButton;
    if (btn) {
      const empty = units === 0;
      btn.disabled = empty;
      btn.setAttribute('aria-disabled', empty ? 'true' : 'false');
    }
  }

  /**
   * @param {number} cents
   */
  #formatMoney(cents) {
    try {
      return formatMoney(cents, this.#moneyFormat, this.#currency);
    } catch (_e) {
      return (cents / 100).toFixed(2);
    }
  }

  /**
   * @param {boolean} busy
   */
  #setBusy(busy) {
    this.classList.toggle('is-busy', busy);
    const btn = this.refs.submitButton;
    if (btn) {
      btn.disabled = busy || btn.disabled;
      btn.setAttribute('aria-busy', busy ? 'true' : 'false');
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

  /**
   * Section IDs to re-render — our own + any cart-drawer/cart-icon on the page.
   * @returns {string[]}
   */
  #getSectionIds() {
    /** @type {string[]} */
    const ids = [];
    if (this.dataset.sectionId) ids.push(this.dataset.sectionId);

    const cartItems = document.querySelectorAll('cart-items-component');
    for (const el of cartItems) {
      if (!(el instanceof HTMLElement)) continue;
      const id = el.dataset.sectionId;
      if (id && !ids.includes(id)) ids.push(id);
    }

    const cartIcons = document.querySelectorAll('cart-icon-component');
    for (const el of cartIcons) {
      if (!(el instanceof HTMLElement)) continue;
      const id = el.dataset.sectionId;
      if (id && !ids.includes(id)) ids.push(id);
    }

    return ids;
  }

}

if (!customElements.get('wholesale-order-list')) {
  customElements.define('wholesale-order-list', WholesaleOrderList);
}
