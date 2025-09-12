const { GoogleGenerativeAI } = require('@google/generative-ai');
const { admin, isInitialized } = require('../config/firebase');
const SourceValidator = require('./sourceValidator');
const CitationGenerator = require('./citationGenerator');

class ResearchService {
  constructor() {
    // Check if Gemini API key is configured
    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_gemini_api_key_here') {
      this.genAI = null;
      this.model = null;
    } else {
      this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });
    }
    
    // Initialize Firestore only if Firebase is properly configured
    if (isInitialized && admin) {
      this.db = admin.firestore();
    } else {
      this.db = null;
    }
    
    this.sourceValidator = new SourceValidator();
    this.citationGenerator = new CitationGenerator();
  }

  /**
   * Perform deep research on a given topic using Gemini 2.5 Pro
   * @param {string} query - Research query
   * @param {string} researchType - Type of research (academic, general, technical, etc.)
   * @param {number} depth - Research depth level (1-5)
   * @param {Array} sources - Preferred source types
   * @param {string} userId - User ID for tracking
   * @returns {Object} Research results with sources and analysis
   */
  async conductResearch(query, researchType = 'general', depth = 3, sources = [], userId) {
    try {
      // Check if Gemini API is configured
      if (!this.model || !this.genAI) {
        throw new Error('Research service is not configured. Please contact support to enable AI-powered research.');
      }
      
      const researchPrompt = this.buildResearchPrompt(query, researchType, depth, sources);
      
      const result = await this.model.generateContent({
        contents: [{
          role: 'user',
          parts: [{ text: researchPrompt }]
        }],
        generationConfig: {
          temperature: 0.3,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 8192,
        }
      });

      const response = result.response;
      const researchData = this.parseResearchResponse(response.text());
      
      // Parse sources from the research content
      const extractedSources = this.extractSources(response.text());
      
      // Validate and enhance sources
      const sourceValidation = await this.sourceValidator.validateSources(
        extractedSources, 
        query
      );
      
      // Generate citations
      const citationResult = await this.citationGenerator.generateCitations(
        sourceValidation.sources,
        'apa',
        { researchTopic: query }
      );
      
      // Calculate word count for credit system
      const wordCount = this.calculateWordCount(response.text());
      
      // Generate research metadata
      const metadata = {
        query,
        researchType,
        depth,
        sources,
        wordCount,
        timestamp: new Date(),
        userId,
        processingTime: Date.now()
      };

      return {
        success: true,
        data: {
          ...researchData,
          sources: sourceValidation.sources,
          citations: citationResult.success ? citationResult.citations : null,
          sourceValidation: sourceValidation.summary,
          recommendations: sourceValidation.recommendations,
          qualityScore: citationResult.success ? 
            this.citationGenerator.generateCitationReport(citationResult.citations).quality.score : null
        },
        metadata,
        wordCount
      };

    } catch (error) {
      console.error('Research generation error:', error);
      throw new Error(`Research failed: ${error.message}`);
    }
  }

  /**
   * Build comprehensive research prompt based on parameters
   */
  buildResearchPrompt(query, researchType, depth, sources) {
    const depthInstructions = {
      1: 'Provide a basic overview with key points',
      2: 'Include moderate detail with supporting evidence',
      3: 'Comprehensive analysis with multiple perspectives',
      4: 'In-depth research with extensive citations and analysis',
      5: 'Exhaustive research with expert-level detail and cross-references'
    };

    const sourceInstructions = sources.length > 0 
      ? `Focus on these source types: ${sources.join(', ')}` 
      : 'Use diverse, credible sources';

    return `
You are an expert researcher conducting ${researchType} research. Your task is to provide comprehensive research on the following query:

**Research Query:** ${query}

**Research Requirements:**
- Research Type: ${researchType}
- Depth Level: ${depth}/5 (${depthInstructions[depth]})
- Source Preference: ${sourceInstructions}

**Output Format:**
Provide your research in the following structured format:

## Executive Summary
[Brief overview of key findings]

## Main Research Findings
[Detailed research content organized by themes/topics]

## Key Insights
[Important insights and analysis]

## Supporting Evidence
[Citations and references to support findings]

## Methodology
[Brief explanation of research approach]

## Limitations
[Any limitations or gaps in the research]

## Recommendations
[Actionable recommendations based on findings]

## Sources and References
[List of sources used in research]

**Guidelines:**
1. Ensure all information is accurate and well-sourced
2. Provide balanced perspectives on controversial topics
3. Use clear, professional language
4. Include relevant statistics and data where available
5. Cite sources appropriately
6. Maintain objectivity and avoid bias
7. Structure information logically
8. Provide actionable insights

Begin your research now:
`;
  }

  /**
   * Parse and structure the research response from Gemini
   */
  parseResearchResponse(responseText) {
    const sections = {
      executiveSummary: '',
      mainFindings: '',
      keyInsights: '',
      supportingEvidence: '',
      methodology: '',
      limitations: '',
      recommendations: '',
      sources: []
    };

    try {
      // Extract sections using regex patterns
      const summaryMatch = responseText.match(/## Executive Summary\s*([\s\S]*?)(?=##|$)/i);
      if (summaryMatch) sections.executiveSummary = summaryMatch[1].trim();

      const findingsMatch = responseText.match(/## Main Research Findings\s*([\s\S]*?)(?=##|$)/i);
      if (findingsMatch) sections.mainFindings = findingsMatch[1].trim();

      const insightsMatch = responseText.match(/## Key Insights\s*([\s\S]*?)(?=##|$)/i);
      if (insightsMatch) sections.keyInsights = insightsMatch[1].trim();

      const evidenceMatch = responseText.match(/## Supporting Evidence\s*([\s\S]*?)(?=##|$)/i);
      if (evidenceMatch) sections.supportingEvidence = evidenceMatch[1].trim();

      const methodologyMatch = responseText.match(/## Methodology\s*([\s\S]*?)(?=##|$)/i);
      if (methodologyMatch) sections.methodology = methodologyMatch[1].trim();

      const limitationsMatch = responseText.match(/## Limitations\s*([\s\S]*?)(?=##|$)/i);
      if (limitationsMatch) sections.limitations = limitationsMatch[1].trim();

      const recommendationsMatch = responseText.match(/## Recommendations\s*([\s\S]*?)(?=##|$)/i);
      if (recommendationsMatch) sections.recommendations = recommendationsMatch[1].trim();

      const sourcesMatch = responseText.match(/## Sources and References\s*([\s\S]*?)(?=##|$)/i);
      if (sourcesMatch) {
        const sourceText = sourcesMatch[1].trim();
        sections.sources = this.extractSources(sourceText);
      }

      return {
        ...sections,
        fullText: responseText,
        structuredData: true
      };

    } catch (error) {
      console.error('Error parsing research response:', error);
      return {
        fullText: responseText,
        structuredData: false,
        error: 'Failed to parse structured data'
      };
    }
  }

  /**
   * Extract sources from the sources section
   */
  extractSources(sourceText) {
    const sources = [];
    const lines = sourceText.split('\n');
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine && (trimmedLine.startsWith('-') || trimmedLine.startsWith('*') || trimmedLine.match(/^\d+\./))) {
        const cleanSource = trimmedLine.replace(/^[-*\d.\s]+/, '').trim();
        if (cleanSource) {
          sources.push({
            citation: cleanSource,
            type: this.detectSourceType(cleanSource),
            reliability: this.assessSourceReliability(cleanSource)
          });
        }
      }
    }
    
    return sources;
  }

  /**
   * Detect the type of source (academic, news, website, etc.)
   */
  detectSourceType(citation) {
    const lowerCitation = citation.toLowerCase();
    
    if (lowerCitation.includes('journal') || lowerCitation.includes('doi:') || lowerCitation.includes('pubmed')) {
      return 'academic';
    } else if (lowerCitation.includes('news') || lowerCitation.includes('times') || lowerCitation.includes('post')) {
      return 'news';
    } else if (lowerCitation.includes('gov') || lowerCitation.includes('official')) {
      return 'government';
    } else if (lowerCitation.includes('book') || lowerCitation.includes('isbn')) {
      return 'book';
    } else {
      return 'website';
    }
  }

  /**
   * Assess source reliability based on domain and type
   */
  assessSourceReliability(citation) {
    const lowerCitation = citation.toLowerCase();
    
    // High reliability indicators
    if (lowerCitation.includes('doi:') || 
        lowerCitation.includes('pubmed') || 
        lowerCitation.includes('.gov') ||
        lowerCitation.includes('nature.com') ||
        lowerCitation.includes('science.org')) {
      return 'high';
    }
    
    // Medium reliability indicators
    if (lowerCitation.includes('edu') ||
        lowerCitation.includes('reuters') ||
        lowerCitation.includes('bbc') ||
        lowerCitation.includes('associated press')) {
      return 'medium';
    }
    
    // Default to medium for unknown sources
    return 'medium';
  }

  /**
   * Calculate word count for credit system
   */
  calculateWordCount(text) {
    return text.trim().split(/\s+/).length;
  }

  /**
   * Save research to history
   */
  async saveResearchToHistory(userId, researchData, metadata) {
    try {
      const researchDoc = {
        userId,
        query: metadata.query,
        researchType: metadata.researchType || 'general',
        depth: metadata.depth,
        sources: metadata.sources || [],
        citations: metadata.citations || null,
        sourceValidation: metadata.sourceValidation || {},
        recommendations: metadata.recommendations || [],
        qualityScore: metadata.qualityScore || 0,
        results: researchData,
        wordCount: metadata.wordCount,
        creditsUsed: metadata.creditsUsed || 0,
        transactionId: metadata.transactionId || null,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        processingTime: metadata.processingTime,
        model: 'gemini-2.5-pro',
        version: '1.0',
        // Enhanced metadata tracking
        metadata: {
          sourceCount: (metadata.sources || []).length,
          highReliabilitySources: metadata.sourceValidation?.highReliability || 0,
          flaggedSources: metadata.sourceValidation?.flagged || 0,
          citationStyle: metadata.citationStyle || 'apa',
          exportFormats: ['text', 'json', 'pdf'],
          tags: this.generateResearchTags(metadata.query, metadata.researchType),
          searchTerms: this.extractSearchTerms(metadata.query)
        }
      };

      const docRef = await this.db.collection('research_history').add(researchDoc);
      
      // Update user research statistics
      await this.updateUserResearchStats(userId, {
        totalResearches: admin.firestore.FieldValue.increment(1),
        totalCreditsUsed: admin.firestore.FieldValue.increment(metadata.creditsUsed || 0),
        totalWordCount: admin.firestore.FieldValue.increment(metadata.wordCount || 0),
        lastResearchDate: admin.firestore.FieldValue.serverTimestamp()
      });
      
      return docRef.id;

    } catch (error) {
      console.error('Error saving research to history:', error);
      throw new Error('Failed to save research to history');
    }
  }

  /**
   * Get user's research history
   */
  async getResearchHistory(userId, limit = 20, offset = 0) {
    try {
      const query = this.db.collection('research_history')
        .where('userId', '==', userId)
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .offset(offset);

      const snapshot = await query.get();
      const history = [];

      snapshot.forEach(doc => {
        history.push({
          id: doc.id,
          ...doc.data()
        });
      });

      return history;

    } catch (error) {
      console.error('Error fetching research history:', error);
      throw new Error('Failed to fetch research history');
    }
  }

  /**
   * Get specific research by ID
   */
  async getResearchById(researchId, userId) {
    try {
      const doc = await this.db.collection('research_history').doc(researchId).get();
      
      if (!doc.exists) {
        throw new Error('Research not found');
      }

      const data = doc.data();
      
      // Verify ownership
      if (data.userId !== userId) {
        throw new Error('Unauthorized access to research');
      }

      return {
        id: doc.id,
        ...data
      };

    } catch (error) {
      console.error('Error fetching research by ID:', error);
      throw error;
    }
  }

  /**
   * Enhanced source processing with validation and citation generation
   */
  async processResearchSources(sources, query, citationStyle = 'apa') {
    try {
      // Validate sources
      const validation = await this.sourceValidator.validateSources(sources, query);
      
      // Generate citations
      const citations = await this.citationGenerator.generateCitations(
        validation.sources,
        citationStyle,
        { researchTopic: query }
      );
      
      return {
        success: true,
        validation,
        citations: citations.success ? citations.citations : null,
        report: citations.success ? 
          this.citationGenerator.generateCitationReport(citations.citations) : null
      };
      
    } catch (error) {
      console.error('Source processing error:', error);
      return {
        success: false,
        error: error.message,
        sources // Return original sources on error
      };
    }
  }

  /**
   * Calculate research credits based on depth and word count
   */
  calculateResearchCredits(wordCount, depth = 3) {
    // Base rate: 1 credit per 5 words for research
    const baseCredits = Math.ceil(wordCount / 5);
    
    // Depth multiplier
    const depthMultipliers = {
      1: 0.8,  // Basic research
      2: 1.0,  // Standard research
      3: 1.2,  // Comprehensive research
      4: 1.5,  // In-depth research
      5: 2.0   // Exhaustive research
    };
    
    const multiplier = depthMultipliers[depth] || 1.0;
    return Math.ceil(baseCredits * multiplier);
  }

  /**
   * Validate sources using the SourceValidator
   */
  async validateSources(sources, researchTopic = null) {
    try {
      const validationResult = await this.sourceValidator.validateSources(sources, researchTopic);
      
      // Calculate overall score
      const totalSources = validationResult.sources.length;
      const highReliability = validationResult.summary.highReliability;
      const mediumReliability = validationResult.summary.mediumReliability;
      const flagged = validationResult.summary.flagged;
      
      const overallScore = Math.round(
        ((highReliability * 3 + mediumReliability * 2) / (totalSources * 3)) * 100
      ) - (flagged * 5); // Penalty for flagged sources
      
      return {
        success: true,
        validatedSources: validationResult.sources,
        summary: validationResult.summary,
        recommendations: validationResult.recommendations,
        overallScore: Math.max(0, overallScore)
      };
      
    } catch (error) {
      console.error('Source validation error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Generate citations using the CitationGenerator
   */
  async generateCitations(sources, format = 'apa', options = {}) {
    try {
      const citationResult = await this.citationGenerator.generateCitations(
        sources,
        format,
        options
      );
      
      if (!citationResult.success) {
        throw new Error(citationResult.error);
      }
      
      return {
        success: true,
        citations: citationResult.citations,
        bibliography: citationResult.citations.formattedBibliography,
        report: this.citationGenerator.generateCitationReport(citationResult.citations)
      };
      
    } catch (error) {
      console.error('Citation generation error:', error);
      return {
        success: false,
        error: error.message
      };
    }
   }

  /**
   * Generate research tags based on query and type
   */
  generateResearchTags(query, researchType) {
    const tags = [researchType || 'general'];
    
    // Extract key topics from query
    const keywords = query.toLowerCase().match(/\b\w{4,}\b/g) || [];
    // Common words filtering should be configured externally
    
    // Basic stop words for keyword filtering
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
      'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
      'will', 'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those',
      'research', 'study', 'analysis', 'paper', 'article', 'journal', 'academic', 'scholar'
    ]);
    
    // Add relevant keywords as tags with improved filtering
    keywords.forEach(keyword => {
      if (keyword.length > 3 && !stopWords.has(keyword.toLowerCase())) {
        tags.push(keyword);
      }
    });
    
    // Domain-specific tags should be configured externally
    // Domain detection temporarily disabled - configure domain mappings externally
    
    return [...new Set(tags)].slice(0, 10); // Remove duplicates and limit to 10 tags
  }

  /**
   * Extract search terms from query
   */
  extractSearchTerms(query) {
    // Extract meaningful terms for search indexing
    const terms = query.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(term => term.length > 2);
    
    // Basic stop words filtering
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
      'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
      'will', 'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those'
    ]);
    
    const filteredTerms = terms.filter(term => !stopWords.has(term));
    
    return [...new Set(filteredTerms)].slice(0, 20); // Remove duplicates and limit to 20 terms
  }

  /**
   * Update user research statistics
   */
  async updateUserResearchStats(userId, stats) {
    try {
      const userStatsRef = this.db.collection('user_research_stats').doc(userId);
      
      await userStatsRef.set(stats, { merge: true });
      
    } catch (error) {
      console.error('Error updating user research stats:', error);
      // Don't throw error as this is not critical
    }
  }

  /**
   * Get user research statistics
   */
  async getUserResearchStats(userId) {
    try {
      const statsDoc = await this.db.collection('user_research_stats').doc(userId).get();
      
      if (statsDoc.exists) {
        return {
          success: true,
          stats: statsDoc.data()
        };
      } else {
        return {
          success: true,
          stats: {
            totalResearches: 0,
            totalCreditsUsed: 0,
            totalWordCount: 0,
            lastResearchDate: null
          }
        };
      }
      
    } catch (error) {
      console.error('Error fetching user research stats:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Search research history with filters
   */
  async searchResearchHistory(userId, options = {}) {
    try {
      const {
        query = '',
        tags = [],
        dateFrom = null,
        dateTo = null,
        minQualityScore = 0,
        limit = 20,
        offset = 0
      } = options;
      
      let firestoreQuery = this.db.collection('research_history')
        .where('userId', '==', userId);
      
      // Add filters
      if (tags.length > 0) {
        firestoreQuery = firestoreQuery.where('metadata.tags', 'array-contains-any', tags);
      }
      
      if (minQualityScore > 0) {
        firestoreQuery = firestoreQuery.where('qualityScore', '>=', minQualityScore);
      }
      
      if (dateFrom) {
        firestoreQuery = firestoreQuery.where('timestamp', '>=', new Date(dateFrom));
      }
      
      if (dateTo) {
        firestoreQuery = firestoreQuery.where('timestamp', '<=', new Date(dateTo));
      }
      
      firestoreQuery = firestoreQuery
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .offset(offset);
      
      const snapshot = await firestoreQuery.get();
      const results = [];
      
      snapshot.forEach(doc => {
        const data = doc.data();
        
        // Apply text search filter if provided
        if (query) {
          const searchText = `${data.query} ${data.results}`.toLowerCase();
          if (!searchText.includes(query.toLowerCase())) {
            return; // Skip this document
          }
        }
        
        results.push({
          id: doc.id,
          ...data
        });
      });
      
      return {
        success: true,
        results,
        total: results.length
      };
      
    } catch (error) {
      console.error('Error searching research history:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = ResearchService;