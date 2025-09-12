/**
 * Accessibility Enhancement Script
 * Handles keyboard navigation, focus management, and user interaction preferences
 */

(function() {
  'use strict';

  // Track user interaction method for focus management
  let isKeyboardUser = false;
  let isMouseUser = false;

  // Initialize accessibility features
  function initAccessibility() {
    setupKeyboardDetection();
    setupFocusManagement();
    setupMobileMenuAccessibility();
    setupSkipLinks();
    setupReducedMotion();
  }

  // Detect keyboard vs mouse usage
  function setupKeyboardDetection() {
    // Detect keyboard usage
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Tab') {
        isKeyboardUser = true;
        isMouseUser = false;
        document.body.classList.add('keyboard-user');
        document.body.classList.remove('mouse-user');
      }
    });

    // Detect mouse usage
    document.addEventListener('mousedown', function() {
      isMouseUser = true;
      isKeyboardUser = false;
      document.body.classList.add('mouse-user');
      document.body.classList.remove('keyboard-user');
    });
  }

  // Enhanced focus management
  function setupFocusManagement() {
    // Trap focus in mobile menu when open
    const mobileMenu = document.querySelector('.nav-links');
    const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
    
    if (mobileMenu && mobileMenuToggle) {
      mobileMenuToggle.addEventListener('click', function() {
        const isExpanded = this.getAttribute('aria-expanded') === 'true';
        
        if (!isExpanded) {
          // Focus first menu item when opening
          setTimeout(() => {
            const firstMenuItem = mobileMenu.querySelector('a');
            if (firstMenuItem) {
              firstMenuItem.focus();
            }
          }, 300); // Wait for animation
        }
      });
    }

    // Handle escape key to close mobile menu
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        const mobileMenu = document.querySelector('.nav-links.active');
        if (mobileMenu) {
          const toggleButton = document.getElementById('mobile-menu-toggle');
          if (toggleButton) {
            toggleButton.click();
            toggleButton.focus();
          }
        }
      }
    });
  }

  // Enhanced mobile menu accessibility
  function setupMobileMenuAccessibility() {
    const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
    const navLinks = document.querySelector('.nav-links');
    
    if (mobileMenuToggle && navLinks) {
      // Update ARIA attributes when menu state changes
      const observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
          if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
            const isActive = navLinks.classList.contains('active');
            mobileMenuToggle.setAttribute('aria-expanded', isActive.toString());
            
            // Prevent body scroll when menu is open
            if (isActive) {
              document.body.style.overflow = 'hidden';
            } else {
              document.body.style.overflow = '';
            }
          }
        });
      });
      
      observer.observe(navLinks, { attributes: true });
    }
  }

  // Setup skip links functionality
  function setupSkipLinks() {
    const skipLinks = document.querySelectorAll('.skip-link');
    
    skipLinks.forEach(function(link) {
      link.addEventListener('click', function(e) {
        e.preventDefault();
        const targetId = this.getAttribute('href').substring(1);
        const target = document.getElementById(targetId);
        
        if (target) {
          target.focus();
          target.scrollIntoView({ behavior: 'smooth' });
        }
      });
    });
  }

  // Respect user's motion preferences
  function setupReducedMotion() {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    
    function handleReducedMotion(mediaQuery) {
      if (mediaQuery.matches) {
        document.body.classList.add('reduced-motion');
      } else {
        document.body.classList.remove('reduced-motion');
      }
    }
    
    handleReducedMotion(prefersReducedMotion);
    prefersReducedMotion.addEventListener('change', handleReducedMotion);
  }

  // Announce dynamic content changes to screen readers
  function announceToScreenReader(message, priority = 'polite') {
    const announcement = document.createElement('div');
    announcement.setAttribute('aria-live', priority);
    announcement.setAttribute('aria-atomic', 'true');
    announcement.className = 'sr-only';
    announcement.textContent = message;
    
    document.body.appendChild(announcement);
    
    // Remove after announcement
    setTimeout(() => {
      document.body.removeChild(announcement);
    }, 1000);
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAccessibility);
  } else {
    initAccessibility();
  }

  // Export for use in other scripts
  window.AccessibilityUtils = {
    announceToScreenReader: announceToScreenReader,
    isKeyboardUser: () => isKeyboardUser,
    isMouseUser: () => isMouseUser
  };

})();