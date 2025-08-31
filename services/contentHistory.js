const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');

class ContentHistoryService {
  constructor() {
    this.db = admin.firestore();
  }

  /**
   * Save final content and comprehensive metadata to user's history
   * @param {string} userId - User ID
   * @param {Object} contentData - Complete content data
   * @returns {Object} Saved content document with ID
   */
  async saveContentToHistory(userId, contentData) {
    try {
      const contentId = uuidv4();
      const timestamp = admin.firestore.FieldValue.serverTimestamp();
      
      // Prepare comprehensive metadata
      const contentDocument = {
        id: contentId,
        userId,
        
        // Content data
        content: contentData.finalContent,
        title: contentData.title || this.extractTitle(contentData.finalContent),
        
        // Generation metadata
        prompt: contentData.prompt,
        style: contentData.style,
        tone: contentData.tone,
        wordCount: contentData.finalWordCount,
        
        // Multi-part generation info
        isMultiPart: contentData.isMultiPart || false,
        chunksGenerated: contentData.chunksGenerated || 1,
        refinementCycles: contentData.refinementCycles || 0,
        
        // Detection and quality metrics
        finalDetectionResults: contentData.finalDetectionResults || {},
        originalityScore: contentData.finalDetectionResults?.originalityScore || null,
        aiDetectionScore: contentData.finalDetectionResults?.aiDetectionScore || null,
        plagiarismScore: contentData.finalDetectionResults?.plagiarismScore || null,
        
        // Citation information
        citationsUsed: contentData.citationsUsed || false,
        citationStyle: contentData.citationStyle || null,
        citationCount: contentData.citationCount || 0,
        bibliography: contentData.bibliography || [],
        
        // Generation statistics
        generationTime: contentData.generationTime || 0,
        creditsUsed: contentData.creditsUsed || 0,
        transactionId: contentData.transactionId || null,
        
        // Content optimization
        usedSimilarContent: contentData.usedSimilarContent || false,
        similarContentId: contentData.similarContentId || null,
        optimizationApplied: contentData.optimizationApplied || false,
        
        // User plan and limits
        userPlan: contentData.userPlan,
        planLimits: contentData.planLimits || {},
        
        // Timestamps
        createdAt: timestamp,
        updatedAt: timestamp,
        
        // Status and flags
        status: 'completed',
        isPublic: false,
        isFavorite: false,
        tags: contentData.tags || [],
        
        // Export and sharing
        exportFormats: [],
        sharedWith: [],
        
        // Version control
        version: 1,
        parentContentId: null,
        
        // Analytics
        viewCount: 0,
        editCount: 0,
        lastViewedAt: null,
        lastEditedAt: null
      };
      
      // Save to Firestore
      await this.db.collection('contentHistory').doc(contentId).set(contentDocument);
      
      // Update user statistics
      await this.updateUserStatistics(userId, contentDocument);
      
      return {
        success: true,
        contentId,
        document: contentDocument
      };
      
    } catch (error) {
      console.error('Content history save error:', error);
      throw new Error(`Failed to save content to history: ${error.message}`);
    }
  }

  /**
   * Retrieve user's content history with pagination and filtering
   * @param {string} userId - User ID
   * @param {Object} options - Query options
   * @returns {Object} Content history results
   */
  async getUserContentHistory(userId, options = {}) {
    try {
      const {
        limit = 20,
        offset = 0,
        sortBy = 'createdAt',
        sortOrder = 'desc',
        filterBy = {},
        searchQuery = ''
      } = options;
      
      let query = this.db.collection('contentHistory')
        .where('userId', '==', userId);
      
      // Apply filters
      if (filterBy.style) {
        query = query.where('style', '==', filterBy.style);
      }
      
      if (filterBy.isMultiPart !== undefined) {
        query = query.where('isMultiPart', '==', filterBy.isMultiPart);
      }
      
      if (filterBy.citationsUsed !== undefined) {
        query = query.where('citationsUsed', '==', filterBy.citationsUsed);
      }
      
      if (filterBy.userPlan) {
        query = query.where('userPlan', '==', filterBy.userPlan);
      }
      
      // Apply sorting
      query = query.orderBy(sortBy, sortOrder);
      
      // Apply pagination
      if (offset > 0) {
        const offsetSnapshot = await query.limit(offset).get();
        if (!offsetSnapshot.empty) {
          const lastDoc = offsetSnapshot.docs[offsetSnapshot.docs.length - 1];
          query = query.startAfter(lastDoc);
        }
      }
      
      query = query.limit(limit);
      
      const snapshot = await query.get();
      const contents = [];
      
      snapshot.forEach(doc => {
        const data = doc.data();
        
        // Apply text search if provided
        if (searchQuery) {
          const searchLower = searchQuery.toLowerCase();
          const titleMatch = data.title?.toLowerCase().includes(searchLower);
          const promptMatch = data.prompt?.toLowerCase().includes(searchLower);
          const contentMatch = data.content?.toLowerCase().includes(searchLower);
          
          if (!titleMatch && !promptMatch && !contentMatch) {
            return;
          }
        }
        
        contents.push({
          id: doc.id,
          ...data,
          // Remove large content field for list view
          content: data.content?.substring(0, 200) + '...',
          createdAt: data.createdAt?.toDate(),
          updatedAt: data.updatedAt?.toDate()
        });
      });
      
      return {
        success: true,
        contents,
        total: contents.length,
        hasMore: snapshot.size === limit
      };
      
    } catch (error) {
      console.error('Content history retrieval error:', error);
      throw new Error(`Failed to retrieve content history: ${error.message}`);
    }
  }

  /**
   * Get specific content by ID
   * @param {string} contentId - Content ID
   * @param {string} userId - User ID for authorization
   * @returns {Object} Content document
   */
  async getContentById(contentId, userId) {
    try {
      const doc = await this.db.collection('contentHistory').doc(contentId).get();
      
      if (!doc.exists) {
        throw new Error('Content not found');
      }
      
      const data = doc.data();
      
      // Verify user ownership
      if (data.userId !== userId) {
        throw new Error('Unauthorized access to content');
      }
      
      // Update view statistics
      await this.updateViewStatistics(contentId);
      
      return {
        success: true,
        content: {
          id: doc.id,
          ...data,
          createdAt: data.createdAt?.toDate(),
          updatedAt: data.updatedAt?.toDate(),
          lastViewedAt: data.lastViewedAt?.toDate(),
          lastEditedAt: data.lastEditedAt?.toDate()
        }
      };
      
    } catch (error) {
      console.error('Content retrieval error:', error);
      throw new Error(`Failed to retrieve content: ${error.message}`);
    }
  }

  /**
   * Update content (for editing)
   * @param {string} contentId - Content ID
   * @param {string} userId - User ID
   * @param {Object} updates - Content updates
   * @returns {Object} Update result
   */
  async updateContent(contentId, userId, updates) {
    try {
      const doc = await this.db.collection('contentHistory').doc(contentId).get();
      
      if (!doc.exists) {
        throw new Error('Content not found');
      }
      
      const data = doc.data();
      
      if (data.userId !== userId) {
        throw new Error('Unauthorized access to content');
      }
      
      const updateData = {
        ...updates,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastEditedAt: admin.firestore.FieldValue.serverTimestamp(),
        editCount: admin.firestore.FieldValue.increment(1),
        version: admin.firestore.FieldValue.increment(1)
      };
      
      // Recalculate word count if content changed
      if (updates.content) {
        updateData.wordCount = this.countWords(updates.content);
      }
      
      await this.db.collection('contentHistory').doc(contentId).update(updateData);
      
      return {
        success: true,
        contentId,
        updated: Object.keys(updates)
      };
      
    } catch (error) {
      console.error('Content update error:', error);
      throw new Error(`Failed to update content: ${error.message}`);
    }
  }

  /**
   * Delete content from history
   * @param {string} contentId - Content ID
   * @param {string} userId - User ID
   * @returns {Object} Deletion result
   */
  async deleteContent(contentId, userId) {
    try {
      const doc = await this.db.collection('contentHistory').doc(contentId).get();
      
      if (!doc.exists) {
        throw new Error('Content not found');
      }
      
      const data = doc.data();
      
      if (data.userId !== userId) {
        throw new Error('Unauthorized access to content');
      }
      
      await this.db.collection('contentHistory').doc(contentId).delete();
      
      return {
        success: true,
        contentId,
        deleted: true
      };
      
    } catch (error) {
      console.error('Content deletion error:', error);
      throw new Error(`Failed to delete content: ${error.message}`);
    }
  }

  /**
   * Get user content statistics
   * @param {string} userId - User ID
   * @returns {Object} User statistics
   */
  async getUserStatistics(userId) {
    try {
      const statsDoc = await this.db.collection('userStats').doc(userId).get();
      
      if (!statsDoc.exists) {
        return {
          totalContents: 0,
          totalWords: 0,
          totalCreditsUsed: 0,
          averageWordCount: 0,
          contentsByStyle: {},
          contentsByPlan: {},
          monthlyUsage: {}
        };
      }
      
      return statsDoc.data();
      
    } catch (error) {
      console.error('Statistics retrieval error:', error);
      return {};
    }
  }

  /**
   * Update user statistics after content creation
   * @param {string} userId - User ID
   * @param {Object} contentDocument - Content document
   */
  async updateUserStatistics(userId, contentDocument) {
    try {
      const statsRef = this.db.collection('userStats').doc(userId);
      const currentMonth = new Date().toISOString().substring(0, 7); // YYYY-MM
      
      await this.db.runTransaction(async (transaction) => {
        const statsDoc = await transaction.get(statsRef);
        
        let stats = statsDoc.exists ? statsDoc.data() : {
          totalContents: 0,
          totalWords: 0,
          totalCreditsUsed: 0,
          contentsByStyle: {},
          contentsByPlan: {},
          monthlyUsage: {}
        };
        
        // Update totals
        stats.totalContents += 1;
        stats.totalWords += contentDocument.wordCount;
        stats.totalCreditsUsed += contentDocument.creditsUsed;
        stats.averageWordCount = Math.round(stats.totalWords / stats.totalContents);
        
        // Update style breakdown
        const style = contentDocument.style || 'unknown';
        stats.contentsByStyle[style] = (stats.contentsByStyle[style] || 0) + 1;
        
        // Update plan breakdown
        const plan = contentDocument.userPlan || 'unknown';
        stats.contentsByPlan[plan] = (stats.contentsByPlan[plan] || 0) + 1;
        
        // Update monthly usage
        if (!stats.monthlyUsage[currentMonth]) {
          stats.monthlyUsage[currentMonth] = {
            contents: 0,
            words: 0,
            credits: 0
          };
        }
        
        stats.monthlyUsage[currentMonth].contents += 1;
        stats.monthlyUsage[currentMonth].words += contentDocument.wordCount;
        stats.monthlyUsage[currentMonth].credits += contentDocument.creditsUsed;
        
        stats.lastUpdated = admin.firestore.FieldValue.serverTimestamp();
        
        transaction.set(statsRef, stats, { merge: true });
      });
      
    } catch (error) {
      console.error('Statistics update error:', error);
    }
  }

  /**
   * Update view statistics for content
   * @param {string} contentId - Content ID
   */
  async updateViewStatistics(contentId) {
    try {
      await this.db.collection('contentHistory').doc(contentId).update({
        viewCount: admin.firestore.FieldValue.increment(1),
        lastViewedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (error) {
      console.error('View statistics update error:', error);
    }
  }

  /**
   * Extract title from content
   * @param {string} content - Content text
   * @returns {string} Extracted title
   */
  extractTitle(content) {
    if (!content) return 'Untitled Content';
    
    // Try to find a title in the first few lines
    const lines = content.split('\n').filter(line => line.trim());
    const firstLine = lines[0]?.trim();
    
    if (firstLine && firstLine.length < 100) {
      return firstLine.replace(/^#+\s*/, ''); // Remove markdown headers
    }
    
    // Fallback: use first 50 characters
    return content.substring(0, 50).trim() + '...';
  }

  /**
   * Count words in content
   * @param {string} content - Content text
   * @returns {number} Word count
   */
  countWords(content) {
    if (!content) return 0;
    return content.trim().split(/\s+/).filter(word => word.length > 0).length;
  }
}

module.exports = ContentHistoryService;