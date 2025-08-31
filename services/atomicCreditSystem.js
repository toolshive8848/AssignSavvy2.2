const admin = require('firebase-admin');

/**
 * AtomicCreditSystem class for handling credit calculations and atomic Firestore transactions
 * Implements different word-to-credit ratios for different tools
 */
class AtomicCreditSystem {
    constructor() {
        this.db = admin.firestore();
        this.CREDIT_RATIOS = {
            writing: 5,    // 1 credit per 5 words for writing/assignments
            research: 10,  // 1 credit per 10 words for research
            detector: 50,  // 50 credits per 1000 words for detection
            detector_generation: 10, // 1 credit per 10 words for detector generation
            prompt: 100    // 1 credit per 100 words for prompt engineer (after daily limit)
        };
        this.MAX_RETRY_ATTEMPTS = 3;
        this.RETRY_DELAY_MS = 100;
    }

    /**
     * Calculate required credits based on total requested words/credits and tool type
     * @param {number} requestedAmount - Total words requested
     * @param {string} toolType - Type of tool ('writing', 'research', 'detector', 'detector_generation', 'prompt')
     * @param {string} operation - For detector: 'detection' or 'generation'
     * @returns {number} Required credits
     */
    calculateRequiredCredits(requestedAmount, toolType = 'writing', operation = null) {
        if (!requestedAmount || requestedAmount <= 0) {
            throw new Error('Invalid amount for credit calculation');
        }
        
        // Special handling for detector tool
        if (toolType === 'detector') {
            if (operation === 'detection') {
                // 50 credits per 1000 words for detection
                const requiredCredits = Math.ceil((requestedAmount / 1000) * this.CREDIT_RATIOS.detector);
                console.log(`Credit calculation: ${requestedAmount} words = ${requiredCredits} credits (detector detection: 50 credits per 1000 words)`);
                return requiredCredits;
            } else if (operation === 'generation') {
                // 1 credit per 10 words for generation
                const requiredCredits = Math.ceil(requestedAmount / this.CREDIT_RATIOS.detector_generation);
                console.log(`Credit calculation: ${requestedAmount} words = ${requiredCredits} credits (detector generation: 1 credit per 10 words)`);
                return requiredCredits;
            }
        }
        
        // For other tools, calculate credits from word count
        const ratio = this.CREDIT_RATIOS[toolType] || this.CREDIT_RATIOS.writing;
        const requiredCredits = Math.ceil(requestedAmount / ratio);
        console.log(`Credit calculation: ${requestedAmount} words = ${requiredCredits} credits (ratio: 1:${ratio}, tool: ${toolType})`);
        
        return requiredCredits;
    }

    /**
     * Atomic credit deduction with Firestore transaction
     * @param {string} userId - User ID
     * @param {number} requestedAmount - Total words requested or credits for detector
     * @param {string} planType - User's plan type
     * @param {string} toolType - Type of tool ('writing', 'research', or 'detector')
     * @returns {Promise<Object>} Transaction result
     */
    async deductCreditsAtomic(userId, requestedAmount, planType, toolType = 'writing') {
        const requiredCredits = this.calculateRequiredCredits(requestedAmount, toolType);
        
        // For detector tool, requestedAmount is credits, so wordCount should be 0
        const wordCount = toolType === 'detector' ? 0 : requestedAmount;
        
        let attempt = 0;
        while (attempt < this.MAX_RETRY_ATTEMPTS) {
            try {
                const result = await this.executeTransaction(userId, requiredCredits, wordCount, planType);
                console.log(`Atomic credit deduction successful for user ${userId}: -${requiredCredits} credits, +${wordCount} monthly words`);
                result.toolType = toolType;
                result.requestedAmount = requestedAmount;
                return result;
            } catch (error) {
                attempt++;
                console.warn(`Transaction attempt ${attempt} failed for user ${userId}:`, error.message);
                
                if (attempt >= this.MAX_RETRY_ATTEMPTS) {
                    console.error(`All ${this.MAX_RETRY_ATTEMPTS} transaction attempts failed for user ${userId}`);
                    throw error;
                }
                
                // Wait before retry with exponential backoff
                await this.delay(this.RETRY_DELAY_MS * Math.pow(2, attempt - 1));
            }
        }
    }

    /**
     * Execute Firestore transaction for credit deduction
     * @param {string} userId - User ID
     * @param {number} requiredCredits - Credits to deduct
     * @param {number} requestedWordCount - Words to add to monthly counter
     * @param {string} planType - User's plan type
     * @returns {Promise<Object>} Transaction result
     */
    async executeTransaction(userId, requiredCredits, requestedWordCount, planType) {
        return await this.db.runTransaction(async (transaction) => {
            // References
            const userRef = this.db.collection('users').doc(userId);
            const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
            const monthlyUsageRef = this.db.collection('monthlyUsage').doc(`${userId}_${currentMonth}`);
            
            // Read current state
            const [userDoc, monthlyUsageDoc] = await Promise.all([
                transaction.get(userRef),
                transaction.get(monthlyUsageRef)
            ]);
            
            // Validate user exists
            if (!userDoc.exists) {
                throw new Error('User not found');
            }
            
            const userData = userDoc.data();
            const currentCredits = userData.credits || 0;
            
            // Check sufficient credits
            if (currentCredits < requiredCredits) {
                throw new Error(`Insufficient credits. Required: ${requiredCredits}, Available: ${currentCredits}. Please top-up.`);
            }
            
            // Get current monthly usage
            const currentMonthlyData = monthlyUsageDoc.exists ? monthlyUsageDoc.data() : {
                userId,
                monthKey: currentMonth,
                wordsGenerated: 0,
                creditsUsed: 0,
                requestCount: 0,
                createdAt: new Date()
            };
            
            // For freemium users, check monthly word limit
            if (planType === 'freemium') {
                const FREEMIUM_MONTHLY_LIMIT = 1000;
                const newMonthlyWords = (currentMonthlyData.wordsGenerated || 0) + requestedWordCount;
                
                if (newMonthlyWords > FREEMIUM_MONTHLY_LIMIT) {
                    throw new Error(`Monthly word limit exceeded. Current: ${currentMonthlyData.wordsGenerated}, Requested: ${requestedWordCount}, Limit: ${FREEMIUM_MONTHLY_LIMIT}`);
                }
            }
            
            // Calculate new balances
            const newCreditBalance = currentCredits - requiredCredits;
            const newMonthlyWords = (currentMonthlyData.wordsGenerated || 0) + requestedWordCount;
            const newMonthlyCredits = (currentMonthlyData.creditsUsed || 0) + requiredCredits;
            const newRequestCount = (currentMonthlyData.requestCount || 0) + 1;
            
            // Prepare transaction data
            const transactionData = {
                userId,
                transactionId: this.generateTransactionId(),
                type: 'credit_deduction',
                amount: requiredCredits,
                wordCount: requestedWordCount,
                planType,
                timestamp: new Date(),
                previousBalance: currentCredits,
                newBalance: newCreditBalance,
                monthKey: currentMonth,
                status: 'completed'
            };
            
            // Update user credits
            transaction.update(userRef, {
                credits: newCreditBalance,
                lastCreditDeduction: new Date(),
                totalCreditsUsed: (userData.totalCreditsUsed || 0) + requiredCredits,
                totalWordsGenerated: (userData.totalWordsGenerated || 0) + requestedWordCount
            });
            
            // Update monthly usage
            transaction.set(monthlyUsageRef, {
                userId,
                monthKey: currentMonth,
                wordsGenerated: newMonthlyWords,
                creditsUsed: newMonthlyCredits,
                requestCount: newRequestCount,
                lastUpdated: new Date(),
                createdAt: currentMonthlyData.createdAt || new Date()
            }, { merge: true });
            
            // Record transaction
            const transactionRef = this.db.collection('creditTransactions').doc();
            transaction.set(transactionRef, transactionData);
            
            return {
                success: true,
                transactionId: transactionData.transactionId,
                creditsDeducted: requiredCredits,
                wordsAllocated: requestedWordCount,
                previousBalance: currentCredits,
                newBalance: newCreditBalance,
                monthlyUsage: {
                    wordsGenerated: newMonthlyWords,
                    creditsUsed: newMonthlyCredits,
                    requestCount: newRequestCount
                },
                timestamp: transactionData.timestamp
            };
        });
    }

    /**
     * Rollback transaction in case of failure
     * @param {string} userId - User ID
     * @param {string} transactionId - Transaction ID to rollback
     * @param {number} creditsToRestore - Credits to restore
     * @param {number} wordsToDeduct - Words to deduct from monthly counter
     * @returns {Promise<Object>} Rollback result
     */
    async rollbackTransaction(userId, transactionId, creditsToRestore, wordsToDeduct) {
        try {
            return await this.db.runTransaction(async (transaction) => {
                const userRef = this.db.collection('users').doc(userId);
                const currentMonth = new Date().toISOString().slice(0, 7);
                const monthlyUsageRef = this.db.collection('monthlyUsage').doc(`${userId}_${currentMonth}`);
                const transactionRef = this.db.collection('creditTransactions').doc(transactionId);
                
                // Read current state
                const [userDoc, monthlyUsageDoc, transactionDoc] = await Promise.all([
                    transaction.get(userRef),
                    transaction.get(monthlyUsageRef),
                    transaction.get(transactionRef)
                ]);
                
                if (!userDoc.exists) {
                    throw new Error('User not found for rollback');
                }
                
                if (!transactionDoc.exists) {
                    throw new Error('Transaction not found for rollback');
                }
                
                const userData = userDoc.data();
                const monthlyData = monthlyUsageDoc.exists ? monthlyUsageDoc.data() : {};
                
                // Restore credits
                const restoredBalance = (userData.credits || 0) + creditsToRestore;
                
                // Update user
                transaction.update(userRef, {
                    credits: restoredBalance,
                    totalCreditsUsed: Math.max(0, (userData.totalCreditsUsed || 0) - creditsToRestore),
                    totalWordsGenerated: Math.max(0, (userData.totalWordsGenerated || 0) - wordsToDeduct)
                });
                
                // Update monthly usage
                if (monthlyUsageDoc.exists) {
                    transaction.update(monthlyUsageRef, {
                        wordsGenerated: Math.max(0, (monthlyData.wordsGenerated || 0) - wordsToDeduct),
                        creditsUsed: Math.max(0, (monthlyData.creditsUsed || 0) - creditsToRestore),
                        requestCount: Math.max(0, (monthlyData.requestCount || 0) - 1),
                        lastUpdated: new Date()
                    });
                }
                
                // Mark transaction as rolled back
                transaction.update(transactionRef, {
                    status: 'rolled_back',
                    rollbackTimestamp: new Date(),
                    rollbackReason: 'Content generation failed'
                });
                
                return {
                    success: true,
                    creditsRestored: creditsToRestore,
                    wordsDeducted: wordsToDeduct,
                    newBalance: restoredBalance,
                    rollbackTimestamp: new Date()
                };
            });
        } catch (error) {
            console.error('Rollback transaction failed:', error);
            throw new Error(`Rollback failed: ${error.message}`);
        }
    }

    /**
     * Get user's current credit balance
     * @param {string} userId - User ID
     * @returns {Promise<Object>} Credit balance information
     */
    async getCreditBalance(userId) {
        try {
            const userRef = this.db.collection('users').doc(userId);
            const userDoc = await userRef.get();
            
            if (!userDoc.exists) {
                throw new Error('User not found');
            }
            
            const userData = userDoc.data();
            return {
                currentBalance: userData.credits || 0,
                totalCreditsUsed: userData.totalCreditsUsed || 0,
                totalWordsGenerated: userData.totalWordsGenerated || 0,
                lastCreditDeduction: userData.lastCreditDeduction?.toDate() || null
            };
        } catch (error) {
            console.error('Error getting credit balance:', error);
            throw error;
        }
    }

    /**
     * Get transaction history for a user
     * @param {string} userId - User ID
     * @param {number} limit - Number of transactions to retrieve
     * @returns {Promise<Array>} Transaction history
     */
    async getTransactionHistory(userId, limit = 50) {
        try {
            const transactionsRef = this.db.collection('creditTransactions')
                .where('userId', '==', userId)
                .orderBy('timestamp', 'desc')
                .limit(limit);
            
            const snapshot = await transactionsRef.get();
            
            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                timestamp: doc.data().timestamp?.toDate()
            }));
        } catch (error) {
            console.error('Error getting transaction history:', error);
            throw error;
        }
    }

    /**
     * Generate unique transaction ID
     * @returns {string} Transaction ID
     */
    generateTransactionId() {
        return `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Delay function for retry logic
     * @param {number} ms - Milliseconds to delay
     * @returns {Promise<void>}
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Refund credits to user account
     * @param {string} userId - User ID
     * @param {number} creditsToRefund - Credits to refund
     * @param {string} originalTransactionId - Original transaction ID for reference
     * @returns {Promise<Object>} Refund result
     */
    async refundCredits(userId, creditsToRefund, originalTransactionId) {
        try {
            return await this.db.runTransaction(async (transaction) => {
                const userRef = this.db.collection('users').doc(userId);
                const userDoc = await transaction.get(userRef);
                
                if (!userDoc.exists) {
                    throw new Error('User not found');
                }
                
                const userData = userDoc.data();
                const currentCredits = userData.credits || 0;
                const newCreditBalance = currentCredits + creditsToRefund;
                
                // Update user credits
                transaction.update(userRef, {
                    credits: newCreditBalance,
                    lastUpdated: new Date()
                });
                
                // Record refund transaction
                const refundTransactionData = {
                    transactionId: this.generateTransactionId(),
                    userId,
                    type: 'refund',
                    creditsRefunded: creditsToRefund,
                    previousBalance: currentCredits,
                    newBalance: newCreditBalance,
                    originalTransactionId,
                    timestamp: new Date(),
                    status: 'completed'
                };
                
                const refundTransactionRef = this.db.collection('creditTransactions').doc();
                transaction.set(refundTransactionRef, refundTransactionData);
                
                return {
                    success: true,
                    transactionId: refundTransactionData.transactionId,
                    creditsRefunded,
                    previousBalance: currentCredits,
                    newBalance: newCreditBalance,
                    timestamp: refundTransactionData.timestamp
                };
            });
        } catch (error) {
            console.error('Error refunding credits:', error);
            throw new Error(`Credit refund failed: ${error.message}`);
        }
    }

    /**
     * Validate transaction integrity
     * @param {string} transactionId - Transaction ID to validate
     * @returns {Promise<Object>} Validation result
     */
    async validateTransaction(transactionId) {
        try {
            const transactionRef = this.db.collection('creditTransactions').doc(transactionId);
            const transactionDoc = await transactionRef.get();
            
            if (!transactionDoc.exists) {
                return {
                    isValid: false,
                    error: 'Transaction not found'
                };
            }
            
            const transactionData = transactionDoc.data();
            
            return {
                isValid: true,
                transaction: {
                    ...transactionData,
                    timestamp: transactionData.timestamp?.toDate()
                }
            };
        } catch (error) {
            console.error('Error validating transaction:', error);
            return {
                isValid: false,
                error: error.message
            };
        }
    }
}

module.exports = AtomicCreditSystem;