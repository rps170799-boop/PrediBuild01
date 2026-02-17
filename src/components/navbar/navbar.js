// Cargar navbar HTML y activar funcionalidad
export async function loadNavbar() {
  const navbarContainer = document.getElementById('navbar-container');
  
  if (!navbarContainer) {
    console.error('No se encontró el contenedor del navbar');
    return;
  }
  
  try {
    const response = await fetch('/src/components/navbar/navbar.html');
    const html = await response.text();
    navbarContainer.innerHTML = html;
    
    // Inicializar funcionalidad después de cargar el HTML
    initNavbarFunctionality();
  } catch (error) {
    console.error('Error cargando navbar:', error);
  }
}

// Funcionalidad del navbar (menú móvil y dropdowns)
function initNavbarFunctionality() {
  const menuToggle = document.querySelector('.menu-toggle');
  const navLinks = document.querySelector('.nav-links');
  const dropdowns = document.querySelectorAll('.dropdown');

  // Menú móvil
  if (menuToggle) {
    menuToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      navLinks.classList.toggle('active');
    });
  }

  // Dropdowns
  dropdowns.forEach(dropdown => {
    const toggle = dropdown.querySelector('.dropdown-toggle');
    const menu = dropdown.querySelector('.dropdown-menu');
    
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      
      // Cerrar otros dropdowns
      dropdowns.forEach(other => {
        if (other !== dropdown) {
          other.querySelector('.dropdown-menu').classList.remove('is-visible');
        }
      });
      
      menu.classList.toggle('is-visible');
    });
  });

  // Cerrar al hacer click fuera
  document.addEventListener('click', () => {
    dropdowns.forEach(dropdown => {
      dropdown.querySelector('.dropdown-menu').classList.remove('is-visible');
    });
    navLinks.classList.remove('active');
  });
}