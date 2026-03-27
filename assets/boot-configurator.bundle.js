/**
 * 3D Boot Configurator v2 — Three.js WebGL + GLB Model
 *
 * Loads a real GLB model and applies real-time material/colour changes.
 * Self-contained ES module. Three.js loaded via importmap from CDN.
 *
 * Path A: Colour-only configurator (single GLB, material swaps)
 * Path B (future): Shape-swappable sub-meshes — see showMesh() stub
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ═══════════════════════════════════════════════════════════
// 1. CONSTANTS
// ═══════════════════════════════════════════════════════════

const PHASES = [
  { id: 'customise', label: 'Customise' },
  { id: 'personalise', label: 'Personalise' },
  // TODO Path B: re-add { id: 'build', label: 'Build' } as first phase
];

const COLOR_LERP_MS = 300;

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
    }

    return { denied, messages };
  }

  isValid(key, value, state) {
    const { denied } = this.evaluate(key, state);
    return !denied.has(value);
  }
}

// ═══════════════════════════════════════════════════════════
// 4. THREE.JS RENDERER — GLB Model Loader
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
  /** @type {number} */
  #rafId = 0;
  /** @type {boolean} */
  #needsRender = true;
  /** @type {ResizeObserver | null} */
  #resizeObserver = null;
  /** @type {Record<string, THREE.Mesh[]>} */
  #partMeshes = {};
  /** @type {THREE.Mesh[]} */
  #allMeshes = [];
  /** @type {THREE.Group | null} */
  #model = null;
  /** @type {Promise<void>} */
  ready;
  /** @type {string[]} */
  #debugLog = [];

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {HTMLElement} container
   * @param {string} modelUrl
   * @param {Record<string, string[]>} partMeshMap
   * @param {boolean} positionFallback
   * @param {(progress: number) => void} [onProgress]
   */
  constructor(canvas, container, modelUrl, partMeshMap, positionFallback, onProgress) {
    this.#initRenderer(canvas, container);
    this.#initScene();
    this.#initCamera(container);
    this.#initControls(canvas);
    this.#initLights();
    this.#startRenderLoop();
    this.#initResize(container);

    // Load GLB — expose as ready Promise
    this.ready = this.#loadGLB(modelUrl, partMeshMap, positionFallback, onProgress);
  }

  // ── Renderer setup ──

  #initRenderer(canvas, container) {
    this.#renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.#renderer.setSize(container.clientWidth, container.clientHeight);
    this.#renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.#renderer.toneMappingExposure = 1.3;
    this.#renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.#renderer.shadowMap.enabled = true;
    this.#renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  #initScene() {
    this.#scene = new THREE.Scene();
    // Transparent — CSS background shows through
    this.#scene.background = null;
  }

  #initCamera(container) {
    const aspect = container.clientWidth / container.clientHeight;
    this.#camera = new THREE.PerspectiveCamera(35, aspect, 0.01, 100);
    this.#camera.position.set(2.5, 1.2, 2.5);
    this.#camera.lookAt(0, 0.5, 0);
  }

  #initControls(canvas) {
    this.#controls = new OrbitControls(this.#camera, canvas);
    this.#controls.target.set(0, 0.5, 0);
    this.#controls.enablePan = false;
    this.#controls.enableDamping = true;
    this.#controls.dampingFactor = 0.06;
    this.#controls.minDistance = 1;
    this.#controls.maxDistance = 8;
    this.#controls.minPolarAngle = Math.PI * 0.15;
    this.#controls.maxPolarAngle = Math.PI * 0.6;
    this.#controls.autoRotate = true;
    this.#controls.autoRotateSpeed = 0.8;
    this.#controls.addEventListener('change', () => { this.#needsRender = true; });
    this.#controls.update();

    // Stop auto-rotate on interaction
    canvas.addEventListener('pointerdown', () => { this.#controls.autoRotate = false; });
  }

  #initLights() {
    // Ambient fill
    const ambient = new THREE.AmbientLight(0xfff5ee, 0.4);
    this.#scene.add(ambient);

    // Key light (main)
    const key = new THREE.DirectionalLight(0xffffff, 2.0);
    key.position.set(5, 8, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.radius = 4;
    this.#scene.add(key);

    // Fill light
    const fill = new THREE.DirectionalLight(0xe8dfd5, 0.8);
    fill.position.set(-4, 3, -2);
    this.#scene.add(fill);

    // Rim / back light
    const rim = new THREE.DirectionalLight(0xfff0e0, 0.6);
    rim.position.set(0, 4, -6);
    this.#scene.add(rim);

    // Bottom fill (for sole)
    const bottom = new THREE.DirectionalLight(0xe0d8d0, 0.3);
    bottom.position.set(0, -3, 2);
    this.#scene.add(bottom);

    // Hemisphere
    const hemi = new THREE.HemisphereLight(0xffeedd, 0x8d7b6c, 0.4);
    this.#scene.add(hemi);

    // Shadow-receiving ground plane
    const shadowGeo = new THREE.PlaneGeometry(10, 10);
    const shadowMat = new THREE.ShadowMaterial({ opacity: 0.15 });
    const shadowPlane = new THREE.Mesh(shadowGeo, shadowMat);
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = -0.01;
    shadowPlane.receiveShadow = true;
    this.#scene.add(shadowPlane);
  }

  // ── GLB Loading ──

  /**
   * Load a GLB model and categorize its meshes into boot parts.
   * @param {string} url
   * @param {Record<string, string[]>} partMeshMap
   * @param {boolean} positionFallback
   * @param {(progress: number) => void} [onProgress]
   */
  async #loadGLB(url, partMeshMap, positionFallback, onProgress) {
    const loader = new GLTFLoader();

    // Initialise partMeshes buckets
    for (const part of Object.keys(partMeshMap)) {
      this.#partMeshes[part] = [];
    }

    return new Promise((resolve, reject) => {
      loader.load(
        url,
        (gltf) => {
          const model = gltf.scene;

          // Center and scale the model
          const box = new THREE.Box3().setFromObject(model);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);
          const scale = 2.0 / maxDim;
          model.scale.setScalar(scale);
          model.position.sub(center.multiplyScalar(scale));
          model.position.y -= (box.min.y * scale);

          this.#scene.add(model);
          this.#model = model;

          // Traverse and categorize meshes
          this.#categorizeMeshes(model, partMeshMap, positionFallback);

          this.#needsRender = true;
          resolve();
        },
        (progress) => {
          if (progress.total && onProgress) {
            onProgress(progress.loaded / progress.total);
          }
        },
        (error) => {
          console.error('Boot configurator: GLB load failed', error);
          reject(error);
        }
      );
    });
  }

  /**
   * Walk the scene graph, assign each mesh to a boot part.
   */
  #categorizeMeshes(model, partMeshMap, positionFallback) {
    const unmatched = [];

    model.traverse((child) => {
      if (!child.isMesh) return;

      child.castShadow = true;
      child.receiveShadow = true;

      // Clone material so parts colour independently
      if (Array.isArray(child.material)) {
        child.material = child.material.map(m => {
          const clone = m.clone();
          // Strip texture maps so base colour is paintable
          this.#stripTextures(clone);
          return clone;
        });
      } else {
        child.material = child.material.clone();
        this.#stripTextures(child.material);
      }

      const meshName = (child.name || '').toLowerCase();
      const matName = (Array.isArray(child.material)
        ? child.material.map(m => m.name).join(' ')
        : child.material.name || ''
      ).toLowerCase();
      const combined = meshName + ' ' + matName;

      this.#debugLog.push(`  mesh: "${child.name}" | mat: "${matName}" | combined: "${combined}"`);

      // Try name matching
      let matched = false;
      for (const [part, keywords] of Object.entries(partMeshMap)) {
        for (const kw of keywords) {
          if (combined.includes(kw.toLowerCase())) {
            this.#partMeshes[part].push(child);
            matched = true;
            this.#debugLog.push(`    → MATCHED [${part}] via keyword "${kw}"`);
            break;
          }
        }
        if (matched) break;
      }

      if (!matched) {
        unmatched.push(child);
        this.#allMeshes.push(child);
        this.#debugLog.push(`    → UNMATCHED`);
      }
    });

    // Position-based fallback if no name matches found
    const anyMatched = Object.values(this.#partMeshes).some(arr => arr.length > 0);

    if (positionFallback && !anyMatched && unmatched.length > 0) {
      this.#debugLog.push('--- Position fallback triggered ---');

      // Compute model bounding box for normalization
      const modelBox = new THREE.Box3().setFromObject(model);
      const modelHeight = modelBox.max.y - modelBox.min.y;
      const modelMinY = modelBox.min.y;

      for (const mesh of unmatched) {
        const meshBox = new THREE.Box3().setFromObject(mesh);
        const worldCenter = meshBox.getCenter(new THREE.Vector3());
        const meshSize = new THREE.Vector3();
        meshBox.getSize(meshSize);
        const volume = meshSize.x * meshSize.y * meshSize.z;
        // Normalize Y to 0–1 range relative to model bounds
        const yNorm = modelHeight > 0 ? (worldCenter.y - modelMinY) / modelHeight : 0.5;

        if (yNorm < 0.15) {
          this.#partMeshes.sole.push(mesh);
          this.#debugLog.push(`[pos] "${mesh.name}" (yNorm:${yNorm.toFixed(2)}) → sole`);
        } else if (volume < 0.005 && yNorm > 0.75) {
          this.#partMeshes.tug.push(mesh);
          this.#debugLog.push(`[pos] "${mesh.name}" (yNorm:${yNorm.toFixed(2)}, vol:${volume.toFixed(5)}) → tug`);
        } else {
          this.#partMeshes.upper.push(mesh);
          this.#debugLog.push(`[pos] "${mesh.name}" (yNorm:${yNorm.toFixed(2)}) → upper`);
        }
      }
    }

    // Single-mesh fallback: if still nothing, assign all to upper
    const anyMapped = Object.values(this.#partMeshes).some(arr => arr.length > 0);
    if (!anyMapped && this.#allMeshes.length > 0) {
      this.#partMeshes.upper = [...this.#allMeshes];
      this.#debugLog.push('--- Single-mesh fallback: all → upper ---');
    }

    // Always log mesh discovery (critical for debugging GLB integration)
    console.group('%c Boot Configurator — Mesh Discovery', 'color: #8B4513; font-weight: bold');
    for (const line of this.#debugLog) console.log(line);
    console.log('Part summary:', Object.fromEntries(
      Object.entries(this.#partMeshes).map(([k, v]) => [k, v.length])
    ));
    console.log('Total meshes found:', this.#allMeshes.length + Object.values(this.#partMeshes).reduce((a, b) => a + b.length, 0));
    console.groupEnd();
  }

  /**
   * Strip texture maps from a material so base colour is directly paintable.
   * GLB models often have baked textures that override material.color.
   */
  #stripTextures(mat) {
    if (mat.map) { mat.map.dispose(); mat.map = null; }
    if (mat.normalMap) { mat.normalMap.dispose(); mat.normalMap = null; }
    if (mat.roughnessMap) { mat.roughnessMap.dispose(); mat.roughnessMap = null; }
    if (mat.metalnessMap) { mat.metalnessMap.dispose(); mat.metalnessMap = null; }
    if (mat.aoMap) { mat.aoMap.dispose(); mat.aoMap = null; }
    if (mat.emissiveMap) { mat.emissiveMap.dispose(); mat.emissiveMap = null; }
    // Reset to clean PBR defaults
    mat.color.set(0xffffff);
    mat.needsUpdate = true;
  }

  // ── Material / Colour ──

  /**
   * Set the colour of a boot part with smooth lerp transition.
   * @param {string} partName — e.g. 'upper', 'elastic', 'tug', 'sole'
   * @param {string} hexColor
   * @param {number} [roughness]
   * @param {number} [metalness]
   */
  setPartColor(partName, hexColor, roughness, metalness) {
    const meshes = this.#partMeshes[partName];
    if (!meshes || meshes.length === 0) {
      console.warn(`Boot configurator: no meshes for part "${partName}"`);
      return;
    }

    const targetColor = new THREE.Color(hexColor);

    for (const mesh of meshes) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        // Ensure no texture overrides the colour
        if (mat.map) { mat.map.dispose(); mat.map = null; }
        this.#lerpColor(mat.color, targetColor, COLOR_LERP_MS);
        if (roughness !== undefined) mat.roughness = roughness;
        if (metalness !== undefined) mat.metalness = metalness;
        mat.needsUpdate = true;
      }
    }

    this.#needsRender = true;
  }

  /**
   * Smooth colour transition.
   * @param {THREE.Color} current
   * @param {THREE.Color} target
   * @param {number} durationMs
   */
  #lerpColor(current, target, durationMs) {
    const start = current.clone();
    const startTime = performance.now();
    const tick = (now) => {
      const t = Math.min((now - startTime) / durationMs, 1);
      current.lerpColors(start, target, t);
      this.#needsRender = true;
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /**
   * TODO Path B: Show one mesh variant and hide others in the same group.
   * For GLB sub-mesh swapping (e.g. load toe_round.glb, hide toe_chisel.glb).
   * Currently a no-op — shape swapping requires multiple GLB sub-meshes.
   * @param {string} _group
   * @param {string} _meshName
   */
  showMesh(_group, _meshName) {
    // Path B implementation will go here.
    // Expected approach: load/cache GLB sub-meshes per group,
    // toggle visibility, and update the scene graph.
  }

  // ── Render loop ──

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

    this.#scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry?.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) m?.dispose();
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
      this.#renderCurrentStep();
    });
  }

  #renderPhases() {
    const container = this.#root.querySelector('.boot-configurator__phases');
    if (!container) return;

    const currentStep = this.#manifest.steps[this.#currentStepIndex];
    const currentPhase = currentStep?.phase || PHASES[0].id;

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
      // TODO Path B: shape selection chips
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

    if (step.type === 'swatches' && step.materialTarget) {
      const opt = step.options.find(o => o.id === value);
      if (opt?.color) {
        this.#renderer.setPartColor(step.materialTarget, opt.color, opt.roughness, opt.metalness);
      }
    } else if (step.type === 'chips') {
      // TODO Path B: call renderer.showMesh(key, opt.mesh)
      const opt = step.options.find(o => o.id === value);
      if (opt?.mesh) {
        this.#renderer.showMesh(key, opt.mesh);
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
      addBtn.textContent = 'Adding\u2026';

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

      addBtn.textContent = 'Added \u2713';
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

  destroy() {}
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

  async init() {
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

    // Get model URL from data attribute
    const modelUrl = this.#root.dataset.modelUrl;
    if (!modelUrl) {
      console.error('Boot configurator: no data-model-url attribute');
      return;
    }

    // UI elements
    const canvas = this.#root.querySelector('.boot-configurator__canvas');
    const viewer = this.#root.querySelector('.boot-configurator__viewer');
    const loader = this.#root.querySelector('.boot-configurator__loader');
    const loaderText = this.#root.querySelector('.boot-configurator__loader-text');
    const progressFill = this.#root.querySelector('.boot-configurator__progress-fill');
    if (!canvas || !viewer) { console.error('Boot configurator: no canvas/viewer'); return; }

    // Progress callback
    const onProgress = (pct) => {
      const percent = Math.round(pct * 100);
      if (loaderText) loaderText.textContent = `Loading 3D preview\u2026 ${percent}%`;
      if (progressFill) progressFill.style.width = `${percent}%`;
    };

    // Create renderer and load GLB
    this.#renderer = new BootRenderer(
      canvas, viewer, modelUrl,
      manifest.partMeshMap || {},
      manifest.positionFallback !== false,
      onProgress
    );

    try {
      await this.#renderer.ready;
    } catch {
      if (loaderText) loaderText.textContent = 'Failed to load 3D model.';
      return;
    }

    // Hide loader
    if (loader) loader.hidden = true;

    // Apply default colours to the model
    for (const step of manifest.steps) {
      const val = manifest.defaultConfig[step.id];
      if (!val || step.type !== 'swatches' || !step.materialTarget) continue;
      const opt = step.options.find(o => o.id === val);
      if (opt?.color) {
        this.#renderer.setPartColor(step.materialTarget, opt.color, opt.roughness, opt.metalness);
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
// 7. INIT
// ═══════════════════════════════════════════════════════════

/** @type {Map<string, BootConfiguratorApp>} */
const instances = new Map();

function initAll() {
  for (const root of document.querySelectorAll('.boot-configurator')) {
    const id = root.dataset.sectionId;
    if (!id) continue;

    if (instances.has(id)) {
      instances.get(id).destroy();
      instances.delete(id);
    }

    const app = new BootConfiguratorApp(root);
    app.init();
    instances.set(id, app);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAll);
} else {
  initAll();
}

// Theme editor lifecycle
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
