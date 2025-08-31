const OriginalityDetection = require('./originalityDetection');
const admin = require('firebase-admin');

class FinalDetectionService {
  constructor() {
    this.originalityDetection = new OriginalityDetection();
    this.db = admin.firestore();
  }

  /**
   * Process final detection for combined multi-part content
   * @param {string} combinedContent - Complete stitched content
   * @param {Array} chunkDetectionResults - Individual chunk detection results
   * @param {Object} metadata - Content metadata
   * @returns {Object} Comprehensive final detection results
   */
  async processFinalDetection(combinedContent, chunkDetectionResults = [], metadata = {}) {
    try {
      const startTime = Date.now();
      
      // Step 1: Run detection on complete combined content
      const fullContentDetection = await this.originalityDetection.detectContent(combinedContent);
      
      // Step 2: Analyze chunk-level results
      const chunkAnalysis = this.analyzeChunkResults(chunkDetectionResults);
      
      // Step 3: Compare and reconcile results
      const reconciledResults = this.reconcileDetectionResults(
        fullContentDetection,
        chunkAnalysis,
        combinedContent
      );
      
      // Step 4: Generate comprehensive report
      const finalReport = await this.generateFinalReport(
        reconciledResults,
        combinedContent,
        metadata
      );
      
      // Step 5: Store detection results
      await this.storeDetectionResults(finalReport, metadata);
      
      const processingTime = Date.now() - startTime;
      
      return {
        ...finalReport,
        processingTime,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('Final detection processing error:', error);
      return {
        success: false,
        error: error.message,
        fallbackResults: this.generateFallbackResults(chunkDetectionResults)
      };
    }
  }

  /**
   * Analyze individual chunk detection results
   * @param {Array} chunkResults - Array of chunk detection results
   * @returns {Object} Aggregated chunk analysis
   */
  analyzeChunkResults(chunkResults) {
    if (!chunkResults || chunkResults.length === 0) {
      return {
        averageOriginalityScore: 100,
        averageAiScore: 0,
        averagePlagiarismScore: 0,
        totalChunks: 0,
        problematicChunks: 0,
        refinementCycles: 0
      };
    }

    const validResults = chunkResults.filter(result => result && result.success);
    
    if (validResults.length === 0) {
      return this.analyzeChunkResults([]);
    }

    const totalChunks = validResults.length;
    let totalOriginality = 0;
    let totalAiScore = 0;
    let totalPlagiarism = 0;
    let problematicChunks = 0;
    let totalRefinements = 0;

    validResults.forEach(result => {
      const detection = result.detectionResults || {};
      
      totalOriginality += detection.originalityScore || 100;
      totalAiScore += detection.aiDetectionScore || 0;
      totalPlagiarism += detection.plagiarismScore || 0;
      
      if (detection.severity === 'high' || detection.severity === 'medium') {
        problematicChunks++;
      }
      
      totalRefinements += result.refinementCycles || 0;
    });

    return {
      averageOriginalityScore: Math.round(totalOriginality / totalChunks),
      averageAiScore: Math.round(totalAiScore / totalChunks),
      averagePlagiarismScore: Math.round(totalPlagiarism / totalChunks),
      totalChunks,
      problematicChunks,
      refinementCycles: totalRefinements,
      chunkSuccessRate: Math.round((validResults.length / chunkResults.length) * 100)
    };
  }

  /**
   * Reconcile full content detection with chunk analysis
   * @param {Object} fullDetection - Full content detection results
   * @param {Object} chunkAnalysis - Aggregated chunk analysis
   * @param {string} content - Complete content
   * @returns {Object} Reconciled detection results
   */
  reconcileDetectionResults(fullDetection, chunkAnalysis, content) {
    const wordCount = this.countWords(content);
    
    // Use full content detection as primary, chunk analysis as secondary
    const primaryResults = fullDetection.success ? fullDetection.detectionResults : {};
    
    return {
      // Primary scores (from full content detection)
      originalityScore: primaryResults.originalityScore || chunkAnalysis.averageOriginalityScore,
      aiDetectionScore: primaryResults.aiDetectionScore || chunkAnalysis.averageAiScore,
      plagiarismScore: primaryResults.plagiarismScore || chunkAnalysis.averagePlagiarismScore,
      
      // Severity assessment
      severity: this.calculateOverallSeverity(primaryResults, chunkAnalysis),
      
      // Confidence metrics
      confidence: this.calculateConfidence(fullDetection, chunkAnalysis),
      
      // Detailed breakdown
      fullContentDetection: {
        success: fullDetection.success,
        originalityScore: primaryResults.originalityScore,
        aiDetectionScore: primaryResults.aiDetectionScore,
        plagiarismScore: primaryResults.plagiarismScore,
        severity: primaryResults.severity
      },
      
      chunkAnalysis,
      
      // Content metrics
      wordCount,
      characterCount: content.length,
      
      // Quality indicators
      qualityScore: this.calculateQualityScore(primaryResults, chunkAnalysis, wordCount),
      
      // Recommendations
      recommendations: this.generateRecommendations(primaryResults, chunkAnalysis),
      
      // Flags
      requiresReview: this.requiresReview(primaryResults, chunkAnalysis),
      isAcceptable: this.isAcceptable(primaryResults, chunkAnalysis)
    };
  }

  /**
   * Calculate overall severity
   * @param {Object} primaryResults - Primary detection results
   * @param {Object} chunkAnalysis - Chunk analysis
   * @returns {string} Overall severity level
   */
  calculateOverallSeverity(primaryResults, chunkAnalysis) {
    const aiScore = primaryResults.aiDetectionScore || chunkAnalysis.averageAiScore;
    const plagiarismScore = primaryResults.plagiarismScore || chunkAnalysis.averagePlagiarismScore;
    const originalityScore = primaryResults.originalityScore || chunkAnalysis.averageOriginalityScore;
    
    if (aiScore > 80 || plagiarismScore > 30 || originalityScore < 60) {
      return 'high';
    } else if (aiScore > 60 || plagiarismScore > 15 || originalityScore < 80) {
      return 'medium';
    } else if (aiScore > 40 || plagiarismScore > 5 || originalityScore < 90) {
      return 'low';
    }
    
    return 'minimal';
  }

  /**
   * Calculate confidence in detection results
   * @param {Object} fullDetection - Full content detection
   * @param {Object} chunkAnalysis - Chunk analysis
   * @returns {number} Confidence percentage
   */
  calculateConfidence(fullDetection, chunkAnalysis) {
    let confidence = 50; // Base confidence
    
    // Increase confidence if full detection succeeded
    if (fullDetection.success) {
      confidence += 30;
    }
    
    // Increase confidence based on chunk success rate
    if (chunkAnalysis.chunkSuccessRate) {
      confidence += (chunkAnalysis.chunkSuccessRate / 100) * 20;
    }
    
    // Decrease confidence if results are inconsistent
    if (fullDetection.success && chunkAnalysis.totalChunks > 0) {
      const fullAi = fullDetection.detectionResults?.aiDetectionScore || 0;
      const chunkAi = chunkAnalysis.averageAiScore || 0;
      const aiDifference = Math.abs(fullAi - chunkAi);
      
      if (aiDifference > 20) {
        confidence -= 15;
      }
    }
    
    return Math.max(0, Math.min(100, Math.round(confidence)));
  }

  /**
   * Calculate overall quality score
   * @param {Object} primaryResults - Primary detection results
   * @param {Object} chunkAnalysis - Chunk analysis
   * @param {number} wordCount - Content word count
   * @returns {number} Quality score (0-100)
   */
  calculateQualityScore(primaryResults, chunkAnalysis, wordCount) {
    const originalityScore = primaryResults.originalityScore || chunkAnalysis.averageOriginalityScore;
    const aiScore = primaryResults.aiDetectionScore || chunkAnalysis.averageAiScore;
    const plagiarismScore = primaryResults.plagiarismScore || chunkAnalysis.averagePlagiarismScore;
    
    // Base quality from originality (40% weight)
    let quality = originalityScore * 0.4;
    
    // Penalty for high AI detection (30% weight)
    quality += (100 - aiScore) * 0.3;
    
    // Penalty for plagiarism (20% weight)
    quality += (100 - plagiarismScore) * 0.2;
    
    // Bonus for appropriate length (10% weight)
    const lengthBonus = wordCount >= 500 ? 10 : (wordCount / 500) * 10;
    quality += lengthBonus;
    
    return Math.max(0, Math.min(100, Math.round(quality)));
  }

  /**
   * Generate recommendations based on detection results
   * @param {Object} primaryResults - Primary detection results
   * @param {Object} chunkAnalysis - Chunk analysis
   * @returns {Array} Array of recommendations
   */
  generateRecommendations(primaryResults, chunkAnalysis) {
    const recommendations = [];
    
    const aiScore = primaryResults.aiDetectionScore || chunkAnalysis.averageAiScore;
    const plagiarismScore = primaryResults.plagiarismScore || chunkAnalysis.averagePlagiarismScore;
    const originalityScore = primaryResults.originalityScore || chunkAnalysis.averageOriginalityScore;
    
    if (aiScore > 70) {
      recommendations.push({
        type: 'ai_detection',
        severity: 'high',
        message: 'Content shows high AI detection scores. Consider manual revision to improve naturalness.'
      });
    } else if (aiScore > 50) {
      recommendations.push({
        type: 'ai_detection',
        severity: 'medium',
        message: 'Content may benefit from additional human-like refinements.'
      });
    }
    
    if (plagiarismScore > 20) {
      recommendations.push({
        type: 'plagiarism',
        severity: 'high',
        message: 'High plagiarism detected. Review and rewrite flagged sections.'
      });
    } else if (plagiarismScore > 10) {
      recommendations.push({
        type: 'plagiarism',
        severity: 'medium',
        message: 'Some content similarity detected. Consider paraphrasing.'
      });
    }
    
    if (originalityScore < 70) {
      recommendations.push({
        type: 'originality',
        severity: 'high',
        message: 'Content lacks originality. Add unique insights and perspectives.'
      });
    }
    
    if (chunkAnalysis.problematicChunks > chunkAnalysis.totalChunks * 0.5) {
      recommendations.push({
        type: 'quality',
        severity: 'medium',
        message: 'Multiple sections required refinement. Consider overall content strategy review.'
      });
    }
    
    if (recommendations.length === 0) {
      recommendations.push({
        type: 'quality',
        severity: 'low',
        message: 'Content meets quality standards. Consider final proofreading.'
      });
    }
    
    return recommendations;
  }

  /**
   * Determine if content requires manual review
   * @param {Object} primaryResults - Primary detection results
   * @param {Object} chunkAnalysis - Chunk analysis
   * @returns {boolean} Whether review is required
   */
  requiresReview(primaryResults, chunkAnalysis) {
    const aiScore = primaryResults.aiDetectionScore || chunkAnalysis.averageAiScore;
    const plagiarismScore = primaryResults.plagiarismScore || chunkAnalysis.averagePlagiarismScore;
    const originalityScore = primaryResults.originalityScore || chunkAnalysis.averageOriginalityScore;
    
    return aiScore > 80 || plagiarismScore > 25 || originalityScore < 60;
  }

  /**
   * Determine if content is acceptable for delivery
   * @param {Object} primaryResults - Primary detection results
   * @param {Object} chunkAnalysis - Chunk analysis
   * @returns {boolean} Whether content is acceptable
   */
  isAcceptable(primaryResults, chunkAnalysis) {
    const aiScore = primaryResults.aiDetectionScore || chunkAnalysis.averageAiScore;
    const plagiarismScore = primaryResults.plagiarismScore || chunkAnalysis.averagePlagiarismScore;
    const originalityScore = primaryResults.originalityScore || chunkAnalysis.averageOriginalityScore;
    
    return aiScore <= 70 && plagiarismScore <= 20 && originalityScore >= 70;
  }

  /**
   * Generate comprehensive final report
   * @param {Object} reconciledResults - Reconciled detection results
   * @param {string} content - Complete content
   * @param {Object} metadata - Content metadata
   * @returns {Object} Final detection report
   */
  async generateFinalReport(reconciledResults, content, metadata) {
    return {
      success: true,
      
      // Core detection metrics
      originalityScore: reconciledResults.originalityScore,
      aiDetectionScore: reconciledResults.aiDetectionScore,
      plagiarismScore: reconciledResults.plagiarismScore,
      qualityScore: reconciledResults.qualityScore,
      
      // Overall assessment
      severity: reconciledResults.severity,
      confidence: reconciledResults.confidence,
      requiresReview: reconciledResults.requiresReview,
      isAcceptable: reconciledResults.isAcceptable,
      
      // Detailed breakdown
      fullContentDetection: reconciledResults.fullContentDetection,
      chunkAnalysis: reconciledResults.chunkAnalysis,
      
      // Content metrics
      wordCount: reconciledResults.wordCount,
      characterCount: reconciledResults.characterCount,
      
      // Recommendations and actions
      recommendations: reconciledResults.recommendations,
      
      // Metadata
      contentId: metadata.contentId,
      userId: metadata.userId,
      isMultiPart: metadata.isMultiPart || false,
      generationMethod: metadata.generationMethod || 'multi-part',
      
      // Processing info
      detectionProvider: 'originality.ai',
      processingDate: new Date().toISOString(),
      version: '1.0'
    };
  }

  /**
   * Store detection results for future reference
   * @param {Object} finalReport - Final detection report
   * @param {Object} metadata - Content metadata
   */
  async storeDetectionResults(finalReport, metadata) {
    try {
      if (!metadata.contentId) return;
      
      const detectionDoc = {
        contentId: metadata.contentId,
        userId: metadata.userId,
        detectionResults: finalReport,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      };
      
      await this.db.collection('detectionResults').doc(metadata.contentId).set(detectionDoc);
      
    } catch (error) {
      console.error('Detection results storage error:', error);
    }
  }

  /**
   * Generate fallback results when detection fails
   * @param {Array} chunkResults - Chunk detection results
   * @returns {Object} Fallback detection results
   */
  generateFallbackResults(chunkResults) {
    const chunkAnalysis = this.analyzeChunkResults(chunkResults);
    
    return {
      success: false,
      originalityScore: chunkAnalysis.averageOriginalityScore,
      aiDetectionScore: chunkAnalysis.averageAiScore,
      plagiarismScore: chunkAnalysis.averagePlagiarismScore,
      qualityScore: 75, // Conservative estimate
      severity: 'unknown',
      confidence: 30,
      requiresReview: true,
      isAcceptable: false,
      recommendations: [{
        type: 'system',
        severity: 'high',
        message: 'Detection service unavailable. Manual review recommended.'
      }],
      fallback: true
    };
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

module.exports = FinalDetectionService;