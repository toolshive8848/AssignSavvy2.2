/**
 * User Session Manager
 * Centralized user data management for consistent display across all pages
 */
class UserSessionManager {
    constructor() {
        this.defaultUser = {
            name: null,
            email: null,
            plan: 'free', // 'free', 'pro', or 'custom'
            credits: 0,
            maxCredits: 200
        };
        
        this.currentUser = this.loadUserData();
    }

    /**
     * Load user data from localStorage or use default
     */
    loadUserData() {
        try {
            const userToken = localStorage.getItem('userToken') || localStorage.getItem('authToken');
            
            // If no token, treat as logged out
            if (!userToken) {
                // Clear any stray user data
                localStorage.removeItem('userData');
                localStorage.removeItem('user');
                return null; // Return null instead of default user data
            }

            // Prioritize 'user' data, which is fresh from login/signup
            let freshUserData = localStorage.getItem('user');
            if (freshUserData) {
                const parsedUser = JSON.parse(freshUserData);
                
                // Define max credits based on plan
                let maxCredits = 200; // Default for free
                if (parsedUser.plan === 'pro') maxCredits = 2000;
                if (parsedUser.plan === 'custom') maxCredits = 5000;

                const formattedData = {
                    name: parsedUser.name || null,
                    email: parsedUser.email || null,
                    plan: parsedUser.plan || 'free',
                    credits: parsedUser.credits !== undefined ? parsedUser.credits : 0,
                    maxCredits: maxCredits
                };
                
                // Overwrite 'userData' with this fresh, formatted data
                localStorage.setItem('userData', JSON.stringify(formattedData));
                
                // Clean up the now-processed 'user' key
                localStorage.removeItem('user');
                
                return formattedData;
            }

            // If no fresh 'user' data, fall back to 'userData'
            let storedUserData = localStorage.getItem('userData');
            if (storedUserData) {
                const parsedData = JSON.parse(storedUserData);
                // Ensure it's merged with defaults in case of missing properties
                return { ...this.defaultUser, ...parsedData };
            }

        } catch (error) {
            console.warn('Failed to load or process user data from localStorage:', error);
            // In case of any error, clear session and return null
            localStorage.removeItem('userToken');
            localStorage.removeItem('authToken');
            localStorage.removeItem('userData');
            localStorage.removeItem('user');
        }

        // If all else fails, return null to indicate no user session
        return null;
    }

    /**
     * Save user data to localStorage
     */
    saveUserData() {
        try {
            localStorage.setItem('userData', JSON.stringify(this.currentUser));
        } catch (error) {
            console.warn('Failed to save user data to localStorage:', error);
        }
    }

    /**
     * Get current user data
     */
    getCurrentUser() {
        return { ...this.currentUser };
    }

    /**
     * Update user data
     */
    updateUser(userData) {
        this.currentUser = { ...this.currentUser, ...userData };
        this.saveUserData();
        this.updateAllDisplays();
    }

    /**
     * Get formatted plan display text
     */
    getPlanDisplayText() {
        if (!this.currentUser) return 'Not Logged In';
        
        switch (this.currentUser.plan) {
            case 'free':
                return 'Free Plan';
            case 'pro':
                return 'Pro Plan';
            case 'custom':
                return 'Custom Plan';
            default:
                return 'Free Plan';
        }
    }

    /**
     * Get formatted credits display text
     */
    getCreditsDisplayText() {
        if (!this.currentUser) return 'Login Required';
        return `${this.currentUser.credits}/${this.currentUser.maxCredits} Credits`;
    }

    /**
     * Show not logged in state for UI elements
     */
    showNotLoggedInState() {
        const userNameEl = document.getElementById('user-name');
        const userPlanEl = document.getElementById('user-plan');
        const userCreditsEl = document.getElementById('user-credits');
        
        if (userNameEl) userNameEl.textContent = 'Please Login';
        if (userPlanEl) userPlanEl.textContent = 'Not Logged In';
        if (userCreditsEl) userCreditsEl.textContent = 'Login Required';
        
        // Update modal elements
        const modalUserNameEl = document.getElementById('modal-user-name');
        const modalUserEmailEl = document.getElementById('modal-user-email');
        const modalUserPlanEl = document.getElementById('modal-user-plan');
        const modalUserCreditsEl = document.getElementById('modal-user-credits');
        
        if (modalUserNameEl) modalUserNameEl.textContent = 'Please Login';
        if (modalUserEmailEl) modalUserEmailEl.textContent = 'Not Available';
        if (modalUserPlanEl) modalUserPlanEl.textContent = 'Not Logged In';
        if (modalUserCreditsEl) modalUserCreditsEl.textContent = 'Login Required';
    }

    /**
     * Update all user displays on the current page
     */
    updateAllDisplays() {
        // Check if user is logged in
        if (!this.currentUser) {
            this.showNotLoggedInState();
            return;
        }
        
        // Update sidebar user info
        const userNameEl = document.getElementById('user-name');
        const userPlanEl = document.getElementById('user-plan');
        const userCreditsEl = document.getElementById('user-credits');
        
        if (userNameEl) userNameEl.textContent = this.currentUser.name || 'User';
        if (userPlanEl) userPlanEl.textContent = this.getPlanDisplayText();
        if (userCreditsEl) userCreditsEl.textContent = this.getCreditsDisplayText();
        
        // Update modal user info
        const modalUserNameEl = document.getElementById('modal-user-name');
        const modalUserEmailEl = document.getElementById('modal-user-email');
        const modalUserPlanEl = document.getElementById('modal-user-plan');
        const modalUserCreditsEl = document.getElementById('modal-user-credits');
        
        if (modalUserNameEl) modalUserNameEl.textContent = this.currentUser.name || 'User';
        if (modalUserEmailEl) modalUserEmailEl.textContent = this.currentUser.email;
        if (modalUserPlanEl) modalUserPlanEl.textContent = this.getPlanDisplayText();
        if (modalUserCreditsEl) modalUserCreditsEl.textContent = this.getCreditsDisplayText();
        
        // Update welcome message on dashboard
        const welcomeMessageEl = document.getElementById('welcome-message');
        if (welcomeMessageEl) {
            welcomeMessageEl.innerHTML = `Welcome back, ${this.currentUser.name}! 👋`;
        }
    }

    /**
     * Fetch current user data from server
     */
    async fetchUserDataFromServer() {
        try {
            const token = localStorage.getItem('userToken') || localStorage.getItem('authToken');
            if (!token) {
                console.log('No auth token found, using default user data');
                return null;
            }

            const response = await fetch('/api/users/profile', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const userData = await response.json();
                console.log('Fetched user data from server:', userData);
                
                // Format the data to match our structure
                const formattedData = {
                    name: userData.name || this.defaultUser.name,
                    email: userData.email || this.defaultUser.email,
                    plan: userData.plan || 'free',
                    credits: userData.credits !== undefined ? userData.credits : this.defaultUser.credits,
                    maxCredits: userData.plan === 'pro' ? 2000 : userData.plan === 'custom' ? 5000 : 200
                };
                
                // Update current user and save to localStorage
                this.currentUser = formattedData;
                this.saveUserData();
                
                return formattedData;
            } else {
                console.warn('Failed to fetch user data from server:', response.status);
                return null;
            }
        } catch (error) {
            console.warn('Error fetching user data from server:', error);
            return null;
        }
    }

    /**
     * Initialize user session on page load
     */
    async init() {
        // First load from localStorage
        this.currentUser = this.loadUserData();
        
        // Try to fetch fresh data from server
        const serverData = await this.fetchUserDataFromServer();
        if (serverData) {
            this.currentUser = serverData;
        }
        
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                this.updateAllDisplays();
            });
        } else {
            this.updateAllDisplays();
        }
    }

    /**
     * Logout user
     */
    logout() {
        if (confirm('Are you sure you want to logout?')) {
            // Clear all user-related data from localStorage
            localStorage.removeItem('userToken');
            localStorage.removeItem('userData');
            localStorage.removeItem('user');
            localStorage.removeItem('authToken');
            
            // Reset to default user
            this.currentUser = { ...this.defaultUser };
            this.updateAllDisplays();
            
            window.location.href = 'auth.html';
        }
    }

    /**
     * Check if user has pro features
     */
    hasProFeatures() {
        return this.currentUser.plan === 'pro' || this.currentUser.plan === 'custom';
    }

    /**
     * Check if user has sufficient credits
     */
    hasSufficientCredits(requiredCredits) {
        return this.currentUser.credits >= requiredCredits;
    }

    /**
     * Deduct credits (for demo purposes)
     */
    deductCredits(amount) {
        if (this.currentUser.credits >= amount) {
            this.currentUser.credits -= amount;
            this.saveUserData();
            this.updateAllDisplays();
            return true;
        }
        return false;
    }
}

// Create global instance
window.userSession = new UserSessionManager();

// Auto-initialize
window.userSession.init();

// Global logout function for backward compatibility
window.logout = function() {
    window.userSession.logout();
};