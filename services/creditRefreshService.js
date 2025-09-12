const { admin, db, isInitialized } = require('../config/firebase');

/**
 * CreditRefreshService - Handles monthly credit refresh for all user types
 * - Freemium users: Reset to 200 credits (no accumulation)
 * - Paid users: Add monthly allowance to existing balance (accumulation)
 */
class CreditRefreshService {
    constructor() {
        this.db = isInitialized ? db : null;
        this.isInitialized = isInitialized;
        
        // Plan configurations
        this.planConfigs = {
            freemium: {
                monthlyCredits: 200,
                accumulate: false // Reset to base amount
            },
            premium: {
                monthlyCredits: 2000,
                accumulate: true // Add to existing balance
            },
            custom: {
                monthlyCredits: 3300,
                accumulate: true // Add to existing balance
            }
        };
    }

    /**
     * Refresh credits for a single user based on their plan
     * @param {string} userId - User ID
     * @param {string} planType - User's plan type
     * @param {number} currentCredits - User's current credit balance
     * @returns {Promise<Object>} Refresh result
     */
    async refreshUserCredits(userId, planType = 'freemium', currentCredits = 0) {
        if (!this.isInitialized) {
            console.log(`⚠️  Firebase not initialized, skipping credit refresh for user ${userId}`);
            return {
                success: false,
                error: 'Firebase not initialized',
                mock: true
            };
        }

        try {
            const planConfig = this.planConfigs[planType] || this.planConfigs.freemium;
            let newCreditBalance;
            let creditsAdded;

            if (planConfig.accumulate) {
                // Paid users: Add monthly credits to existing balance (accumulate)
                newCreditBalance = currentCredits + planConfig.monthlyCredits;
                creditsAdded = planConfig.monthlyCredits;
            } else {
                // Free users: Reset to 200 credits monthly regardless of current balance
                newCreditBalance = planConfig.monthlyCredits;
                creditsAdded = planConfig.monthlyCredits - currentCredits;
            }

            // Update user credits in Firestore
            const userRef = this.db.collection('users').doc(userId);
            const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
            
            const batch = this.db.batch();
            
            // Update user credits
            batch.update(userRef, {
                credits: newCreditBalance,
                lastCreditRefresh: admin.firestore.FieldValue.serverTimestamp(),
                lastRefreshMonth: currentMonth,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            // Record the refresh transaction
            const transactionRef = this.db.collection('creditTransactions').doc();
            batch.set(transactionRef, {
                userId: userId,
                type: 'monthly_refresh',
                amount: creditsAdded,
                planType: planType,
                previousBalance: currentCredits,
                newBalance: newCreditBalance,
                monthKey: currentMonth,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                status: 'completed'
            });

            await batch.commit();

            console.log(`Credit refresh completed for user ${userId}: ${currentCredits} → ${newCreditBalance} (${creditsAdded > 0 ? '+' : ''}${creditsAdded})`);

            return {
                success: true,
                userId: userId,
                planType: planType,
                previousBalance: currentCredits,
                newBalance: newCreditBalance,
                creditsAdded: creditsAdded,
                refreshMonth: currentMonth,
                refreshType: planConfig.accumulate ? 'accumulate' : 'reset'
            };

        } catch (error) {
            console.error(`Error refreshing credits for user ${userId}:`, error);
            return {
                success: false,
                error: error.message,
                userId: userId
            };
        }
    }

    /**
     * Refresh credits for all users (batch operation)
     * @param {number} batchSize - Number of users to process per batch
     * @returns {Promise<Object>} Batch refresh result
     */
    async refreshAllUserCredits(batchSize = 100) {
        if (!this.isInitialized) {
            console.log('⚠️  Firebase not initialized, skipping batch credit refresh');
            return {
                success: false,
                error: 'Firebase not initialized'
            };
        }

        try {
            const currentMonth = new Date().toISOString().slice(0, 7);
            const results = {
                processed: 0,
                successful: 0,
                failed: 0,
                errors: [],
                summary: {
                    freemium: { count: 0, totalCreditsAdded: 0 },
                    premium: { count: 0, totalCreditsAdded: 0 },
                    custom: { count: 0, totalCreditsAdded: 0 }
                }
            };

            // Query users who haven't been refreshed this month
            let query = this.db.collection('users')
                .where('lastRefreshMonth', '!=', currentMonth)
                .limit(batchSize);

            let hasMore = true;
            let lastDoc = null;

            while (hasMore) {
                if (lastDoc) {
                    query = query.startAfter(lastDoc);
                }

                const snapshot = await query.get();
                
                if (snapshot.empty) {
                    hasMore = false;
                    break;
                }

                const batch = this.db.batch();
                const refreshPromises = [];

                snapshot.forEach(doc => {
                    const userData = doc.data();
                    const userId = doc.id;
                    const planType = userData.planType || 'freemium';
                    const currentCredits = userData.credits || 0;

                    refreshPromises.push(
                        this.refreshUserCredits(userId, planType, currentCredits)
                            .then(result => {
                                results.processed++;
                                if (result.success) {
                                    results.successful++;
                                    results.summary[planType].count++;
                                    results.summary[planType].totalCreditsAdded += result.creditsAdded;
                                } else {
                                    results.failed++;
                                    results.errors.push({
                                        userId: userId,
                                        error: result.error
                                    });
                                }
                                return result;
                            })
                    );
                });

                await Promise.all(refreshPromises);
                lastDoc = snapshot.docs[snapshot.docs.length - 1];
                
                // Check if we have more documents
                if (snapshot.docs.length < batchSize) {
                    hasMore = false;
                }
            }

            console.log(`Batch credit refresh completed: ${results.successful}/${results.processed} users processed successfully`);
            
            return {
                success: true,
                refreshMonth: currentMonth,
                ...results
            };

        } catch (error) {
            console.error('Error in batch credit refresh:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Check if a user needs credit refresh for current month
     * @param {string} userId - User ID
     * @returns {Promise<boolean>} Whether user needs refresh
     */
    async userNeedsRefresh(userId) {
        if (!this.isInitialized) {
            return false;
        }

        try {
            const userDoc = await this.db.collection('users').doc(userId).get();
            
            if (!userDoc.exists) {
                return false;
            }

            const userData = userDoc.data();
            const currentMonth = new Date().toISOString().slice(0, 7);
            const lastRefreshMonth = userData.lastRefreshMonth;

            return lastRefreshMonth !== currentMonth;
        } catch (error) {
            console.error(`Error checking refresh status for user ${userId}:`, error);
            return false;
        }
    }

    /**
     * Get refresh statistics for current month
     * @returns {Promise<Object>} Refresh statistics
     */
    async getRefreshStats() {
        if (!this.isInitialized) {
            return {
                success: false,
                error: 'Firebase not initialized'
            };
        }

        try {
            const currentMonth = new Date().toISOString().slice(0, 7);
            
            const transactionsSnapshot = await this.db.collection('creditTransactions')
                .where('type', '==', 'monthly_refresh')
                .where('monthKey', '==', currentMonth)
                .get();

            const stats = {
                totalRefreshes: 0,
                totalCreditsAdded: 0,
                planBreakdown: {
                    freemium: { count: 0, creditsAdded: 0 },
                    premium: { count: 0, creditsAdded: 0 },
                    custom: { count: 0, creditsAdded: 0 }
                }
            };

            transactionsSnapshot.forEach(doc => {
                const data = doc.data();
                stats.totalRefreshes++;
                stats.totalCreditsAdded += data.amount;
                
                if (stats.planBreakdown[data.planType]) {
                    stats.planBreakdown[data.planType].count++;
                    stats.planBreakdown[data.planType].creditsAdded += data.amount;
                }
            });

            return {
                success: true,
                month: currentMonth,
                ...stats
            };

        } catch (error) {
            console.error('Error getting refresh stats:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = new CreditRefreshService();