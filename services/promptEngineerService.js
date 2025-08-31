const { GoogleGenerativeAI } = require('@google/generative-ai');
const admin = require('firebase-admin');
const AtomicCreditSystem = require('./atomicCreditSystem');
const PlanValidator = require('./planValidator');

class PromptEngineerService {
    constructor() {
        // TODO: Add your Gemini API key here - Get from Google AI Studio (https://makersuite.google.com/app/apikey)
        // Required for Gemini Flash Lite (1.5-flash) model used in prompt engineering
        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY); // Add your Gemini API key
        this.model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        this.db = admin.firestore();
        this.atomicCredit = new AtomicCreditSystem();
        this.planValidator = new PlanValidator();
        
        // Daily limits for different user types
        this.DAILY_LIMITS = {
            free: {
                inputWords: 1000,
                outputWords: 500
            },
            paid: {
                inputWords: 10000,
                outputWords: 5000
            }
        };
        
        // Credit ratio for users exceeding daily limits (1:100 credit to word)
        this.CREDIT_TO_WORD_RATIO = 100;
    }

    /**
     * Calculate excess words that exceed daily limits
     */
    async calculateExcessWords(userId, inputWords, outputWords) {
        const dailyUsage = await this.getDailyUsage(userId);
        const planValidation = await this.planValidator.validateUserPlan(userId);
        const userPlan = planValidation.isValid ? (planValidation.plan || 'free') : 'free';
        const limits = this.DAILY_LIMITS[userPlan !== 'free' ? 'paid' : 'free'];
        
        let excessWords = 0;
        
        // Calculate excess input words
        const newInputTotal = dailyUsage.inputWords + inputWords;
        if (newInputTotal > limits.inputWords) {
            excessWords += newInputTotal - limits.inputWords;
        }
        
        // Calculate excess output words
        const newOutputTotal = dailyUsage.outputWords + outputWords;
        if (newOutputTotal > limits.outputWords) {
            excessWords += newOutputTotal - limits.outputWords;
        }
        
        return excessWords;
    }

    /**
     * Calculate word count for a given text
     */
    calculateWordCount(text) {
        if (!text || typeof text !== 'string') return 0;
        return text.trim().split(/\s+/).filter(word => word.length > 0).length;
    }

    /**
     * Analyze prompt quality and provide scoring
     */
    async analyzePromptQuality(prompt) {
        try {
            const analysisPrompt = `
Analyze the following prompt and provide a detailed quality assessment. Return your response in JSON format with the following structure:

{
  "clarity": {
    "score": 0-100,
    "feedback": "specific feedback on clarity"
  },
  "specificity": {
    "score": 0-100,
    "feedback": "specific feedback on specificity"
  },
  "context": {
    "score": 0-100,
    "feedback": "specific feedback on context"
  },
  "overall": {
    "score": 0-100,
    "feedback": "overall assessment and key improvements"
  },
  "strengths": ["list of strengths"],
  "improvements": ["list of specific improvements"]
}

Prompt to analyze:
"${prompt}"

Provide honest, constructive feedback focusing on how well the prompt communicates intent, provides necessary context, and would generate useful responses.`;

            const result = await this.model.generateContent(analysisPrompt);
            const response = result.response;
            const text = response.text();
            
            // Parse JSON response
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
            
            // Fallback if JSON parsing fails
            return {
                clarity: { score: 50, feedback: "Unable to analyze clarity" },
                specificity: { score: 50, feedback: "Unable to analyze specificity" },
                context: { score: 50, feedback: "Unable to analyze context" },
                overall: { score: 50, feedback: "Analysis failed, please try again" },
                strengths: [],
                improvements: ["Please try submitting your prompt again"]
            };
        } catch (error) {
            console.error('Error analyzing prompt quality:', error);
            throw new Error('Failed to analyze prompt quality');
        }
    }

    /**
     * Check daily usage for a user
     */
    async getDailyUsage(userId) {
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
        const usageRef = this.db.collection('dailyUsage').doc(`${userId}_${today}`);
        const usageDoc = await usageRef.get();
        
        if (!usageDoc.exists) {
            return {
                inputWords: 0,
                outputWords: 0,
                date: today
            };
        }
        
        return usageDoc.data();
    }
    
    /**
     * Update daily usage for a user
     */
    async updateDailyUsage(userId, inputWords, outputWords) {
        const today = new Date().toISOString().split('T')[0];
        const usageRef = this.db.collection('dailyUsage').doc(`${userId}_${today}`);
        
        await usageRef.set({
            userId,
            date: today,
            inputWords: admin.firestore.FieldValue.increment(inputWords),
            outputWords: admin.firestore.FieldValue.increment(outputWords),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    }
    
    /**
     * Check if user can perform operation within daily limits
     */
    async checkDailyLimits(userId, inputWords, estimatedOutputWords) {
        const planValidation = await this.planValidator.validateUserPlan(userId);
        const userPlan = planValidation.isValid ? (planValidation.plan || 'free') : 'free';
        const isPaid = userPlan !== 'free';
        
        const dailyUsage = await this.getDailyUsage(userId);
        const limits = this.DAILY_LIMITS[isPaid ? 'paid' : 'free'];
        
        const newInputTotal = dailyUsage.inputWords + inputWords;
        const newOutputTotal = dailyUsage.outputWords + estimatedOutputWords;
        
        const result = {
            canProceed: true,
            requiresCredits: false,
            creditsNeeded: 0,
            limitExceeded: false,
            userPlan,
            dailyUsage,
            limits,
            message: ''
        };
        
        // Check input limits
        if (newInputTotal > limits.inputWords) {
            if (!isPaid) {
                result.canProceed = false;
                result.limitExceeded = true;
                result.message = `Daily input limit exceeded. Free users can input up to ${limits.inputWords} words per day. Please upgrade to continue.`;
                return result;
            } else {
                // Paid user exceeding limit - calculate credits needed
                const excessInputWords = newInputTotal - limits.inputWords;
                result.requiresCredits = true;
                result.creditsNeeded += Math.ceil(excessInputWords / this.CREDIT_TO_WORD_RATIO);
            }
        }
        
        // Check output limits
        if (newOutputTotal > limits.outputWords) {
            if (!isPaid) {
                result.canProceed = false;
                result.limitExceeded = true;
                result.message = `Daily output limit exceeded. Free users can generate up to ${limits.outputWords} words per day. Please upgrade to continue.`;
                return result;
            } else {
                // Paid user exceeding limit - calculate credits needed
                const excessOutputWords = newOutputTotal - limits.outputWords;
                result.requiresCredits = true;
                result.creditsNeeded += Math.ceil(excessOutputWords / this.CREDIT_TO_WORD_RATIO);
            }
        }
        
        return result;
    }

    /**
     * Optimize a prompt using Gemini Flash Lite with daily limits
     */
    async optimizePrompt(originalPrompt, category = 'general', userId) {
        try {
            const inputWords = this.calculateWordCount(originalPrompt);
            const estimatedOutputWords = Math.min(inputWords * 1.5, 1000); // Estimate output length
            
            // Check daily limits
            const limitCheck = await this.checkDailyLimits(userId, inputWords, estimatedOutputWords);
            
            if (!limitCheck.canProceed) {
                return {
                    success: false,
                    error: 'LIMIT_EXCEEDED',
                    message: limitCheck.message,
                    requiresUpgrade: !limitCheck.userPlan || limitCheck.userPlan === 'free'
                };
            }
            
            // Handle credit deduction for paid users exceeding limits
            let creditTransaction = null;
            if (limitCheck.requiresCredits && limitCheck.creditsNeeded > 0) {
                // Calculate total words that exceed the daily limit
                const excessWords = this.calculateExcessWords(userId, inputWords, estimatedOutputWords);
                creditTransaction = await this.atomicCredit.deductCreditsAtomic(
                    userId,
                    excessWords,
                    limitCheck.userPlan,
                    'prompt'
                );
                
                if (!creditTransaction.success) {
                    return {
                        success: false,
                        error: 'INSUFFICIENT_CREDITS',
                        message: creditTransaction.message
                    };
                }
            }

            try {
                const optimizationPrompt = `
You are an expert prompt engineer. Your task is to optimize the following prompt to make it more effective, clear, and likely to produce better results.

Category: ${category}
Original Prompt: "${originalPrompt}"

Please provide an optimized version that:
1. Maintains the original intent
2. Adds necessary context and specificity
3. Uses clear, actionable language
4. Follows best practices for the ${category} category
5. Is structured for optimal AI response

Return your response in JSON format:
{
  "optimized_prompt": "your optimized version here",
  "improvements_made": ["list of specific improvements"],
  "explanation": "brief explanation of why these changes improve the prompt",
  "category_tips": "specific tips for ${category} prompts"
}

Focus on practical improvements that will genuinely enhance the prompt's effectiveness.`;

                const result = await this.model.generateContent(optimizationPrompt);
                const response = result.response;
                const text = response.text();
                
                // Calculate actual output words
                const actualOutputWords = this.calculateWordCount(text);
                
                // Parse JSON response
                const jsonMatch = text.match(/\{[\s\S]*\}/);
                let optimizationResult;
                
                if (jsonMatch) {
                    optimizationResult = JSON.parse(jsonMatch[0]);
                } else {
                    // Fallback if JSON parsing fails
                    optimizationResult = {
                        optimized_prompt: text,
                        improvements_made: ["General optimization applied"],
                        explanation: "Prompt has been optimized for better clarity and effectiveness",
                        category_tips: `Consider ${category}-specific best practices`
                    };
                }

                // Update daily usage
                await this.updateDailyUsage(userId, inputWords, actualOutputWords);

                // Store the optimization result
                await this.storeOptimizationResult(userId, {
                    originalPrompt,
                    optimizedPrompt: optimizationResult.optimized_prompt,
                    category,
                    improvements: optimizationResult.improvements_made,
                    explanation: optimizationResult.explanation,
                    categoryTips: optimizationResult.category_tips,
                    inputWords,
                    outputWords: actualOutputWords,
                    creditsUsed: limitCheck.creditsNeeded || 0,
                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                });

                return {
                    success: true,
                    optimizedPrompt: optimizationResult.optimized_prompt,
                    improvements: optimizationResult.improvements_made,
                    explanation: optimizationResult.explanation,
                    categoryTips: optimizationResult.category_tips,
                    inputWords,
                    outputWords: actualOutputWords,
                    creditsUsed: limitCheck.creditsNeeded || 0,
                    dailyUsage: await this.getDailyUsage(userId)
                };

            } catch (optimizationError) {
                // Rollback credits on failure
                if (creditTransaction) {
                    await this.atomicCredit.rollbackTransaction(creditTransaction.transactionId);
                }
                throw optimizationError;
            }

        } catch (error) {
            console.error('Error optimizing prompt:', error);
            throw new Error(error.message || 'Failed to optimize prompt');
        }
    }

    /**
     * Analyze prompt and provide quality metrics (free version - no daily limits)
     */
    async analyzePromptFree(prompt) {
        try {
            const analysis = await this.analyzePromptQuality(prompt);
            return {
                success: true,
                analysis,
                isFree: true
            };
        } catch (error) {
            console.error('Error in free prompt analysis:', error);
            throw new Error('Failed to analyze prompt');
        }
    }

    /**
     * Analyze prompt and provide quality metrics (with daily limits)
     */
    async analyzePromptWithCredits(prompt, userId) {
        try {
            const inputWords = this.calculateWordCount(prompt);
            const estimatedOutputWords = 200; // Analysis output is typically shorter
            
            // Check daily limits
            const limitCheck = await this.checkDailyLimits(userId, inputWords, estimatedOutputWords);
            
            if (!limitCheck.canProceed) {
                return {
                    success: false,
                    error: 'LIMIT_EXCEEDED',
                    message: limitCheck.message,
                    requiresUpgrade: !limitCheck.userPlan || limitCheck.userPlan === 'free'
                };
            }
            
            // Handle credit deduction for paid users exceeding limits
            let creditTransaction = null;
            if (limitCheck.requiresCredits && limitCheck.creditsNeeded > 0) {
                // Calculate total words that exceed the daily limit
                const excessWords = await this.calculateExcessWords(userId, inputWords, estimatedOutputWords);
                creditTransaction = await this.atomicCredit.deductCreditsAtomic(
                    userId,
                    excessWords,
                    limitCheck.userPlan,
                    'prompt'
                );
                
                if (!creditTransaction.success) {
                    return {
                        success: false,
                        error: 'INSUFFICIENT_CREDITS',
                        message: creditTransaction.message
                    };
                }
            }

            try {
                const analysis = await this.analyzePromptQuality(prompt);
                const actualOutputWords = 200; // Analysis output is typically consistent

                // Update daily usage
                await this.updateDailyUsage(userId, inputWords, actualOutputWords);

                // Store the analysis result
                await this.storeAnalysisResult(userId, {
                    prompt,
                    analysis,
                    inputWords,
                    outputWords: actualOutputWords,
                    creditsUsed: limitCheck.creditsNeeded || 0,
                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                });

                return {
                    success: true,
                    analysis,
                    inputWords,
                    outputWords: actualOutputWords,
                    creditsUsed: limitCheck.creditsNeeded || 0,
                    dailyUsage: await this.getDailyUsage(userId)
                };

            } catch (analysisError) {
                // Rollback credits on failure
                if (creditTransaction) {
                    await this.atomicCredit.rollbackTransaction(creditTransaction.transactionId);
                }
                throw analysisError;
            }

        } catch (error) {
            console.error('Error analyzing prompt with credits:', error);
            throw new Error(error.message || 'Failed to analyze prompt');
        }
    }
    
    /**
     * Get daily usage statistics for a user
     */
    async getDailyUsageStats(userId) {
        try {
            const planValidation = await this.planValidator.validateUserPlan(userId);
            const userPlan = planValidation.isValid ? (planValidation.plan || 'free') : 'free';
            const isPaid = userPlan !== 'free';
            
            const dailyUsage = await this.getDailyUsage(userId);
            const limits = this.DAILY_LIMITS[isPaid ? 'paid' : 'free'];
            
            return {
                success: true,
                userPlan,
                dailyUsage,
                limits,
                remainingInput: Math.max(0, limits.inputWords - dailyUsage.inputWords),
                remainingOutput: Math.max(0, limits.outputWords - dailyUsage.outputWords),
                inputPercentage: Math.min(100, (dailyUsage.inputWords / limits.inputWords) * 100),
                outputPercentage: Math.min(100, (dailyUsage.outputWords / limits.outputWords) * 100)
            };
        } catch (error) {
            console.error('Error getting daily usage stats:', error);
            throw new Error('Failed to get usage statistics');
        }
    }

    /**
     * Store optimization result in database
     */
    async storeOptimizationResult(userId, data) {
        try {
            await this.db.collection('promptOptimizations').add({
                userId,
                ...data
            });
        } catch (error) {
            console.error('Error storing optimization result:', error);
            throw new Error('Failed to store optimization result');
        }
    }

    /**
     * Store analysis result in database
     */
    async storeAnalysisResult(userId, data) {
        try {
            await this.db.collection('promptAnalyses').add({
                userId,
                ...data
            });
        } catch (error) {
            console.error('Error storing analysis result:', error);
            throw new Error('Failed to store analysis result');
        }
    }

    /**
     * Get user's prompt history
     */
    async getPromptHistory(userId, limit = 20) {
        try {
            const optimizations = await this.db.collection('promptOptimizations')
                .where('userId', '==', userId)
                .orderBy('timestamp', 'desc')
                .limit(limit)
                .get();

            const analyses = await this.db.collection('promptAnalyses')
                .where('userId', '==', userId)
                .orderBy('timestamp', 'desc')
                .limit(limit)
                .get();

            const history = {
                optimizations: optimizations.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                })),
                analyses: analyses.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }))
            };

            return history;
        } catch (error) {
            console.error('Error getting prompt history:', error);
            throw new Error('Failed to retrieve prompt history');
        }
    }

    /**
     * Get quick templates for different categories
     */
    getQuickTemplates() {
        return {
            general: [
                "Please explain [topic] in simple terms, including [specific aspects you want covered].",
                "Create a step-by-step guide for [task], considering [constraints or requirements].",
                "Compare and contrast [item A] and [item B] focusing on [specific criteria]."
            ],
            academic: [
                "Analyze [academic topic] from the perspective of [theoretical framework], including relevant examples and citations.",
                "Develop a research question about [subject area] that addresses [specific gap or problem].",
                "Summarize the key findings of [research area] and their implications for [field of study]."
            ],
            creative: [
                "Write a [genre] story about [character/situation] that explores themes of [themes].",
                "Create a compelling character description for [type of character] in [setting/context].",
                "Generate creative ideas for [project type] that incorporate [specific elements or constraints]."
            ],
            technical: [
                "Explain how to implement [technical concept] in [programming language/framework], including code examples.",
                "Debug this [language] code: [code snippet] and explain the issue and solution.",
                "Design a system architecture for [application type] that handles [specific requirements]."
            ],
            business: [
                "Create a business strategy for [company/product] to address [market challenge or opportunity].",
                "Analyze the market potential for [product/service] in [target market or industry].",
                "Develop a marketing plan for [product/service] targeting [specific audience]."
            ]
        };
    }
}

module.exports = PromptEngineerService;