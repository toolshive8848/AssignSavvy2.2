const axios = require('axios');

/**
 * OriginalityDetection class for plagiarism and AI detection using Originality.ai
 * Handles content chunk detection and provides refinement recommendations
 */
class OriginalityDetection {
    constructor() {
        // TODO: Add your Originality.ai API key here - Get from https://originality.ai/dashboard
        // Required for plagiarism and AI content detection
        this.apiKey = process.env.ORIGINALITY_AI_API_KEY; // Add your Originality.ai API key
        this.baseUrl = 'https://api.originality.ai/api/v1';
        this.maxRetries = 3;
        this.retryDelay = 1000; // 1 second
        
        // Detection thresholds
        this.THRESHOLDS = {
            ai: {
                low: 10,
                medium: 30,
                high: 50
            },
            plagiarism: {
                low: 10,
                medium: 30,
                high: 50
            }
        };
        
        // Rate limiting
        this.lastRequestTime = 0;
        this.minRequestInterval = 1000; // 1 second between requests
    }

    /**
     * Perform comprehensive detection on content chunk
     * @param {string} content - Content to analyze
     * @param {Object} options - Detection options
     * @returns {Promise<Object>} Detection results with refinement recommendations
     */
    async detectContent(content, options = {}) {
        const {
            includeAI = true,
            includePlagiarism = true,
            chunkIndex = 0,
            totalChunks = 1
        } = options;

        try {
            console.log(`Starting detection for chunk ${chunkIndex + 1}/${totalChunks}`);
            
            // Rate limiting
            await this.enforceRateLimit();
            
            const detectionResults = {
                chunkIndex,
                wordCount: content.split(' ').length,
                timestamp: new Date().toISOString()
            };
            
            // Perform AI detection
            if (includeAI) {
                detectionResults.aiDetection = await this.performAIDetection(content);
            }
            
            // Perform plagiarism detection
            if (includePlagiarism) {
                detectionResults.plagiarismDetection = await this.performPlagiarismDetection(content);
            }
            
            // Analyze results and provide recommendations
            const analysis = this.analyzeDetectionResults(detectionResults);
            
            console.log(`Detection completed for chunk ${chunkIndex + 1}: AI=${analysis.aiScore}%, Plagiarism=${analysis.plagiarismScore}%, Severity=${analysis.severity}`);
            
            return {
                ...detectionResults,
                ...analysis,
                recommendations: this.generateRecommendations(analysis),
                needsRefinement: analysis.severity !== 'low',
                refinementStrategy: this.determineRefinementStrategy(analysis)
            };
        } catch (error) {
            console.error('Error in content detection:', error);
            
            // Return fallback results to prevent blocking generation
            return this.getFallbackResults(content, chunkIndex);
        }
    }

    /**
     * Perform AI detection using Originality.ai
     * @param {string} content - Content to analyze
     * @returns {Promise<Object>} AI detection results
     */
    async performAIDetection(content) {
        try {
            const response = await this.makeAPIRequest('/scan/ai', {
                content: content,
                aiModelVersion: 'latest',
                storeScan: false
            });
            
            return {
                score: response.score?.ai || 0,
                confidence: response.confidence || 0,
                details: response.details || {},
                flaggedSections: this.extractFlaggedSections(response, 'ai'),
                patterns: this.identifyAIPatterns(content, response)
            };
        } catch (error) {
            console.error('AI detection error:', error);
            return this.getFallbackAIResults(content);
        }
    }

    /**
     * Perform plagiarism detection using Originality.ai
     * @param {string} content - Content to analyze
     * @returns {Promise<Object>} Plagiarism detection results
     */
    async performPlagiarismDetection(content) {
        try {
            const response = await this.makeAPIRequest('/scan/plagiarism', {
                content: content,
                storeScan: false,
                webhookUrl: null
            });
            
            return {
                score: response.score?.plagiarism || 0,
                confidence: response.confidence || 0,
                sources: response.sources || [],
                flaggedSections: this.extractFlaggedSections(response, 'plagiarism'),
                matchDetails: response.matches || []
            };
        } catch (error) {
            console.error('Plagiarism detection error:', error);
            return this.getFallbackPlagiarismResults(content);
        }
    }

    /**
     * Make API request to Originality.ai with retry logic
     * @param {string} endpoint - API endpoint
     * @param {Object} data - Request data
     * @returns {Promise<Object>} API response
     */
    async makeAPIRequest(endpoint, data) {
        let lastError;
        
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                const response = await axios.post(`${this.baseUrl}${endpoint}`, data, {
                    headers: {
                        'X-OAI-API-KEY': this.apiKey,
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000 // 30 seconds
                });
                
                if (response.data && response.data.success) {
                    return response.data;
                } else {
                    throw new Error(`API returned unsuccessful response: ${JSON.stringify(response.data)}`);
                }
            } catch (error) {
                lastError = error;
                console.warn(`API request attempt ${attempt} failed:`, error.message);
                
                if (attempt < this.maxRetries) {
                    await this.delay(this.retryDelay * attempt);
                }
            }
        }
        
        throw lastError;
    }

    /**
     * Analyze detection results and determine severity
     * @param {Object} results - Detection results
     * @returns {Object} Analysis with severity and scores
     */
    analyzeDetectionResults(results) {
        const aiScore = results.aiDetection?.score || 0;
        const plagiarismScore = results.plagiarismDetection?.score || 0;
        
        // Determine individual severities
        const aiSeverity = this.determineSeverity(aiScore, 'ai');
        const plagiarismSeverity = this.determineSeverity(plagiarismScore, 'plagiarism');
        
        // Overall severity is the highest of the two
        const overallSeverity = this.getHighestSeverity(aiSeverity, plagiarismSeverity);
        
        // Calculate composite score
        const compositeScore = Math.max(aiScore, plagiarismScore);
        
        return {
            aiScore,
            plagiarismScore,
            compositeScore,
            aiSeverity,
            plagiarismSeverity,
            severity: overallSeverity,
            primaryIssue: aiScore > plagiarismScore ? 'ai' : 'plagiarism',
            confidence: this.calculateConfidence(results)
        };
    }

    /**
     * Determine severity level based on score and type
     * @param {number} score - Detection score
     * @param {string} type - Detection type ('ai' or 'plagiarism')
     * @returns {string} Severity level
     */
    determineSeverity(score, type) {
        const thresholds = this.THRESHOLDS[type];
        
        if (score >= thresholds.high) return 'high';
        if (score >= thresholds.medium) return 'medium';
        return 'low';
    }

    /**
     * Get the highest severity level
     * @param {string} severity1 - First severity
     * @param {string} severity2 - Second severity
     * @returns {string} Highest severity
     */
    getHighestSeverity(severity1, severity2) {
        const severityOrder = { low: 1, medium: 2, high: 3 };
        return severityOrder[severity1] >= severityOrder[severity2] ? severity1 : severity2;
    }

    /**
     * Calculate overall confidence score
     * @param {Object} results - Detection results
     * @returns {number} Confidence score (0-100)
     */
    calculateConfidence(results) {
        const aiConfidence = results.aiDetection?.confidence || 0;
        const plagiarismConfidence = results.plagiarismDetection?.confidence || 0;
        
        return Math.max(aiConfidence, plagiarismConfidence);
    }

    /**
     * Generate refinement recommendations
     * @param {Object} analysis - Detection analysis
     * @returns {Array<string>} Refinement recommendations
     */
    generateRecommendations(analysis) {
        const recommendations = [];
        
        if (analysis.aiSeverity === 'high') {
            recommendations.push('Complete regeneration recommended due to high AI detection');
            recommendations.push('Use more varied sentence structures and vocabulary');
            recommendations.push('Avoid formulaic transitions and conclusions');
        } else if (analysis.aiSeverity === 'medium') {
            recommendations.push('Targeted refinement of AI-flagged sections');
            recommendations.push('Rephrase repetitive or formulaic language');
            recommendations.push('Add more specific examples and personal insights');
        }
        
        if (analysis.plagiarismSeverity === 'high') {
            recommendations.push('Significant rewriting required due to plagiarism detection');
            recommendations.push('Paraphrase flagged sections with original language');
            recommendations.push('Add proper citations if using referenced material');
        } else if (analysis.plagiarismSeverity === 'medium') {
            recommendations.push('Minor paraphrasing needed for flagged sections');
            recommendations.push('Ensure all ideas are expressed in original language');
        }
        
        if (analysis.severity === 'low') {
            recommendations.push('Content passes detection checks');
            recommendations.push('Minor polishing may enhance originality');
        }
        
        return recommendations;
    }

    /**
     * Determine refinement strategy based on analysis
     * @param {Object} analysis - Detection analysis
     * @returns {Object} Refinement strategy
     */
    determineRefinementStrategy(analysis) {
        if (analysis.severity === 'high') {
            return {
                type: 'complete_regeneration',
                model: 'gemini-pro',
                focus: analysis.primaryIssue,
                instructions: [
                    'Generate completely new content',
                    'Avoid detected patterns and phrases',
                    'Use original thinking and expression',
                    'Maintain academic rigor while ensuring originality'
                ]
            };
        } else if (analysis.severity === 'medium') {
            return {
                type: 'targeted_refinement',
                model: 'gemini-pro',
                focus: 'problematic_sections',
                instructions: [
                    'Rephrase flagged sections only',
                    'Maintain overall structure and flow',
                    'Use synonyms and alternative expressions',
                    'Ensure natural language patterns'
                ]
            };
        } else {
            return {
                type: 'no_refinement',
                model: null,
                focus: 'none',
                instructions: ['Content is acceptable as-is']
            };
        }
    }

    /**
     * Extract flagged sections from API response
     * @param {Object} response - API response
     * @param {string} type - Detection type
     * @returns {Array<Object>} Flagged sections
     */
    extractFlaggedSections(response, type) {
        const flaggedSections = [];
        
        if (response.highlights && Array.isArray(response.highlights)) {
            response.highlights.forEach(highlight => {
                if (highlight.type === type && highlight.score > this.THRESHOLDS[type].medium) {
                    flaggedSections.push({
                        text: highlight.text,
                        score: highlight.score,
                        startIndex: highlight.startIndex,
                        endIndex: highlight.endIndex,
                        reason: highlight.reason || 'High detection score'
                    });
                }
            });
        }
        
        return flaggedSections;
    }

    /**
     * Identify AI patterns in content
     * @param {string} content - Content to analyze
     * @param {Object} response - API response
     * @returns {Array<string>} Identified patterns
     */
    identifyAIPatterns(content, response) {
        const patterns = [];
        
        // Common AI patterns
        const aiPatterns = [
            { pattern: /\b(furthermore|moreover|additionally|consequently)\b/gi, name: 'Formulaic transitions' },
            { pattern: /\b(it is important to note|it should be noted)\b/gi, name: 'Hedging language' },
            { pattern: /\b(in conclusion|to summarize|in summary)\b/gi, name: 'Generic conclusions' },
            { pattern: /\b(various|numerous|several)\b/gi, name: 'Vague quantifiers' }
        ];
        
        aiPatterns.forEach(({ pattern, name }) => {
            const matches = content.match(pattern);
            if (matches && matches.length > 2) {
                patterns.push(name);
            }
        });
        
        return patterns;
    }

    /**
     * Get fallback results when API fails
     * @param {string} content - Content being analyzed
     * @param {number} chunkIndex - Chunk index
     * @returns {Object} Fallback results
     */
    getFallbackResults(content, chunkIndex) {
        console.warn('Using fallback detection results due to API failure');
        
        return {
            chunkIndex,
            wordCount: content.split(' ').length,
            timestamp: new Date().toISOString(),
            aiDetection: this.getFallbackAIResults(content),
            plagiarismDetection: this.getFallbackPlagiarismResults(content),
            aiScore: 15, // Conservative fallback
            plagiarismScore: 10,
            compositeScore: 15,
            severity: 'low',
            confidence: 50,
            needsRefinement: false,
            recommendations: ['API unavailable - content approved with conservative scoring'],
            refinementStrategy: { type: 'no_refinement', model: null, focus: 'none' },
            fallback: true
        };
    }

    /**
     * Get fallback AI detection results
     * @param {string} content - Content to analyze
     * @returns {Object} Fallback AI results
     */
    getFallbackAIResults(content) {
        // Simple pattern-based fallback
        const aiPatterns = [
            /\b(furthermore|moreover|additionally|consequently)\b/gi,
            /\b(it is important to note|it should be noted)\b/gi,
            /\b(in conclusion|to summarize|in summary)\b/gi
        ];
        
        let patternCount = 0;
        aiPatterns.forEach(pattern => {
            const matches = content.match(pattern);
            if (matches) patternCount += matches.length;
        });
        
        const score = Math.min(patternCount * 5, 30); // Cap at 30%
        
        return {
            score,
            confidence: 50,
            details: { fallback: true },
            flaggedSections: [],
            patterns: ['Fallback pattern detection']
        };
    }

    /**
     * Get fallback plagiarism detection results
     * @param {string} content - Content to analyze
     * @returns {Object} Fallback plagiarism results
     */
    getFallbackPlagiarismResults(content) {
        return {
            score: 5, // Very conservative
            confidence: 50,
            sources: [],
            flaggedSections: [],
            matchDetails: []
        };
    }

    /**
     * Enforce rate limiting between API requests
     * @returns {Promise<void>}
     */
    async enforceRateLimit() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        
        if (timeSinceLastRequest < this.minRequestInterval) {
            const waitTime = this.minRequestInterval - timeSinceLastRequest;
            await this.delay(waitTime);
        }
        
        this.lastRequestTime = Date.now();
    }

    /**
     * Delay execution for specified milliseconds
     * @param {number} ms - Milliseconds to delay
     * @returns {Promise<void>}
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Batch process multiple content chunks
     * @param {Array<string>} chunks - Content chunks to process
     * @param {Object} options - Processing options
     * @returns {Promise<Array<Object>>} Detection results for all chunks
     */
    async batchDetectChunks(chunks, options = {}) {
        const results = [];
        
        for (let i = 0; i < chunks.length; i++) {
            console.log(`Processing chunk ${i + 1}/${chunks.length}`);
            
            const chunkResult = await this.detectContent(chunks[i], {
                ...options,
                chunkIndex: i,
                totalChunks: chunks.length
            });
            
            results.push(chunkResult);
            
            // Add delay between chunks to respect rate limits
            if (i < chunks.length - 1) {
                await this.delay(500);
            }
        }
        
        return results;
    }

    /**
     * Get detection statistics summary
     * @param {Array<Object>} detectionResults - Array of detection results
     * @returns {Object} Statistics summary
     */
    getDetectionStatistics(detectionResults) {
        const stats = {
            totalChunks: detectionResults.length,
            averageAIScore: 0,
            averagePlagiarismScore: 0,
            highSeverityChunks: 0,
            mediumSeverityChunks: 0,
            lowSeverityChunks: 0,
            chunksNeedingRefinement: 0,
            totalRefinementCycles: 0
        };
        
        if (detectionResults.length === 0) return stats;
        
        detectionResults.forEach(result => {
            stats.averageAIScore += result.aiScore || 0;
            stats.averagePlagiarismScore += result.plagiarismScore || 0;
            
            switch (result.severity) {
                case 'high':
                    stats.highSeverityChunks++;
                    break;
                case 'medium':
                    stats.mediumSeverityChunks++;
                    break;
                case 'low':
                    stats.lowSeverityChunks++;
                    break;
            }
            
            if (result.needsRefinement) {
                stats.chunksNeedingRefinement++;
            }
        });
        
        stats.averageAIScore /= detectionResults.length;
        stats.averagePlagiarismScore /= detectionResults.length;
        
        return stats;
    }
}

module.exports = OriginalityDetection;