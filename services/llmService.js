const axios = require('axios');
const { logger } = require('../utils/logger');

/**
 * LLM Service for AI Content Generation
 * Handles communication with language models for content creation
 */

class LLMService {
    constructor() {
        // Gemini Configuration
        this.geminiApiKey = process.env.GEMINI_API_KEY;
        this.isGeminiConfigured = this.geminiApiKey && this.geminiApiKey !== 'your-gemini-api-key-here';
        
        // Service is configured if Gemini is available
        this.isConfigured = this.isGeminiConfigured;
        this.maxRetries = 3;
        this.retryDelay = 1000; // 1 second
        this.fallbackEnabled = true;
        this.circuitBreakerThreshold = 5; // Number of failures before circuit opens
        this.circuitBreakerTimeout = 300000; // 5 minutes
        this.failureCount = 0;
        this.lastFailureTime = null;
        this.circuitOpen = false;
    }

    /**
     * Generate content using LLM with error handling and fallbacks
     * @param {string} prompt - The content prompt
     * @param {string} style - Writing style
     * @param {string} tone - Writing tone
     * @param {number} wordCount - Target word count
     * @param {string} qualityTier - Quality tier ('standard' or 'premium')
     * @returns {Promise<Object>} Generated content with metadata
     */
    async generateContent(prompt, style = 'Academic', tone = 'Formal', wordCount = 500, qualityTier = 'standard') {
        // Check if any LLM service is configured
        if (!this.isConfigured) {
            throw new Error('AI content generation service is not configured. Please contact support to enable this feature.');
        }
        
        const startTime = Date.now();
        let attempt = 0;
        let lastError = null;

        // Check circuit breaker
        if (this._isCircuitOpen()) {
            logger.warn('Circuit breaker is open, using fallback immediately', {
                service: 'LLMService',
                method: 'generateContent',
                failureCount: this.failureCount,
                wordCount
            });
            return this._generateFallbackContent(prompt, style, tone, wordCount, 'circuit_breaker');
        }

        // Try primary LLM service with retries
        while (attempt < this.maxRetries) {
            attempt++;
            
            try {
                const result = await this._attemptLLMGeneration(prompt, style, tone, wordCount, qualityTier);
                
                // Success - reset failure count
                this._recordSuccess();
                
                return {
                    content: result,
                    source: qualityTier === 'premium' ? 'gemini-pro' : 'gemini-flash',
                    attempt: attempt,
                    generationTime: Date.now() - startTime,
                    fallbackUsed: false,
                    qualityTier: qualityTier
                };

            } catch (error) {
                lastError = error;
                logger.error('LLM generation attempt failed', {
                    service: 'LLMService',
                    method: 'generateContent',
                    attempt,
                    maxRetries: this.maxRetries,
                    error: error.message,
                    wordCount
                });
                
                // Record failure
                this._recordFailure();
                
                // Check if we should retry
                if (attempt < this.maxRetries && this._shouldRetry(error)) {
                    const delay = this._calculateRetryDelay(attempt);
                    logger.info('Retrying LLM generation', {
                        service: 'LLMService',
                        attempt,
                        delayMs: delay
                    });
                    await this._sleep(delay);
                    continue;
                }
                
                break;
            }
        }

        // All retries failed, use fallback
        logger.warn('All LLM generation attempts failed, using fallback', {
            service: 'LLMService',
            maxRetries: this.maxRetries,
            finalError: lastError?.message
        });
        return this._generateFallbackContent(prompt, style, tone, wordCount, 'llm_failure', lastError);
    }

    /**
     * Attempt LLM generation (single try)
     */
    async _attemptLLMGeneration(prompt, style, tone, wordCount, qualityTier = 'standard') {
        // Use Gemini 2.5 Flash for standard tier, Gemini 2.5 Pro for premium
        if (!this.geminiApiKey) {
            throw new Error('Gemini API key not configured');
        }

        const { GoogleGenerativeAI } = require('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(this.geminiApiKey);
        
        // Select model based on quality tier
        const modelName = qualityTier === 'premium' ? 'gemini-2.5-pro' : 'gemini-2.5-flash';
        const model = genAI.getGenerativeModel({ model: modelName });
        
        const systemPrompt = this.buildSystemPrompt(style, tone, wordCount);
        const userPrompt = this.buildUserPrompt(prompt, wordCount);
        
        // For standard tier: direct generation without detection
        const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;
        
        const result = await model.generateContent(fullPrompt);
        const response = await result.response;
        return response.text();
    }

    /**
     * Generate fallback content when LLM fails
     */
    _generateFallbackContent(prompt, style, tone, wordCount, reason, error = null) {
        logger.info('Generating fallback content', {
            service: 'LLMService',
            reason,
            error: error?.message,
            wordCount
        });
        
        const fallbackContent = this.generateMockContent(prompt, style, tone, wordCount);
        
        return {
            content: fallbackContent,
            source: 'fallback',
            reason: reason,
            error: error?.message,
            fallbackUsed: true,
            generationTime: 0
        };
    }

    /**
     * Check if circuit breaker is open
     */
    _isCircuitOpen() {
        if (!this.circuitOpen) return false;
        
        // Check if timeout has passed
        if (Date.now() - this.lastFailureTime > this.circuitBreakerTimeout) {
            logger.info('Circuit breaker timeout passed, attempting to close circuit', {
                service: 'LLMService',
                timeoutMs: this.circuitBreakerTimeout
            });
            this.circuitOpen = false;
            this.failureCount = 0;
            return false;
        }
        
        return true;
    }

    /**
     * Record successful generation
     */
    _recordSuccess() {
        this.failureCount = 0;
        this.circuitOpen = false;
    }

    /**
     * Record failed generation
     */
    _recordFailure() {
        this.failureCount++;
        this.lastFailureTime = Date.now();
        
        if (this.failureCount >= this.circuitBreakerThreshold) {
            logger.warn('Circuit breaker opened due to failures', {
                service: 'LLMService',
                failureCount: this.failureCount,
                threshold: this.circuitBreakerThreshold
            });
            this.circuitOpen = true;
        }
    }

    /**
     * Determine if error is retryable
     */
    _shouldRetry(error) {
        const retryableErrors = [
            'timeout',
            'network',
            'ECONNRESET',
            'ENOTFOUND',
            'ECONNREFUSED',
            '429', // Rate limit
            '500', // Server error
            '502', // Bad gateway
            '503', // Service unavailable
            '504'  // Gateway timeout
        ];
        
        const errorMessage = error.message.toLowerCase();
        return retryableErrors.some(retryableError => 
            errorMessage.includes(retryableError)
        );
    }

    /**
     * Calculate retry delay with exponential backoff
     */
    _calculateRetryDelay(attempt) {
        const baseDelay = this.retryDelay;
        const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
        const jitter = Math.random() * 1000; // Add jitter to prevent thundering herd
        return Math.min(exponentialDelay + jitter, 30000); // Max 30 seconds
    }

    /**
     * Sleep utility
     */
    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Build system prompt based on style and tone
     */
    buildSystemPrompt(style, tone, wordCount) {
        const styleInstructions = {
            'Academic': 'Write in a scholarly, research-based manner with proper citations and formal language. Use evidence-based arguments and maintain objectivity.',
            'Business': 'Write in a professional business context with clear, actionable insights. Focus on practical applications and strategic thinking.',
            'Creative': 'Write with creativity and engaging narrative elements. Use vivid descriptions and compelling storytelling techniques.'
        };

        const toneInstructions = {
            'Formal': 'Maintain a formal, professional tone throughout.',
            'Casual': 'Use a conversational, approachable tone while remaining informative.',
            'Persuasive': 'Use persuasive language to convince and engage the reader.'
        };

        return `You are an expert writer specializing in ${style.toLowerCase()} writing. ${styleInstructions[style] || styleInstructions['Academic']} ${toneInstructions[tone] || toneInstructions['Formal']} 

Target word count: approximately ${wordCount} words. Structure your response with clear sections including an introduction, main body with multiple paragraphs, and a conclusion. Ensure the content is well-researched, original, and meets academic standards.`;
    }

    /**
     * Build user prompt with specific requirements
     */
    buildUserPrompt(prompt, wordCount) {
        return `Please write a comprehensive piece on the following topic:

${prompt}

Requirements:
- Target length: ${wordCount} words
- Include proper structure with introduction, body, and conclusion
- Provide detailed analysis and insights
- Ensure originality and quality
- Use appropriate formatting with headers and subheaders`;
    }

    /**
     * Get temperature setting based on writing style
     */
    getTemperatureForStyle(style) {
        const temperatures = {
            'Academic': 0.3,  // More focused and precise
            'Business': 0.5,  // Balanced creativity and precision
            'Creative': 0.8   // More creative and varied
        };
        return temperatures[style] || 0.5;
    }

    /**
     * Generate fallback content when LLM service is unavailable
     */
    generateMockContent(prompt, style, tone, wordCount) {
        // Return null to indicate service unavailable instead of hardcoded content
        throw new Error('LLM service is currently unavailable. Please try again later or contact support if the issue persists.');
    }

    /**
     * Get appropriate words per sentence for style
     */
    _getWordsPerSentence(style) {
        const wordsPerSentence = {
            Academic: 18,
            Business: 16,
            Creative: 14,
            Casual: 12
        };
        return wordsPerSentence[style] || 15;
    }

    // Helper functions removed - should be replaced with actual LLM service integration

    /**
     * Polish existing content sections to match new requirements
     * @param {Array} sections - Content sections to polish
     * @param {string} prompt - New prompt requirements
     * @param {string} style - Writing style
     * @param {string} tone - Writing tone
     * @param {number} wordCount - Target word count
     * @returns {Promise<Object>} Polished content with metadata
     */
    async polishExistingContent(sections, prompt, style = 'Academic', tone = 'Formal', wordCount = 500, qualityTier = 'standard') {
        const startTime = Date.now();
        
        try {
            // Combine sections into a single content string
            const baseContent = sections.map(section => section.content).join('\n\n');
            
            const polishPrompt = `
Polish and adapt the following content to match the new requirements:

Original Content:
${baseContent}

New Requirements:
- Prompt: ${prompt}
- Target word count: ${wordCount} words
- Style: ${style}
- Tone: ${tone}

Instructions:
1. Maintain the core ideas but adapt to the new prompt
2. Adjust the content to match the specified style and tone
3. Ensure the content flows naturally and coherently
4. Target exactly ${wordCount} words
5. Make the content original and avoid AI detection patterns
6. Preserve key information while improving readability

Polished Content:`;
            
            // Try to use LLM for polishing, fallback to enhanced mock if needed
            let polishedContent;
            
            try {
                polishedContent = await this._attemptLLMGeneration(polishPrompt, style, tone, wordCount, qualityTier);
            } catch (error) {
                logger.warn('LLM polishing failed, using enhanced fallback', {
                    service: 'LLMService',
                    method: 'polishExistingContent',
                    error: error.message,
                    wordCount
                });
                polishedContent = this._generatePolishedFallback(baseContent, prompt, style, tone, wordCount);
            }
            
            return {
                content: polishedContent,
                source: 'polished',
                generationTime: Date.now() - startTime,
                fallbackUsed: false,
                originalSections: sections.length
            };
            
        } catch (error) {
            logger.error('Error polishing existing content', {
                service: 'LLMService',
                method: 'polishExistingContent',
                error: error.message,
                wordCount
            });
            
            // Fallback to enhanced content generation
            return this._generateFallbackContent(prompt, style, tone, wordCount, 'polishing_error', error);
        }
    }
    
    /**
     * Generate enhanced fallback for polished content
     */
    _generatePolishedFallback(baseContent, prompt, style, tone, wordCount) {
        // When LLM service is unavailable, throw an error instead of returning hardcoded content
        throw new Error('Content polishing service is currently unavailable. Please try again later or contact support if the issue persists.');
    }

    /**
     * Get service health status
     */
    getHealthStatus() {
        return {
            circuitOpen: this.circuitOpen,
            failureCount: this.failureCount,
            lastFailureTime: this.lastFailureTime,
            apiKeyConfigured: !!this.apiKey,
            fallbackEnabled: this.fallbackEnabled
        };
    }

    /**
     * Extract a title from the prompt
     */
    extractTitle(prompt) {
        const words = prompt.split(' ').slice(0, 8);
        return words.join(' ').replace(/[^a-zA-Z0-9\s]/g, '');
    }
}

module.exports = new LLMService();