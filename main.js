const menuToggle = document.querySelector('.menu-toggle');
const navLinks = document.querySelector('.nav-links');
const dropdowns = document.querySelectorAll('.dropdown');

menuToggle.addEventListener('click', (e) => {
    e.stopPropagation(); // ← ESTO EVITA QUE SE PROPAGUE
    navLinks.classList.toggle('active');
});

dropdowns.forEach(dropdown => {
    const toggle = dropdown.querySelector('.dropdown-toggle');
    const menu = dropdown.querySelector('.dropdown-menu');
    toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdowns.forEach(other => {
            if(other !== dropdown){
                other.querySelector('.dropdown-menu').classList.remove('is-visible');
            }
        });
        menu.classList.toggle('is-visible');
    });
});

document.addEventListener('click', () => {
    dropdowns.forEach(dropdown => {
        dropdown.querySelector('.dropdown-menu').classList.remove('is-visible');
    });
    navLinks.classList.remove('active');
});



// Funcionalidad de tarjeta expandible
const cardToggle = document.querySelector('.feature-card.red-light .card-toggle');

if (cardToggle) {
    cardToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const card = cardToggle.closest('.feature-card');
        const expandable = card.querySelector('.card-expandable');
        
        cardToggle.classList.toggle('active');
        expandable.classList.toggle('open');
    });
}