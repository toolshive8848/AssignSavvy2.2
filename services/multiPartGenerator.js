const { GoogleGenerativeAI } = require('@google/generative-ai');
const ContentDatabase = require('./contentDatabase');
const OriginalityDetection = require('./originalityDetection');
const ZoteroCSLProcessor = require('./zoteroCSL');
const FinalDetectionService = require('./finalDetection');
const { logger } = require('../utils/logger');

/**
 * MultiPartGenerator class for chunk-based content generation
 * Handles Pro (2000 words) and Freemium (1000 words) limits with iterative processing
 */
class MultiPartGenerator {
    constructor() {
        // Validate Gemini API key
        if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your-gemini-api-key-here') {
            logger.warn('GEMINI_API_KEY not configured. Multi-part generation will use fallback mode.', {
                service: 'MultiPartGenerator',
                method: 'constructor'
            });
            this.genAI = null;
            this.flashModel = null;
            this.proModel = null;
        } else {
            try {
                this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
                this.flashModel = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
                this.proModel = this.genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });
            } catch (error) {
                logger.error('Failed to initialize Gemini models', {
                    service: 'MultiPartGenerator',
                    method: 'constructor',
                    error: error.message,
                    stack: error.stack
                });
                this.genAI = null;
                this.flashModel = null;
                this.proModel = null;
            }
        }
        this.contentDatabase = new ContentDatabase();
        this.originalityDetection = new OriginalityDetection();
        this.zoteroCSLProcessor = new ZoteroCSLProcessor();
        this.finalDetectionService = new FinalDetectionService();
        
        // Chunk size limits based on user plan
        this.CHUNK_LIMITS = {
            freemium: 1000,
            pro: 2000,
            custom: 2000
        };
        
        // Generation parameters
        this.MAX_RETRIES = 3;
        this.CONTEXT_OVERLAP = 200; // Words to overlap between chunks for coherence
        this.MAX_REFINEMENT_CYCLES = 2;
    }

    /**
     * Generate content in multiple parts with iterative detection and refinement
     * @param {Object} params - Generation parameters
     * @returns {Promise<Object>} Generated content with metadata
     */
    async generateMultiPartContent(params) {
        const {
            userId,
            prompt,
            requestedWordCount,
            userPlan,
            style = 'Academic',
            tone = 'Formal',
            subject = '',
            additionalInstructions = '',
            requiresCitations = false,
            citationStyle = 'apa',
            qualityTier = 'standard',
            enableRefinement = false
        } = params;

        try {
            logger.info('Starting multi-part generation', {
                service: 'MultiPartGenerator',
                method: 'generateMultiPartContent',
                userId,
                requestedWordCount,
                userPlan
            });
            
            // Check if Gemini models are available
            if (!this.flashModel || !this.proModel) {
                logger.warn('Gemini models not available, falling back to single generation', {
                    service: 'MultiPartGenerator',
                    method: 'generateMultiPartContent',
                    userId
                });
                // Import llmService for fallback
                const llmService = require('./llmService');
                const fallbackResult = await llmService.generateContent(prompt, style, tone, requestedWordCount, qualityTier);
                
                return {
                    content: fallbackResult.content,
                    wordCount: fallbackResult.wordCount || requestedWordCount,
                    chunksGenerated: 1,
                    refinementCycles: 0,
                    generationTime: fallbackResult.generationTime || 2000,
                    contentId: null,
                    usedSimilarContent: false,
                    citationData: fallbackResult.citationData || {},
                    finalDetectionResults: fallbackResult.finalDetectionResults || {},
                    metadata: {
                        style,
                        tone,
                        subject,
                        userPlan,
                        requestedWordCount,
                        requiresCitations,
                        citationStyle: requiresCitations ? citationStyle : null,
                        fallbackUsed: true
                    }
                };
            }
            
            // Initialize generation state
            const generationState = {
                finalContentChunks: [],
                contextForNextChunk: '',
                totalWordsGenerated: 0,
                chunksGenerated: 0,
                refinementCycles: 0,
                startTime: Date.now()
            };
            
            // Determine chunk size based on user plan
            const chunkSize = this.getChunkSize(userPlan, requestedWordCount);
            logger.info('Using chunk size', {
                service: 'MultiPartGenerator',
                method: 'generateMultiPartContent',
                chunkSize,
                userId
            });
            
            // Check for similar content in database
            const similarContent = await this.contentDatabase.findSimilarContent(
                prompt, style, tone, requestedWordCount
            );
            
            let baseContent = null;
            if (similarContent.length > 0) {
                logger.info('Found similar content matches', {
                    service: 'MultiPartGenerator',
                    method: 'generateMultiPartContent',
                    matchCount: similarContent.length,
                    userId
                });
                baseContent = await this.contentDatabase.getContentForPolishing(
                    similarContent[0].contentId, 
                    requestedWordCount
                );
            }
            
            // Generate content chunks iteratively
            while (generationState.totalWordsGenerated < requestedWordCount) {
                const remainingWords = requestedWordCount - generationState.totalWordsGenerated;
                const currentChunkTarget = Math.min(chunkSize, remainingWords);
                
                logger.info('Generating chunk', {
                    service: 'MultiPartGenerator',
                    method: 'generateMultiPartContent',
                    chunkNumber: generationState.chunksGenerated + 1,
                    targetWords: currentChunkTarget,
                    userId
                });
                
                const chunkResult = await this.generateAndRefineChunk({
                    prompt,
                    chunkTarget: currentChunkTarget,
                    chunkIndex: generationState.chunksGenerated,
                    contextForNextChunk: generationState.contextForNextChunk,
                    style,
                    tone,
                    subject,
                    additionalInstructions,
                    baseContent: baseContent ? baseContent.sections[generationState.chunksGenerated] : null,
                    totalTargetWords: requestedWordCount,
                    enableRefinement: enableRefinement
                });
                
                // Add refined chunk to final content
                generationState.finalContentChunks.push(chunkResult.content);
                generationState.totalWordsGenerated += chunkResult.wordCount;
                generationState.chunksGenerated++;
                generationState.refinementCycles += chunkResult.refinementCycles;
                
                // Update context for next chunk
                generationState.contextForNextChunk = this.extractContextForNext(
                    chunkResult.content, 
                    generationState.finalContentChunks
                );
                
                logger.info('Chunk completed', {
                    service: 'MultiPartGenerator',
                    method: 'generateMultiPartContent',
                    chunkNumber: generationState.chunksGenerated,
                    wordCount: chunkResult.wordCount,
                    refinementCycles: chunkResult.refinementCycles,
                    userId
                });
            }
            
            // Combine all chunks into final content
            let finalContent = this.combineChunks(generationState.finalContentChunks);
            
            // Process citations if required
            let citationData = {
                requiresCitations: false,
                processedContent: finalContent,
                bibliography: [],
                inTextCitations: [],
                citationCount: 0
            };
            
            if (requiresCitations && citationStyle) {
                logger.info('Processing citations', {
                    service: 'MultiPartGenerator',
                    method: 'generateMultiPartContent',
                    citationStyle,
                    userId
                });
                citationData = await this.zoteroCSLProcessor.processCitations(
                    finalContent,
                    citationStyle,
                    subject || prompt.substring(0, 100)
                );
                finalContent = citationData.processedContent;
            }
            
            // Run final comprehensive detection on combined content
            logger.info('Running final detection on combined content', {
                service: 'MultiPartGenerator',
                method: 'generateMultiPartContent',
                userId
            });
            const chunkDetectionResults = generationState.finalContentChunks.map(chunk => chunk.detectionResults).filter(Boolean);
            const finalDetectionResults = await this.finalDetectionService.processFinalDetection(
                finalContent,
                chunkDetectionResults,
                {
                    contentId: null, // Will be set after storage
                    userId,
                    isMultiPart: true,
                    generationMethod: 'multi-part',
                    chunksGenerated: generationState.chunksGenerated,
                    refinementCycles: generationState.refinementCycles
                }
            );
            
            const finalWordCount = finalContent.split(' ').length;
            
            // Store generated content in database
            const contentId = await this.contentDatabase.storeContent(
                userId,
                prompt,
                finalContent,
                {
                    style,
                    tone,
                    subject,
                    requestedWordCount,
                    actualWordCount: finalWordCount,
                    chunksGenerated: generationState.chunksGenerated,
                    refinementCycles: generationState.refinementCycles,
                    generationTime: Date.now() - generationState.startTime,
                    userPlan,
                    usedSimilarContent: baseContent !== null
                }
            );
            
            logger.info('Multi-part generation completed', {
                service: 'MultiPartGenerator',
                method: 'generateMultiPartContent',
                finalWordCount,
                chunksGenerated: generationState.chunksGenerated,
                userId
            });
            
            return {
                content: finalContent,
                wordCount: finalWordCount,
                chunksGenerated: generationState.chunksGenerated,
                refinementCycles: generationState.refinementCycles,
                generationTime: Date.now() - generationState.startTime,
                contentId,
                usedSimilarContent: baseContent !== null,
                citationData,
                finalDetectionResults,
                metadata: {
                    style,
                    tone,
                    subject,
                    userPlan,
                    requestedWordCount,
                    requiresCitations,
                    citationStyle: requiresCitations ? citationStyle : null,
                    originalityScore: finalDetectionResults.originalityScore,
                    aiDetectionScore: finalDetectionResults.aiDetectionScore,
                    plagiarismScore: finalDetectionResults.plagiarismScore,
                    qualityScore: finalDetectionResults.qualityScore,
                    requiresReview: finalDetectionResults.requiresReview,
                    isAcceptable: finalDetectionResults.isAcceptable
                }
            };
        } catch (error) {
            logger.error('Error in multi-part generation', {
                service: 'MultiPartGenerator',
                method: 'generateMultiPartContent',
                userId,
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Generate and refine a single content chunk
     * @param {Object} params - Chunk generation parameters
     * @returns {Promise<Object>} Refined chunk with metadata
     */
    async generateAndRefineChunk(params) {
        const {
            prompt,
            chunkTarget,
            chunkIndex,
            contextForNextChunk,
            style,
            tone,
            subject,
            additionalInstructions,
            baseContent,
            totalTargetWords,
            enableRefinement = false
        } = params;

        try {
            let currentContent = '';
            let refinementCycles = 0;
            let detectionResults = null;
            
            // Step A: Generate initial chunk
            if (baseContent && baseContent.content) {
                logger.info('Using base content for chunk, polishing with Flash', {
                    service: 'MultiPartGenerator',
                    method: 'generateAndRefineChunk',
                    chunkIndex
                });
                currentContent = await this.polishExistingContent(
                    baseContent.content,
                    prompt,
                    chunkTarget,
                    contextForNextChunk,
                    style,
                    tone
                );
            } else {
                logger.info('Generating new content for chunk with Flash', {
                    service: 'MultiPartGenerator',
                    method: 'generateAndRefineChunk',
                    chunkIndex
                });
                currentContent = await this.generateNewChunk(
                    prompt,
                    chunkTarget,
                    chunkIndex,
                    contextForNextChunk,
                    style,
                    tone,
                    subject,
                    additionalInstructions,
                    totalTargetWords
                );
            }
            
            // Step B: Originality.ai Detection
            detectionResults = await this.originalityDetection.detectContent(currentContent, {
                chunkIndex,
                totalChunks: Math.ceil(totalTargetWords / chunkTarget)
            });
            
            // Step C: Conditional refinement based on detection results and quality tier
            if (detectionResults.needsRefinement && enableRefinement) {
                logger.info('Chunk needs refinement (Premium tier)', {
                    service: 'MultiPartGenerator',
                    method: 'generateAndRefineChunk',
                    chunkIndex,
                    reason: detectionResults.reason
                });
            } else if (detectionResults.needsRefinement && !enableRefinement) {
                logger.info('Chunk needs refinement but skipping (Standard tier)', {
                    service: 'MultiPartGenerator',
                    method: 'generateAndRefineChunk',
                    chunkIndex,
                    reason: detectionResults.reason
                });
            }
            
            if (detectionResults.needsRefinement && enableRefinement) {
                
                for (let cycle = 0; cycle < this.MAX_REFINEMENT_CYCLES && detectionResults.needsRefinement && enableRefinement; cycle++) {
                    refinementCycles++;
                    
                    if (detectionResults.severity === 'high') {
                        // Complete regeneration with Pro model
                        currentContent = await this.regenerateWithPro(
                            prompt,
                            chunkTarget,
                            contextForNextChunk,
                            style,
                            tone,
                            detectionResults.recommendations
                        );
                    } else if (detectionResults.severity === 'medium') {
                        // Targeted refinement of problematic sections
                        const problematicSections = detectionResults.aiDetection?.flaggedSections?.map(s => s.text) || 
                                                   detectionResults.plagiarismDetection?.flaggedSections?.map(s => s.text) || 
                                                   ['Detected formulaic language'];
                        currentContent = await this.refineProblematicSections(
                            currentContent,
                            problematicSections,
                            chunkTarget,
                            style,
                            tone
                        );
                    }
                    
                    // Re-check after refinement
                    detectionResults = await this.originalityDetection.detectContent(currentContent, {
                        chunkIndex,
                        totalChunks: Math.ceil(totalTargetWords / chunkTarget)
                    });
                    logger.info('Refinement cycle completed for chunk', {
                        service: 'MultiPartGenerator',
                        method: 'generateAndRefineChunk',
                        cycle: cycle + 1,
                        chunkIndex
                    });
                }
            }
            
            const finalWordCount = currentContent.split(' ').length;
            
            return {
                content: currentContent,
                wordCount: finalWordCount,
                refinementCycles,
                detectionResults,
                chunkIndex
            };
        } catch (error) {
            logger.error('Error generating chunk', {
                service: 'MultiPartGenerator',
                method: 'generateAndRefineChunk',
                chunkIndex,
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Generate new content chunk with Gemini Flash
     * @param {string} prompt - Original prompt
     * @param {number} chunkTarget - Target word count for chunk
     * @param {number} chunkIndex - Current chunk index
     * @param {string} context - Context from previous chunks
     * @param {string} style - Writing style
     * @param {string} tone - Writing tone
     * @param {string} subject - Subject area
     * @param {string} additionalInstructions - Additional instructions
     * @param {number} totalTargetWords - Total target word count
     * @returns {Promise<string>} Generated content
     */
    async generateNewChunk(prompt, chunkTarget, chunkIndex, context, style, tone, subject, additionalInstructions, totalTargetWords) {
        try {
            if (!this.flashModel) {
                throw new Error('Gemini Flash model not available');
            }
            
            const chunkPrompt = this.buildChunkPrompt({
                originalPrompt: prompt,
                chunkTarget,
                chunkIndex,
                context,
                style,
                tone,
                subject,
                additionalInstructions,
                totalTargetWords
            });
            
            const result = await this.flashModel.generateContent(chunkPrompt);
            const response = await result.response;
            return response.text();
        } catch (error) {
            logger.error('Error generating new chunk', {
                service: 'MultiPartGenerator',
                method: 'generateNewChunk',
                chunkIndex,
                error: error.message
            });
            // Fallback to template-based content
            return this.generateFallbackChunk(prompt, chunkTarget, chunkIndex, style, tone);
        }
    }

    /**
     * Polish existing content with Gemini Flash
     * @param {string} baseContent - Base content to polish
     * @param {string} prompt - Original prompt
     * @param {number} chunkTarget - Target word count
     * @param {string} context - Context for coherence
     * @param {string} style - Writing style
     * @param {string} tone - Writing tone
     * @returns {Promise<string>} Polished content
     */
    async polishExistingContent(baseContent, prompt, chunkTarget, context, style, tone) {
        try {
            if (!this.flashModel) {
                throw new Error('Gemini Flash model not available');
            }
            
            const polishPrompt = `
Polish and adapt the following content to match the new requirements:

Original Content:
${baseContent}

New Requirements:
- Prompt: ${prompt}
- Target word count: ${chunkTarget} words
- Style: ${style}
- Tone: ${tone}
- Context from previous sections: ${context}

Instructions:
1. Maintain the core ideas but adapt to the new prompt
2. Adjust the content to match the specified style and tone
3. Ensure smooth transition from the provided context
4. Target exactly ${chunkTarget} words
5. Make the content original and avoid AI detection patterns

Polished Content:`;
            
            const result = await this.flashModel.generateContent(polishPrompt);
            const response = await result.response;
            return response.text();
        } catch (error) {
            logger.error('Error polishing existing content', {
                service: 'MultiPartGenerator',
                method: 'polishExistingContent',
                error: error.message
            });
            // Fallback to base content with minimal modifications
            return this.applyBasicPolishing(baseContent, chunkTarget, style, tone);
        }
    }

    /**
     * Regenerate content with Gemini Pro for high detection issues
     * @param {string} prompt - Original prompt
     * @param {number} chunkTarget - Target word count
     * @param {string} context - Context for coherence
     * @param {string} style - Writing style
     * @param {string} tone - Writing tone
     * @param {Array} recommendations - Detection recommendations to follow
     * @returns {Promise<string>} Regenerated content
     */
    async regenerateWithPro(prompt, chunkTarget, context, style, tone, recommendations) {
        try {
            const regenerationPrompt = `
Regenerate content following these recommendations:
${recommendations.join('\n- ')}

Requirements:
- Prompt: ${prompt}
- Target word count: ${chunkTarget} words
- Style: ${style}
- Tone: ${tone}
- Context: ${context}

Instructions:
1. Create completely original content
2. Avoid AI detection patterns and clichés
3. Use varied sentence structures and vocabulary
4. Ensure natural flow and human-like writing
5. Maintain academic rigor and authenticity

Regenerated Content:`;
            
            const result = await this.proModel.generateContent(regenerationPrompt);
            const response = await result.response;
            return response.text();
        } catch (error) {
            logger.error('Error regenerating with Pro', {
                service: 'MultiPartGenerator',
                method: 'regenerateWithPro',
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Refine problematic sections with targeted improvements
     * @param {string} content - Current content
     * @param {Array} problematicSections - Sections that need refinement
     * @param {number} chunkTarget - Target word count
     * @param {string} style - Writing style
     * @param {string} tone - Writing tone
     * @returns {Promise<string>} Refined content
     */
    async refineProblematicSections(content, problematicSections, chunkTarget, style, tone) {
        try {
            const refinementPrompt = `
Refine the following content by improving these problematic sections:
${problematicSections.map((section, index) => `${index + 1}. ${section}`).join('\n')}

Current Content:
${content}

Instructions:
1. Rewrite only the problematic sections
2. Maintain the overall structure and flow
3. Target word count: ${chunkTarget} words
4. Style: ${style}, Tone: ${tone}
5. Make improvements sound natural and human-written

Refined Content:`;
            
            const result = await this.proModel.generateContent(refinementPrompt);
            const response = await result.response;
            return response.text();
        } catch (error) {
            logger.error('Error refining problematic sections', {
                service: 'MultiPartGenerator',
                method: 'refineProblematicSections',
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }



    /**
     * Build chunk-specific prompt
     * @param {Object} params - Prompt parameters
     * @returns {string} Formatted prompt
     */
    buildChunkPrompt(params) {
        const {
            originalPrompt,
            chunkTarget,
            chunkIndex,
            context,
            style,
            tone,
            subject,
            additionalInstructions,
            totalTargetWords
        } = params;

        let chunkRole = '';
        if (chunkIndex === 0) {
            chunkRole = 'introduction and opening section';
        } else if (chunkTarget >= totalTargetWords * 0.8) {
            chunkRole = 'conclusion and closing section';
        } else {
            chunkRole = 'main body section';
        }

        return `
Write a ${chunkRole} for the following assignment:

${originalPrompt}

Requirements:
- Target word count: ${chunkTarget} words
- Writing style: ${style}
- Tone: ${tone}
- Subject area: ${subject}
- Additional instructions: ${additionalInstructions}

${context ? `Context from previous sections:\n${context}\n` : ''}

Instructions:
1. Write exactly ${chunkTarget} words
2. Maintain ${style} style with ${tone} tone
3. Ensure smooth flow ${context ? 'from the provided context' : 'as the opening section'}
4. Use original thinking and avoid clichés
5. Include specific examples and evidence where appropriate
6. Make the writing sound natural and human-authored

Content:`;
    }

    /**
     * Extract context for next chunk
     * @param {string} currentChunk - Current chunk content
     * @param {Array} allChunks - All previous chunks
     * @returns {string} Context for next chunk
     */
    extractContextForNext(currentChunk, allChunks) {
        // Get last few sentences of current chunk
        const sentences = currentChunk.split(/[.!?]+/).filter(s => s.trim().length > 0);
        const lastSentences = sentences.slice(-2).join('. ') + '.';
        
        // Get key themes from all chunks
        const allText = allChunks.join(' ');
        const keywords = this.extractKeyThemes(allText);
        
        return `Previous content ended with: ${lastSentences}\n\nKey themes established: ${keywords.join(', ')}`;
    }

    /**
     * Extract key themes from text
     * @param {string} text - Text to analyze
     * @returns {Array<string>} Key themes
     */
    extractKeyThemes(text) {
        // Simple keyword extraction for themes
        const words = text.toLowerCase()
            .replace(/[^a-zA-Z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(word => word.length > 4);
        
        const wordCount = {};
        words.forEach(word => {
            wordCount[word] = (wordCount[word] || 0) + 1;
        });
        
        return Object.entries(wordCount)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 5)
            .map(([word]) => word);
    }

    /**
     * Combine chunks into final content
     * @param {Array<string>} chunks - Content chunks
     * @returns {string} Combined content
     */
    combineChunks(chunks) {
        return chunks.join('\n\n');
    }

    /**
     * Get chunk size based on user plan
     * @param {string} userPlan - User plan type
     * @param {number} requestedWordCount - Total requested words
     * @returns {number} Chunk size
     */
    getChunkSize(userPlan, requestedWordCount) {
        const planLimit = this.CHUNK_LIMITS[userPlan.toLowerCase()] || this.CHUNK_LIMITS.freemium;
        return Math.min(planLimit, requestedWordCount);
    }

    /**
     * Generate fallback content when API is unavailable
     * @param {string} prompt - Original prompt
     * @param {number} chunkTarget - Target word count
     * @param {number} chunkIndex - Chunk index
     * @param {string} style - Writing style
     * @param {string} tone - Writing tone
     * @returns {string} Fallback content
     */
    generateFallbackChunk(prompt, chunkTarget, chunkIndex, style, tone) {
        const chunkRole = chunkIndex === 0 ? 'Introduction' : 
                         chunkIndex === 1 ? 'Main Analysis' : 'Conclusion';
        
        const fallbackContent = `
# ${chunkRole}

This section addresses the topic: "${prompt}"

## Key Points

1. **Primary Analysis**: The examination of this topic reveals several important considerations that merit detailed discussion.

2. **Supporting Evidence**: Research and analysis in this area demonstrate the significance of understanding the various factors involved.

3. **Critical Evaluation**: A thorough assessment of the available information provides insights into the complexities of this subject matter.

4. **Implications**: The findings suggest important implications for further study and practical application.

## Detailed Discussion

The ${style.toLowerCase()} approach to this topic requires careful consideration of multiple perspectives. The ${tone.toLowerCase()} examination reveals that comprehensive understanding necessitates analysis of both theoretical frameworks and practical applications.

Further investigation into this area would benefit from additional research and analysis to fully explore the implications and potential outcomes.

## Summary

This ${chunkRole.toLowerCase()} section has provided an overview of the key aspects related to the given topic, establishing a foundation for continued analysis and discussion.
        `.trim();
        
        // Adjust content length to approximate target
        const words = fallbackContent.split(/\s+/);
        if (words.length > chunkTarget) {
            return words.slice(0, chunkTarget).join(' ');
        } else if (words.length < chunkTarget * 0.8) {
            // Add padding content if too short
            const padding = ' Additional analysis and discussion of this topic would provide further insights into the various aspects and implications involved.';
            return fallbackContent + padding.repeat(Math.ceil((chunkTarget - words.length) / 20));
        }
        
        return fallbackContent;
    }

    /**
     * Apply basic polishing to existing content
     * @param {string} baseContent - Base content to polish
     * @param {number} chunkTarget - Target word count
     * @param {string} style - Writing style
     * @param {string} tone - Writing tone
     * @returns {string} Polished content
     */
    applyBasicPolishing(baseContent, chunkTarget, style, tone) {
        // Basic text processing for polishing
        let polished = baseContent
            .replace(/\b(very|really|quite|rather)\s+/gi, '') // Remove weak modifiers
            .replace(/\b(I think|I believe|In my opinion)\b/gi, '') // Remove subjective phrases
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();
        
        // Adjust for style
        if (style === 'Academic') {
            polished = polished.replace(/\b(can't|won't|don't)\b/gi, (match) => {
                return match.replace("'", ' not');
            });
        }
        
        // Adjust length to target
        const words = polished.split(/\s+/);
        if (words.length > chunkTarget) {
            polished = words.slice(0, chunkTarget).join(' ');
        }
        
        return polished;
    }
}

module.exports = MultiPartGenerator;