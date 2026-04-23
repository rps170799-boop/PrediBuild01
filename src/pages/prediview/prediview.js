// ========================================
// IMPORTACIONES
// ========================================
import { loadNavbar } from '/src/components/navbar/navbar.js';
import { loadFooter } from '/src/components/footer/footer.js';
import * as OBC from '@thatopen/components';
import * as FRAGS from '@thatopen/fragments';
import * as THREE from 'three';
import { CoordinationService } from './coordination-service.js';

loadNavbar();
loadFooter();

// ========================================
// SETUP BÁSICO
// ========================================

const container = document.getElementById('ifc-viewer');
const components = new OBC.Components();
const worlds = components.get(OBC.Worlds);

const world = worlds.create(
  OBC.SimpleScene,
  OBC.OrthoPerspectiveCamera,
  OBC.SimpleRenderer
);

world.scene = new OBC.SimpleScene(components);
world.scene.setup();
world.scene.three.background = null;

// ---- Lighting ----
// OBC SimpleScene.setup() adds a basic ambient; supplement with directional
// lights for depth and shading on lit materials (MeshLambertMaterial, etc.)
const _hemiLight = new THREE.HemisphereLight(0xffffff, 0x8bacd4, 0.6);
world.scene.three.add(_hemiLight);

const _sunLight = new THREE.DirectionalLight(0xffffff, 1.4);
_sunLight.position.set(60, 100, 40);
world.scene.three.add(_sunLight);

const _fillLight = new THREE.DirectionalLight(0xd0e8ff, 0.5);
_fillLight.position.set(-40, 20, -60);
world.scene.three.add(_fillLight);

container.innerHTML = '';
world.renderer = new OBC.SimpleRenderer(components, container);
world.camera = new OBC.OrthoPerspectiveCamera(components);
await world.camera.controls.setLookAt(78, 20, -2.2, 26, -4, 25);

components.init();

const grid = components.get(OBC.Grids).create(world);

// ========================================
// FRAGMENTS
// ========================================

const githubUrl = 'https://thatopen.github.io/engine_fragment/resources/worker.mjs';
const fetchedUrl = await fetch(githubUrl);
const workerBlob = await fetchedUrl.blob();
const workerFile = new File([workerBlob], 'worker.mjs', { type: 'text/javascript' });
const workerUrl = URL.createObjectURL(workerFile);

const fragments = components.get(OBC.FragmentsManager);
fragments.init(workerUrl);

world.camera.controls.addEventListener('update', () => fragments.core.update());

world.onCameraChanged.add((camera) => {
  for (const [, model] of fragments.list) model.useCamera(camera.three);
  fragments.core.update(true);
});

fragments.list.onItemSet.add(({ value: model }) => {
  model.useCamera(world.camera.three);
  world.scene.three.add(model.object);
  fragments.core.update(true);
});

fragments.core.models.materials.list.onItemSet.add(({ value: material }) => {
  if (!('isLodMaterial' in material && material.isLodMaterial)) {
    material.polygonOffset = true;
    material.polygonOffsetUnits = 1;
    material.polygonOffsetFactor = Math.random();
  }
});

// ========================================
// IFC LOADER
// ========================================

const ifcLoader = components.get(OBC.IfcLoader);
await ifcLoader.setup({
  autoSetWasm: false,
  wasm: { path: 'https://unpkg.com/web-ifc@0.0.77/', absolute: true }
});

// ========================================
// COORDINATION SERVICE
// ========================================

const coordinator = new CoordinationService(components, fragments);

coordinator.onProgress(({ phase, done, total }) => {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  updateClashStatus(`⏳ ${phase === 'broad' ? 'Fase AABB' : 'Fase geometría'}: ${pct}%`);
});

// OBC.Hider — per-element show/hide for isolation mode
const hider = components.get(OBC.Hider);

// ========================================
// RAYCASTER
// ========================================

const casters = components.get(OBC.Raycasters);
const caster = casters.get(world);

// ========================================
// CLIPPER
// ========================================

const clipper = components.get(OBC.Clipper);
clipper.enabled = false;

window.addEventListener('keydown', (event) => {
  if (event.code === 'Escape') {
    // Cancelar preview de sección
    if (sectionState === 'previewing') cancelSectionPreview();
  }
  if (event.code === 'Delete' || event.code === 'Backspace') {
    if (clipper.enabled) { clipper.delete(world); updateSectionCount(); }
  }
});

// ========================================
// FACE DISC PREVIEW
// Disco semi-transparente que muestra solo la cara
// bajo el cursor, no el elemento completo
// ========================================

const discGeom = new THREE.CircleGeometry(0.8, 32);
const discMat = new THREE.MeshBasicMaterial({
  color: 0x5192c2,
  transparent: true,
  opacity: 0.35,
  side: THREE.DoubleSide,
  depthTest: false,
});
const faceDisc = new THREE.Mesh(discGeom, discMat);
faceDisc.visible = false;
faceDisc.renderOrder = 999;
world.scene.three.add(faceDisc);

// Preview plane para sección (más grande, con borde)
const previewGeom = new THREE.PlaneGeometry(6, 6);
const previewMat = new THREE.MeshBasicMaterial({
  color: 0xf59e0b,
  transparent: true,
  opacity: 0.2,
  side: THREE.DoubleSide,
  depthTest: false,
});
const previewPlane = new THREE.Mesh(previewGeom, previewMat);
previewPlane.visible = false;
previewPlane.renderOrder = 998;
world.scene.three.add(previewPlane);

// Marcador de punto para coordenadas (esfera)
const markerGeom = new THREE.SphereGeometry(0.12, 16, 16);
const markerMat = new THREE.MeshBasicMaterial({ color: 0xef4444, depthTest: false });
const coordMarker = new THREE.Mesh(markerGeom, markerMat);
coordMarker.visible = false;
coordMarker.renderOrder = 999;
world.scene.three.add(coordMarker);

/**
 * Posiciona el disco en un punto con una normal dada
 */
function positionDisc(mesh, point, normal) {
  mesh.position.copy(point);
  // Offset ligeramente para evitar z-fighting
  mesh.position.addScaledVector(normal, 0.02);
  // Orientar el disco para que mire en la dirección de la normal
  const target = point.clone().add(normal);
  mesh.lookAt(target);
}

function hideDisc() {
  faceDisc.visible = false;
}

function hidePreviewPlane() {
  previewPlane.visible = false;
}

// ========================================
// SECTION — ESTADO DE DOS CLICKS
// 'idle' → click → 'previewing' → click → crea sección → 'idle'
// ESC → cancela preview → 'idle'
// ========================================

let sectionState = 'idle'; // 'idle' | 'previewing'
let pendingSectionNormal = null;
let pendingSectionPoint = null;

function cancelSectionPreview() {
  sectionState = 'idle';
  pendingSectionNormal = null;
  pendingSectionPoint = null;
  hidePreviewPlane();
  document.getElementById('section-status').textContent = 'Click en una cara para previsualizar';
}

function updateSectionStatus(text) {
  const el = document.getElementById('section-status');
  if (el) el.textContent = text;
}

// ========================================
// TOOLBAR — HERRAMIENTA ACTIVA
// ========================================

let activeTool = 'select';

const toolBtns = {
  select: document.getElementById('tool-select'),
  section: document.getElementById('tool-section'),
  coords: document.getElementById('tool-coords'),
};

const sectionSubBtns = {
  face: document.getElementById('section-face'),
  x: document.getElementById('section-x'),
  y: document.getElementById('section-y'),
  z: document.getElementById('section-z'),
};

const sectionSubmenu = document.getElementById('section-submenu');
const sectionCountEl = document.getElementById('section-count');
const coordsPopup = document.getElementById('coords-popup');

function setActiveTool(tool) {
  activeTool = tool;
  const isSection = tool.startsWith('section');

  toolBtns.select?.classList.toggle('active', tool === 'select');
  toolBtns.section?.classList.toggle('active', isSection);
  toolBtns.coords?.classList.toggle('active', tool === 'coords');

  if (sectionSubmenu) sectionSubmenu.classList.toggle('visible', isSection);

  if (isSection) {
    const subMode = tool.replace('section-', '');
    Object.entries(sectionSubBtns).forEach(([key, btn]) => {
      btn?.classList.toggle('active', key === subMode);
    });
  }

  clipper.enabled = isSection;
  container.style.cursor = tool === 'select' ? 'default' : 'crosshair';

  // Limpiar estados al cambiar herramienta
  if (!isSection) {
    cancelSectionPreview();
    hideDisc();
  }
  if (tool !== 'coords') {
    coordsPopup.classList.remove('visible');
    coordMarker.visible = false;
  }
}

// Listeners principales
toolBtns.select?.addEventListener('click', () => setActiveTool('select'));
toolBtns.section?.addEventListener('click', () => {
  if (activeTool.startsWith('section')) setActiveTool('select');
  else setActiveTool('section-face');
});
toolBtns.coords?.addEventListener('click', () => setActiveTool('coords'));

sectionSubBtns.face?.addEventListener('click', () => { cancelSectionPreview(); setActiveTool('section-face'); });
sectionSubBtns.x?.addEventListener('click', () => { cancelSectionPreview(); setActiveTool('section-x'); });
sectionSubBtns.y?.addEventListener('click', () => { cancelSectionPreview(); setActiveTool('section-y'); });
sectionSubBtns.z?.addEventListener('click', () => { cancelSectionPreview(); setActiveTool('section-z'); });

document.getElementById('tool-delete-sections')?.addEventListener('click', () => {
  clipper.deleteAll();
  updateSectionCount();
  cancelSectionPreview();
});

function updateSectionCount() {
  const count = clipper.list.size;
  if (sectionCountEl) sectionCountEl.textContent = count > 0 ? count : '';
}

// ========================================
// HOVER — muestra disco de cara o marcador de coords
// ========================================

container.addEventListener('mousemove', async () => {
  if (activeTool === 'select') return;

  const result = await caster.castRay();

  // SECCIÓN — mostrar disco en la cara
  if (activeTool.startsWith('section') && sectionState === 'idle') {
    if (!result || !result.point) {
      hideDisc();
      return;
    }

    let normal;
    if (activeTool === 'section-face') {
      normal = result.normal || new THREE.Vector3(0, 1, 0);
    } else {
      const normals = {
        'section-x': new THREE.Vector3(1, 0, 0),
        'section-y': new THREE.Vector3(0, 1, 0),
        'section-z': new THREE.Vector3(0, 0, 1),
      };
      normal = normals[activeTool];
    }

    positionDisc(faceDisc, result.point, normal);
    faceDisc.visible = true;
  }

  // COORDENADAS — mostrar marcador en punto/vértice
  if (activeTool === 'coords') {
    if (!result || !result.point) {
      coordMarker.visible = false;
      return;
    }

    // Intentar snap a vértice más cercano
    const snapPoint = snapToVertex(result);
    coordMarker.position.copy(snapPoint);
    coordMarker.visible = true;
  }
});

container.addEventListener('mouseleave', () => {
  hideDisc();
  coordMarker.visible = false;
});

/**
 * Intenta hacer snap al vértice más cercano del face intersectado.
 * Si no puede, devuelve el punto de intersección original.
 */
function snapToVertex(result) {
  const point = result.point.clone();

  try {
    // Three.js intersection tiene face con a, b, c (índices de vértices)
    const face = result.face;
    const object = result.object;
    if (!face || !object?.geometry) return point;

    const posAttr = object.geometry.getAttribute('position');
    if (!posAttr) return point;

    // Obtener posiciones de los 3 vértices del triángulo
    const vertices = [
      new THREE.Vector3().fromBufferAttribute(posAttr, face.a),
      new THREE.Vector3().fromBufferAttribute(posAttr, face.b),
      new THREE.Vector3().fromBufferAttribute(posAttr, face.c),
    ];

    // Si el objeto tiene matrixWorld, transformar los vértices a world space
    if (object.matrixWorld) {
      vertices.forEach(v => v.applyMatrix4(object.matrixWorld));
    }

    // Encontrar el vértice más cercano al punto de intersección
    let closest = vertices[0];
    let minDist = point.distanceTo(vertices[0]);

    for (let i = 1; i < vertices.length; i++) {
      const dist = point.distanceTo(vertices[i]);
      if (dist < minDist) {
        minDist = dist;
        closest = vertices[i];
      }
    }

    // Solo snap si el vértice está razonablemente cerca (< 1.5 unidades)
    if (minDist < 1.5) return closest;
    return point;

  } catch (e) {
    return point;
  }
}

// ========================================
// SELECCIÓN (tool: select)
// ========================================

const highlightColor = new THREE.Color('#7c3aed'); // Morado-azul
let selectedModelIdMap = {};

const propsPopup = document.getElementById('props-popup');
const propsContent = document.getElementById('props-content');

function displayProperties(attributes) {
  if (!attributes) { propsPopup.classList.remove('visible'); return; }
  let html = '';
  for (const [key, val] of Object.entries(attributes)) {
    if (val && typeof val === 'object' && 'value' in val) {
      const dv = val.value ?? '-';
      if (dv === '' || dv === undefined) continue;
      html += `<div class="prop-row"><span class="prop-key">${key}</span><span class="prop-value">${dv}</span></div>`;
    }
  }
  if (!html) html = '<p class="prop-empty-text">Sin propiedades disponibles</p>';
  propsContent.innerHTML = html;
  propsPopup.classList.add('visible');
}

async function clearSelection() {
  selectedModelIdMap = {};
  propsPopup.classList.remove('visible');
  await fragments.resetHighlight();
  await fragments.core.update(true);
}

document.getElementById('props-close')?.addEventListener('click', () => propsPopup.classList.remove('visible'));
document.getElementById('props-clear')?.addEventListener('click', () => clearSelection());

// ========================================
// COORDENADAS (tool: coords)
// ========================================

const coordsContent = document.getElementById('coords-content');
document.getElementById('coords-close')?.addEventListener('click', () => {
  coordsPopup.classList.remove('visible');
  coordMarker.visible = false;
});

/**
 * Muestra coordenadas en convención IFC:
 * IFC X = Three.js X
 * IFC Y = Three.js -Z (o Z dependiendo de la convención del modelo)
 * IFC Z = Three.js Y (elevación)
 * 
 * Nota: Mostramos Three.js coords tal cual con etiquetas
 * El usuario puede verificar contra su modelo
 */
function showCoordinates(point) {
  // Mostrar en convención IFC (Z-up):
  // IFC X = Three X, IFC Y = Three Z, IFC Z = Three Y
  const ifcX = point.x.toFixed(3);
  const ifcY = point.z.toFixed(3);
  const ifcZ = point.y.toFixed(3);

  coordsContent.innerHTML = `
    <div class="coord-row"><span class="coord-axis coord-x">X</span><span class="coord-val">${ifcX}</span></div>
    <div class="coord-row"><span class="coord-axis coord-y">Y</span><span class="coord-val">${ifcY}</span></div>
    <div class="coord-row"><span class="coord-axis coord-z">Z</span><span class="coord-val">${ifcZ}</span></div>
    <div class="coord-hint">Convención IFC (Z = elevación)</div>
  `;
  coordsPopup.classList.add('visible');
}

// ========================================
// CLICK PRINCIPAL
// ========================================

container.addEventListener('click', async (event) => {

  // ---- SELECT ----
  if (activeTool === 'select') {
    const result = await caster.castRay();
    if (!result) { await clearSelection(); return; }

    const modelId = result.fragments.modelId;
    const localId = result.localId;
    const isCtrl = event.ctrlKey || event.metaKey;

    if (!isCtrl) {
      await fragments.resetHighlight();
      selectedModelIdMap = {};
    }
    if (!selectedModelIdMap[modelId]) selectedModelIdMap[modelId] = new Set();
    selectedModelIdMap[modelId].add(localId);

    const model = fragments.list.get(modelId);
    if (model) {
      try {
        const [data] = await model.getItemsData([localId]);
        displayProperties(data);
      } catch (err) { console.warn('⚠️', err); }
    }

    await fragments.highlight(
      { color: highlightColor, renderedFaces: FRAGS.RenderedFaces.ONE, opacity: 1, transparent: false },
      selectedModelIdMap,
    );
    await fragments.core.update(true);
  }

  // ---- SECTION (two-click) ----
  if (activeTool.startsWith('section')) {
    const result = await caster.castRay();
    if (!result || !result.point) return;

    let normal;
    if (activeTool === 'section-face') {
      normal = result.normal || new THREE.Vector3(0, 1, 0);
    } else {
      const normals = {
        'section-x': new THREE.Vector3(1, 0, 0),
        'section-y': new THREE.Vector3(0, 1, 0),
        'section-z': new THREE.Vector3(0, 0, 1),
      };
      normal = normals[activeTool];
    }

    if (sectionState === 'idle') {
      // Primer click → mostrar preview
      sectionState = 'previewing';
      pendingSectionNormal = normal.clone();
      pendingSectionPoint = result.point.clone();

      positionDisc(previewPlane, result.point, normal);
      previewPlane.visible = true;
      hideDisc();

      updateSectionStatus('Click para confirmar · ESC para cancelar');

    } else if (sectionState === 'previewing') {
      // ¿El segundo click está en la misma zona que el preview?
      const dist = result.point.distanceTo(pendingSectionPoint);

      if (dist < 2.0) {
        // Confirmar — crear sección real en el punto del preview
        if (activeTool === 'section-face') {
          clipper.createFromNormalAndCoplanarPoint(world, pendingSectionNormal.clone().negate(), pendingSectionPoint);
        } else {
          clipper.createFromNormalAndCoplanarPoint(world, pendingSectionNormal.clone().negate(), pendingSectionPoint);
        }
        updateSectionCount();

        sectionState = 'idle';
        pendingSectionNormal = null;
        pendingSectionPoint = null;
        hidePreviewPlane();
        updateSectionStatus('Click en una cara para previsualizar');

      } else {
        // Click en otra cara → mover el preview ahí
        pendingSectionNormal = normal.clone();
        pendingSectionPoint = result.point.clone();
        positionDisc(previewPlane, result.point, normal);
        previewPlane.visible = true;
      }
    }
  }

  // ---- COORDS ----
  if (activeTool === 'coords') {
    const result = await caster.castRay();
    if (result && result.point) {
      const snapPoint = snapToVertex(result);
      coordMarker.position.copy(snapPoint);
      coordMarker.visible = true;
      showCoordinates(snapPoint);
    }
  }
});

// ========================================
// GESTIÓN DE MODELOS
// ========================================

const loadedModels = {};
const modelListEl = document.getElementById('model-list');
const modelCountEl = document.getElementById('model-count');

function updateModelList() {
  const ids = Object.keys(loadedModels);
  modelCountEl.textContent = ids.length;
  if (ids.length === 0) { modelListEl.innerHTML = '<p class="models-empty">Sin modelos cargados</p>'; return; }
  let html = '';
  for (const id of ids) {
    const info = loadedModels[id];
    html += `<div class="model-item"><label class="model-toggle"><input type="checkbox" ${info.visible ? 'checked' : ''} data-model-id="${id}"><span class="toggle-check"></span><span class="model-name" title="${info.name}">${info.name}</span></label><span class="model-size">${info.size}</span></div>`;
  }
  modelListEl.innerHTML = html;
  modelListEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const mId = e.target.dataset.modelId;
      const model = fragments.list.get(mId);
      if (!model) return;
      model.object.visible = e.target.checked;
      loadedModels[mId].visible = e.target.checked;
      fragments.core.update(true);
    });
  });
}

// ========================================
// CARGAR IFC
// ========================================

async function loadIfc(fileInput, isUrl = false) {
  try {
    let buffer, fileName = 'Modelo', fileSize = '-';
    if (isUrl) {
      const resp = await fetch(fileInput);
      const ab = await resp.arrayBuffer();
      buffer = new Uint8Array(ab);
      fileName = fileInput.split('/').pop().replace('.ifc', '');
      fileSize = (ab.byteLength / (1024 * 1024)).toFixed(2) + ' MB';
    } else {
      const ab = await fileInput.arrayBuffer();
      buffer = new Uint8Array(ab);
      fileName = fileInput.name.replace('.ifc', '');
      fileSize = (fileInput.size / (1024 * 1024)).toFixed(2) + ' MB';
    }
    const modelId = fileName + '-' + Date.now();
    await ifcLoader.load(buffer, true, modelId, {
      processData: { progressCallback: (p) => console.log('📊', p) },
    });
    loadedModels[modelId] = { name: fileName, visible: true, size: fileSize };
    updateModelList();
    updateClashSelectors();
    coordinator.indexStoreys(modelId).catch(err => console.warn('[Clash] Storey index:', err));
    const model = fragments.list.get(modelId);
    if (model) setTimeout(() => world.camera.fit([model.object]), 100);
  } catch (error) {
    console.error('❌', error);
    alert('Error al cargar IFC: ' + error.message);
  }
}

// ========================================
// UI EVENTS
// ========================================

document.getElementById('file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file && file.name.endsWith('.ifc')) loadIfc(file, false);
  e.target.value = '';
});
document.getElementById('reset-camera').addEventListener('click', () => {
  world.camera.controls.setLookAt(78, 20, -2.2, 26, -4, 25);
});
document.getElementById('fit-model').addEventListener('click', () => {
  const models = Array.from(fragments.list.values());
  if (models.length > 0) world.camera.fit(models.map(m => m.object));
});

window.addEventListener('resize', () => {
  world.renderer?.resize();
  world.camera?.updateAspect();
});

updateModelList();
setActiveTool('select');

// ========================================
// CLASH DETECTIVE
// ========================================

const clashPanel     = document.getElementById('clash-panel');
const clashModelAEl  = document.getElementById('clash-model-a');
const clashModelBEl  = document.getElementById('clash-model-b');
const clashStatusEl  = document.getElementById('clash-status');
const clashResultsEl = document.getElementById('clash-results');
const clashSummaryEl = document.getElementById('clash-summary');
const clashTbodyEl   = document.getElementById('clash-tbody');

/** Stored array of all clash results for the current run */
let _lastClashes = [];

function updateClashStatus(text) {
  if (clashStatusEl) clashStatusEl.textContent = text;
}

/** Populate both <select> dropdowns from loadedModels */
function updateClashSelectors() {
  const ids = Object.keys(loadedModels);
  [clashModelAEl, clashModelBEl].forEach((sel, idx) => {
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="">— Selecciona modelo —</option>';
    ids.forEach((id) => {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = loadedModels[id].name;
      if (id === prev) opt.selected = true;
      sel.appendChild(opt);
    });
    // Auto-select first/second model for convenience
    if (!prev && ids.length > idx) sel.value = ids[idx];
  });
}

/** Separate highlight colors for each clash element */
const clashColorA = new THREE.Color('#ef4444'); // Red   — Structural element
const clashColorB = new THREE.Color('#22c55e'); // Green — MEP element

// Shared style objects (created once, reused each click)
const _clashStyleA = { color: clashColorA, renderedFaces: FRAGS.RenderedFaces.ONE, opacity: 1, transparent: false };
const _clashStyleB = { color: clashColorB, renderedFaces: FRAGS.RenderedFaces.ONE, opacity: 1, transparent: false };

/**
 * Ghost Mode + Clash Highlight  (four-step sequence that avoids the
 * preserveOriginalMaterial conflict between setOpacity and fragments.highlight)
 *
 * Step 1 — clean slate: resetHighlight clears ALL per-item state.
 * Step 2 — ghost everything: setOpacity(undefined, 0.06) paints every item
 *           transparent in the opacity sub-channel. Works reliably with
 *           undefined (= all items, no ID lookup needed).
 * Step 3 — un-ghost clash items: resetOpacity([id]) strips the opacity/
 *           transparent props and the preserveOriginalMaterial flag from
 *           those two items. Without this step, the next highlight call is
 *           silently ignored because preserveOriginalMaterial is still set.
 * Step 4 — apply solid color: fragments.highlight writes fresh color+opacity
 *           on a now-clean per-item state for just the two clash elements.
 */
async function highlightClashPair(clash) {
  // Step 1 — clean slate
  await fragments.resetHighlight();

  // Step 2 — ghost all items in every model
  for (const [, model] of fragments.list) {
    if (typeof model.setOpacity === 'function') {
      await model.setOpacity(undefined, 0.06);
    }
  }

  // Step 3 — un-ghost the two clash items so their per-item state is clean
  const modelA = fragments.list.get(clash.aModelId);
  const modelB = fragments.list.get(clash.bModelId);
  if (modelA && typeof modelA.resetOpacity === 'function') {
    await modelA.resetOpacity([clash.aLocalId]);
  }
  if (modelB && typeof modelB.resetOpacity === 'function') {
    await modelB.resetOpacity([clash.bLocalId]);
  }

  // Step 4 — apply solid red / green highlight (clean state, no merge conflict)
  await fragments.highlight(_clashStyleA, { [clash.aModelId]: new Set([clash.aLocalId]) });
  await fragments.highlight(_clashStyleB, { [clash.bModelId]: new Set([clash.bLocalId]) });

  await fragments.core.update(true);
}

/**
 * Applies Ghost Mode visualization + zooms camera to the clash point.
 *  • All models stay visible (no .visible=false).
 *  • Non-clash geometry is ghosted at 6% opacity.
 *  • Clash elements are shown solid red/green.
 *  • Camera frames the precise bounding box of the two elements.
 */
async function isolateClashPair(clash) {
  // Ensure all models are visible (ghost mode, not hidden)
  for (const [id, model] of fragments.list) {
    model.object.visible = loadedModels[id]?.visible ?? true;
  }

  // 1. Apply ghost + clash highlights
  await highlightClashPair(clash);

  // 2. Precise zoom to the two clash elements
  await zoomToClashPair(clash);

  // 3. Show reset bar
  const resetBar = document.getElementById('clash-reset-bar');
  if (resetBar) resetBar.style.display = 'flex';
}

/**
 * Restores the full solid view: clears ALL highlight overrides
 * (including ghost opacities set by setOpacity) and resets the camera.
 */
async function resetClashIsolation() {
  // resetHighlight with no args clears colour + opacity overrides on all models
  await fragments.resetHighlight();
  await fragments.core.update(true);

  world.camera.controls.setLookAt(78, 20, -2.2, 26, -4, 25, true);

  const resetBar = document.getElementById('clash-reset-bar');
  if (resetBar) resetBar.style.display = 'none';

  clashTbodyEl?.querySelectorAll('tr.selected').forEach(r => r.classList.remove('selected'));
}

document.getElementById('clash-reset-btn')?.addEventListener('click', () => {
  resetClashIsolation().catch(console.warn);
});

/**
 * Zooms the camera to frame both clashing elements precisely.
 *
 * Uses fragments.getBBoxes() — the official OBC v3 API that asks the
 * Fragments worker for per-element geometry boxes in world space.
 * This is accurate even after applyBaseCoordinateSystem repositions a model.
 * Falls back to coordinator._bboxCache if the worker call fails.
 */
async function zoomToClashPair(clash) {
  const isFiniteVec = (v) => isFinite(v.x) && isFinite(v.y) && isFinite(v.z);
  const merged = new THREE.Box3();

  // --- Primary: fragments.getBBoxes({ modelId: Set<localId> }) ---
  const clashItemsMap = {
    [clash.aModelId]: new Set([clash.aLocalId]),
    [clash.bModelId]: new Set([clash.bLocalId]),
  };

  let usedApi = false;
  try {
    const boxes = await fragments.getBBoxes(clashItemsMap); // returns THREE.Box3[]
    if (boxes && boxes.length > 0) {
      for (const b of boxes) {
        if (b && !b.isEmpty() && isFiniteVec(b.min) && isFiniteVec(b.max)) {
          merged.union(b);
          usedApi = true;
        }
      }
    }
  } catch (err) {
    console.warn('[zoomToClashPair] getBBoxes failed, using cache fallback', err.message);
  }

  // --- Fallback: cached AABBs from extractElementData ---
  if (!usedApi || merged.isEmpty()) {
    console.debug('[zoomToClashPair] falling back to coordinator bbox cache',
      clash.aLocalId, clash.bLocalId);
    for (const [modelId, localId] of [
      [clash.aModelId, clash.aLocalId],
      [clash.bModelId, clash.bLocalId],
    ]) {
      const c = coordinator.getElementBbox(modelId, localId);
      if (c) {
        merged.union(new THREE.Box3(
          new THREE.Vector3(c.minX, c.minY, c.minZ),
          new THREE.Vector3(c.maxX, c.maxY, c.maxZ),
        ));
      }
    }
  }

  merged.expandByScalar(1.5); // tight padding around the clash point

  if (merged.isEmpty() || !isFiniteVec(merged.min) || !isFiniteVec(merged.max)) {
    console.error('[zoomToClashPair] No valid box — skipping zoom.',
      'ExpressIDs:', clash.aLocalId, clash.bLocalId,
      'min:', merged.min, 'max:', merged.max);
    return;
  }
  console.debug('[zoomToClashPair] box min:', merged.min.toArray(), 'max:', merged.max.toArray());

  try {
    await world.camera.controls.fitToBox(merged, true);
  } catch (_) {
    const center = merged.getCenter(new THREE.Vector3());
    const size   = merged.getSize(new THREE.Vector3());
    const dist   = Math.max(size.x, size.y, size.z) * 1.8;
    world.camera.controls.setLookAt(
      center.x, center.y + dist, center.z + dist,
      center.x, center.y,        center.z,
      true,
    );
  }
}

/** Render the clash table rows (async — fetches element names per row) */
async function renderClashTable(clashes, modelAId, modelBId) {
  if (!clashTbodyEl) return;
  clashTbodyEl.innerHTML = '';

  const MAX_ROWS = 800;
  const visible  = clashes.slice(0, MAX_ROWS);

  for (let i = 0; i < visible.length; i++) {
    const clash = visible[i];

    // Storey: resolve for first 200 rows only to avoid blocking the UI;
    // beyond that show '-' immediately and let the index warm in background.
    const storey = i < 200
      ? await coordinator.getStoreyName(clash.aModelId, clash.aLocalId)
      : (coordinator.getStoreyName(clash.aModelId, clash.aLocalId)  // fire but don't await
          .then(name => {
            const cell = clashTbodyEl?.querySelector(`tr[data-clash-index="${i}"] td:nth-child(2)`);
            if (cell) cell.textContent = name;
          })
          .catch(() => {}), '-');

    // Try to resolve a human-readable name for each element
    let nameA = String(clash.aLocalId);
    let nameB = String(clash.bLocalId);
    try {
      const mA = fragments.list.get(clash.aModelId);
      const mB = fragments.list.get(clash.bModelId);
      if (mA) {
        const [dA] = await mA.getItemsData([clash.aLocalId]) ?? [null];
        nameA = dA?.ObjectType?.value ?? dA?.Name?.value ?? nameA;
      }
      if (mB) {
        const [dB] = await mB.getItemsData([clash.bLocalId]) ?? [null];
        nameB = dB?.ObjectType?.value ?? dB?.Name?.value ?? nameB;
      }
    } catch (_) { /* non-critical */ }

    const tr = document.createElement('tr');
    tr.dataset.clashIndex = i;
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${storey}</td>
      <td class="clash-cell-a" title="${clash.aLocalId}">${nameA}</td>
      <td class="clash-cell-b" title="${clash.bLocalId}">${nameB}</td>
    `;
    tr.addEventListener('click', () => {
      clashTbodyEl.querySelectorAll('tr.selected').forEach(r => r.classList.remove('selected'));
      tr.classList.add('selected');
      isolateClashPair(clash).catch(console.warn);
    });
    clashTbodyEl.appendChild(tr);
  }

  if (clashes.length > MAX_ROWS) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="4" class="clash-more">… ${clashes.length - MAX_ROWS} choques adicionales no mostrados</td>`;
    clashTbodyEl.appendChild(tr);
  }
}

/** Run clash detection */
document.getElementById('clash-run-btn')?.addEventListener('click', async () => {
  const aId = clashModelAEl?.value;
  const bId = clashModelBEl?.value;

  if (!aId || !bId) { updateClashStatus('⚠️ Selecciona ambos modelos'); return; }
  if (aId === bId)  { updateClashStatus('⚠️ Selecciona modelos distintos'); return; }

  updateClashStatus('⏳ Iniciando análisis…');
  if (clashResultsEl) clashResultsEl.style.display = 'none';

  try {
    // Read tolerance (soft-clash threshold in metres; 0 = report all AABB overlaps)
    const toleranceVal = parseFloat(document.getElementById('clash-tolerance')?.value ?? '0') || 0;
    const clashes = await coordinator.detectClashes(aId, bId, false, toleranceVal);
    _lastClashes = clashes;

    if (clashSummaryEl) {
      clashSummaryEl.innerHTML = clashes.length === 0
        ? '<span class="clash-ok">✓ Sin choques detectados</span>'
        : `<span class="clash-count">${clashes.length}</span> choque${clashes.length !== 1 ? 's' : ''} detectado${clashes.length !== 1 ? 's' : ''}`;
    }

    if (clashResultsEl) clashResultsEl.style.display = 'flex';
    updateClashStatus('');
    await renderClashTable(clashes, aId, bId);
  } catch (err) {
    console.error('[Clash]', err);
    updateClashStatus('❌ Error: ' + err.message);
  }
});

/** Align MEP to Structural */
document.getElementById('clash-align-btn')?.addEventListener('click', () => {
  const aId = clashModelAEl?.value;
  const bId = clashModelBEl?.value;
  if (!aId || !bId || aId === bId) { updateClashStatus('⚠️ Selecciona modelos distintos'); return; }
  coordinator.applyBaseCoordinateSystem(aId, bId);
  fragments.core.update(true);
  updateClashStatus('✓ Modelos alineados');
});

/** Toggle clash panel — docked right column */
const viewerContainer = document.querySelector('.viewer-container');
const toolClashBtn    = document.getElementById('tool-clash');

toolClashBtn?.addEventListener('click', () => {
  const isOpen = viewerContainer?.classList.toggle('viewer-has-clash');
  toolClashBtn.classList.toggle('active', isOpen);
  if (isOpen) updateClashSelectors();
});

document.getElementById('clash-close')?.addEventListener('click', () => {
  viewerContainer?.classList.remove('viewer-has-clash');
  toolClashBtn?.classList.remove('active');
});

console.log('🎉 Listo');