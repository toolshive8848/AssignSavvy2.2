const { GoogleGenerativeAI } = require('@google/generative-ai');
const admin = require('firebase-admin');
const AtomicCreditSystem = require('./atomicCreditSystem');
const PlanValidator = require('./planValidator');
const { logger } = require('../utils/logger');

class PromptEngineerService {
    constructor() {
        // TODO: Add your Gemini API key here - Get from Google AI Studio (https://makersuite.google.com/app/apikey)
        // Required for Gemini 2.5 Flash Lite model used in prompt engineering
        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY); // Add your Gemini API key
        this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
        
        // Initialize Firebase database with proper error handling
        try {
            this.db = admin.firestore();
        } catch (error) {
            logger.warn('Firebase not initialized, using mock database for prompt engineer service', {
                service: 'PromptEngineerService',
                method: 'constructor'
            });
            this.db = null;
        }
        
        this.atomicCredit = new AtomicCreditSystem();
        this.planValidator = new PlanValidator();
        
        // Credit ratios for prompt engineer tool
        this.CREDIT_RATIOS = {
            input: 20,  // 1 credit = 20 words for input
            output: 10  // 1 credit = 10 words for output
        };
    }

    /**
     * Calculate credits needed for input and output words
     */
    calculateCreditsNeeded(inputWords, outputWords) {
        const inputCredits = Math.ceil(inputWords / this.CREDIT_RATIOS.input);
        const outputCredits = Math.ceil(outputWords / this.CREDIT_RATIOS.output);
        return inputCredits + outputCredits;
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
            logger.error('Error analyzing prompt quality', {
                service: 'PromptEngineerService',
                method: 'analyzePromptQuality',
                error: error.message,
                stack: error.stack
            });
            throw new Error('Failed to analyze prompt quality');
        }
    }

    // Daily usage tracking methods removed - now using pure credit-based system
    
    /**
     * Check if user can perform operation and calculate credits (pure credit-based system)
     */
    async checkLimitsAndCredits(userId, inputWords, estimatedOutputWords) {
        const planValidation = await this.planValidator.validateUserPlan(userId);
        const userPlan = planValidation.isValid ? (planValidation.plan || 'free') : 'free';
        
        const result = {
            canProceed: true,
            creditsNeeded: 0,
            limitExceeded: false,
            userPlan,
            message: ''
        };
        
        // Calculate credits needed for all users (no daily limits)
        result.creditsNeeded = this.calculateCreditsNeeded(inputWords, estimatedOutputWords);
        
        return result;
    }

    /**
     * Optimize a prompt using Gemini Flash Lite with credit-based system
     */
    async optimizePrompt(originalPrompt, category = 'general', userId) {
        try {
            const inputWords = this.calculateWordCount(originalPrompt);
            const estimatedOutputWords = Math.min(inputWords * 1.5, 1000); // Estimate output length
            
            // Check limits and calculate credits
            const limitCheck = await this.checkLimitsAndCredits(userId, inputWords, estimatedOutputWords);
            
            if (!limitCheck.canProceed) {
                return {
                    success: false,
                    error: 'LIMIT_EXCEEDED',
                    message: limitCheck.message
                };
            }
            
            // Deduct credits for all users
            let creditTransaction = null;
            if (limitCheck.creditsNeeded > 0) {
                creditTransaction = await this.atomicCredit.deductCreditsAtomic(
                    userId,
                    limitCheck.creditsNeeded,
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

                // No daily usage tracking needed in credit-based system

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
            logger.error('Error optimizing prompt', {
                service: 'PromptEngineerService',
                method: 'optimizePrompt',
                userId,
                error: error.message,
                stack: error.stack
            });
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
            logger.error('Error in free prompt analysis', {
                service: 'PromptEngineerService',
                method: 'analyzePromptFree',
                error: error.message,
                stack: error.stack
            });
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
            
            // Check limits and calculate credits
            const limitCheck = await this.checkLimitsAndCredits(userId, inputWords, estimatedOutputWords);
            
            if (!limitCheck.canProceed) {
                return {
                    success: false,
                    error: 'LIMIT_EXCEEDED',
                    message: limitCheck.message
                };
            }
            
            // Deduct credits for all users
            let creditTransaction = null;
            if (limitCheck.creditsNeeded > 0) {
                creditTransaction = await this.atomicCredit.deductCreditsAtomic(
                    userId,
                    limitCheck.creditsNeeded,
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

                // No daily usage tracking needed in credit-based system

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
                    creditsUsed: limitCheck.creditsNeeded || 0
                };

            } catch (analysisError) {
                // Rollback credits on failure
                if (creditTransaction) {
                    await this.atomicCredit.rollbackTransaction(creditTransaction.transactionId);
                }
                throw analysisError;
            }

        } catch (error) {
            logger.error('Error analyzing prompt with credits', {
                service: 'PromptEngineerService',
                method: 'analyzePromptWithCredits',
                userId,
                error: error.message,
                stack: error.stack
            });
            throw new Error(error.message || 'Failed to analyze prompt');
        }
    }
    
    /**
     * Get user credit information (replaces daily usage stats)
     */
    async getUserCreditInfo(userId) {
        try {
            const planValidation = await this.planValidator.validateUserPlan(userId);
            const userPlan = planValidation.isValid ? (planValidation.plan || 'free') : 'free';
            
            let currentCredits = 0;
            
            // Get user's current credit balance from Firebase if available
            if (this.db) {
                try {
                    const userDoc = await this.db.collection('users').doc(userId).get();
                    const userData = userDoc.exists ? userDoc.data() : {};
                    currentCredits = userData.credits || 0;
                } catch (dbError) {
                    logger.warn('Database unavailable, using default credits', {
                        service: 'PromptEngineerService',
                        method: 'getUserCreditInfo',
                        userId
                    });
                    currentCredits = 100; // Default credits for mock mode
                }
            } else {
                currentCredits = 100; // Default credits for mock mode
            }
            
            return {
                success: true,
                userPlan,
                currentCredits,
                creditRatios: this.CREDIT_RATIOS
            };
        } catch (error) {
            logger.error('Error getting user credit info', {
                service: 'PromptEngineerService',
                method: 'getUserCreditInfo',
                userId,
                error: error.message,
                stack: error.stack
            });
            throw new Error('Failed to get credit information');
        }
    }

    /**
     * Store optimization result in database
     */
    async storeOptimizationResult(userId, data) {
        try {
            if (this.db) {
                await this.db.collection('promptOptimizations').add({
                    userId,
                    ...data
                });
            } else {
                logger.info('Mock mode: Would store optimization result', {
                    service: 'PromptEngineerService',
                    method: 'storeOptimizationResult',
                    userId
                });
            }
        } catch (error) {
            logger.error('Error storing optimization result', {
                service: 'PromptEngineerService',
                method: 'storeOptimizationResult',
                userId,
                error: error.message
            });
            // Don't throw error in mock mode
            if (this.db) {
                throw new Error('Failed to store optimization result');
            }
        }
    }

    /**
     * Store analysis result in database
     */
    async storeAnalysisResult(userId, data) {
        try {
            if (this.db) {
                await this.db.collection('promptAnalyses').add({
                    userId,
                    ...data
                });
            } else {
                logger.info('Mock mode: Would store analysis result', {
                    service: 'PromptEngineerService',
                    method: 'storeAnalysisResult',
                    userId
                });
            }
        } catch (error) {
            logger.error('Error storing analysis result', {
                service: 'PromptEngineerService',
                method: 'storeAnalysisResult',
                userId,
                error: error.message
            });
            // Don't throw error in mock mode
            if (this.db) {
                throw new Error('Failed to store analysis result');
            }
        }
    }

    /**
     * Get user's prompt history
     */
    async getPromptHistory(userId, limit = 20) {
        try {
            if (this.db) {
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
            } else {
                // Return empty history in mock mode
                return {
                    optimizations: [],
                    analyses: []
                };
            }
        } catch (error) {
            logger.error('Error getting prompt history', {
                service: 'PromptEngineerService',
                method: 'getPromptHistory',
                userId,
                error: error.message
            });
            // Return empty history instead of throwing in mock mode
            if (!this.db) {
                return {
                    optimizations: [],
                    analyses: []
                };
            }
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