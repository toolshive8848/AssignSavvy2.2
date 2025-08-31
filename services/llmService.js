const axios = require('axios');

/**
 * LLM Service for AI Content Generation
 * Handles communication with language models for content creation
 */

class LLMService {
    constructor() {
        // TODO: Add your Gemini API key here - Get from Google AI Studio (https://makersuite.google.com/app/apikey)
        // For Gemini 2.5 Flash and Gemini 2.5 Pro models
        this.geminiApiKey = process.env.GEMINI_API_KEY; // Add your Gemini API key
        
        // Legacy OpenAI support (can be removed if switching fully to Gemini)
        this.apiKey = process.env.OPENAI_API_KEY;
        this.baseURL = 'https://api.openai.com/v1';
        this.model = 'gpt-3.5-turbo';
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
     * @returns {Promise<Object>} Generated content with metadata
     */
    async generateContent(prompt, style = 'Academic', tone = 'Formal', wordCount = 500) {
        const startTime = Date.now();
        let attempt = 0;
        let lastError = null;

        // Check circuit breaker
        if (this._isCircuitOpen()) {
            console.warn('Circuit breaker is open, using fallback immediately');
            return this._generateFallbackContent(prompt, style, tone, wordCount, 'circuit_breaker');
        }

        // Try primary LLM service with retries
        while (attempt < this.maxRetries) {
            attempt++;
            
            try {
                const result = await this._attemptLLMGeneration(prompt, style, tone, wordCount);
                
                // Success - reset failure count
                this._recordSuccess();
                
                return {
                    content: result,
                    source: 'llm',
                    attempt: attempt,
                    generationTime: Date.now() - startTime,
                    fallbackUsed: false
                };

            } catch (error) {
                lastError = error;
                console.error(`LLM generation attempt ${attempt} failed:`, error.message);
                
                // Record failure
                this._recordFailure();
                
                // Check if we should retry
                if (attempt < this.maxRetries && this._shouldRetry(error)) {
                    const delay = this._calculateRetryDelay(attempt);
                    console.log(`Retrying in ${delay}ms...`);
                    await this._sleep(delay);
                    continue;
                }
                
                break;
            }
        }

        // All retries failed, use fallback
        console.warn(`All ${this.maxRetries} attempts failed, using fallback`);
        return this._generateFallbackContent(prompt, style, tone, wordCount, 'llm_failure', lastError);
    }

    /**
     * Attempt LLM generation (single try)
     */
    async _attemptLLMGeneration(prompt, style, tone, wordCount) {
        if (!this.apiKey) {
            throw new Error('OpenAI API key not configured');
        }

        const systemPrompt = this.buildSystemPrompt(style, tone, wordCount);
        const userPrompt = this.buildUserPrompt(prompt, wordCount);
        const temperature = this.getTemperatureForStyle(style);

        const response = await axios.post(
            `${this.baseURL}/chat/completions`,
            {
                model: this.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                max_tokens: Math.min(4000, Math.ceil(wordCount * 1.5)),
                temperature: temperature,
                presence_penalty: 0.1,
                frequency_penalty: 0.1
            },
            {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 60000 // 60 second timeout
            }
        );

        if (response.data && response.data.choices && response.data.choices[0]) {
            return response.data.choices[0].message.content.trim();
        } else {
            throw new Error('Invalid response from LLM service');
        }
    }

    /**
     * Generate fallback content when LLM fails
     */
    _generateFallbackContent(prompt, style, tone, wordCount, reason, error = null) {
        console.log(`Generating fallback content due to: ${reason}`);
        
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
            console.log('Circuit breaker timeout passed, attempting to close circuit');
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
            console.warn(`Circuit breaker opened after ${this.failureCount} failures`);
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
     * Generate mock content for testing/fallback with enhanced quality
     */
    generateMockContent(prompt, style, tone, wordCount) {
        const styleTemplates = {
            Academic: {
                introduction: "This comprehensive analysis examines",
                body_starters: [
                    "Research indicates that",
                    "Studies have demonstrated",
                    "Evidence suggests that",
                    "Scholarly investigation reveals",
                    "Academic literature supports"
                ],
                transitions: ["Furthermore,", "Additionally,", "Moreover,", "In contrast,", "Subsequently,", "Nevertheless,", "Consequently,"]
            },
            Business: {
                introduction: "This strategic report outlines",
                body_starters: [
                    "Market analysis shows",
                    "Industry trends indicate",
                    "Performance metrics demonstrate",
                    "Stakeholder feedback reveals",
                    "Competitive analysis suggests"
                ],
                transitions: ["Therefore,", "As a result,", "Consequently,", "In addition,", "However,", "Furthermore,", "Nevertheless,"]
            },
            Creative: {
                introduction: "Imagine a world where",
                body_starters: [
                    "In this realm,",
                    "The landscape reveals",
                    "Characters discover that",
                    "The narrative unfolds as",
                    "Within this setting,"
                ],
                transitions: ["Suddenly,", "Meanwhile,", "In that moment,", "As if by magic,", "Without warning,", "Unexpectedly,", "In the distance,"]
            },
            Casual: {
                introduction: "Let's dive into",
                body_starters: [
                    "Here's the thing:",
                    "What's interesting is",
                    "You might be surprised that",
                    "The reality is",
                    "It turns out that"
                ],
                transitions: ["So,", "Also,", "Plus,", "But here's the thing,", "On the other hand,", "Actually,", "Honestly,"]
            }
        };

        const template = styleTemplates[style] || styleTemplates.Academic;
        const wordsPerSentence = this._getWordsPerSentence(style);
        const targetSentences = Math.ceil(wordCount / wordsPerSentence);
        const paragraphs = Math.max(3, Math.ceil(targetSentences / 4));
        
        let content = '';
        let sentenceCount = 0;
        
        // Introduction paragraph
        content += `${template.introduction} ${prompt}. `;
        sentenceCount++;
        
        // Add introduction details
        if (targetSentences > 3) {
            content += `This ${style.toLowerCase()} examination provides comprehensive insights into the subject matter. `;
            sentenceCount++;
        }
        
        content += '\n\n';
        
        // Body paragraphs
        for (let p = 1; p < paragraphs - 1 && sentenceCount < targetSentences - 2; p++) {
            const starter = template.body_starters[p % template.body_starters.length];
            content += `${starter} ${this._generateTopicSentence(prompt, style, tone)}. `;
            sentenceCount++;
            
            // Add supporting sentences
            const sentencesInParagraph = Math.min(3, targetSentences - sentenceCount - 2);
            for (let s = 0; s < sentencesInParagraph; s++) {
                const transition = template.transitions[s % template.transitions.length];
                content += `${transition} ${this._generateSupportingSentence(prompt, style, tone)}. `;
                sentenceCount++;
            }
            
            content += '\n\n';
        }
        
        // Conclusion paragraph
        content += this._generateConclusion(prompt, style, tone);
        
        return content.trim();
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

    /**
     * Generate topic sentence
     */
    _generateTopicSentence(prompt, style, tone) {
        const topics = [
            `the fundamental aspects of ${prompt.toLowerCase()}`,
            `key considerations regarding ${prompt.toLowerCase()}`,
            `important implications of ${prompt.toLowerCase()}`,
            `significant factors influencing ${prompt.toLowerCase()}`,
            `critical elements within ${prompt.toLowerCase()}`
        ];
        return topics[Math.floor(Math.random() * topics.length)];
    }

    /**
     * Generate supporting sentence
     */
    _generateSupportingSentence(prompt, style, tone) {
        const supports = [
            `this approach enhances understanding of the core concepts`,
            `multiple perspectives contribute to a comprehensive analysis`,
            `detailed examination reveals important patterns and trends`,
            `systematic investigation provides valuable insights`,
            `thorough evaluation demonstrates significant findings`
        ];
        return supports[Math.floor(Math.random() * supports.length)];
    }

    /**
     * Generate conclusion
     */
    _generateConclusion(prompt, style, tone) {
        const conclusions = {
            Academic: `In conclusion, this comprehensive analysis of ${prompt.toLowerCase()} demonstrates the complexity and significance of the subject matter. The findings contribute to our understanding and provide a foundation for future research and investigation.`,
            Business: `In summary, this examination of ${prompt.toLowerCase()} provides actionable insights and strategic recommendations. The analysis supports informed decision-making and effective implementation of proposed solutions.`,
            Creative: `As our exploration of ${prompt.toLowerCase()} draws to a close, we discover that the journey itself has been as meaningful as the destination. The narrative continues to unfold, leaving us with lasting impressions and new possibilities.`,
            Casual: `So there you have it - a complete look at ${prompt.toLowerCase()}. Hopefully this gives you a better understanding of the topic and maybe even sparks some new ideas for your own exploration.`
        };
        return conclusions[style] || conclusions.Academic;
    }

    /**
     * Polish existing content sections to match new requirements
     * @param {Array} sections - Content sections to polish
     * @param {string} prompt - New prompt requirements
     * @param {string} style - Writing style
     * @param {string} tone - Writing tone
     * @param {number} wordCount - Target word count
     * @returns {Promise<Object>} Polished content with metadata
     */
    async polishExistingContent(sections, prompt, style = 'Academic', tone = 'Formal', wordCount = 500) {
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
                polishedContent = await this._attemptLLMGeneration(polishPrompt, style, tone, wordCount);
            } catch (error) {
                console.warn('LLM polishing failed, using enhanced fallback:', error.message);
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
            console.error('Error polishing existing content:', error);
            
            // Fallback to enhanced content generation
            return this._generateFallbackContent(prompt, style, tone, wordCount, 'polishing_error', error);
        }
    }
    
    /**
     * Generate enhanced fallback for polished content
     */
    _generatePolishedFallback(baseContent, prompt, style, tone, wordCount) {
        // Extract key concepts from base content
        const sentences = baseContent.split(/[.!?]+/).filter(s => s.trim().length > 10);
        const keyConcepts = sentences.slice(0, 3).map(s => s.trim());
        
        // Generate new content incorporating key concepts
        let polishedContent = this.generateMockContent(prompt, style, tone, wordCount);
        
        // Try to incorporate key concepts from original content
        if (keyConcepts.length > 0) {
            const conceptIntegration = keyConcepts.join('. ');
            polishedContent = polishedContent.replace(
                /This comprehensive analysis examines/,
                `Building upon previous insights, this analysis examines`
            );
            
            // Add a paragraph incorporating original concepts
            const paragraphs = polishedContent.split('\n\n');
            if (paragraphs.length > 2) {
                paragraphs.splice(2, 0, `Previous research has established that ${conceptIntegration}. These foundational insights provide valuable context for understanding the current analysis.`);
                polishedContent = paragraphs.join('\n\n');
            }
        }
        
        return polishedContent;
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