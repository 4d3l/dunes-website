/**
 * DUNES CHAT LANDING PAGE INTERACTION CONTROLLER
 * High-fidelity client-side experience for dunes.chat
 */

document.addEventListener('DOMContentLoaded', () => {
    initMobileNav();
    initFAQAccordions();
    initEncryptionSimulator();
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
 * 3. High-Fidelity Interactive Encryption Simulator
 */
function initEncryptionSimulator() {
    const plainInput = document.getElementById('plain-input');
    const cipherOutput = document.getElementById('cipher-output');
    const btnEncrypt = document.getElementById('btn-encrypt-toggle');
    const btnCopy = document.getElementById('btn-copy-cipher');
    const charCounter = document.getElementById('char-counter');
    const statusDot = document.querySelector('#sim-status .status-dot');
    const statusText = document.getElementById('status-text');
    const securityBadge = document.getElementById('security-badge');
    const keyVal = document.getElementById('sim-key-val');

    if (!plainInput || !cipherOutput || !btnEncrypt) return;

    let isEncrypted = true; // Starts in encrypted state demonstrating mock text
    let dhSharedKey = generateRandomHex(32);
    
    // Set initial shared key
    keyVal.textContent = `dune_dh_${dhSharedKey.substring(0, 16)}...`;

    // Character counter listener
    plainInput.addEventListener('input', () => {
        const len = plainInput.value.length;
        charCounter.textContent = `${len} character${len !== 1 ? 's' : ''}`;
        
        // If user modifies input, reset simulated cipher instantly
        if (isEncrypted) {
            cipherOutput.textContent = 'Payload altered. Re-encryption required.';
            securityBadge.textContent = 'Payload Modified';
            securityBadge.className = 'badge';
            securityBadge.style.backgroundColor = 'rgba(239, 83, 80, 0.08)';
            securityBadge.style.borderColor = 'rgba(239, 83, 80, 0.2)';
            securityBadge.style.color = '#EF5350';
            btnEncrypt.textContent = 'Encrypt Payload';
            isEncrypted = false;
        }
    });

    // Mock encryption routine
    btnEncrypt.addEventListener('click', () => {
        if (!isEncrypted) {
            // Trigger Encryption Sequence Animation
            btnEncrypt.disabled = true;
            statusText.textContent = 'DH Key Agreement...';
            statusDot.className = 'status-dot pulsing';
            statusDot.style.backgroundColor = '#F5A623';
            statusDot.style.boxShadow = '0 0 10px #F5A623';

            setTimeout(() => {
                statusText.textContent = 'AES-GCM Multiplexing...';
                
                setTimeout(() => {
                    // Complete encryption simulation
                    const rawVal = plainInput.value || ' ';
                    const encryptedVal = mockAESEncrypt(rawVal, dhSharedKey);
                    
                    cipherOutput.textContent = encryptedVal;
                    
                    statusText.textContent = 'Payload Sealed';
                    statusDot.className = 'status-dot';
                    statusDot.style.backgroundColor = '#4CAF50';
                    statusDot.style.boxShadow = '0 0 10px #4CAF50';
                    
                    securityBadge.textContent = 'Encrypted (AES-GCM)';
                    securityBadge.className = 'badge badge-success';
                    securityBadge.style = ''; // Reset custom overrides
                    
                    btnEncrypt.textContent = 'Decrypt Payload';
                    btnEncrypt.disabled = false;
                    isEncrypted = true;
                }, 600);
            }, 600);
            
        } else {
            // Trigger Decryption Sequence Animation
            btnEncrypt.disabled = true;
            statusText.textContent = 'Decrypting Local Key...';
            statusDot.className = 'status-dot pulsing';
            statusDot.style.backgroundColor = '#F5A623';
            statusDot.style.boxShadow = '0 0 10px #F5A623';

            setTimeout(() => {
                cipherOutput.textContent = plainInput.value;
                statusText.textContent = 'Decrypted & Clear';
                statusDot.className = 'status-dot';
                statusDot.style.backgroundColor = '#EF5350';
                statusDot.style.boxShadow = '0 0 10px #EF5350';
                
                securityBadge.textContent = 'Plaintext (Unencrypted)';
                securityBadge.className = 'badge';
                securityBadge.style.backgroundColor = 'rgba(239, 83, 80, 0.08)';
                securityBadge.style.borderColor = 'rgba(239, 83, 80, 0.2)';
                securityBadge.style.color = '#EF5350';

                btnEncrypt.textContent = 'Encrypt Payload';
                btnEncrypt.disabled = false;
                isEncrypted = false;
            }, 700);
        }
    });

    // Copy to clipboard helper
    btnCopy.addEventListener('click', () => {
        const cipherText = cipherOutput.textContent.trim();
        navigator.clipboard.writeText(cipherText).then(() => {
            const originalText = btnCopy.textContent;
            btnCopy.textContent = 'Copied!';
            btnCopy.style.color = '#4CAF50';
            
            setTimeout(() => {
                btnCopy.textContent = originalText;
                btnCopy.style.color = '';
            }, 1800);
        });
    });
}

/**
 * 4. Scroll linked active highlights & navbar glass-dimmer
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
 * 5. Smooth scroller & highlighters for Sideload Instructions
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

/**
 * UTILITY FUNCTIONS
 */

// Generate random hex keys
function generateRandomHex(length) {
    const chars = '0123456789abcdef';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
}

// Custom simulated AES GCM cryptographic encoding routine
// Encodes the message to a randomized payload matching real-world AES base64
function mockAESEncrypt(plaintext, keySeed) {
    if (!plaintext) return '';
    
    // Basic character rotation based on key indices for simulated real-world E2EE output
    const shift = (parseInt(keySeed.charAt(0), 16) || 7) % 26;
    
    let encryptedChars = [];
    for (let i = 0; i < plaintext.length; i++) {
        let code = plaintext.charCodeAt(i);
        encryptedChars.push(String.fromCharCode(code + shift + (i % 3)));
    }
    
    // Encode to window standard Base64 representation
    const secureSerialized = btoa(unescape(encodeURIComponent(encryptedChars.join(''))));
    
    // Wrap inside a standard AES secure boundary
    return `AES-GCM::IV[${keySeed.substring(0, 8)}]-TAG[${keySeed.substring(24, 28)}]::${secureSerialized.substring(0, 68)}`;
}
