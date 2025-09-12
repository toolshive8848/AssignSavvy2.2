const { admin, db, isInitialized } = require('../config/firebase');
const { globalErrorHandler } = require('../middleware/errorHandler');

/**
 * ImprovedCreditSystem class with enhanced transaction integrity and race condition prevention
 * Addresses critical issues found in the original atomic credit system
 */
class ImprovedCreditSystem {
    constructor() {
        this.db = isInitialized ? db : null;
        this.isInitialized = isInitialized;
        this.CREDIT_RATIOS = {
            writing: 3,
            research: 5,
            detector: 10,
            detector_generation: 5
        };
        this.MAX_RETRY_ATTEMPTS = 5; // Increased from 3
        this.RETRY_DELAY_MS = 200; // Increased base delay
        this.TRANSACTION_TIMEOUT = 30000; // 30 seconds
        this.CONCURRENT_TRANSACTION_LIMIT = 3; // Prevent too many concurrent transactions
        this.userTransactionCounts = new Map(); // Track concurrent transactions per user
    }

    /**
     * Calculate required credits with validation
     */
    calculateRequiredCredits(requestedAmount, toolType = 'writing', operation = null) {
        if (!requestedAmount || requestedAmount <= 0) {
            throw new Error('Invalid amount for credit calculation');
        }
        
        if (requestedAmount > 100000) { // Prevent excessive requests
            throw new Error('Request amount exceeds maximum limit (100,000)');
        }

        if (toolType === 'detector') {
            const ratio = operation === 'detection' ? this.CREDIT_RATIOS.detector : this.CREDIT_RATIOS.detector_generation;
            return Math.ceil(requestedAmount / ratio);
        }
        
        const ratio = this.CREDIT_RATIOS[toolType] || this.CREDIT_RATIOS.writing;
        return Math.ceil(requestedAmount / ratio);
    }

    /**
     * Enhanced atomic credit deduction with improved race condition handling
     */
    async deductCreditsAtomic(userId, requestedAmount, planType, toolType = 'writing', operation = null) {
        // Validate inputs
        if (!userId || typeof userId !== 'string') {
            throw new Error('Invalid user ID');
        }
        
        if (!planType || typeof planType !== 'string') {
            throw new Error('Invalid plan type');
        }

        // Check concurrent transaction limit
        const currentCount = this.userTransactionCounts.get(userId) || 0;
        if (currentCount >= this.CONCURRENT_TRANSACTION_LIMIT) {
            throw new Error('Too many concurrent transactions. Please wait and try again.');
        }

        // Increment transaction counter
        this.userTransactionCounts.set(userId, currentCount + 1);

        try {
            const requiredCredits = this.calculateRequiredCredits(requestedAmount, toolType, operation);
            const wordCount = toolType === 'detector' ? 0 : requestedAmount;

            // Mock mode for uninitialized Firebase
            if (!this.isInitialized) {
                console.log(`⚠️  Firebase not initialized, returning mock credit deduction for user ${userId}`);
                return {
                    success: true,
                    mock: true,
                    creditsDeducted: requiredCredits,
                    remainingCredits: 200 - requiredCredits,
                    monthlyWordsUsed: wordCount,
                    toolType: toolType,
                    requestedAmount: requestedAmount
                };
            }

            // Execute transaction with enhanced retry logic
            return await this.executeTransactionWithRetry(userId, requiredCredits, wordCount, planType, toolType);
        } finally {
            // Always decrement transaction counter
            const newCount = Math.max(0, (this.userTransactionCounts.get(userId) || 1) - 1);
            if (newCount === 0) {
                this.userTransactionCounts.delete(userId);
            } else {
                this.userTransactionCounts.set(userId, newCount);
            }
        }
    }

    /**
     * Enhanced transaction execution with better retry logic
     */
    async executeTransactionWithRetry(userId, requiredCredits, wordCount, planType, toolType) {
        let lastError;
        
        for (let attempt = 1; attempt <= this.MAX_RETRY_ATTEMPTS; attempt++) {
            try {
                const result = await Promise.race([
                    this.executeEnhancedTransaction(userId, requiredCredits, wordCount, planType, toolType),
                    this.createTimeoutPromise(this.TRANSACTION_TIMEOUT)
                ]);
                
                console.log(`Transaction successful for user ${userId} on attempt ${attempt}`);
                return result;
            } catch (error) {
                lastError = error;
                console.warn(`Transaction attempt ${attempt}/${this.MAX_RETRY_ATTEMPTS} failed for user ${userId}:`, error.message);
                
                // Don't retry on certain errors
                if (this.isNonRetryableError(error)) {
                    throw error;
                }
                
                if (attempt < this.MAX_RETRY_ATTEMPTS) {
                    // Exponential backoff with jitter
                    const delay = this.RETRY_DELAY_MS * Math.pow(2, attempt - 1) + Math.random() * 100;
                    await this.delay(delay);
                }
            }
        }
        
        console.error(`All ${this.MAX_RETRY_ATTEMPTS} transaction attempts failed for user ${userId}`);
        throw lastError;
    }

    /**
     * Enhanced transaction execution with better error handling and validation
     */
    async executeEnhancedTransaction(userId, requiredCredits, wordCount, planType, toolType) {
        return await this.db.runTransaction(async (transaction) => {
            const userRef = this.db.collection('users').doc(userId);
            const currentMonth = new Date().toISOString().slice(0, 7);
            const monthlyUsageRef = this.db.collection('monthlyUsage').doc(`${userId}_${currentMonth}`);
            
            // Read current state with error handling
            const [userDoc, monthlyUsageDoc] = await Promise.all([
                transaction.get(userRef).catch(err => {
                    throw new Error(`Failed to read user data: ${err.message}`);
                }),
                transaction.get(monthlyUsageRef).catch(err => {
                    throw new Error(`Failed to read monthly usage: ${err.message}`);
                })
            ]);
            
            // Enhanced user validation
            if (!userDoc.exists) {
                throw new Error('User not found');
            }
            
            const userData = userDoc.data();
            if (!userData || typeof userData.credits !== 'number') {
                throw new Error('Invalid user data structure');
            }
            
            const currentCredits = userData.credits;
            
            // Enhanced credit validation
            if (currentCredits < requiredCredits) {
                throw new Error(`Insufficient credits. Required: ${requiredCredits}, Available: ${currentCredits}. Please top-up.`);
            }
            
            // Get and validate monthly usage data
            const currentMonthlyData = monthlyUsageDoc.exists ? monthlyUsageDoc.data() : {
                userId,
                monthKey: currentMonth,
                wordsGenerated: 0,
                creditsUsed: 0,
                requestCount: 0,
                createdAt: new Date()
            };
            
            // Enhanced freemium validation
            if (planType === 'freemium') {
                const FREEMIUM_MONTHLY_LIMIT = 1000;
                const currentWords = currentMonthlyData.wordsGenerated || 0;
                const newMonthlyWords = currentWords + wordCount;
                
                if (newMonthlyWords > FREEMIUM_MONTHLY_LIMIT) {
                    throw new Error(`Monthly word limit exceeded. Current: ${currentWords}, Requested: ${wordCount}, Limit: ${FREEMIUM_MONTHLY_LIMIT}`);
                }
            }
            
            // Calculate new balances with validation
            const newCreditBalance = currentCredits - requiredCredits;
            const newMonthlyWords = (currentMonthlyData.wordsGenerated || 0) + wordCount;
            const newMonthlyCredits = (currentMonthlyData.creditsUsed || 0) + requiredCredits;
            const newRequestCount = (currentMonthlyData.requestCount || 0) + 1;
            
            // Validate calculations
            if (newCreditBalance < 0) {
                throw new Error('Credit calculation resulted in negative balance');
            }
            
            // Generate transaction data with enhanced tracking
            const transactionId = this.generateEnhancedTransactionId();
            const timestamp = new Date();
            
            const transactionData = {
                userId,
                transactionId,
                type: 'credit_deduction',
                amount: requiredCredits,
                wordCount,
                toolType,
                planType,
                timestamp,
                previousBalance: currentCredits,
                newBalance: newCreditBalance,
                monthKey: currentMonth,
                status: 'completed',
                version: '2.0', // Track system version
                metadata: {
                    userAgent: 'improved-credit-system',
                    retryAttempt: 1
                }
            };
            
            // Perform all updates atomically
            try {
                // Update user credits with enhanced tracking
                transaction.update(userRef, {
                    credits: newCreditBalance,
                    lastCreditDeduction: timestamp,
                    totalCreditsUsed: (userData.totalCreditsUsed || 0) + requiredCredits,
                    totalWordsGenerated: (userData.totalWordsGenerated || 0) + wordCount,
                    lastActivity: timestamp,
                    version: admin.firestore.FieldValue.increment(1) // Optimistic concurrency control
                });
                
                // Update monthly usage with merge to prevent overwrites
                transaction.set(monthlyUsageRef, {
                    userId,
                    monthKey: currentMonth,
                    wordsGenerated: newMonthlyWords,
                    creditsUsed: newMonthlyCredits,
                    requestCount: newRequestCount,
                    lastUpdated: timestamp,
                    createdAt: currentMonthlyData.createdAt || timestamp
                }, { merge: true });
                
                // Record transaction with auto-generated ID to prevent conflicts
                const transactionRef = this.db.collection('creditTransactions').doc();
                transaction.set(transactionRef, {
                    ...transactionData,
                    firestoreId: transactionRef.id
                });
                
                return {
                    success: true,
                    transactionId,
                    firestoreId: transactionRef.id,
                    creditsDeducted: requiredCredits,
                    wordsAllocated: wordCount,
                    previousBalance: currentCredits,
                    newBalance: newCreditBalance,
                    monthlyUsage: {
                        wordsGenerated: newMonthlyWords,
                        creditsUsed: newMonthlyCredits,
                        requestCount: newRequestCount
                    },
                    timestamp,
                    toolType
                };
            } catch (updateError) {
                throw new Error(`Transaction update failed: ${updateError.message}`);
            }
        });
    }

    /**
     * Enhanced rollback with better error handling and validation
     */
    async rollbackTransaction(userId, transactionId, creditsToRestore, wordsToDeduct) {
        if (!userId || !transactionId || creditsToRestore < 0 || wordsToDeduct < 0) {
            throw new Error('Invalid rollback parameters');
        }

        try {
            return await this.db.runTransaction(async (transaction) => {
                const userRef = this.db.collection('users').doc(userId);
                const currentMonth = new Date().toISOString().slice(0, 7);
                const monthlyUsageRef = this.db.collection('monthlyUsage').doc(`${userId}_${currentMonth}`);
                
                // Find transaction by transactionId
                const transactionQuery = this.db.collection('creditTransactions')
                    .where('transactionId', '==', transactionId)
                    .where('userId', '==', userId)
                    .limit(1);
                
                const [userDoc, monthlyUsageDoc, transactionSnapshot] = await Promise.all([
                    transaction.get(userRef),
                    transaction.get(monthlyUsageRef),
                    transaction.get(transactionQuery)
                ]);
                
                if (!userDoc.exists) {
                    throw new Error('User not found for rollback');
                }
                
                if (transactionSnapshot.empty) {
                    throw new Error('Transaction not found for rollback');
                }
                
                const transactionDoc = transactionSnapshot.docs[0];
                const transactionData = transactionDoc.data();
                
                // Prevent double rollback
                if (transactionData.status === 'rolled_back') {
                    throw new Error('Transaction already rolled back');
                }
                
                const userData = userDoc.data();
                const monthlyData = monthlyUsageDoc.exists ? monthlyUsageDoc.data() : {};
                
                // Calculate restored balances with validation
                const restoredBalance = (userData.credits || 0) + creditsToRestore;
                const newMonthlyWords = Math.max(0, (monthlyData.wordsGenerated || 0) - wordsToDeduct);
                const newMonthlyCredits = Math.max(0, (monthlyData.creditsUsed || 0) - creditsToRestore);
                const newRequestCount = Math.max(0, (monthlyData.requestCount || 0) - 1);
                
                // Update user with rollback
                transaction.update(userRef, {
                    credits: restoredBalance,
                    totalCreditsUsed: Math.max(0, (userData.totalCreditsUsed || 0) - creditsToRestore),
                    totalWordsGenerated: Math.max(0, (userData.totalWordsGenerated || 0) - wordsToDeduct),
                    lastRollback: new Date()
                });
                
                // Update monthly usage if exists
                if (monthlyUsageDoc.exists) {
                    transaction.update(monthlyUsageRef, {
                        wordsGenerated: newMonthlyWords,
                        creditsUsed: newMonthlyCredits,
                        requestCount: newRequestCount,
                        lastUpdated: new Date()
                    });
                }
                
                // Mark transaction as rolled back
                transaction.update(transactionDoc.ref, {
                    status: 'rolled_back',
                    rollbackTimestamp: new Date(),
                    rollbackReason: 'Content generation failed',
                    originalAmount: transactionData.amount,
                    restoredAmount: creditsToRestore
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
            console.error('Enhanced rollback failed:', error);
            throw new Error(`Rollback failed: ${error.message}`);
        }
    }

    /**
     * Check if error should not be retried
     */
    isNonRetryableError(error) {
        const nonRetryableMessages = [
            'User not found',
            'Insufficient credits',
            'Monthly word limit exceeded',
            'Invalid user data structure',
            'Too many concurrent transactions'
        ];
        
        return nonRetryableMessages.some(msg => error.message.includes(msg));
    }

    /**
     * Create timeout promise for transaction timeout
     */
    createTimeoutPromise(timeout) {
        return new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Transaction timeout')), timeout);
        });
    }

    /**
     * Enhanced transaction ID generation
     */
    generateEnhancedTransactionId() {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substr(2, 12);
        const checksum = (timestamp % 10000).toString().padStart(4, '0');
        return `txn_${timestamp}_${random}_${checksum}`;
    }

    /**
     * Delay with jitter
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Health check for the credit system
     */
    async healthCheck() {
        if (!this.isInitialized) {
            return { status: 'warning', message: 'Firebase not initialized' };
        }
        
        try {
            // Test database connectivity
            await this.db.collection('users').limit(1).get();
            return { status: 'healthy', message: 'Credit system operational' };
        } catch (error) {
            return { status: 'error', message: `Database connectivity issue: ${error.message}` };
        }
    }
}

module.exports = ImprovedCreditSystem;