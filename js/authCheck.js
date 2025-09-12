/**
 * Authentication Check Module
 * Ensures users are properly authenticated before accessing tools
 */

class AuthenticationManager {
    constructor() {
        this.requiredPages = ['writer.html', 'researcher.html', 'detector.html', 'prompt-engineer.html', 'dashboard.html', 'history.html'];
    }

    /**
     * Check if user is authenticated
     */
    isAuthenticated() {
        const authToken = localStorage.getItem('authToken');
        const userData = localStorage.getItem('user') || localStorage.getItem('userData');
        
        return authToken && userData;
    }

    /**
     * Get current page name
     */
    getCurrentPage() {
        return window.location.pathname.split('/').pop() || 'index.html';
    }

    /**
     * Check if current page requires authentication
     */
    requiresAuth() {
        const currentPage = this.getCurrentPage();
        return this.requiredPages.includes(currentPage);
    }

    /**
     * Redirect to login page
     */
    redirectToLogin() {
        console.log('User not authenticated, redirecting to login...');
        window.location.href = 'auth.html';
    }

    /**
     * Initialize authentication check
     */
    init() {
        // Only check auth on pages that require it
        if (this.requiresAuth()) {
            if (!this.isAuthenticated()) {
                this.redirectToLogin();
                return false;
            }
        }
        return true;
    }

    /**
     * Clear authentication data
     */
    logout() {
        localStorage.removeItem('authToken');
        localStorage.removeItem('user');
        localStorage.removeItem('userData');
        this.redirectToLogin();
    }
}

// Create global instance
window.authManager = new AuthenticationManager();

// Auto-initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    window.authManager.init();
});