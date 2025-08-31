class CreditSystem {
    constructor() {
        this.planLimits = {
            free: {
                maxWordCount: 2000,
                initialCredits: 200,    // Free users get 200 credits
                monthlyCredits: 200,    // Monthly refresh: 200 credits
                wordsPerCredit: 5,      // 1 credit per 5 words (1:5 ratio)
                features: ['basic_generation']
            },
            premium: {
                maxWordCount: 10000,
                initialCredits: 2000,   // Premium users get 2000 credits
                monthlyCredits: 2000,   // Monthly refresh: 2000 credits
                wordsPerCredit: 5,      // Same 1:5 ratio for consistency
                features: ['basic_generation', 'advanced_styles', 'priority_processing', 'export_formats']
            },
            custom: {
                maxWordCount: 50000,
                initialCredits: 3300,   // Custom plan: $15 = 3300 credits
                monthlyCredits: 3300,   // Monthly refresh: 3300 credits
                wordsPerCredit: 5,      // Same 1:5 ratio for consistency
                features: ['basic_generation', 'advanced_styles', 'priority_processing', 'export_formats', 'api_access', 'custom_templates']
            }
        };

        this.styleMultipliers = {
            'Academic': 1.0,
            'Business': 1.2,
            'Creative': 1.5,
            'Technical': 1.8,
            'Legal': 2.0
        };

        this.complexityMultipliers = {
            'basic': 1.0,
            'intermediate': 1.3,
            'advanced': 1.6,
            'expert': 2.0
        };
    }

    /**
     * Calculate credits needed for content generation
     * @param {number} wordCount - Target word count
     * @param {string} userPlan - User's subscription plan
     * @param {string} style - Writing style
     * @param {string} complexity - Content complexity level
     * @returns {Object} Credit calculation result
     */
    calculateCreditsNeeded(wordCount, userPlan = 'free', style = 'Academic', complexity = 'basic') {
        try {
            const plan = this.planLimits[userPlan] || this.planLimits.free;
            
            // Check if word count exceeds plan limits
            if (wordCount > plan.maxWordCount) {
                return {
                    success: false,
                    error: `Word count ${wordCount} exceeds plan limit of ${plan.maxWordCount}`,
                    maxAllowed: plan.maxWordCount
                };
            }

            // Base credit calculation using wordsPerCredit ratio
            let baseCredits = Math.ceil(wordCount / plan.wordsPerCredit);

            // Apply style multiplier
            const styleMultiplier = this.styleMultipliers[style] || 1.0;
            baseCredits *= styleMultiplier;

            // Apply complexity multiplier
            const complexityMultiplier = this.complexityMultipliers[complexity] || 1.0;
            baseCredits *= complexityMultiplier;

            // Round up to nearest whole credit
            const totalCredits = Math.ceil(baseCredits);

            return {
                success: true,
                creditsNeeded: totalCredits,
                breakdown: {
                    baseCredits: Math.ceil(wordCount / plan.wordsPerCredit),
                    styleMultiplier: styleMultiplier,
                    complexityMultiplier: complexityMultiplier,
                    finalCredits: totalCredits
                },
                planInfo: {
                    plan: userPlan,
                    maxWordCount: plan.maxWordCount,
                    wordsPerCredit: plan.wordsPerCredit,
                    initialCredits: plan.initialCredits,
                    monthlyCredits: plan.monthlyCredits
                }
            };
        } catch (error) {
            console.error('Credit calculation error:', error);
            return {
                success: false,
                error: 'Failed to calculate credits'
            };
        }
    }

    /**
     * Check if user has sufficient credits and hasn't exceeded limits
     * @param {Object} user - User object with credits and plan info
     * @param {number} creditsNeeded - Credits required for operation
     * @param {number} wordCount - Word count for the request
     * @returns {Object} Validation result
     */
    async validateUserLimits(user, creditsNeeded, wordCount, db) {
        try {
            // Check credit balance only (no daily/monthly limits since system is purely credit-based)
            if (user.credits < creditsNeeded) {
                return {
                    success: false,
                    error: 'Insufficient credits',
                    creditsNeeded: creditsNeeded,
                    creditsAvailable: user.credits,
                    shortfall: creditsNeeded - user.credits
                };
            }

            return {
                success: true,
                message: 'User limits validated successfully',
                remainingCredits: user.credits - creditsNeeded
            };
        } catch (error) {
            console.error('User limit validation error:', error);
            return {
                success: false,
                error: 'Failed to validate user limits'
            };
        }
    }

    /**
     * Get user's daily word usage
     */
    async getUserDailyUsage(userId, date, db) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT COALESCE(SUM(word_count), 0) as daily_usage 
                FROM assignments 
                WHERE user_id = ? AND DATE(created_at) = ?
            `;
            
            db.get(query, [userId, date], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row.daily_usage || 0);
                }
            });
        });
    }

    /**
     * Get user's monthly word usage
     */
    async getUserMonthlyUsage(userId, month, db) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT COALESCE(SUM(word_count), 0) as monthly_usage 
                FROM assignments 
                WHERE user_id = ? AND strftime('%Y-%m', created_at) = ?
            `;
            
            db.get(query, [userId, month], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row.monthly_usage || 0);
                }
            });
        });
    }

    /**
     * Process credit deduction and usage tracking
     * @param {number} userId - User ID
     * @param {number} creditsToDeduct - Credits to deduct
     * @param {number} wordCount - Word count for tracking
     * @param {Object} db - Database connection
     * @returns {Promise<Object>} Processing result
     */
    async processCreditsDeduction(userId, creditsToDeduct, wordCount, db) {
        return new Promise((resolve, reject) => {
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                
                // Update user credits
                db.run(
                    'UPDATE users SET credits = credits - ? WHERE id = ?',
                    [creditsToDeduct, userId],
                    function(err) {
                        if (err) {
                            db.run('ROLLBACK');
                            reject(new Error('Failed to deduct credits'));
                            return;
                        }

                        // Insert usage record for tracking
                        db.run(
                            `INSERT INTO user_usage_tracking 
                             (user_id, word_count, credits_used, created_at) 
                             VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
                            [userId, wordCount, creditsToDeduct],
                            function(insertErr) {
                                if (insertErr) {
                                    // Log error but don't fail the transaction
                                    console.warn('Failed to insert usage tracking:', insertErr);
                                }
                                
                                db.run('COMMIT');
                                resolve({
                                    success: true,
                                    creditsDeducted: creditsToDeduct,
                                    wordCountTracked: wordCount
                                });
                            }
                        );
                    }
                );
            });
        });
    }

    /**
     * Get plan features for a user
     */
    getPlanFeatures(userPlan = 'free') {
        const plan = this.planLimits[userPlan] || this.planLimits.free;
        return plan.features;
    }

    /**
     * Check if user has access to a specific feature
     */
    hasFeatureAccess(userPlan, feature) {
        const features = this.getPlanFeatures(userPlan);
        return features.includes(feature);
    }

    /**
     * Get plan information for display
     */
    getPlanInfo(userPlan = 'free') {
        const plan = this.planLimits[userPlan] || this.planLimits.free;
        return {
            planName: userPlan,
            maxWordCount: plan.maxWordCount,
            dailyLimit: plan.dailyLimit,
            monthlyLimit: plan.monthlyLimit,
            creditsPerWord: plan.creditsPerWord,
            features: plan.features
        };
    }
}

module.exports = new CreditSystem();