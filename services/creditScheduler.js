const admin = require('firebase-admin');
const { CreditRefreshService } = require('./creditRefreshService');

class CreditScheduler {
    constructor() {
        this.db = admin.firestore();
        this.creditRefreshService = new CreditRefreshService();
        this.isRunning = false;
    }

    /**
     * Start the monthly credit refresh scheduler
     * Runs on the 1st of every month at 00:00 UTC
     */
    start() {
        if (this.isRunning) {
            console.log('Credit scheduler is already running');
            return;
        }

        this.isRunning = true;
        console.log('Starting monthly credit refresh scheduler...');
        
        // Calculate time until next month's 1st day
        const now = new Date();
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
        const timeUntilNextRun = nextMonth.getTime() - now.getTime();
        
        // Schedule first run
        setTimeout(() => {
            this.executeMonthlyRefresh();
            
            // Set up monthly interval (30 days)
            this.monthlyInterval = setInterval(() => {
                this.executeMonthlyRefresh();
            }, 30 * 24 * 60 * 60 * 1000); // 30 days in milliseconds
            
        }, timeUntilNextRun);
        
        console.log(`Next credit refresh scheduled for: ${nextMonth.toISOString()}`);
    }

    /**
     * Stop the scheduler
     */
    stop() {
        if (this.monthlyInterval) {
            clearInterval(this.monthlyInterval);
            this.monthlyInterval = null;
        }
        this.isRunning = false;
        console.log('Credit scheduler stopped');
    }

    /**
     * Execute monthly credit refresh for all users
     */
    async executeMonthlyRefresh() {
        try {
            console.log('Starting monthly credit refresh for all users...');
            const startTime = Date.now();
            
            const result = await this.creditRefreshService.refreshAllUsers();
            
            const duration = Date.now() - startTime;
            console.log(`Monthly credit refresh completed in ${duration}ms:`);
            console.log(`- Total users processed: ${result.totalProcessed}`);
            console.log(`- Successful refreshes: ${result.successCount}`);
            console.log(`- Failed refreshes: ${result.failureCount}`);
            console.log(`- Free users refreshed: ${result.freeUsersRefreshed}`);
            console.log(`- Paid users refreshed: ${result.paidUsersRefreshed}`);
            
            // Log the refresh event
            await this.logRefreshEvent(result, duration);
            
        } catch (error) {
            console.error('Error during monthly credit refresh:', error);
            
            // Log the error
            await this.logRefreshEvent({ error: error.message }, 0);
        }
    }

    /**
     * Log refresh events to Firestore for monitoring
     */
    async logRefreshEvent(result, duration) {
        try {
            await this.db.collection('creditRefreshLogs').add({
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                result: result,
                duration: duration,
                type: 'monthly_refresh'
            });
        } catch (error) {
            console.error('Error logging refresh event:', error);
        }
    }

    /**
     * Manually trigger credit refresh (for testing or emergency use)
     */
    async manualRefresh() {
        console.log('Manual credit refresh triggered...');
        await this.executeMonthlyRefresh();
    }

    /**
     * Get scheduler status
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            hasInterval: !!this.monthlyInterval
        };
    }

    /**
     * Calculate next refresh date
     */
    getNextRefreshDate() {
        const now = new Date();
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
        return nextMonth;
    }
}

module.exports = { CreditScheduler };