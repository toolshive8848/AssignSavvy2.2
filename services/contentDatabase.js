const admin = require('firebase-admin');

/**
 * ContentDatabase class for content optimization and similarity matching
 * Handles 80%+ content matching and retrieval for efficient content reuse
 */
class ContentDatabase {
    constructor() {
        this.db = admin.firestore();
        this.SIMILARITY_THRESHOLD = 0.8; // 80% similarity threshold
        this.MAX_SEARCH_RESULTS = 10;
        this.CONTENT_COLLECTION = 'generatedContent';
        this.KEYWORDS_COLLECTION = 'contentKeywords';
    }

    /**
     * Store generated content with metadata and keywords
     * @param {string} userId - User ID
     * @param {string} prompt - Original prompt
     * @param {string} content - Generated content
     * @param {Object} metadata - Content metadata
     * @returns {Promise<string>} Content document ID
     */
    async storeContent(userId, prompt, content, metadata = {}) {
        try {
            const keywords = this.extractKeywords(prompt);
            const contentHash = this.generateContentHash(content);
            
            const contentDoc = {
                userId,
                prompt: prompt.toLowerCase().trim(),
                content,
                contentHash,
                keywords,
                wordCount: content.split(' ').length,
                metadata: {
                    style: metadata.style || 'Academic',
                    tone: metadata.tone || 'Formal',
                    generationTime: metadata.generationTime || 0,
                    source: metadata.source || 'primary',
                    ...metadata
                },
                createdAt: new Date(),
                lastAccessed: new Date(),
                accessCount: 0,
                similarityScore: 1.0, // Perfect match with itself
                isActive: true
            };
            
            const docRef = await this.db.collection(this.CONTENT_COLLECTION).add(contentDoc);
            
            // Store keywords separately for efficient searching
            await this.storeKeywords(docRef.id, keywords, prompt);
            
            console.log(`Content stored with ID: ${docRef.id}, Keywords: ${keywords.join(', ')}`);
            return docRef.id;
        } catch (error) {
            console.error('Error storing content:', error);
            throw error;
        }
    }

    /**
     * Search for similar content based on prompt and keywords
     * @param {string} prompt - Search prompt
     * @param {string} style - Content style
     * @param {string} tone - Content tone
     * @param {number} targetWordCount - Target word count
     * @returns {Promise<Array>} Similar content matches
     */
    async findSimilarContent(prompt, style = 'Academic', tone = 'Formal', targetWordCount = 1000) {
        try {
            const searchKeywords = this.extractKeywords(prompt);
            const promptLower = prompt.toLowerCase().trim();
            
            console.log(`Searching for similar content with keywords: ${searchKeywords.join(', ')}`);
            
            // Step 1: Find content with matching keywords
            const keywordMatches = await this.searchByKeywords(searchKeywords);
            
            // Step 2: Calculate similarity scores
            const similarityResults = [];
            
            for (const match of keywordMatches) {
                const contentDoc = await this.db.collection(this.CONTENT_COLLECTION).doc(match.contentId).get();
                
                if (!contentDoc.exists || !contentDoc.data().isActive) {
                    continue;
                }
                
                const contentData = contentDoc.data();
                
                // Calculate various similarity metrics
                const promptSimilarity = this.calculateTextSimilarity(promptLower, contentData.prompt);
                const keywordSimilarity = this.calculateKeywordSimilarity(searchKeywords, contentData.keywords);
                const styleToneMatch = this.calculateStyleToneMatch(style, tone, contentData.metadata);
                const wordCountSimilarity = this.calculateWordCountSimilarity(targetWordCount, contentData.wordCount);
                
                // Weighted overall similarity score
                const overallSimilarity = (
                    promptSimilarity * 0.4 +
                    keywordSimilarity * 0.3 +
                    styleToneMatch * 0.2 +
                    wordCountSimilarity * 0.1
                );
                
                if (overallSimilarity >= this.SIMILARITY_THRESHOLD) {
                    similarityResults.push({
                        contentId: contentDoc.id,
                        content: contentData.content,
                        prompt: contentData.prompt,
                        keywords: contentData.keywords,
                        metadata: contentData.metadata,
                        wordCount: contentData.wordCount,
                        similarityScore: overallSimilarity,
                        promptSimilarity,
                        keywordSimilarity,
                        styleToneMatch,
                        wordCountSimilarity,
                        createdAt: contentData.createdAt?.toDate(),
                        lastAccessed: contentData.lastAccessed?.toDate(),
                        accessCount: contentData.accessCount || 0
                    });
                }
            }
            
            // Sort by similarity score (highest first)
            similarityResults.sort((a, b) => b.similarityScore - a.similarityScore);
            
            // Update access statistics for found content
            if (similarityResults.length > 0) {
                await this.updateAccessStatistics(similarityResults.map(r => r.contentId));
            }
            
            console.log(`Found ${similarityResults.length} similar content matches above ${this.SIMILARITY_THRESHOLD * 100}% threshold`);
            
            return similarityResults.slice(0, this.MAX_SEARCH_RESULTS);
        } catch (error) {
            console.error('Error finding similar content:', error);
            return [];
        }
    }

    /**
     * Get content sections for polishing and refinement
     * @param {string} contentId - Content document ID
     * @param {number} targetWordCount - Target word count for refinement
     * @returns {Promise<Object>} Content sections for polishing
     */
    async getContentForPolishing(contentId, targetWordCount) {
        try {
            const contentDoc = await this.db.collection(this.CONTENT_COLLECTION).doc(contentId).get();
            
            if (!contentDoc.exists) {
                throw new Error('Content not found');
            }
            
            const contentData = contentDoc.data();
            const content = contentData.content;
            
            // Split content into logical sections
            const sections = this.splitContentIntoSections(content);
            
            // Calculate how to distribute target word count across sections
            const sectionTargets = this.calculateSectionTargets(sections, targetWordCount);
            
            return {
                originalContent: content,
                originalWordCount: contentData.wordCount,
                targetWordCount,
                sections: sections.map((section, index) => ({
                    index,
                    content: section,
                    currentWordCount: section.split(' ').length,
                    targetWordCount: sectionTargets[index],
                    needsExpansion: sectionTargets[index] > section.split(' ').length,
                    needsReduction: sectionTargets[index] < section.split(' ').length
                })),
                metadata: contentData.metadata,
                originalPrompt: contentData.prompt
            };
        } catch (error) {
            console.error('Error getting content for polishing:', error);
            throw error;
        }
    }

    /**
     * Extract keywords from text using simple NLP techniques
     * @param {string} text - Input text
     * @returns {Array<string>} Extracted keywords
     */
    extractKeywords(text) {
        // Remove common stop words
        const stopWords = new Set([
            'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
            'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
            'will', 'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those',
            'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your',
            'his', 'her', 'its', 'our', 'their', 'about', 'how', 'what', 'when', 'where', 'why', 'which'
        ]);
        
        // Extract words, filter stop words, and get unique keywords
        const words = text.toLowerCase()
            .replace(/[^a-zA-Z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(word => word.length > 2 && !stopWords.has(word));
        
        // Count word frequency
        const wordCount = {};
        words.forEach(word => {
            wordCount[word] = (wordCount[word] || 0) + 1;
        });
        
        // Sort by frequency and return top keywords
        return Object.entries(wordCount)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 20)
            .map(([word]) => word);
    }

    /**
     * Store keywords for efficient searching
     * @param {string} contentId - Content document ID
     * @param {Array<string>} keywords - Keywords to store
     * @param {string} prompt - Original prompt
     * @returns {Promise<void>}
     */
    async storeKeywords(contentId, keywords, prompt) {
        try {
            const keywordDoc = {
                contentId,
                keywords,
                prompt: prompt.toLowerCase().trim(),
                createdAt: new Date()
            };
            
            await this.db.collection(this.KEYWORDS_COLLECTION).add(keywordDoc);
        } catch (error) {
            console.error('Error storing keywords:', error);
        }
    }

    /**
     * Search content by keywords
     * @param {Array<string>} keywords - Keywords to search
     * @returns {Promise<Array>} Matching content IDs
     */
    async searchByKeywords(keywords) {
        try {
            const matches = [];
            
            // Search for content that contains any of the keywords
            for (const keyword of keywords) {
                const keywordQuery = await this.db.collection(this.KEYWORDS_COLLECTION)
                    .where('keywords', 'array-contains', keyword)
                    .limit(50)
                    .get();
                
                keywordQuery.docs.forEach(doc => {
                    const data = doc.data();
                    matches.push({
                        contentId: data.contentId,
                        matchedKeyword: keyword,
                        allKeywords: data.keywords
                    });
                });
            }
            
            // Remove duplicates and count keyword matches
            const contentMatches = {};
            matches.forEach(match => {
                if (!contentMatches[match.contentId]) {
                    contentMatches[match.contentId] = {
                        contentId: match.contentId,
                        matchedKeywords: [],
                        matchCount: 0
                    };
                }
                
                if (!contentMatches[match.contentId].matchedKeywords.includes(match.matchedKeyword)) {
                    contentMatches[match.contentId].matchedKeywords.push(match.matchedKeyword);
                    contentMatches[match.contentId].matchCount++;
                }
            });
            
            // Sort by number of keyword matches
            return Object.values(contentMatches)
                .sort((a, b) => b.matchCount - a.matchCount);
        } catch (error) {
            console.error('Error searching by keywords:', error);
            return [];
        }
    }

    /**
     * Calculate text similarity using Jaccard similarity
     * @param {string} text1 - First text
     * @param {string} text2 - Second text
     * @returns {number} Similarity score (0-1)
     */
    calculateTextSimilarity(text1, text2) {
        const words1 = new Set(text1.toLowerCase().split(/\s+/));
        const words2 = new Set(text2.toLowerCase().split(/\s+/));
        
        const intersection = new Set([...words1].filter(x => words2.has(x)));
        const union = new Set([...words1, ...words2]);
        
        return union.size > 0 ? intersection.size / union.size : 0;
    }

    /**
     * Calculate keyword similarity
     * @param {Array<string>} keywords1 - First set of keywords
     * @param {Array<string>} keywords2 - Second set of keywords
     * @returns {number} Similarity score (0-1)
     */
    calculateKeywordSimilarity(keywords1, keywords2) {
        const set1 = new Set(keywords1);
        const set2 = new Set(keywords2);
        
        const intersection = new Set([...set1].filter(x => set2.has(x)));
        const union = new Set([...set1, ...set2]);
        
        return union.size > 0 ? intersection.size / union.size : 0;
    }

    /**
     * Calculate style and tone match
     * @param {string} targetStyle - Target style
     * @param {string} targetTone - Target tone
     * @param {Object} contentMetadata - Content metadata
     * @returns {number} Match score (0-1)
     */
    calculateStyleToneMatch(targetStyle, targetTone, contentMetadata) {
        const styleMatch = (contentMetadata.style || '').toLowerCase() === targetStyle.toLowerCase() ? 1 : 0;
        const toneMatch = (contentMetadata.tone || '').toLowerCase() === targetTone.toLowerCase() ? 1 : 0;
        
        return (styleMatch + toneMatch) / 2;
    }

    /**
     * Calculate word count similarity
     * @param {number} targetCount - Target word count
     * @param {number} actualCount - Actual word count
     * @returns {number} Similarity score (0-1)
     */
    calculateWordCountSimilarity(targetCount, actualCount) {
        const ratio = Math.min(targetCount, actualCount) / Math.max(targetCount, actualCount);
        return ratio;
    }

    /**
     * Split content into logical sections
     * @param {string} content - Content to split
     * @returns {Array<string>} Content sections
     */
    splitContentIntoSections(content) {
        // Split by double line breaks (paragraphs)
        const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim().length > 0);
        
        if (paragraphs.length <= 3) {
            return paragraphs;
        }
        
        // Group paragraphs into logical sections (introduction, body, conclusion)
        const sections = [];
        const sectionSize = Math.ceil(paragraphs.length / 3);
        
        for (let i = 0; i < paragraphs.length; i += sectionSize) {
            sections.push(paragraphs.slice(i, i + sectionSize).join('\n\n'));
        }
        
        return sections;
    }

    /**
     * Calculate target word counts for sections
     * @param {Array<string>} sections - Content sections
     * @param {number} targetWordCount - Total target word count
     * @returns {Array<number>} Target word counts per section
     */
    calculateSectionTargets(sections, targetWordCount) {
        const totalCurrentWords = sections.reduce((sum, section) => sum + section.split(' ').length, 0);
        const ratio = targetWordCount / totalCurrentWords;
        
        return sections.map(section => Math.round(section.split(' ').length * ratio));
    }

    /**
     * Update access statistics for content
     * @param {Array<string>} contentIds - Content IDs to update
     * @returns {Promise<void>}
     */
    async updateAccessStatistics(contentIds) {
        try {
            const batch = this.db.batch();
            
            contentIds.forEach(contentId => {
                const contentRef = this.db.collection(this.CONTENT_COLLECTION).doc(contentId);
                batch.update(contentRef, {
                    lastAccessed: new Date(),
                    accessCount: admin.firestore.FieldValue.increment(1)
                });
            });
            
            await batch.commit();
        } catch (error) {
            console.error('Error updating access statistics:', error);
        }
    }

    /**
     * Generate content hash for deduplication
     * @param {string} content - Content to hash
     * @returns {string} Content hash
     */
    generateContentHash(content) {
        // Simple hash function for content deduplication
        let hash = 0;
        for (let i = 0; i < content.length; i++) {
            const char = content.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return hash.toString(36);
    }

    /**
     * Clean up old or unused content
     * @param {number} daysOld - Days old threshold
     * @returns {Promise<number>} Number of documents cleaned
     */
    async cleanupOldContent(daysOld = 90) {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysOld);
            
            const oldContentQuery = await this.db.collection(this.CONTENT_COLLECTION)
                .where('lastAccessed', '<', cutoffDate)
                .where('accessCount', '<=', 1)
                .limit(100)
                .get();
            
            const batch = this.db.batch();
            let cleanedCount = 0;
            
            oldContentQuery.docs.forEach(doc => {
                batch.update(doc.ref, { isActive: false });
                cleanedCount++;
            });
            
            if (cleanedCount > 0) {
                await batch.commit();
                console.log(`Cleaned up ${cleanedCount} old content documents`);
            }
            
            return cleanedCount;
        } catch (error) {
            console.error('Error cleaning up old content:', error);
            return 0;
        }
    }
}

module.exports = ContentDatabase;