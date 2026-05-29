/**
 * DUNES CHAT LANDING PAGE INTERACTION CONTROLLER
 * High-fidelity client-side experience for dunes.chat
 */

document.addEventListener('DOMContentLoaded', () => {
    initMobileNav();
    initFAQAccordions();
    initScrollEffects();
    initSideloadScroller();
});

/**
 * 1. Mobile Drawer Navigation Toggle
 */
function initMobileNav() {
    const toggleBtn = document.getElementById('mobile-menu-btn');
    const drawer = document.getElementById('mobile-drawer');
    const links = document.querySelectorAll('.mobile-link');

    if (!toggleBtn || !drawer) return;

    // Toggle drawer open/close
    toggleBtn.addEventListener('click', () => {
        toggleBtn.classList.toggle('active');
        drawer.classList.toggle('active');
    });

    // Close drawer when any mobile nav link is clicked
    links.forEach(link => {
        link.addEventListener('click', () => {
            toggleBtn.classList.remove('active');
            drawer.classList.remove('active');
        });
    });
}

/**
 * 2. FAQ Accordion Logic
 */
function initFAQAccordions() {
    const faqQuestions = document.querySelectorAll('.faq-question');

    faqQuestions.forEach(question => {
        question.addEventListener('click', () => {
            const item = question.parentElement;
            const isActive = item.classList.contains('active');

            // Close all other FAQ items for a clean accordion effect
            document.querySelectorAll('.faq-item').forEach(otherItem => {
                otherItem.classList.remove('active');
            });

            // Toggle current item
            if (!isActive) {
                item.classList.add('active');
            }
        });
    });
}

/**
 * 3. Scroll linked active highlights & navbar glass-dimmer
 */
function initScrollEffects() {
    const navbar = document.getElementById('navbar');
    const sections = document.querySelectorAll('section[id]');
    const navLinks = document.querySelectorAll('.desktop-nav .nav-link');

    window.addEventListener('scroll', () => {
        // 1. Add background shadow and diminish opacity on header scroll
        if (window.scrollY > 40) {
            navbar.style.boxShadow = '0 8px 30px rgba(0,0,0,0.4)';
            navbar.style.padding = '10px 0';
        } else {
            navbar.style.boxShadow = 'none';
            navbar.style.padding = '';
        }

        // 2. Active navbar links highlighter
        let currentSectionId = '';
        const scrollPosition = window.scrollY + 120; // Offset for topbar height

        sections.forEach(section => {
            const sectionTop = section.offsetTop;
            const sectionHeight = section.offsetHeight;
            
            if (scrollPosition >= sectionTop && scrollPosition < (sectionTop + sectionHeight)) {
                currentSectionId = section.getAttribute('id');
            }
        });

        navLinks.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === `#${currentSectionId}`) {
                link.style.color = 'var(--color-accent-light)';
            } else {
                link.style.color = ''; // reset
            }
        });
    });
}

/**
 * 4. Smooth scroller & highlighters for Sideload Instructions
 */
function initSideloadScroller() {
    const trigger = document.getElementById('btn-sideload-guide');
    const targetCard = document.getElementById('sideload-guide-card');

    if (!trigger || !targetCard) return;

    trigger.addEventListener('click', () => {
        targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        // Dynamic amber glow pulse on scroll-target entry
        setTimeout(() => {
            targetCard.style.boxShadow = '0 0 35px rgba(245, 166, 35, 0.4)';
            targetCard.style.borderColor = 'var(--color-accent)';
            
            setTimeout(() => {
                targetCard.style.boxShadow = '';
                targetCard.style.borderColor = '';
            }, 1800);
        }, 600);
    });
}
