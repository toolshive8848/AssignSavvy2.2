const admin = require('firebase-admin');

/**
 * UsageTracker class for managing monthly usage limits and tracking
 * Handles word count tracking, credit consumption, and usage statistics
 */
class UsageTracker {
    constructor() {
        this.db = admin.firestore();
        this.FREEMIUM_MONTHLY_WORD_LIMIT = 1000;
        this.FREEMIUM_MONTHLY_CREDIT_LIMIT = 200;
    }

    /**
     * Get current month key for usage tracking
     * @returns {string} Month key in format YYYY-MM
     */
    getCurrentMonthKey() {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    /**
     * Get user's monthly usage statistics
     * @param {string} userId - User ID
     * @returns {Promise<Object>} Usage statistics
     */
    async getMonthlyUsage(userId) {
        try {
            const monthKey = this.getCurrentMonthKey();
            const usageRef = this.db.collection('monthlyUsage').doc(`${userId}_${monthKey}`);
            const usageDoc = await usageRef.get();

            if (!usageDoc.exists) {
                return {
                    userId,
                    monthKey,
                    wordsGenerated: 0,
                    creditsUsed: 0,
                    requestCount: 0,
                    lastUpdated: new Date(),
                    createdAt: new Date()
                };
            }

            const data = usageDoc.data();
            return {
                userId,
                monthKey,
                wordsGenerated: data.wordsGenerated || 0,
                creditsUsed: data.creditsUsed || 0,
                requestCount: data.requestCount || 0,
                lastUpdated: data.lastUpdated?.toDate() || new Date(),
                createdAt: data.createdAt?.toDate() || new Date()
            };
        } catch (error) {
            console.error('Error getting monthly usage:', error);
            throw new Error('Failed to retrieve monthly usage data');
        }
    }

    /**
     * Check if user can generate content within their monthly limits
     * @param {string} userId - User ID
     * @param {string} planType - User's plan type
     * @param {number} requestedWordCount - Requested word count
     * @param {number} estimatedCredits - Estimated credits needed
     * @returns {Promise<Object>} Validation result
     */
    async validateMonthlyLimits(userId, planType, requestedWordCount, estimatedCredits) {
        try {
            // Only apply monthly limits to freemium users
            if (planType !== 'freemium') {
                return {
                    canProceed: true,
                    reason: 'No monthly limits for paid plans'
                };
            }

            const currentUsage = await this.getMonthlyUsage(userId);
            
            // Check word count limit
            const newWordTotal = currentUsage.wordsGenerated + requestedWordCount;
            if (newWordTotal > this.FREEMIUM_MONTHLY_WORD_LIMIT) {
                return {
                    canProceed: false,
                    reason: 'MONTHLY_WORD_LIMIT_EXCEEDED',
                    currentUsage: currentUsage.wordsGenerated,
                    limit: this.FREEMIUM_MONTHLY_WORD_LIMIT,
                    requestedWords: requestedWordCount,
                    wouldExceedBy: newWordTotal - this.FREEMIUM_MONTHLY_WORD_LIMIT
                };
            }

            // Check credit limit
            const newCreditTotal = currentUsage.creditsUsed + estimatedCredits;
            if (newCreditTotal > this.FREEMIUM_MONTHLY_CREDIT_LIMIT) {
                return {
                    canProceed: false,
                    reason: 'MONTHLY_CREDIT_LIMIT_EXCEEDED',
                    currentUsage: currentUsage.creditsUsed,
                    limit: this.FREEMIUM_MONTHLY_CREDIT_LIMIT,
                    requestedCredits: estimatedCredits,
                    wouldExceedBy: newCreditTotal - this.FREEMIUM_MONTHLY_CREDIT_LIMIT
                };
            }

            return {
                canProceed: true,
                currentUsage,
                remainingWords: this.FREEMIUM_MONTHLY_WORD_LIMIT - currentUsage.wordsGenerated,
                remainingCredits: this.FREEMIUM_MONTHLY_CREDIT_LIMIT - currentUsage.creditsUsed
            };
        } catch (error) {
            console.error('Error validating monthly limits:', error);
            throw new Error('Failed to validate monthly limits');
        }
    }

    /**
     * Record usage after successful content generation
     * @param {string} userId - User ID
     * @param {number} wordsGenerated - Number of words generated
     * @param {number} creditsUsed - Credits consumed
     * @param {Object} metadata - Additional metadata
     * @returns {Promise<Object>} Updated usage statistics
     */
    async recordUsage(userId, wordsGenerated, creditsUsed, metadata = {}) {
        try {
            const monthKey = this.getCurrentMonthKey();
            const usageRef = this.db.collection('monthlyUsage').doc(`${userId}_${monthKey}`);
            
            const currentUsage = await this.getMonthlyUsage(userId);
            
            const updatedUsage = {
                userId,
                monthKey,
                wordsGenerated: currentUsage.wordsGenerated + wordsGenerated,
                creditsUsed: currentUsage.creditsUsed + creditsUsed,
                requestCount: currentUsage.requestCount + 1,
                lastUpdated: new Date(),
                createdAt: currentUsage.createdAt || new Date(),
                ...metadata
            };

            await usageRef.set(updatedUsage, { merge: true });

            // Also record individual usage entry for detailed tracking
            await this.recordUsageEntry(userId, wordsGenerated, creditsUsed, metadata);

            console.log(`Usage recorded for user ${userId}: +${wordsGenerated} words, +${creditsUsed} credits`);
            
            return updatedUsage;
        } catch (error) {
            console.error('Error recording usage:', error);
            throw new Error('Failed to record usage data');
        }
    }

    /**
     * Record individual usage entry for detailed tracking
     * @param {string} userId - User ID
     * @param {number} wordsGenerated - Number of words generated
     * @param {number} creditsUsed - Credits consumed
     * @param {Object} metadata - Additional metadata
     * @returns {Promise<void>}
     */
    async recordUsageEntry(userId, wordsGenerated, creditsUsed, metadata = {}) {
        try {
            const usageEntry = {
                userId,
                wordsGenerated,
                creditsUsed,
                timestamp: new Date(),
                monthKey: this.getCurrentMonthKey(),
                ...metadata
            };

            await this.db.collection('usageEntries').add(usageEntry);
        } catch (error) {
            console.error('Error recording usage entry:', error);
            // Don't throw here as this is supplementary tracking
        }
    }

    /**
     * Get usage statistics for a specific month
     * @param {string} userId - User ID
     * @param {string} monthKey - Month key (YYYY-MM)
     * @returns {Promise<Object>} Usage statistics
     */
    async getUsageForMonth(userId, monthKey) {
        try {
            const usageRef = this.db.collection('monthlyUsage').doc(`${userId}_${monthKey}`);
            const usageDoc = await usageRef.get();

            if (!usageDoc.exists) {
                return null;
            }

            const data = usageDoc.data();
            return {
                userId,
                monthKey,
                wordsGenerated: data.wordsGenerated || 0,
                creditsUsed: data.creditsUsed || 0,
                requestCount: data.requestCount || 0,
                lastUpdated: data.lastUpdated?.toDate(),
                createdAt: data.createdAt?.toDate()
            };
        } catch (error) {
            console.error('Error getting usage for month:', error);
            throw new Error('Failed to retrieve usage data for month');
        }
    }

    /**
     * Get usage history for a user
     * @param {string} userId - User ID
     * @param {number} months - Number of months to retrieve (default: 6)
     * @returns {Promise<Array>} Usage history
     */
    async getUserUsageHistory(userId, months = 6) {
        try {
            const history = [];
            const now = new Date();

            for (let i = 0; i < months; i++) {
                const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
                const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                
                const usage = await this.getUsageForMonth(userId, monthKey);
                history.push({
                    monthKey,
                    month: date.toLocaleString('default', { month: 'long', year: 'numeric' }),
                    usage: usage || {
                        wordsGenerated: 0,
                        creditsUsed: 0,
                        requestCount: 0
                    }
                });
            }

            return history;
        } catch (error) {
            console.error('Error getting user usage history:', error);
            throw new Error('Failed to retrieve usage history');
        }
    }

    /**
     * Reset monthly usage (for testing or admin purposes)
     * @param {string} userId - User ID
     * @param {string} monthKey - Month key (optional, defaults to current month)
     * @returns {Promise<void>}
     */
    async resetMonthlyUsage(userId, monthKey = null) {
        try {
            const targetMonth = monthKey || this.getCurrentMonthKey();
            const usageRef = this.db.collection('monthlyUsage').doc(`${userId}_${targetMonth}`);
            
            await usageRef.set({
                userId,
                monthKey: targetMonth,
                wordsGenerated: 0,
                creditsUsed: 0,
                requestCount: 0,
                lastUpdated: new Date(),
                createdAt: new Date(),
                resetAt: new Date(),
                resetReason: 'Manual reset'
            });

            console.log(`Monthly usage reset for user ${userId} for month ${targetMonth}`);
        } catch (error) {
            console.error('Error resetting monthly usage:', error);
            throw new Error('Failed to reset monthly usage');
        }
    }

    /**
     * Get freemium limits
     * @returns {Object} Freemium limits
     */
    getFreemiumLimits() {
        return {
            monthlyWordLimit: this.FREEMIUM_MONTHLY_WORD_LIMIT,
            monthlyCreditLimit: this.FREEMIUM_MONTHLY_CREDIT_LIMIT
        };
    }
}

module.exports = UsageTracker;