/**
 * 3D Boot Configurator — Three.js WebGL Application
 *
 * Self-contained ES module. Three.js loaded via importmap from CDN.
 * Liquid section renders the shell; this JS owns the entire experience.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ═══════════════════════════════════════════════════════════
// 1. CONSTANTS
// ═══════════════════════════════════════════════════════════

const PHASES = [
  { id: 'build', label: 'Build' },
  { id: 'customise', label: 'Customise' },
  { id: 'personalise', label: 'Personalise' },
];

// ═══════════════════════════════════════════════════════════
// 2. STATE STORE
// ═══════════════════════════════════════════════════════════

class StateStore {
  /** @type {Record<string, string>} */
  #state = {};
  /** @type {Set<Function>} */
  #listeners = new Set();

  constructor(defaults) {
    this.#state = { ...defaults };
  }

  get(key) { return this.#state[key]; }

  set(key, value) {
    if (this.#state[key] === value) return;
    this.#state[key] = value;
    for (const fn of this.#listeners) fn(key, value, this.#state);
  }

  getAll() { return { ...this.#state }; }

  onChange(fn) { this.#listeners.add(fn); }

  removeListener(fn) { this.#listeners.delete(fn); }

  /** Generate deterministic config hash. */
  hash() {
    return Object.entries(this.#state)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('|');
  }
}

// ═══════════════════════════════════════════════════════════
// 3. RULES ENGINE
// ═══════════════════════════════════════════════════════════

class RulesEngine {
  #rules = [];

  constructor(rules) {
    this.#rules = rules || [];
  }

  /**
   * Get denied values for a given option key based on current state.
   * @param {string} key
   * @param {Record<string, string>} state
   * @returns {{ denied: Set<string>, messages: string[] }}
   */
  evaluate(key, state) {
    const denied = new Set();
    const messages = [];

    for (const rule of this.#rules) {
      const conditionsMet = Object.entries(rule.when).every(([k, v]) => state[k] === v);
      if (!conditionsMet) continue;

      if (rule.deny?.[key]) {
        for (const val of rule.deny[key]) {
          denied.add(val);
        }
        if (rule.message) messages.push(rule.message);
      }

      if (rule.allow?.[key]) {
        // Allow means everything NOT in the list is denied
        // (not implemented for MVP — deny-only is simpler)
      }
    }

    return { denied, messages };
  }

  /**
   * Check if a specific value is valid for a key given current state.
   */
  isValid(key, value, state) {
    const { denied } = this.evaluate(key, state);
    return !denied.has(value);
  }
}

// ═══════════════════════════════════════════════════════════
// 4. THREE.JS RENDERER
// ═══════════════════════════════════════════════════════════

class BootRenderer {
  /** @type {THREE.WebGLRenderer} */
  #renderer;
  /** @type {THREE.Scene} */
  #scene;
  /** @type {THREE.PerspectiveCamera} */
  #camera;
  /** @type {OrbitControls} */
  #controls;
  /** @type {THREE.Group} */
  #bootGroup;
  /** @type {Record<string, THREE.MeshStandardMaterial>} */
  #materials = {};
  /** @type {Record<string, THREE.Group>} */
  #meshGroups = {};
  /** @type {number} */
  #rafId = 0;
  /** @type {boolean} */
  #needsRender = true;
  /** @type {ResizeObserver | null} */
  #resizeObserver = null;

  constructor(canvas, container) {
    this.#initRenderer(canvas, container);
    this.#initScene();
    this.#initCamera(container);
    this.#initControls(canvas);
    this.#initLights();
    this.#createPlaceholderBoot();
    this.#startRenderLoop();
    this.#initResize(container);
  }

  #initRenderer(canvas, container) {
    this.#renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.#renderer.setSize(container.clientWidth, container.clientHeight);
    this.#renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.#renderer.toneMappingExposure = 1.2;
  }

  #initScene() {
    this.#scene = new THREE.Scene();
    this.#scene.background = new THREE.Color(0xf5f0e8);
  }

  #initCamera(container) {
    const aspect = container.clientWidth / container.clientHeight;
    this.#camera = new THREE.PerspectiveCamera(35, aspect, 0.1, 100);
    this.#camera.position.set(3, 2, 5);
    this.#camera.lookAt(0, 1, 0);
  }

  #initControls(canvas) {
    this.#controls = new OrbitControls(this.#camera, canvas);
    this.#controls.target.set(0, 1, 0);
    this.#controls.enablePan = false;
    this.#controls.enableDamping = true;
    this.#controls.dampingFactor = 0.08;
    this.#controls.minDistance = 3;
    this.#controls.maxDistance = 8;
    this.#controls.minPolarAngle = Math.PI * 0.2;
    this.#controls.maxPolarAngle = Math.PI * 0.65;
    this.#controls.addEventListener('change', () => { this.#needsRender = true; });
    this.#controls.update();
  }

  #initLights() {
    // Ambient fill
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.#scene.add(ambient);

    // Key light
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(5, 8, 5);
    key.castShadow = false;
    this.#scene.add(key);

    // Rim light
    const rim = new THREE.DirectionalLight(0xffeedd, 0.4);
    rim.position.set(-3, 4, -3);
    this.#scene.add(rim);

    // Fill from below
    const fill = new THREE.DirectionalLight(0xffffff, 0.2);
    fill.position.set(0, -2, 3);
    this.#scene.add(fill);
  }

  /**
   * Build a Chelsea boot from Three.js primitives.
   * Each variant part is a named mesh in a named group for easy show/hide.
   */
  #createPlaceholderBoot() {
    this.#bootGroup = new THREE.Group();
    this.#bootGroup.name = 'BootRoot';

    // ── Materials ──
    this.#materials.upper = new THREE.MeshStandardMaterial({
      color: 0x8B4513, roughness: 0.62, metalness: 0.0,
    });
    this.#materials.sole = new THREE.MeshStandardMaterial({
      color: 0x8B6340, roughness: 0.8, metalness: 0.0,
    });
    this.#materials.heel = new THREE.MeshStandardMaterial({
      color: 0x3E2712, roughness: 0.7, metalness: 0.0,
    });
    this.#materials.elastic = new THREE.MeshStandardMaterial({
      color: 0x5C3A1E, roughness: 0.75, metalness: 0.0,
    });
    this.#materials.tug = new THREE.MeshStandardMaterial({
      color: 0xB22222, roughness: 0.6, metalness: 0.0,
    });
    this.#materials.welt = new THREE.MeshStandardMaterial({
      color: 0xA0724A, roughness: 0.65, metalness: 0.0,
    });
    this.#materials.rubber = new THREE.MeshStandardMaterial({
      color: 0x2C2C2C, roughness: 0.9, metalness: 0.0,
    });
    this.#materials.brass = new THREE.MeshStandardMaterial({
      color: 0xDAA520, roughness: 0.3, metalness: 0.6,
    });

    // ── Upper (boot shaft + vamp) ──
    const upperGroup = new THREE.Group();
    upperGroup.name = 'GEO_upper_main';

    // Shaft (tapered cylinder)
    const shaftGeo = new THREE.CylinderGeometry(0.45, 0.5, 1.8, 32, 1, true);
    const shaft = new THREE.Mesh(shaftGeo, this.#materials.upper);
    shaft.position.set(0, 1.5, 0);
    upperGroup.add(shaft);

    // Vamp (front lower section) — half sphere
    const vampGeo = new THREE.SphereGeometry(0.55, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.5);
    const vamp = new THREE.Mesh(vampGeo, this.#materials.upper);
    vamp.position.set(0, 0.6, 0.15);
    vamp.rotation.x = Math.PI;
    upperGroup.add(vamp);

    // Ankle bridge
    const ankleGeo = new THREE.CylinderGeometry(0.5, 0.55, 0.3, 32);
    const ankle = new THREE.Mesh(ankleGeo, this.#materials.upper);
    ankle.position.set(0, 0.6, 0);
    upperGroup.add(ankle);

    this.#bootGroup.add(upperGroup);
    this.#meshGroups['GEO_upper_main'] = upperGroup;

    // ── Toe variants ──
    const toeGroup = new THREE.Group();
    toeGroup.name = 'ToeGroup';

    // Round toe
    const roundGeo = new THREE.SphereGeometry(0.35, 32, 16);
    const roundToe = new THREE.Mesh(roundGeo, this.#materials.upper);
    roundToe.name = 'GEO_toe_round';
    roundToe.position.set(0, 0.35, 0.65);
    roundToe.scale.set(1.3, 0.7, 1.2);
    toeGroup.add(roundToe);

    // Chisel toe
    const chiselGeo = new THREE.BoxGeometry(0.7, 0.4, 0.8);
    const chiselToe = new THREE.Mesh(chiselGeo, this.#materials.upper);
    chiselToe.name = 'GEO_toe_chisel';
    chiselToe.position.set(0, 0.35, 0.7);
    chiselToe.visible = false;
    toeGroup.add(chiselToe);

    // Square toe
    const squareGeo = new THREE.BoxGeometry(0.85, 0.4, 0.7);
    const squareToe = new THREE.Mesh(squareGeo, this.#materials.upper);
    squareToe.name = 'GEO_toe_square';
    squareToe.position.set(0, 0.35, 0.65);
    squareToe.visible = false;
    toeGroup.add(squareToe);

    this.#bootGroup.add(toeGroup);
    this.#meshGroups['GEO_toe_round'] = roundToe;
    this.#meshGroups['GEO_toe_chisel'] = chiselToe;
    this.#meshGroups['GEO_toe_square'] = squareToe;

    // ── Heel variants ──
    // Flat heel
    const flatHeel = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.15, 0.5),
      this.#materials.heel
    );
    flatHeel.name = 'GEO_heel_flat';
    flatHeel.position.set(0, 0.08, -0.35);
    this.#bootGroup.add(flatHeel);
    this.#meshGroups['GEO_heel_flat'] = flatHeel;

    // Block heel
    const blockHeel = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.4, 0.45),
      this.#materials.heel
    );
    blockHeel.name = 'GEO_heel_block';
    blockHeel.position.set(0, 0.2, -0.35);
    blockHeel.visible = false;
    this.#bootGroup.add(blockHeel);
    this.#meshGroups['GEO_heel_block'] = blockHeel;

    // Cuban heel (trapezoidal)
    const cubanShape = new THREE.Shape();
    cubanShape.moveTo(-0.3, 0);
    cubanShape.lineTo(0.3, 0);
    cubanShape.lineTo(0.22, 0.55);
    cubanShape.lineTo(-0.22, 0.55);
    cubanShape.closePath();
    const cubanGeo = new THREE.ExtrudeGeometry(cubanShape, { depth: 0.4, bevelEnabled: false });
    const cubanHeel = new THREE.Mesh(cubanGeo, this.#materials.heel);
    cubanHeel.name = 'GEO_heel_cuban';
    cubanHeel.position.set(0, 0, -0.55);
    cubanHeel.visible = false;
    this.#bootGroup.add(cubanHeel);
    this.#meshGroups['GEO_heel_cuban'] = cubanHeel;

    // ── Sole variants ──
    // Leather sole
    const leatherSole = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.06, 1.8),
      this.#materials.sole
    );
    leatherSole.name = 'GEO_sole_leather';
    leatherSole.position.set(0, 0.03, 0.15);
    this.#bootGroup.add(leatherSole);
    this.#meshGroups['GEO_sole_leather'] = leatherSole;

    // Rubber sole
    const rubberSole = new THREE.Mesh(
      new THREE.BoxGeometry(1.15, 0.1, 1.85),
      this.#materials.rubber
    );
    rubberSole.name = 'GEO_sole_rubber';
    rubberSole.position.set(0, 0.05, 0.15);
    rubberSole.visible = false;
    this.#bootGroup.add(rubberSole);
    this.#meshGroups['GEO_sole_rubber'] = rubberSole;

    // Brass sole (leather + brass accents)
    const brassSoleGroup = new THREE.Group();
    brassSoleGroup.name = 'GEO_sole_brass';
    const brassBase = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.06, 1.8),
      this.#materials.sole
    );
    brassBase.position.set(0, 0.03, 0.15);
    brassSoleGroup.add(brassBase);

    // Add brass screw heads
    const screwGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.02, 8);
    const screwPositions = [
      [-0.4, 0.07, 0.6], [-0.4, 0.07, 0.2], [-0.4, 0.07, -0.2], [-0.4, 0.07, -0.5],
      [0.4, 0.07, 0.6], [0.4, 0.07, 0.2], [0.4, 0.07, -0.2], [0.4, 0.07, -0.5],
      [0, 0.07, 0.9], [0, 0.07, -0.6],
    ];
    for (const [x, y, z] of screwPositions) {
      const screw = new THREE.Mesh(screwGeo, this.#materials.brass);
      screw.position.set(x, y, z);
      brassSoleGroup.add(screw);
    }
    brassSoleGroup.visible = false;
    this.#bootGroup.add(brassSoleGroup);
    this.#meshGroups['GEO_sole_brass'] = brassSoleGroup;

    // ── Elastic panels ──
    const elasticGeo = new THREE.PlaneGeometry(0.08, 1.0);

    const elasticL = new THREE.Mesh(elasticGeo, this.#materials.elastic);
    elasticL.name = 'GEO_elastic_left';
    elasticL.position.set(-0.48, 1.2, 0);
    elasticL.rotation.y = Math.PI * 0.5;
    this.#bootGroup.add(elasticL);
    this.#meshGroups['GEO_elastic_left'] = elasticL;

    const elasticR = new THREE.Mesh(elasticGeo, this.#materials.elastic);
    elasticR.name = 'GEO_elastic_right';
    elasticR.position.set(0.48, 1.2, 0);
    elasticR.rotation.y = -Math.PI * 0.5;
    this.#bootGroup.add(elasticR);
    this.#meshGroups['GEO_elastic_right'] = elasticR;

    // ── Tug (pull tabs) ──
    const tugGeo = new THREE.BoxGeometry(0.12, 0.2, 0.04);

    const tugL = new THREE.Mesh(tugGeo, this.#materials.tug);
    tugL.name = 'GEO_tug_left';
    tugL.position.set(0, 2.5, -0.42);
    this.#bootGroup.add(tugL);
    this.#meshGroups['GEO_tug_left'] = tugL;

    const tugR = new THREE.Mesh(tugGeo, this.#materials.tug);
    tugR.name = 'GEO_tug_right';
    tugR.position.set(0, 2.5, 0.42);
    this.#bootGroup.add(tugR);
    this.#meshGroups['GEO_tug_right'] = tugR;

    // ── Welt (sole edge stitching line) ──
    const weltGeo = new THREE.TorusGeometry(0.58, 0.015, 8, 64);
    const welt = new THREE.Mesh(weltGeo, this.#materials.welt);
    welt.position.set(0, 0.06, 0.15);
    welt.rotation.x = Math.PI * 0.5;
    welt.scale.set(1, 1.5, 1);
    this.#bootGroup.add(welt);

    // Add boot to scene
    this.#scene.add(this.#bootGroup);
    this.#needsRender = true;
  }

  /**
   * Show one mesh and hide others in the same option group.
   * @param {string} group - e.g. 'toe', 'heel', 'sole'
   * @param {string} meshName - e.g. 'GEO_toe_chisel'
   */
  showMesh(group, meshName) {
    const prefix = `GEO_${group}_`;
    for (const [name, mesh] of Object.entries(this.#meshGroups)) {
      if (name.startsWith(prefix)) {
        mesh.visible = name === meshName;
      }
    }
    this.#needsRender = true;
  }

  /**
   * Update a material's color.
   * @param {string} materialName
   * @param {string} hexColor
   * @param {number} [roughness]
   * @param {number} [metalness]
   */
  setMaterialColor(materialName, hexColor, roughness, metalness) {
    const mat = this.#materials[materialName];
    if (!mat) return;
    mat.color.set(hexColor);
    if (roughness !== undefined) mat.roughness = roughness;
    if (metalness !== undefined) mat.metalness = metalness;
    this.#needsRender = true;
  }

  #startRenderLoop() {
    const animate = () => {
      this.#rafId = requestAnimationFrame(animate);
      this.#controls.update();
      if (this.#needsRender) {
        this.#renderer.render(this.#scene, this.#camera);
        this.#needsRender = false;
      }
    };
    animate();
  }

  #initResize(container) {
    this.#resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      this.#camera.aspect = w / h;
      this.#camera.updateProjectionMatrix();
      this.#renderer.setSize(w, h);
      this.#needsRender = true;
    });
    this.#resizeObserver.observe(container);
  }

  requestRender() { this.#needsRender = true; }

  destroy() {
    cancelAnimationFrame(this.#rafId);
    this.#resizeObserver?.disconnect();
    this.#controls.dispose();

    // Dispose geometries and materials
    this.#scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry?.dispose();
        if (obj.material instanceof THREE.Material) obj.material.dispose();
      }
    });
    this.#renderer.dispose();
  }
}

// ═══════════════════════════════════════════════════════════
// 5. UI CONTROLLER
// ═══════════════════════════════════════════════════════════

class UIController {
  #root;
  #manifest;
  #state;
  #rules;
  #renderer;
  #currentStepIndex = 0;

  constructor(root, manifest, state, rules, renderer) {
    this.#root = root;
    this.#manifest = manifest;
    this.#state = state;
    this.#rules = rules;
    this.#renderer = renderer;

    this.#renderPhases();
    this.#renderCurrentStep();
    this.#updateSummary();
    this.#updatePrice();
    this.#bindNavButtons();

    this.#state.onChange((key, value) => {
      this.#applyStateToScene(key, value);
      this.#updateSummary();
      this.#updatePrice();
      this.#renderCurrentStep(); // re-render to update disabled states
    });
  }

  #renderPhases() {
    const container = this.#root.querySelector('.boot-configurator__phases');
    if (!container) return;

    const currentStep = this.#manifest.steps[this.#currentStepIndex];
    const currentPhase = currentStep?.phase || 'build';

    container.innerHTML = PHASES.map((phase, i) => {
      const phaseIndex = PHASES.findIndex(p => p.id === currentPhase);
      const isActive = i === phaseIndex;
      const isComplete = i < phaseIndex;
      const cls = isActive ? ' boot-configurator__phase--active' : isComplete ? ' boot-configurator__phase--complete' : '';
      return `<span class="boot-configurator__phase${cls}" ${isActive ? 'aria-current="step"' : ''}>
        <span class="boot-configurator__phase-dot">${isComplete ? '✓' : i + 1}</span>
        ${phase.label}
      </span>`;
    }).join('<span class="boot-configurator__phase-line"></span>');
  }

  #renderCurrentStep() {
    const container = this.#root.querySelector('.boot-configurator__steps');
    if (!container) return;

    const step = this.#manifest.steps[this.#currentStepIndex];
    if (!step) return;

    const allState = this.#state.getAll();
    const { denied } = this.#rules.evaluate(step.id, allState);

    let html = `<div class="boot-configurator__step">
      <h3 class="boot-configurator__step-title">${step.label}</h3>`;

    if (step.type === 'chips') {
      html += `<div class="boot-configurator__chips">`;
      for (const opt of step.options) {
        const isSelected = allState[step.id] === opt.id;
        const isDenied = denied.has(opt.id);
        html += `<button class="boot-configurator__chip${isSelected ? ' boot-configurator__chip--active' : ''}${isDenied ? ' boot-configurator__chip--disabled' : ''}"
          data-step="${step.id}" data-value="${opt.id}" ${isDenied ? 'disabled' : ''}>
          <span class="boot-configurator__chip-label">${opt.label}</span>
          <span class="boot-configurator__chip-desc">${opt.desc || ''}</span>
          ${opt.priceAdjust ? `<span class="boot-configurator__chip-price">+$${opt.priceAdjust / 100}</span>` : ''}
        </button>`;
      }
      html += `</div>`;
    } else if (step.type === 'swatches') {
      html += `<div class="boot-configurator__swatches">`;
      for (const opt of step.options) {
        const isSelected = allState[step.id] === opt.id;
        html += `<button class="boot-configurator__swatch${isSelected ? ' boot-configurator__swatch--active' : ''}"
          data-step="${step.id}" data-value="${opt.id}"
          style="--swatch-color: ${opt.color}" title="${opt.label}">
          <span class="boot-configurator__swatch-color"></span>
          <span class="boot-configurator__swatch-label">${opt.label}</span>
          ${opt.priceAdjust ? `<span class="boot-configurator__chip-price">+$${opt.priceAdjust / 100}</span>` : ''}
        </button>`;
      }
      html += `</div>`;
    } else if (step.type === 'dropdown') {
      html += `<select class="boot-configurator__select" data-step="${step.id}">`;
      for (const opt of step.options) {
        const isSelected = allState[step.id] === opt.id;
        html += `<option value="${opt.id}" ${isSelected ? 'selected' : ''}>${opt.label}</option>`;
      }
      html += `</select>`;
    } else if (step.type === 'text') {
      const val = allState[step.id] || '';
      html += `<div class="boot-configurator__text-field">
        <input type="text" class="boot-configurator__input" data-step="${step.id}"
          maxlength="${step.maxLength || 20}" placeholder="${step.placeholder || ''}" value="${val}">
        <span class="boot-configurator__char-count">${val.length} / ${step.maxLength || 20}</span>
      </div>`;
    }

    html += `</div>`;
    container.innerHTML = html;

    // Bind events
    for (const btn of container.querySelectorAll('[data-step][data-value]')) {
      btn.addEventListener('click', (e) => {
        const el = e.currentTarget;
        if (el.disabled) return;
        this.#state.set(el.dataset.step, el.dataset.value);
      });
    }

    for (const sel of container.querySelectorAll('select[data-step]')) {
      sel.addEventListener('change', (e) => {
        this.#state.set(e.target.dataset.step, e.target.value);
      });
    }

    for (const input of container.querySelectorAll('input[data-step]')) {
      input.addEventListener('input', (e) => {
        this.#state.set(e.target.dataset.step, e.target.value);
        const counter = container.querySelector('.boot-configurator__char-count');
        if (counter) counter.textContent = `${e.target.value.length} / ${e.target.maxLength}`;
      });
    }

    this.#updateNavButtons();
    this.#renderPhases();
  }

  #applyStateToScene(key, value) {
    const step = this.#manifest.steps.find(s => s.id === key);
    if (!step) return;

    if (step.type === 'chips') {
      const opt = step.options.find(o => o.id === value);
      if (opt?.mesh) {
        const group = key; // 'toe', 'heel', 'sole'
        this.#renderer.showMesh(group, opt.mesh);
      }
    } else if (step.type === 'swatches' && step.materialTarget) {
      const opt = step.options.find(o => o.id === value);
      if (opt?.color) {
        this.#renderer.setMaterialColor(step.materialTarget, opt.color, opt.roughness, opt.metalness);
      }
    }
  }

  #updateSummary() {
    const container = this.#root.querySelector('.boot-configurator__summary');
    if (!container) return;

    const allState = this.#state.getAll();
    let html = '';

    for (const step of this.#manifest.steps) {
      const val = allState[step.id];
      if (!val) continue;
      const opt = step.options?.find(o => o.id === val);
      const label = opt?.label || val;
      const color = opt?.color || '';

      html += `<span class="boot-configurator__summary-chip">`;
      if (color) {
        html += `<span class="boot-configurator__summary-dot" style="background:${color}"></span>`;
      }
      html += `<span class="boot-configurator__summary-key">${step.label}:</span> ${label}</span>`;
    }

    container.innerHTML = html;
  }

  #updatePrice() {
    const container = this.#root.querySelector('.boot-configurator__price');
    if (!container) return;

    let total = this.#manifest.basePrice || 79500;
    const allState = this.#state.getAll();

    for (const step of this.#manifest.steps) {
      const val = allState[step.id];
      const opt = step.options?.find(o => o.id === val);
      if (opt?.priceAdjust) total += opt.priceAdjust;
    }

    const dollars = total / 100;
    container.innerHTML = `<span class="boot-configurator__price-label">Your Craftsman</span>
      <span class="boot-configurator__price-value">$${dollars.toLocaleString('en-AU')}</span>`;
  }

  #bindNavButtons() {
    const backBtn = this.#root.querySelector('.boot-configurator__btn--back');
    const nextBtn = this.#root.querySelector('.boot-configurator__btn--next');
    const addBtn = this.#root.querySelector('.boot-configurator__btn--add');

    backBtn?.addEventListener('click', () => {
      if (this.#currentStepIndex > 0) {
        this.#currentStepIndex--;
        this.#renderCurrentStep();
      }
    });

    nextBtn?.addEventListener('click', () => {
      if (this.#currentStepIndex < this.#manifest.steps.length - 1) {
        this.#currentStepIndex++;
        this.#renderCurrentStep();
      }
    });

    addBtn?.addEventListener('click', () => this.#addToCart());
  }

  #updateNavButtons() {
    const backBtn = this.#root.querySelector('.boot-configurator__btn--back');
    const nextBtn = this.#root.querySelector('.boot-configurator__btn--next');
    const addBtn = this.#root.querySelector('.boot-configurator__btn--add');
    const isFirst = this.#currentStepIndex === 0;
    const isLast = this.#currentStepIndex === this.#manifest.steps.length - 1;

    if (backBtn) backBtn.hidden = isFirst;
    if (nextBtn) {
      nextBtn.hidden = isLast;
      if (!isLast) {
        const nextStep = this.#manifest.steps[this.#currentStepIndex + 1];
        nextBtn.textContent = `Next: ${nextStep.label}`;
      }
    }
    if (addBtn) addBtn.hidden = !isLast;
  }

  async #addToCart() {
    const addBtn = this.#root.querySelector('.boot-configurator__btn--add');
    const variantId = this.#root.dataset.baseVariantId;
    const cartUrl = this.#root.dataset.cartAddUrl || '/cart/add.js';
    if (!variantId || !addBtn) return;

    const allState = this.#state.getAll();
    const properties = {};

    for (const step of this.#manifest.steps) {
      const val = allState[step.id];
      const opt = step.options?.find(o => o.id === val);
      properties[step.label] = opt?.label || val || 'None';
    }

    properties['_config_json'] = JSON.stringify(allState);
    properties['_config_hash'] = this.#state.hash();

    try {
      addBtn.disabled = true;
      addBtn.textContent = 'Adding…';

      const res = await fetch(cartUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          items: [{ id: parseInt(variantId), quantity: 1, properties }],
        }),
      });

      const data = await res.json();
      if (data.status) {
        addBtn.textContent = `Error: ${data.message}`;
        setTimeout(() => { addBtn.disabled = false; addBtn.textContent = 'Add to Cart'; }, 3000);
        return;
      }

      addBtn.textContent = 'Added ✓';
      // Dispatch native event for cart drawers
      document.dispatchEvent(new CustomEvent('cart:add', { detail: data }));

      setTimeout(() => {
        addBtn.disabled = false;
        addBtn.textContent = 'Add to Cart';
      }, 2500);
    } catch (err) {
      console.error('Cart add failed:', err);
      addBtn.disabled = false;
      addBtn.textContent = 'Add to Cart';
    }
  }

  destroy() {
    // Cleanup handled by garbage collection when root is removed
  }
}

// ═══════════════════════════════════════════════════════════
// 6. APP BOOTSTRAP
// ═══════════════════════════════════════════════════════════

class BootConfiguratorApp {
  #root;
  #renderer;
  #ui;

  constructor(root) {
    this.#root = root;
  }

  init() {
    // Parse manifest
    const manifestEl = this.#root.querySelector('.boot-configurator__manifest');
    if (!manifestEl) { console.error('Boot configurator: no manifest found'); return; }

    let manifest;
    try {
      manifest = JSON.parse(manifestEl.textContent);
    } catch (e) {
      console.error('Boot configurator: invalid manifest JSON', e);
      return;
    }

    // State store
    const state = new StateStore(manifest.defaultConfig);

    // Rules engine
    const rules = new RulesEngine(manifest.rules);

    // Three.js renderer
    const canvas = this.#root.querySelector('.boot-configurator__canvas');
    const viewer = this.#root.querySelector('.boot-configurator__viewer');
    if (!canvas || !viewer) { console.error('Boot configurator: no canvas/viewer'); return; }

    this.#renderer = new BootRenderer(canvas, viewer);

    // Hide loader
    const loader = this.#root.querySelector('.boot-configurator__loader');
    if (loader) loader.hidden = true;

    // Apply default state to scene
    for (const step of manifest.steps) {
      const val = manifest.defaultConfig[step.id];
      if (!val) continue;

      if (step.type === 'chips') {
        const opt = step.options.find(o => o.id === val);
        if (opt?.mesh) this.#renderer.showMesh(step.id, opt.mesh);
      } else if (step.type === 'swatches' && step.materialTarget) {
        const opt = step.options.find(o => o.id === val);
        if (opt?.color) this.#renderer.setMaterialColor(step.materialTarget, opt.color, opt.roughness, opt.metalness);
      }
    }

    // UI controller
    this.#ui = new UIController(this.#root, manifest, state, rules, this.#renderer);
  }

  destroy() {
    this.#renderer?.destroy();
    this.#ui?.destroy();
  }
}

// ═══════════════════════════════════════════════════════════
// 7. INIT — find all configurator sections and boot them
// ═══════════════════════════════════════════════════════════

/** @type {Map<string, BootConfiguratorApp>} */
const instances = new Map();

function initAll() {
  for (const root of document.querySelectorAll('.boot-configurator')) {
    const id = root.dataset.sectionId;
    if (!id) continue;

    // Destroy existing instance (theme editor re-render)
    if (instances.has(id)) {
      instances.get(id).destroy();
      instances.delete(id);
    }

    const app = new BootConfiguratorApp(root);
    app.init();
    instances.set(id, app);
  }
}

// Init on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAll);
} else {
  initAll();
}

// Theme editor lifecycle — reinit on section load/select
document.addEventListener('shopify:section:load', (e) => {
  const section = e.target?.querySelector('.boot-configurator');
  if (section) initAll();
});

document.addEventListener('shopify:section:unload', (e) => {
  const id = e.detail?.sectionId;
  if (id && instances.has(id)) {
    instances.get(id).destroy();
    instances.delete(id);
  }
});
