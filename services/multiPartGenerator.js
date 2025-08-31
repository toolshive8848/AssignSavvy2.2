const { GoogleGenerativeAI } = require('@google/generative-ai');
const ContentDatabase = require('./contentDatabase');
const OriginalityDetection = require('./originalityDetection');
const ZoteroCSLProcessor = require('./zoteroCSL');
const FinalDetectionService = require('./finalDetection');

/**
 * MultiPartGenerator class for chunk-based content generation
 * Handles Pro (2000 words) and Freemium (1000 words) limits with iterative processing
 */
class MultiPartGenerator {
    constructor() {
        // TODO: Add your Gemini API key here - Get from Google AI Studio (https://makersuite.google.com/app/apikey)
        // Required for Gemini 2.5 Pro models used in multi-part content generation
        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY); // Add your Gemini API key
        this.flashModel = this.genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });
        this.proModel = this.genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });
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
            citationStyle = 'apa'
        } = params;

        try {
            console.log(`Starting multi-part generation for ${requestedWordCount} words (${userPlan} plan)`);
            
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
            console.log(`Using chunk size: ${chunkSize} words`);
            
            // Check for similar content in database
            const similarContent = await this.contentDatabase.findSimilarContent(
                prompt, style, tone, requestedWordCount
            );
            
            let baseContent = null;
            if (similarContent.length > 0) {
                console.log(`Found ${similarContent.length} similar content matches`);
                baseContent = await this.contentDatabase.getContentForPolishing(
                    similarContent[0].contentId, 
                    requestedWordCount
                );
            }
            
            // Generate content chunks iteratively
            while (generationState.totalWordsGenerated < requestedWordCount) {
                const remainingWords = requestedWordCount - generationState.totalWordsGenerated;
                const currentChunkTarget = Math.min(chunkSize, remainingWords);
                
                console.log(`Generating chunk ${generationState.chunksGenerated + 1}, target: ${currentChunkTarget} words`);
                
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
                    totalTargetWords: requestedWordCount
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
                
                console.log(`Chunk ${generationState.chunksGenerated} completed: ${chunkResult.wordCount} words, ${chunkResult.refinementCycles} refinements`);
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
                console.log(`Processing citations with style: ${citationStyle}`);
                citationData = await this.zoteroCSLProcessor.processCitations(
                    finalContent,
                    citationStyle,
                    subject || prompt.substring(0, 100)
                );
                finalContent = citationData.processedContent;
            }
            
            // Run final comprehensive detection on combined content
            console.log('Running final detection on combined content');
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
            
            console.log(`Multi-part generation completed: ${finalWordCount} words in ${generationState.chunksGenerated} chunks`);
            
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
            console.error('Error in multi-part generation:', error);
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
            totalTargetWords
        } = params;

        try {
            let currentContent = '';
            let refinementCycles = 0;
            let detectionResults = null;
            
            // Step A: Generate initial chunk
            if (baseContent && baseContent.content) {
                console.log(`Using base content for chunk ${chunkIndex}, polishing with Flash`);
                currentContent = await this.polishExistingContent(
                    baseContent.content,
                    prompt,
                    chunkTarget,
                    contextForNextChunk,
                    style,
                    tone
                );
            } else {
                console.log(`Generating new content for chunk ${chunkIndex} with Flash`);
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
            
            // Step C: Conditional refinement based on detection results
            if (detectionResults.needsRefinement) {
                console.log(`Chunk ${chunkIndex} needs refinement: ${detectionResults.reason}`);
                
                for (let cycle = 0; cycle < this.MAX_REFINEMENT_CYCLES && detectionResults.needsRefinement; cycle++) {
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
                    console.log(`Refinement cycle ${cycle + 1} completed for chunk ${chunkIndex}`);
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
            console.error(`Error generating chunk ${chunkIndex}:`, error);
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
            console.error('Error generating new chunk:', error);
            throw error;
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
            console.error('Error polishing existing content:', error);
            throw error;
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
            console.error('Error regenerating with Pro:', error);
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
            console.error('Error refining problematic sections:', error);
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
}

module.exports = MultiPartGenerator;