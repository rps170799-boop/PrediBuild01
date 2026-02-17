// Cargar footer HTML
export async function loadFooter() {
  const footerContainer = document.getElementById('footer-container');
  
  if (!footerContainer) {
    console.error('No se encontró el contenedor del footer');
    return;
  }
  
  try {
    const response = await fetch('/src/components/footer/footer.html');
    const html = await response.text();
    footerContainer.innerHTML = html;
    
    // Si necesitas funcionalidad específica del footer, agrégala aquí
    // Por ahora el footer es estático, no necesita JavaScript
    
  } catch (error) {
    console.error('Error cargando footer:', error);
  }
}