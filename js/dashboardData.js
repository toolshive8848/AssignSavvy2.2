// Dashboard Data Management
// Handles dynamic loading of user statistics and dashboard content

class DashboardData {
  constructor() {
    this.userStats = {
      wordsGenerated: 0,
      projectsCompleted: 0,
      creditsUsed: 0,
      totalCredits: 200,
      timeSaved: 0,
      todayWords: 0,
      sourcesFound: 0,
      originalityScore: 0,
      promptsOptimized: 0
    };
    
    this.recentActivity = [];
    this.isLoading = true;
  }

  // Initialize dashboard data loading
  async init() {
    try {
      await this.loadUserStats();
      await this.loadRecentActivity();
      this.updateDashboard();
      this.isLoading = false;
    } catch (error) {
      console.error('Error initializing dashboard data:', error);
      this.showErrorState();
    }
  }

  // Load user statistics from Firebase
  async loadUserStats() {
    try {
      const user = firebase.auth().currentUser;
      if (!user) {
        throw new Error('User not authenticated');
      }

      // Get user document from Firestore
      const userDoc = await firebase.firestore()
        .collection('users')
        .doc(user.uid)
        .get();

      if (userDoc.exists) {
        const userData = userDoc.data();
        
        // Update stats with real data
        this.userStats = {
          wordsGenerated: userData.stats?.wordsGenerated || 0,
          projectsCompleted: userData.stats?.projectsCompleted || 0,
          creditsUsed: userData.credits?.used || 0,
          totalCredits: userData.credits?.total || 200,
          timeSaved: userData.stats?.timeSaved || 0,
          todayWords: userData.stats?.todayWords || 0,
          sourcesFound: userData.stats?.sourcesFound || 0,
          originalityScore: userData.stats?.originalityScore || 0,
          promptsOptimized: userData.stats?.promptsOptimized || 0
        };
      }
    } catch (error) {
      console.error('Error loading user stats:', error);
      // Keep default values if Firebase fails
    }
  }

  // Load recent activity from Firebase
  async loadRecentActivity() {
    try {
      const user = firebase.auth().currentUser;
      if (!user) return;

      // Get recent activities from Firestore
      const activitiesSnapshot = await firebase.firestore()
        .collection('activities')
        .where('userId', '==', user.uid)
        .orderBy('timestamp', 'desc')
        .limit(10)
        .get();

      this.recentActivity = activitiesSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch (error) {
      console.error('Error loading recent activity:', error);
      this.recentActivity = [];
    }
  }

  // Update dashboard UI with loaded data
  updateDashboard() {
    this.updateStatsCards();
    this.updateToolStats();
    this.updateRecentActivity();
    this.updateUserInfo();
  }

  // Update statistics cards
  updateStatsCards() {
    // Words Generated
    const wordsElement = document.querySelector('.stat-card:nth-child(1) .stat-value');
    if (wordsElement) {
      wordsElement.textContent = this.formatNumber(this.userStats.wordsGenerated);
    }

    // Projects Completed
    const projectsElement = document.querySelector('.stat-card:nth-child(2) .stat-value');
    if (projectsElement) {
      projectsElement.textContent = this.userStats.projectsCompleted.toString();
    }

    // Credits Used
    const creditsElement = document.querySelector('.stat-card:nth-child(3) .stat-value');
    if (creditsElement) {
      creditsElement.textContent = `${this.userStats.creditsUsed}/${this.userStats.totalCredits}`;
    }

    // Time Saved
    const timeElement = document.querySelector('.stat-card:nth-child(4) .stat-value');
    if (timeElement) {
      timeElement.textContent = this.formatTime(this.userStats.timeSaved);
    }

    // Update credits display in sidebar
    const sidebarCredits = document.getElementById('user-credits');
    if (sidebarCredits) {
      sidebarCredits.textContent = `${this.userStats.creditsUsed}/${this.userStats.totalCredits} Credits`;
    }
  }

  // Update tool-specific statistics
  updateToolStats() {
    // Writer tool stats
    const writerStat = document.querySelector('.tool-card:nth-child(1) .tool-stat');
    if (writerStat) {
      writerStat.innerHTML = `<i class="fas fa-file-text"></i> ${this.formatNumber(this.userStats.todayWords)} words today`;
    }

    // Researcher tool stats
    const researcherStat = document.querySelector('.tool-card:nth-child(2) .tool-stat');
    if (researcherStat) {
      researcherStat.innerHTML = `<i class="fas fa-search"></i> ${this.userStats.sourcesFound} sources found`;
    }

    // Detector tool stats
    const detectorStat = document.querySelector('.tool-card:nth-child(3) .tool-stat');
    if (detectorStat) {
      detectorStat.innerHTML = `<i class="fas fa-check-circle"></i> ${this.userStats.originalityScore}% original`;
    }

    // Prompt Engineer tool stats
    const promptStat = document.querySelector('.tool-card:nth-child(4) .tool-stat');
    if (promptStat) {
      promptStat.innerHTML = `<i class="fas fa-magic"></i> ${this.userStats.promptsOptimized} prompts optimized`;
    }
  }

  // Update recent activity section
  updateRecentActivity() {
    const activityCard = document.querySelector('.activity-card');
    if (!activityCard) return;

    if (this.recentActivity.length === 0) {
      // Show empty state
      activityCard.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">
            <i class="fas fa-folder-open"></i>
          </div>
          <h4 class="empty-title">No recent activity</h4>
          <p class="empty-description">Your recent projects and activities will appear here</p>
          <a href="writer.html" class="empty-action">
            <i class="fas fa-plus"></i>
            Create Your First Project
          </a>
        </div>
      `;
    } else {
      // Show activity list
      const activitiesHTML = this.recentActivity.map(activity => `
        <div class="activity-item">
          <div class="activity-icon">
            <i class="fas fa-${this.getActivityIcon(activity.type)}"></i>
          </div>
          <div class="activity-content">
            <h5 class="activity-title">${activity.title}</h5>
            <p class="activity-description">${activity.description}</p>
            <span class="activity-time">${this.formatTimeAgo(activity.timestamp)}</span>
          </div>
        </div>
      `).join('');

      activityCard.innerHTML = `<div class="activity-list">${activitiesHTML}</div>`;
    }
  }

  // Update user information
  updateUserInfo() {
    const user = firebase.auth().currentUser;
    if (!user) return;

    // Update user name
    const userNameElement = document.getElementById('user-name');
    if (userNameElement) {
      userNameElement.textContent = user.displayName || user.email || 'User';
    }

    // Update welcome message
    const welcomeMessage = document.getElementById('welcome-message');
    if (welcomeMessage) {
      const name = user.displayName ? user.displayName.split(' ')[0] : 'there';
      welcomeMessage.textContent = `Welcome back, ${name}! 👋`;
    }
  }

  // Show error state when data loading fails
  showErrorState() {
    console.log('Showing error state for dashboard data');
    // Keep existing hardcoded values as fallback
  }

  // Utility functions
  formatNumber(num) {
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'k';
    }
    return num.toString();
  }

  formatTime(hours) {
    if (hours >= 24) {
      const days = Math.floor(hours / 24);
      return `${days}d`;
    }
    return `${hours}h`;
  }

  formatTimeAgo(timestamp) {
    const now = new Date();
    const time = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const diffMs = now - time;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  }

  getActivityIcon(type) {
    const icons = {
      'write': 'pen',
      'research': 'magnifying-glass',
      'detect': 'shield-halved',
      'prompt': 'code',
      'payment': 'credit-card',
      'default': 'circle'
    };
    return icons[type] || icons.default;
  }

  // Method to update stats when user performs actions
  async updateUserStats(statType, increment = 1) {
    try {
      const user = firebase.auth().currentUser;
      if (!user) return;

      const userRef = firebase.firestore().collection('users').doc(user.uid);
      const updateData = {};
      updateData[`stats.${statType}`] = firebase.firestore.FieldValue.increment(increment);

      await userRef.update(updateData);
      
      // Update local stats
      this.userStats[statType] += increment;
      this.updateDashboard();
    } catch (error) {
      console.error('Error updating user stats:', error);
    }
  }

  // Method to log activity
  async logActivity(type, title, description) {
    try {
      const user = firebase.auth().currentUser;
      if (!user) return;

      await firebase.firestore().collection('activities').add({
        userId: user.uid,
        type,
        title,
        description,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });

      // Reload recent activity
      await this.loadRecentActivity();
      this.updateRecentActivity();
    } catch (error) {
      console.error('Error logging activity:', error);
    }
  }
}

// Initialize dashboard data when DOM is loaded
let dashboardData;

document.addEventListener('DOMContentLoaded', () => {
  // Wait for Firebase auth to be ready
  firebase.auth().onAuthStateChanged((user) => {
    if (user) {
      dashboardData = new DashboardData();
      dashboardData.init();
    } else {
      // Redirect to login if not authenticated
      window.location.href = 'auth.html';
    }
  });
});

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DashboardData;
}