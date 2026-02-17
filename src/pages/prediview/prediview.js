// Importar componentes compartidos
import { loadNavbar } from '/src/components/navbar/navbar.js';
import { loadFooter } from '/src/components/footer/footer.js';

// Cargar navbar y footer
loadNavbar();
loadFooter();

// ========================================
// FUNCIONALIDAD DEL VISOR IFC
// ========================================

// Referencias a elementos DOM
const fileInput = document.getElementById('file-input');
const viewerCanvas = document.getElementById('ifc-viewer');
const resetCameraBtn = document.getElementById('reset-camera');
const fitModelBtn = document.getElementById('fit-model');
const elementCount = document.getElementById('element-count');
const fileSize = document.getElementById('file-size');

// Evento: Cargar archivo IFC
fileInput.addEventListener('change', (event) => {
  const file = event.target.files[0];
  
  if (file) {
    console.log('Archivo seleccionado:', file.name);
    loadIFCModel(file);
  }
});

// Función: Cargar modelo IFC
async function loadIFCModel(file) {
  try {
    // Actualizar info del archivo
    const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
    fileSize.textContent = `${sizeMB} MB`;
    
    // Ocultar placeholder
    const placeholder = viewerCanvas.querySelector('.viewer-placeholder');
    if (placeholder) {
      placeholder.style.display = 'none';
    }
    
    // AQUÍ IRÁN TUS LIBRERÍAS IFC
    // Por ahora mostramos un mensaje
    viewerCanvas.innerHTML = `
      <div style="text-align: center; padding: 50px;">
        <h3 style="color: var(--color-primario); margin-bottom: 15px;">
          📦 Archivo cargado: ${file.name}
        </h3>
        <p style="color: var(--color-texto-muted);">
          Tamaño: ${sizeMB} MB
        </p>
        <p style="color: var(--color-texto-muted); margin-top: 20px;">
          🚧 Aquí se renderizará el modelo 3D con Three.js + IFC.js
        </p>
      </div>
    `;
    
    // Simular conteo de elementos (después lo harás con IFC.js)
    elementCount.textContent = '1,234';
    
    console.log('✅ Modelo cargado exitosamente');
    
  } catch (error) {
    console.error('❌ Error cargando modelo:', error);
    alert('Error al cargar el modelo IFC');
  }
}

// Evento: Reset cámara
resetCameraBtn.addEventListener('click', () => {
  console.log('🔄 Reset cámara');
  // Aquí resetearás la cámara de Three.js
});

// Evento: Ajustar vista
fitModelBtn.addEventListener('click', () => {
  console.log('🎯 Ajustar vista al modelo');
  // Aquí ajustarás la cámara para ver todo el modelo
});

console.log('✅ prediView inicializado');