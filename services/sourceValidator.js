const admin = require('firebase-admin');

class SourceValidator {
  constructor() {
    this.db = admin.firestore();
    
    // Trusted domain patterns
    this.trustedDomains = [
      // Academic and Research
      'pubmed.ncbi.nlm.nih.gov',
      'scholar.google.com',
      'jstor.org',
      'researchgate.net',
      'arxiv.org',
      'nature.com',
      'science.org',
      'sciencedirect.com',
      'springer.com',
      'wiley.com',
      'ieee.org',
      'acm.org',
      
      // Government and Official
      '.gov',
      '.edu',
      'who.int',
      'un.org',
      'worldbank.org',
      'imf.org',
      
      // News and Media (Tier 1)
      'reuters.com',
      'bbc.com',
      'ap.org',
      'npr.org',
      'pbs.org',
      'economist.com',
      'ft.com',
      
      // Professional Organizations
      'ama-assn.org',
      'apa.org',
      'ieee.org'
    ];
    
    // Source type patterns
    this.sourcePatterns = {
      academic: [
        /doi:\s*10\./i,
        /pubmed/i,
        /journal/i,
        /proceedings/i,
        /conference/i,
        /university/i,
        /research/i
      ],
      government: [
        /\.gov/i,
        /official/i,
        /department/i,
        /ministry/i,
        /bureau/i
      ],
      news: [
        /news/i,
        /times/i,
        /post/i,
        /herald/i,
        /tribune/i,
        /guardian/i
      ],
      book: [
        /isbn/i,
        /publisher/i,
        /edition/i,
        /press/i
      ]
    };
  }

  /**
   * Validate and enhance research sources
   * @param {Array} sources - Array of source objects
   * @param {string} researchTopic - Research topic for relevance checking
   * @returns {Object} Validation results with enhanced sources
   */
  async validateSources(sources, researchTopic) {
    try {
      const validatedSources = [];
      const validationSummary = {
        total: sources.length,
        validated: 0,
        highReliability: 0,
        mediumReliability: 0,
        lowReliability: 0,
        flagged: 0,
        enhanced: 0
      };

      for (const source of sources) {
        const validatedSource = await this.validateSingleSource(source, researchTopic);
        validatedSources.push(validatedSource);
        
        // Update summary
        validationSummary.validated++;
        
        switch (validatedSource.reliability) {
          case 'high':
            validationSummary.highReliability++;
            break;
          case 'medium':
            validationSummary.mediumReliability++;
            break;
          case 'low':
            validationSummary.lowReliability++;
            break;
        }
        
        if (validatedSource.flagged) {
          validationSummary.flagged++;
        }
        
        if (validatedSource.enhanced) {
          validationSummary.enhanced++;
        }
      }

      return {
        success: true,
        sources: validatedSources,
        summary: validationSummary,
        recommendations: this.generateRecommendations(validationSummary)
      };

    } catch (error) {
      console.error('Source validation error:', error);
      return {
        success: false,
        error: error.message,
        sources: sources // Return original sources on error
      };
    }
  }

  /**
   * Validate a single source
   */
  async validateSingleSource(source, researchTopic) {
    const validatedSource = {
      ...source,
      validation: {
        timestamp: new Date(),
        checks: []
      },
      enhanced: false,
      flagged: false
    };

    // Domain reliability check
    const domainReliability = this.checkDomainReliability(source.citation);
    validatedSource.reliability = domainReliability.reliability;
    validatedSource.validation.checks.push({
      type: 'domain_reliability',
      result: domainReliability.reliability,
      details: domainReliability.reason
    });

    // Source type detection
    const sourceType = this.detectSourceType(source.citation);
    validatedSource.type = sourceType.type;
    validatedSource.validation.checks.push({
      type: 'source_type',
      result: sourceType.type,
      confidence: sourceType.confidence
    });

    // Citation format validation
    const citationFormat = this.validateCitationFormat(source.citation);
    validatedSource.validation.checks.push({
      type: 'citation_format',
      result: citationFormat.isValid ? 'valid' : 'invalid',
      suggestions: citationFormat.suggestions
    });

    // Relevance check (basic keyword matching)
    const relevanceScore = this.checkRelevance(source.citation, researchTopic);
    validatedSource.relevanceScore = relevanceScore;
    validatedSource.validation.checks.push({
      type: 'relevance',
      score: relevanceScore,
      threshold: 0.3
    });

    // Flag low-quality sources
    if (validatedSource.reliability === 'low' || relevanceScore < 0.2) {
      validatedSource.flagged = true;
      validatedSource.flagReason = validatedSource.reliability === 'low' 
        ? 'Low reliability domain' 
        : 'Low relevance to research topic';
    }

    // Enhance citation if possible
    const enhancedCitation = await this.enhanceCitation(source.citation);
    if (enhancedCitation.enhanced) {
      validatedSource.citation = enhancedCitation.citation;
      validatedSource.metadata = enhancedCitation.metadata;
      validatedSource.enhanced = true;
    }

    return validatedSource;
  }

  /**
   * Check domain reliability
   */
  checkDomainReliability(citation) {
    const lowerCitation = citation.toLowerCase();
    
    // Check for high-reliability indicators
    for (const domain of this.trustedDomains) {
      if (lowerCitation.includes(domain.toLowerCase())) {
        return {
          reliability: 'high',
          reason: `Trusted domain: ${domain}`
        };
      }
    }
    
    // Check for academic indicators
    if (lowerCitation.includes('doi:') || 
        lowerCitation.includes('pubmed') ||
        lowerCitation.includes('.edu')) {
      return {
        reliability: 'high',
        reason: 'Academic source indicators'
      };
    }
    
    // Check for government sources
    if (lowerCitation.includes('.gov')) {
      return {
        reliability: 'high',
        reason: 'Government source'
      };
    }
    
    // Check for established news sources
    const newsIndicators = ['reuters', 'bbc', 'associated press', 'npr'];
    for (const indicator of newsIndicators) {
      if (lowerCitation.includes(indicator)) {
        return {
          reliability: 'medium',
          reason: `Established news source: ${indicator}`
        };
      }
    }
    
    // Default to medium for unknown sources
    return {
      reliability: 'medium',
      reason: 'Unknown domain - requires manual verification'
    };
  }

  /**
   * Detect source type with confidence score
   */
  detectSourceType(citation) {
    const lowerCitation = citation.toLowerCase();
    
    for (const [type, patterns] of Object.entries(this.sourcePatterns)) {
      let matches = 0;
      for (const pattern of patterns) {
        if (pattern.test(citation)) {
          matches++;
        }
      }
      
      if (matches > 0) {
        const confidence = Math.min(matches / patterns.length, 1.0);
        return {
          type,
          confidence,
          matches
        };
      }
    }
    
    return {
      type: 'website',
      confidence: 0.5,
      matches: 0
    };
  }

  /**
   * Validate citation format
   */
  validateCitationFormat(citation) {
    const suggestions = [];
    let isValid = true;
    
    // Check for basic citation elements
    if (!citation.includes('(') && !citation.includes('[')) {
      suggestions.push('Consider adding publication year in parentheses');
      isValid = false;
    }
    
    // Check for URL format
    if (citation.includes('http') && !citation.includes('Retrieved') && !citation.includes('Accessed')) {
      suggestions.push('Add access date for web sources');
    }
    
    // Check for DOI
    if (citation.toLowerCase().includes('journal') && !citation.includes('doi:')) {
      suggestions.push('Include DOI if available for journal articles');
    }
    
    return {
      isValid,
      suggestions
    };
  }

  /**
   * Check relevance to research topic (basic implementation)
   */
  checkRelevance(citation, researchTopic) {
    if (!researchTopic) return 0.5; // Default score if no topic provided
    
    const topicWords = researchTopic.toLowerCase().split(/\s+/);
    const citationWords = citation.toLowerCase().split(/\s+/);
    
    let matches = 0;
    for (const topicWord of topicWords) {
      if (topicWord.length > 3) { // Ignore short words
        for (const citationWord of citationWords) {
          if (citationWord.includes(topicWord) || topicWord.includes(citationWord)) {
            matches++;
            break;
          }
        }
      }
    }
    
    return Math.min(matches / topicWords.length, 1.0);
  }

  /**
   * Enhance citation with additional metadata
   */
  async enhanceCitation(citation) {
    try {
      // Basic enhancement - extract and format key information
      const metadata = {
        extractedDate: this.extractDate(citation),
        extractedAuthors: this.extractAuthors(citation),
        extractedTitle: this.extractTitle(citation),
        extractedDOI: this.extractDOI(citation)
      };
      
      // Check if any enhancement was made
      const enhanced = Object.values(metadata).some(value => value !== null);
      
      if (enhanced) {
        // Format enhanced citation
        let enhancedCitation = citation;
        
        // Add missing elements if detected
        if (metadata.extractedDOI && !citation.includes('doi:')) {
          enhancedCitation += ` doi:${metadata.extractedDOI}`;
        }
        
        return {
          enhanced: true,
          citation: enhancedCitation,
          metadata
        };
      }
      
      return {
        enhanced: false,
        citation,
        metadata: null
      };
      
    } catch (error) {
      console.error('Citation enhancement error:', error);
      return {
        enhanced: false,
        citation,
        error: error.message
      };
    }
  }

  /**
   * Extract date from citation
   */
  extractDate(citation) {
    const datePatterns = [
      /\((\d{4})\)/,  // (2023)
      /\b(\d{4})\b/,  // 2023
      /(\d{1,2}\/\d{1,2}\/\d{4})/,  // MM/DD/YYYY
      /(\d{4}-\d{2}-\d{2})/  // YYYY-MM-DD
    ];
    
    for (const pattern of datePatterns) {
      const match = citation.match(pattern);
      if (match) {
        return match[1];
      }
    }
    
    return null;
  }

  /**
   * Extract authors from citation
   */
  extractAuthors(citation) {
    // Simple author extraction - look for patterns like "Smith, J." or "Smith, John"
    const authorPattern = /([A-Z][a-z]+,\s*[A-Z]\.?(?:\s*[A-Z]\.?)*)/g;
    const matches = citation.match(authorPattern);
    
    return matches ? matches.slice(0, 3) : null; // Return up to 3 authors
  }

  /**
   * Extract title from citation
   */
  extractTitle(citation) {
    // Look for quoted titles
    const quotedTitle = citation.match(/"([^"]+)"/);;
    if (quotedTitle) {
      return quotedTitle[1];
    }
    
    // Look for italicized titles (basic pattern)
    const italicTitle = citation.match(/\*([^*]+)\*/);
    if (italicTitle) {
      return italicTitle[1];
    }
    
    return null;
  }

  /**
   * Extract DOI from citation
   */
  extractDOI(citation) {
    const doiPattern = /doi:\s*(10\.\d+\/[^\s]+)/i;
    const match = citation.match(doiPattern);
    
    return match ? match[1] : null;
  }

  /**
   * Generate recommendations based on validation summary
   */
  generateRecommendations(summary) {
    const recommendations = [];
    
    if (summary.lowReliability > summary.total * 0.3) {
      recommendations.push({
        type: 'quality',
        priority: 'high',
        message: 'Consider replacing low-reliability sources with more authoritative ones'
      });
    }
    
    if (summary.flagged > 0) {
      recommendations.push({
        type: 'review',
        priority: 'medium',
        message: `${summary.flagged} sources require manual review`
      });
    }
    
    if (summary.highReliability < summary.total * 0.5) {
      recommendations.push({
        type: 'improvement',
        priority: 'medium',
        message: 'Add more high-reliability sources (academic, government, or established publications)'
      });
    }
    
    if (summary.enhanced > 0) {
      recommendations.push({
        type: 'success',
        priority: 'low',
        message: `${summary.enhanced} citations were automatically enhanced`
      });
    }
    
    return recommendations;
  }

  /**
   * Generate formatted bibliography
   */
  generateBibliography(sources, style = 'apa') {
    const bibliography = {
      style,
      entries: [],
      metadata: {
        totalSources: sources.length,
        generatedAt: new Date(),
        sourceTypes: this.countSourceTypes(sources)
      }
    };
    
    for (const source of sources) {
      const entry = {
        citation: source.citation,
        type: source.type,
        reliability: source.reliability,
        formatted: this.formatCitation(source, style)
      };
      
      bibliography.entries.push(entry);
    }
    
    return bibliography;
  }

  /**
   * Format citation according to style
   */
  formatCitation(source, style) {
    // Basic formatting - can be expanded for different citation styles
    switch (style.toLowerCase()) {
      case 'apa':
        return this.formatAPA(source);
      case 'mla':
        return this.formatMLA(source);
      case 'chicago':
        return this.formatChicago(source);
      default:
        return source.citation;
    }
  }

  /**
   * Format citation in APA style
   */
  formatAPA(source) {
    // Basic APA formatting
    let formatted = source.citation;
    
    // Ensure proper punctuation
    if (!formatted.endsWith('.')) {
      formatted += '.';
    }
    
    return formatted;
  }

  /**
   * Format citation in MLA style
   */
  formatMLA(source) {
    // Basic MLA formatting
    return source.citation;
  }

  /**
   * Format citation in Chicago style
   */
  formatChicago(source) {
    // Basic Chicago formatting
    return source.citation;
  }

  /**
   * Count source types
   */
  countSourceTypes(sources) {
    const counts = {};
    
    for (const source of sources) {
      const type = source.type || 'unknown';
      counts[type] = (counts[type] || 0) + 1;
    }
    
    return counts;
  }
}

module.exports = SourceValidator;