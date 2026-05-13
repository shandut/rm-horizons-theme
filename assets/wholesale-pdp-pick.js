import { Component } from '@theme/component';
import { CartAddEvent, CartUpdateEvent } from '@theme/events';
import { debounce, fetchConfig } from '@theme/utilities';
import { morphSection } from '@theme/section-renderer';

/**
 * Wholesale PDP Quick Pick — single-product variant picker dialog.
 *
 * Renders a dialog with every variant of the current product. Each row
 * has a ±/qty stepper; edits debounce to a single bulk cart-update POST
 * (`updates: { variantId: qty, ... }`) so multi-variant adjustments
 * coalesce into one round-trip. After every server response we morph
 * our own section so the inputs reflect the server's truth — no
 * client-side bookkeeping for cart line keys.
 *
 * @typedef {object} WholesalePdpPickRefs
 * @property {HTMLButtonElement} [trigger]
 * @property {HTMLDialogElement} [dialog]
 * @property {HTMLButtonElement} [closeButton]
 * @property {HTMLButtonElement} [clearButton]
 * @property {HTMLLIElement[]} [rows]
 * @property {HTMLInputElement[]} [quantityInputs]
 * @property {HTMLElement[]} [lineTotals]
 * @property {HTMLElement} [subtotal]
 * @property {HTMLElement} [totalUnits]
 * @property {HTMLElement} [toast]
 * @property {HTMLElement} [toastText]
 * @property {HTMLElement} [errorContainer]
 * @property {HTMLElement} [errorText]
 *
 * @extends Component<WholesalePdpPickRefs>
 */
class WholesalePdpPick extends Component {
  /** @type {AbortController|null} */
  #abortController = null;

  /** Pending qty intents keyed by variantId — flushed on the next debounced tick. @type {Map<string, number>} */
  #pendingUpdates = new Map();

  /** @type {(() => void) | null} */
  #debouncedFlush = null;

  /** @type {number | null} */
  #toastTimer = null;

  connectedCallback() {
    super.connectedCallback();
    this.#debouncedFlush = debounce(() => this.#flushUpdates(), 350);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abortController?.abort();
    if (this.#toastTimer) clearTimeout(this.#toastTimer);
  }

  /** @param {Event} event */
  openDialog(event) {
    event.preventDefault();
    const dialog = this.refs.dialog;
    if (!(dialog instanceof HTMLDialogElement)) return;
    if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
    // Click backdrop to close.
    dialog.addEventListener('click', this.#onBackdropClick);
  }

  closeDialog() {
    const dialog = this.refs.dialog;
    if (!(dialog instanceof HTMLDialogElement)) return;
    if (dialog.open) dialog.close();
    dialog.removeEventListener('click', this.#onBackdropClick);
  }

  /** @type {(event: MouseEvent) => void} */
  #onBackdropClick = (event) => {
    const dialog = this.refs.dialog;
    if (!(dialog instanceof HTMLDialogElement)) return;
    // <dialog>'s click target is the dialog itself when the backdrop is hit.
    if (event.target === dialog) this.closeDialog();
  };

  /**
   * +/− stepper buttons.
   * @param {Event} event
   */
  onStep(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const btn = target.closest('[data-action][data-variant-id]');
    if (!(btn instanceof HTMLElement) || btn.hasAttribute('disabled')) return;

    const variantId = btn.dataset.variantId;
    if (!variantId) return;
    const input = this.#findInput(variantId);
    if (!input) return;

    const current = parseInt(input.value, 10) || 0;
    const inc = Math.max(1, parseInt(input.dataset.increment || '1', 10) || 1);
    const min = parseInt(input.dataset.min || '0', 10) || 0;
    const max = input.dataset.max ? parseInt(input.dataset.max, 10) : Infinity;

    let next = btn.dataset.action === 'increment' ? current + inc : current - inc;
    // Snap below-min downwards to 0 (treated as remove) rather than clamping back up.
    if (next < 0) next = 0;
    if (next > 0 && next < min) next = btn.dataset.action === 'increment' ? min : 0;
    if (next > max) next = max;
    if (next === current) return;

    input.value = String(next);
    this.#updateLineTotal(input);
    this.#updateFooter();
    this.#queueUpdate(variantId, next);
  }

  /** @param {Event} event */
  onQuantityChange(event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const variantId = input.dataset.variantId;
    if (!variantId) return;

    const qty = Math.max(0, parseInt(input.value, 10) || 0);
    input.value = String(qty);
    this.#updateLineTotal(input);
    this.#updateFooter();
    this.#queueUpdate(variantId, qty);
  }

  /** @param {Event} event */
  onQuantityBlur(event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    // Apply quantity-rule clamping on blur, mirroring the order pad.
    const raw = parseInt(input.value, 10);
    const qty = Number.isFinite(raw) && raw > 0 ? raw : 0;
    const min = parseInt(input.dataset.min || '0', 10) || 0;
    const inc = Math.max(1, parseInt(input.dataset.increment || '1', 10) || 1);
    const max = input.dataset.max ? parseInt(input.dataset.max, 10) : Infinity;

    let clamped = qty;
    if (clamped > 0 && clamped < min) clamped = min;
    if (clamped > max) clamped = max;
    if (clamped > 0 && inc > 1) {
      const base = min > 0 ? min : 0;
      const offset = clamped - base;
      const steps = Math.max(0, Math.ceil(offset / inc));
      clamped = base + steps * inc;
      if (clamped > max) clamped = max;
    }
    if (clamped !== qty) {
      input.value = String(clamped);
      this.#updateLineTotal(input);
      this.#updateFooter();
      const variantId = input.dataset.variantId;
      if (variantId) this.#queueUpdate(variantId, clamped);
    }
  }

  /** Trash icon on a row — sets qty to 0 immediately. @param {Event} event */
  onRemove(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const btn = target.closest('[data-variant-id]');
    if (!(btn instanceof HTMLElement)) return;
    const variantId = btn.dataset.variantId;
    if (!variantId) return;
    const input = this.#findInput(variantId);
    if (!input) return;
    input.value = '0';
    this.#updateLineTotal(input);
    this.#updateFooter();
    this.#queueUpdate(variantId, 0);
  }

  /** Clear-all — zero every input for this product, flush as one POST. */
  clearAll() {
    const inputs = this.refs.quantityInputs || [];
    let touched = false;
    for (const input of inputs) {
      if (parseInt(input.value, 10) > 0) {
        input.value = '0';
        this.#updateLineTotal(input);
        const variantId = input.dataset.variantId;
        if (variantId) this.#pendingUpdates.set(variantId, 0);
        touched = true;
      }
    }
    if (!touched) return;
    this.#updateFooter();
    this.#flushUpdates(); // immediate — no debounce
  }

  // ─── private ──────────────────────────────────────────────────

  /**
   * @param {string} variantId
   * @returns {HTMLInputElement|null}
   */
  #findInput(variantId) {
    const inputs = this.refs.quantityInputs || [];
    return inputs.find((i) => i.dataset.variantId === variantId) || null;
  }

  /** @param {HTMLInputElement} input */
  #updateLineTotal(input) {
    const variantId = input.dataset.variantId;
    if (!variantId) return;
    const totals = this.refs.lineTotals || [];
    const target = totals.find((t) => t.dataset.variantId === variantId);
    if (!target) return;
    const qty = parseInt(input.value, 10) || 0;
    const price = parseInt(input.dataset.price || '0', 10) || 0;
    target.textContent = this.#formatMoney(qty * price);
  }

  /**
   * Updates the footer's *visible* totals based on every input in the
   * picker. The cart subtotal/units will be re-rendered from the server
   * once the POST resolves; this is just snappy local feedback.
   */
  #updateFooter() {
    const inputs = this.refs.quantityInputs || [];
    let cents = 0;
    let units = 0;
    for (const i of inputs) {
      const qty = parseInt(i.value, 10) || 0;
      if (qty <= 0) continue;
      const price = parseInt(i.dataset.price || '0', 10) || 0;
      cents += qty * price;
      units += qty;
    }
    if (this.refs.subtotal) this.refs.subtotal.textContent = this.#formatMoney(cents);
    if (this.refs.totalUnits) this.refs.totalUnits.textContent = String(units);
  }

  /**
   * @param {string} variantId
   * @param {number} qty
   */
  #queueUpdate(variantId, qty) {
    this.#pendingUpdates.set(variantId, qty);
    this.#debouncedFlush?.();
  }

  async #flushUpdates() {
    if (this.#pendingUpdates.size === 0) return;
    /** @type {Record<string, number>} */
    const updates = {};
    for (const [variantId, qty] of this.#pendingUpdates) updates[variantId] = qty;
    this.#pendingUpdates.clear();

    this.#abortController?.abort();
    this.#abortController = new AbortController();
    this.classList.add('is-busy');
    this.#clearError();

    const sectionsUrl = new URL(window.location.pathname + window.location.search, window.location.origin);
    const body = JSON.stringify({
      updates,
      sections: this.#getSectionIds().join(','),
      sections_url: sectionsUrl.pathname + sectionsUrl.search,
    });

    try {
      const res = await fetch(Theme.routes.cart_update_url, {
        ...fetchConfig('json', { body }),
        signal: this.#abortController.signal,
      });
      const text = await res.text();
      /** @type {any} */
      let data;
      try { data = JSON.parse(text); } catch (_e) { data = null; }

      if (!res.ok || (data && (data.errors || data.status >= 400))) {
        const message = (data && (
          typeof data.errors === 'string' ? data.errors : (data.description || data.message)
        )) || 'Could not update cart. Please try again.';
        this.#showError(message);
        return;
      }

      if (data) {
        this.#updateSectionHTML(data);
        const eventCtor = Object.values(updates).some((q) => q > 0) ? CartAddEvent : CartUpdateEvent;
        document.dispatchEvent(new eventCtor(data, this.id, {
          source: 'wholesale-pdp-pick',
          sections: data.sections,
        }));
        const totalAdded = Object.values(updates).reduce((sum, n) => sum + (n > 0 ? n : 0), 0);
        if (totalAdded > 0) this.#showToast(`${totalAdded} item${totalAdded === 1 ? '' : 's'} added`);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      console.error('[wholesale-pdp-pick] flush failed', error);
      this.#showError('Could not reach the cart. Try again.');
    } finally {
      this.classList.remove('is-busy');
    }
  }

  /** @returns {string[]} */
  #getSectionIds() {
    /** @type {string[]} */
    const ids = [];
    if (this.dataset.sectionId) ids.push(this.dataset.sectionId);

    for (const el of document.querySelectorAll('cart-items-component')) {
      if (!(el instanceof HTMLElement)) continue;
      const id = el.dataset.sectionId;
      if (id && !ids.includes(id)) ids.push(id);
    }
    for (const el of document.querySelectorAll('cart-icon-component')) {
      if (!(el instanceof HTMLElement)) continue;
      const id = el.dataset.sectionId;
      if (id && !ids.includes(id)) ids.push(id);
    }
    return ids;
  }

  /** @param {{ sections?: Record<string, string> }} data */
  #updateSectionHTML(data) {
    if (!data.sections) return;
    for (const [id, html] of Object.entries(data.sections)) {
      if (typeof html === 'string') morphSection(id, html);
    }
  }

  /** @param {number} cents */
  #formatMoney(cents) {
    // Local feedback only — the server-rendered Liquid in the morphed
    // section is the source of truth. A simple format that matches
    // shop.money_format closely enough is fine here.
    const value = (cents / 100).toFixed(2);
    const format = this.dataset.moneyFormat || '${{amount}}';
    return format.replace(/\{\{\s*\w+\s*\}\}/, value);
  }

  /** @param {string} message */
  #showToast(message) {
    if (!this.refs.toast || !this.refs.toastText) return;
    this.refs.toastText.textContent = message;
    this.refs.toast.classList.remove('hidden');
    if (this.refs.errorContainer) this.refs.errorContainer.classList.add('hidden');
    if (this.#toastTimer) clearTimeout(this.#toastTimer);
    this.#toastTimer = window.setTimeout(() => {
      this.refs.toast?.classList.add('hidden');
    }, 2500);
  }

  /** @param {string} message */
  #showError(message) {
    if (!this.refs.errorContainer || !this.refs.errorText) return;
    this.refs.errorText.textContent = message;
    this.refs.errorContainer.classList.remove('hidden');
    if (this.refs.toast) this.refs.toast.classList.add('hidden');
  }

  #clearError() {
    this.refs.errorContainer?.classList.add('hidden');
  }
}

if (!customElements.get('wholesale-pdp-pick')) {
  customElements.define('wholesale-pdp-pick', WholesalePdpPick);
}
