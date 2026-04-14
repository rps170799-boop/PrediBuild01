// ========================================
// IMPORTACIONES
// ========================================
import { loadNavbar } from '/src/components/navbar/navbar.js';
import { loadFooter } from '/src/components/footer/footer.js';
import * as OBC from '@thatopen/components';
import * as FRAGS from '@thatopen/fragments';
import * as THREE from 'three';

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
console.log('🎉 Listo');