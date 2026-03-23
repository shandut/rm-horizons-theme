import { Component } from '@theme/component';

/**
 * @typedef {{
 *   tabs: HTMLButtonElement[],
 *   panels: HTMLElement[]
 * }} ExploreRangeRefs
 */

/**
 * Explore Range — tabbed category grid with full WAI-ARIA tab pattern.
 * Supports keyboard navigation: Left/Right arrows, Home, End.
 *
 * @extends {Component<ExploreRangeRefs>}
 */
class ExploreRange extends Component {
  connectedCallback() {
    super.connectedCallback();
  }

  /**
   * Handles tab click — activates the clicked tab and its panel.
   *
   * @param {Event} event
   */
  activateTab(event) {
    const tab = /** @type {HTMLButtonElement} */ (event.target);
    this.#switchToTab(tab);
  }

  /**
   * Handles keyboard navigation on tab elements.
   *
   * @param {KeyboardEvent} event
   */
  handleTabKeydown(event) {
    const tabs = this.refs.tabs;
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
    this.#switchToTab(nextTab);
  }

  /**
   * Switches to the given tab and shows its panel.
   *
   * @param {HTMLButtonElement} activeTab
   */
  #switchToTab(activeTab) {
    const tabs = this.refs.tabs;
    const panels = this.refs.panels;
    if (!tabs || !panels || !Array.isArray(tabs) || !Array.isArray(panels)) return;

    for (const tab of tabs) {
      const isActive = tab === activeTab;
      tab.classList.toggle('explore-range__tab--active', isActive);
      tab.setAttribute('aria-selected', String(isActive));
      tab.setAttribute('tabindex', isActive ? '0' : '-1');
    }

    const panelId = activeTab.getAttribute('aria-controls');

    for (const panel of panels) {
      const isActive = panel.id === panelId;
      panel.classList.toggle('explore-range__panel--active', isActive);
      panel.hidden = !isActive;
    }
  }
}

customElements.define('explore-range-component', ExploreRange);
