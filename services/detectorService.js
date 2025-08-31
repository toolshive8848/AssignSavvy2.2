const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const admin = require('firebase-admin');
const AtomicCreditSystem = require('./atomicCreditSystem');
const PlanValidator = require('./planValidator');

class DetectorService {
  constructor() {
    // TODO: Add your Originality.ai API key here - Get from https://originality.ai/dashboard
    // Required for plagiarism and AI content detection
    this.originalityApiKey = process.env.ORIGINALITY_API_KEY; // Add your Originality.ai API key
    this.originalityBaseUrl = 'https://api.originality.ai/api/v1';
    
    // TODO: Add your Gemini API key here - Get from Google AI Studio (https://makersuite.google.com/app/apikey)
    // Required for Gemini 2.5 Pro model used in content improvement
    this.geminiApiKey = process.env.GEMINI_API_KEY; // Add your Gemini API key
    this.genAI = new GoogleGenerativeAI(this.geminiApiKey);
    this.atomicCredit = new AtomicCreditSystem();
    this.planValidator = new PlanValidator();
    this.db = admin.firestore();
    
    // Credit costs - now handled by AtomicCreditSystem
    // Detection: 50 credits per 1000 words
    // Generation: 1 credit per 10 words
  }

  /**
   * Calculate word count from text
   */
  calculateWordCount(text) {
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
  }

  /**
   * Calculate detection credits needed
   */
  calculateDetectionCredits(wordCount) {
    return this.atomicCredit.calculateRequiredCredits(wordCount, 'detector', 'detection');
  }

  /**
   * Calculate generation credits needed
   */
  calculateGenerationCredits(wordCount) {
    return this.atomicCredit.calculateRequiredCredits(wordCount, 'detector', 'generation');
  }

  /**
   * Analyze content using Originality.ai
   */
  async analyzeContent(userId, content, options = {}) {
    try {
      // Validate user plan
      const planValidation = await this.planValidator.validateUserPlan(userId, {
        toolType: 'detector',
        requestType: 'analysis'
      });

      if (!planValidation.isValid) {
        throw new Error(planValidation.error || 'Plan validation failed');
      }

      const wordCount = this.calculateWordCount(content);
      const creditsNeeded = this.calculateDetectionCredits(wordCount);

      // Deduct credits atomically
      const creditResult = await this.atomicCredit.deductCreditsAtomic(
        userId,
        creditsNeeded, // Pass credits directly for detector tool
        planValidation.userPlan.planType,
        'detector'
      );

      if (!creditResult.success) {
        throw new Error(`Insufficient credits. Need ${creditsNeeded}, available: ${creditResult.previousBalance || 0}`);
      }

      const analysisResults = {};

      try {
        // Perform analyses based on options
        if (options.plagiarismDetection !== false) {
          analysisResults.plagiarism = await this.detectPlagiarism(content);
        }

        if (options.aiDetection !== false) {
          analysisResults.aiContent = await this.detectAIContent(content);
        }

        if (options.readabilityAnalysis !== false) {
          analysisResults.readability = await this.analyzeReadability(content);
        }

        // Store analysis result
        const analysisId = await this.storeDetectorResult({
          userId,
          content,
          results: analysisResults,
          wordCount,
          creditsUsed: creditsNeeded,
          timestamp: new Date()
        });

        return {
          success: true,
          analysisId,
          wordCount,
          creditsUsed: creditsNeeded,
          results: analysisResults
        };

      } catch (analysisError) {
        // Rollback credits on failure
        await this.atomicCredit.rollbackTransaction(
          userId,
          creditResult.transactionId,
          creditsNeeded,
          0 // No words to deduct for detector
        );
        throw analysisError;
      }

    } catch (error) {
      console.error('Content analysis error:', error);
      throw new Error(`Analysis failed: ${error.message}`);
    }
  }

  /**
   * Detect plagiarism using Originality.ai
   */
  async detectPlagiarism(content) {
    try {
      const response = await axios.post(
        `${this.originalityBaseUrl}/scan/plagiarism`,
        {
          content: content,
          title: 'Content Analysis',
          aiModelVersion: '1',
          storeScan: false
        },
        {
          headers: {
            'X-OAI-API-KEY': this.originalityApiKey,
            'Content-Type': 'application/json'
          }
        }
      );

      const result = response.data;
      return {
        score: Math.round((1 - result.score.original) * 100), // Convert to plagiarism percentage
        originalityScore: Math.round(result.score.original * 100),
        matches: result.matches || [],
        sources: result.sources || [],
        status: result.score.original > 0.7 ? 'low_risk' : result.score.original > 0.4 ? 'medium_risk' : 'high_risk'
      };
    } catch (error) {
      console.error('Plagiarism detection error:', error);
      throw new Error('Plagiarism detection failed');
    }
  }

  /**
   * Detect AI-generated content using Originality.ai
   */
  async detectAIContent(content) {
    try {
      const response = await axios.post(
        `${this.originalityBaseUrl}/scan/ai`,
        {
          content: content,
          title: 'AI Content Analysis',
          aiModelVersion: '1',
          storeScan: false
        },
        {
          headers: {
            'X-OAI-API-KEY': this.originalityApiKey,
            'Content-Type': 'application/json'
          }
        }
      );

      const result = response.data;
      return {
        score: Math.round(result.score.ai * 100), // AI probability percentage
        humanScore: Math.round(result.score.original * 100),
        confidence: result.confidence || 'medium',
        status: result.score.ai < 0.3 ? 'likely_human' : result.score.ai < 0.7 ? 'mixed' : 'likely_ai'
      };
    } catch (error) {
      console.error('AI detection error:', error);
      throw new Error('AI content detection failed');
    }
  }

  /**
   * Analyze readability using Originality.ai
   */
  async analyzeReadability(content) {
    try {
      const response = await axios.post(
        `${this.originalityBaseUrl}/scan/readability`,
        {
          content: content,
          title: 'Readability Analysis'
        },
        {
          headers: {
            'X-OAI-API-KEY': this.originalityApiKey,
            'Content-Type': 'application/json'
          }
        }
      );

      const result = response.data;
      return {
        fleschKincaidGrade: result.readability?.fleschKincaidGrade || 0,
        fleschReadingEase: result.readability?.fleschReadingEase || 0,
        gunningFog: result.readability?.gunningFog || 0,
        smogIndex: result.readability?.smogIndex || 0,
        automatedReadabilityIndex: result.readability?.automatedReadabilityIndex || 0,
        averageGradeLevel: result.readability?.averageGradeLevel || 0,
        readingLevel: this.getReadingLevel(result.readability?.averageGradeLevel || 0)
      };
    } catch (error) {
      console.error('Readability analysis error:', error);
      // Return basic readability metrics if API fails
      return this.calculateBasicReadability(content);
    }
  }

  /**
   * Calculate basic readability metrics as fallback
   */
  calculateBasicReadability(content) {
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const words = content.trim().split(/\s+/).filter(word => word.length > 0);
    const syllables = words.reduce((count, word) => count + this.countSyllables(word), 0);

    const avgWordsPerSentence = words.length / sentences.length;
    const avgSyllablesPerWord = syllables / words.length;

    // Flesch Reading Ease
    const fleschReadingEase = 206.835 - (1.015 * avgWordsPerSentence) - (84.6 * avgSyllablesPerWord);
    
    // Flesch-Kincaid Grade Level
    const fleschKincaidGrade = (0.39 * avgWordsPerSentence) + (11.8 * avgSyllablesPerWord) - 15.59;

    return {
      fleschKincaidGrade: Math.round(fleschKincaidGrade * 10) / 10,
      fleschReadingEase: Math.round(fleschReadingEase * 10) / 10,
      gunningFog: 0,
      smogIndex: 0,
      automatedReadabilityIndex: 0,
      averageGradeLevel: Math.round(fleschKincaidGrade * 10) / 10,
      readingLevel: this.getReadingLevel(fleschKincaidGrade)
    };
  }

  /**
   * Count syllables in a word (approximation)
   */
  countSyllables(word) {
    word = word.toLowerCase();
    if (word.length <= 3) return 1;
    word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
    word = word.replace(/^y/, '');
    const matches = word.match(/[aeiouy]{1,2}/g);
    return matches ? matches.length : 1;
  }

  /**
   * Get reading level description
   */
  getReadingLevel(gradeLevel) {
    if (gradeLevel < 6) return 'Elementary';
    if (gradeLevel < 9) return 'Middle School';
    if (gradeLevel < 13) return 'High School';
    if (gradeLevel < 16) return 'College';
    return 'Graduate';
  }

  /**
   * Remove detected issues using Gemini 2.5 Pro
   */
  async removeDetectedIssues(userId, content, detectionResults, options = {}) {
    try {
      // Validate user plan
      const planValidation = await this.planValidator.validateUserPlan(userId, {
        toolType: 'detector',
        requestType: 'removal'
      });

      if (!planValidation.isValid) {
        throw new Error(planValidation.error || 'Plan validation failed');
      }

      const wordCount = this.calculateWordCount(content);
      const creditsNeeded = this.calculateGenerationCredits(wordCount);

      // Deduct credits atomically for content generation
      const creditResult = await this.atomicCredit.deductCreditsAtomic(
        userId,
        wordCount, // Pass word count for 1:10 ratio
        planValidation.userPlan.planType,
        'detector' // Use detector generation ratio (1:10)
      );

      if (!creditResult.success) {
        throw new Error(`Insufficient credits. Need ${creditsNeeded}, available: ${creditResult.previousBalance || 0}`);
      }

      try {
        const model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });
        
        const prompt = this.buildRemovalPrompt(content, detectionResults, options);
        
        const result = await model.generateContent(prompt);
        const improvedContent = result.response.text();

        // Store removal result
        await this.storeDetectorRemoval({
          userId,
          originalContent: content,
          improvedContent,
          detectionResults,
          wordCount,
          creditsUsed: creditResult.creditsDeducted,
          timestamp: new Date()
        });

        return {
          success: true,
          improvedContent,
          originalWordCount: wordCount,
          newWordCount: this.calculateWordCount(improvedContent),
          creditsUsed: creditResult.creditsDeducted
        };

      } catch (generationError) {
        // Rollback credits on failure
        await this.atomicCredit.rollbackTransaction(
          userId,
          creditResult.transactionId,
          creditResult.creditsDeducted,
          wordCount
        );
        throw generationError;
      }

    } catch (error) {
      console.error('Content removal error:', error);
      throw new Error(`Content improvement failed: ${error.message}`);
    }
  }

  /**
   * Build prompt for content improvement
   */
  buildRemovalPrompt(content, detectionResults, options) {
    let prompt = `You are an expert content editor. Please improve the following content to address these issues:\n\n`;
    
    if (detectionResults.plagiarism && detectionResults.plagiarism.score > 30) {
      prompt += `- PLAGIARISM DETECTED (${detectionResults.plagiarism.score}%): Rewrite to ensure originality while maintaining the core message.\n`;
    }
    
    if (detectionResults.aiContent && detectionResults.aiContent.score > 70) {
      prompt += `- AI CONTENT DETECTED (${detectionResults.aiContent.score}%): Humanize the writing style, add personal touches, and vary sentence structure.\n`;
    }
    
    if (detectionResults.readability && detectionResults.readability.fleschKincaidGrade > 12) {
      prompt += `- READABILITY ISSUES: Simplify complex sentences and use more accessible language.\n`;
    }
    
    prompt += `\nOriginal Content:\n${content}\n\n`;
    prompt += `Instructions:\n`;
    prompt += `1. Maintain the original meaning and key information\n`;
    prompt += `2. Ensure the content is completely original and human-like\n`;
    prompt += `3. Improve readability while preserving professionalism\n`;
    prompt += `4. Keep the same approximate length\n`;
    prompt += `5. Return only the improved content without explanations\n\n`;
    prompt += `Improved Content:`;
    
    return prompt;
  }

  /**
   * Store detector analysis result
   */
  async storeDetectorResult(data) {
    try {
      const docRef = await this.db.collection('detectorResults').add({
        ...data,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return docRef.id;
    } catch (error) {
      console.error('Error storing detector result:', error);
      throw error;
    }
  }

  /**
   * Store detector removal result
   */
  async storeDetectorRemoval(data) {
    try {
      const docRef = await this.db.collection('detectorRemovals').add({
        ...data,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return docRef.id;
    } catch (error) {
      console.error('Error storing detector removal:', error);
      throw error;
    }
  }

  /**
   * Complete workflow: Detect and remove issues with two-cycle loop
   * Charges only 1:10 ratio for total detected words regardless of cycles
   */
  async detectAndRemoveWorkflow(userId, content, options = {}) {
    try {
      // Step 1: Initial detection (charges 50 credits per 1000 words)
      const initialDetection = await this.analyzeContent(userId, content, options);
      
      if (!this.hasDetectedIssues(initialDetection.results)) {
        return {
          success: true,
          finalContent: content,
          detectionResults: initialDetection.results,
          cyclesUsed: 0,
          totalCreditsUsed: initialDetection.creditsUsed,
          message: 'No issues detected. Content is clean.'
        };
      }

      // Calculate total detected words for credit charging
      const detectedWordCount = this.calculateDetectedWords(content, initialDetection.results);
      const generationCredits = this.calculateGenerationCredits(detectedWordCount);

      // Validate user plan for removal
      const planValidation = await this.planValidator.validateUserPlan(userId, {
        toolType: 'detector',
        requestType: 'removal'
      });

      if (!planValidation.isValid) {
        throw new Error(planValidation.error || 'Plan validation failed');
      }

      // Deduct credits for the entire removal process (1:10 ratio)
      const removalCreditResult = await this.atomicCredit.deductCreditsAtomic(
        userId,
        detectedWordCount, // Pass detected word count for 1:10 ratio
        planValidation.userPlan.planType,
        'detector' // Use detector generation ratio
      );

      if (!removalCreditResult.success) {
        throw new Error(`Insufficient credits for removal. Need ${generationCredits}, available: ${removalCreditResult.previousBalance || 0}`);
      }

      try {
        let currentContent = content;
        let currentDetection = initialDetection.results;
        let cycleCount = 0;
        const maxCycles = 2;

        // Two-cycle loop for content improvement
        while (cycleCount < maxCycles && this.hasDetectedIssues(currentDetection)) {
          cycleCount++;
          
          // Generate improved content using Gemini 2.5 Pro
          const improvedContent = await this.generateImprovedContent(currentContent, currentDetection, options);
          currentContent = improvedContent;

          // Re-detect issues in improved content (no additional detection charges)
          const reDetection = await this.performDetectionOnly(currentContent, options);
          currentDetection = reDetection;

          // If no issues found after first cycle, break
          if (!this.hasDetectedIssues(currentDetection)) {
            break;
          }
        }

        // Store the complete workflow result
        await this.storeWorkflowResult({
          userId,
          originalContent: content,
          finalContent: currentContent,
          initialDetection: initialDetection.results,
          finalDetection: currentDetection,
          cyclesUsed: cycleCount,
          detectedWordCount,
          totalCreditsUsed: initialDetection.creditsUsed + removalCreditResult.creditsDeducted,
          timestamp: new Date()
        });

        return {
          success: true,
          finalContent: currentContent,
          initialDetection: initialDetection.results,
          finalDetection: currentDetection,
          cyclesUsed: cycleCount,
          detectedWordCount,
          totalCreditsUsed: initialDetection.creditsUsed + removalCreditResult.creditsDeducted,
          message: `Content improved through ${cycleCount} cycle(s). Issues ${this.hasDetectedIssues(currentDetection) ? 'significantly reduced' : 'resolved'}.`
        };

      } catch (workflowError) {
        // Rollback removal credits on failure
        await this.atomicCredit.rollbackTransaction(
          userId,
          removalCreditResult.transactionId,
          removalCreditResult.creditsDeducted,
          detectedWordCount
        );
        throw workflowError;
      }

    } catch (error) {
      console.error('Detect and remove workflow error:', error);
      throw new Error(`Workflow failed: ${error.message}`);
    }
  }

  /**
   * Check if detection results have issues that need fixing
   */
  hasDetectedIssues(detectionResults) {
    const plagiarismThreshold = 30; // 30% plagiarism
    const aiContentThreshold = 70;  // 70% AI content
    const readabilityThreshold = 12; // Grade 12+ readability

    return (
      (detectionResults.plagiarism && detectionResults.plagiarism.score > plagiarismThreshold) ||
      (detectionResults.aiContent && detectionResults.aiContent.score > aiContentThreshold) ||
      (detectionResults.readability && detectionResults.readability.fleschKincaidGrade > readabilityThreshold)
    );
  }

  /**
   * Calculate detected words based on detection results
   */
  calculateDetectedWords(content, detectionResults) {
    const totalWords = this.calculateWordCount(content);
    let detectedPercentage = 0;

    // Calculate weighted detection percentage
    if (detectionResults.plagiarism && detectionResults.plagiarism.score > 30) {
      detectedPercentage = Math.max(detectedPercentage, detectionResults.plagiarism.score / 100);
    }
    
    if (detectionResults.aiContent && detectionResults.aiContent.score > 70) {
      detectedPercentage = Math.max(detectedPercentage, detectionResults.aiContent.score / 100);
    }

    // For readability, assume 50% of content needs improvement if threshold exceeded
    if (detectionResults.readability && detectionResults.readability.fleschKincaidGrade > 12) {
      detectedPercentage = Math.max(detectedPercentage, 0.5);
    }

    return Math.ceil(totalWords * detectedPercentage);
  }

  /**
   * Generate improved content using Gemini 2.5 Pro
   */
  async generateImprovedContent(content, detectionResults, options) {
    const model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });
    const prompt = this.buildRemovalPrompt(content, detectionResults, options);
    
    const result = await model.generateContent(prompt);
    return result.response.text();
  }

  /**
   * Perform detection without charging credits (for re-detection)
   */
  async performDetectionOnly(content, options = {}) {
    const analysisResults = {};

    // Perform analyses based on options
    if (options.plagiarismDetection !== false) {
      analysisResults.plagiarism = await this.detectPlagiarism(content);
    }

    if (options.aiDetection !== false) {
      analysisResults.aiContent = await this.detectAIContent(content);
    }

    if (options.readabilityAnalysis !== false) {
      analysisResults.readability = await this.analyzeReadability(content);
    }

    return analysisResults;
  }

  /**
   * Store complete workflow result
   */
  async storeWorkflowResult(data) {
    try {
      const docRef = await this.db.collection('detectorWorkflows').add({
        ...data,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return docRef.id;
    } catch (error) {
      console.error('Error storing workflow result:', error);
      throw error;
    }
  }

  /**
   * Get detection history for user
   */
  async getDetectionHistory(userId, limit = 10) {
    try {
      const snapshot = await this.db.collection('detectorResults')
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();
      
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch (error) {
      console.error('Error fetching detection history:', error);
      throw new Error('Failed to fetch detection history');
    }
  }
}

module.exports = { DetectorService };