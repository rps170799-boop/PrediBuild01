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

console.log('✅ Escena configurada');

// ========================================
// FRAGMENTS (usar FragmentsModels directamente)
// ========================================

const githubUrl = 'https://thatopen.github.io/engine_fragment/resources/worker.mjs';
const fetchedUrl = await fetch(githubUrl);
const workerBlob = await fetchedUrl.blob();
const workerFile = new File([workerBlob], 'worker.mjs', {
  type: 'text/javascript'
});
const workerUrl = URL.createObjectURL(workerFile);

// USAR FragmentsModels en lugar de FragmentsManager
const fragments = new FRAGS.FragmentsModels(workerUrl);

world.camera.controls.addEventListener('control', () => fragments.update());

// Evitar z-fighting
fragments.models.materials.list.onItemSet.add(({ value: material }) => {
  if (!('isLodMaterial' in material && material.isLodMaterial)) {
    material.polygonOffset = true;
    material.polygonOffsetUnits = 1;
    material.polygonOffsetFactor = Math.random();
  }
});

console.log('✅ Fragments configurado');

// ========================================
// IFC LOADER
// ========================================

const ifcLoader = components.get(OBC.IfcLoader);

await ifcLoader.setup({
  autoSetWasm: false,
  wasm: {
    path: 'https://unpkg.com/web-ifc@0.0.68/',
    absolute: true
  }
});

console.log('✅ IfcLoader configurado');

// ========================================
// CARGAR IFC
// ========================================

async function loadIfc(fileUrl, isUrl = false) {
  try {
    let buffer;
    
    if (isUrl) {
      const response = await fetch(fileUrl);
      const arrayBuffer = await response.arrayBuffer();
      buffer = new Uint8Array(arrayBuffer);
    } else {
      const arrayBuffer = await fileUrl.arrayBuffer();
      buffer = new Uint8Array(arrayBuffer);
    }
    
    console.log('🔄 Procesando IFC...');
    
    const serializer = new FRAGS.IfcImporter();
    serializer.wasm = {
      absolute: true,
      path: 'https://unpkg.com/web-ifc@0.0.68/'
    };
    
    const bytes = await serializer.process({ bytes: buffer, raw: true });
    
    console.log('🔄 Cargando en escena...');
    
    const model = await fragments.load(bytes, {
      modelId: performance.now().toString(),
      camera: world.camera.three,
      raw: true
    });
    
    world.scene.three.add(model.object);
    await fragments.update(true);
    
    console.log('✅ IFC cargado exitosamente');
    
 


    // Ajustar cámara
    setTimeout(() => {
      world.camera.fit([model.object]);
    }, 100);
    
  } catch (error) {
    console.error('❌ Error:', error);
    alert('Error al cargar IFC: ' + error.message);
  }
}



// ========================================
// UI
// ========================================

const fileInput = document.getElementById('file-input');

fileInput.addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (file && file.name.endsWith('.ifc')) {
    loadIfc(file, false);
  }
});

document.getElementById('reset-camera').addEventListener('click', () => {
  world.camera.controls.setLookAt(78, 20, -2.2, 26, -4, 25);
});

document.getElementById('fit-model').addEventListener('click', () => {
  const models = Array.from(fragments.list.values());
  if (models.length > 0) {
    world.camera.fit(models.map(m => m.object));
  }
});

// ========================================
// BOTÓN DE PRUEBA
// ========================================

const testBtn = document.createElement('button');
testBtn.textContent = '🧪 Cargar IFC prueba';
testBtn.style.cssText = `
  position: fixed;
  bottom: 20px;
  right: 20px;
  padding: 12px 24px;
  background: #5297ff;
  color: white;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  z-index: 1000;
`;

testBtn.onclick = () => {
  loadIfc('https://thatopen.github.io/engine_fragment/resources/ifc/just_wall.ifc', true);
};

document.body.appendChild(testBtn);

// ========================================
// RESIZE
// ========================================

window.addEventListener('resize', () => {
  world.renderer?.resize();
  world.camera?.updateAspect();
});

console.log('🎉 Listo!');