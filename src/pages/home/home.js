// Importar componentes compartidos
import { loadNavbar } from '/src/components/navbar/navbar.js';
import { loadFooter } from '/src/components/footer/footer.js';

// Cargar navbar y footer
loadNavbar();
loadFooter();

// Funcionalidad de tarjeta expandible
const cardToggle = document.querySelector('.feature-card.red-light .card-toggle');

if (cardToggle) {
  cardToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const card = cardToggle.closest('.feature-card');
    const expandable = card.querySelector('.card-expandable');
    
    // Toggle de estados
    cardToggle.classList.toggle('active');
    expandable.classList.toggle('open');
  });
}