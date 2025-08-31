const admin = require('firebase-admin');
const SourceValidator = require('./sourceValidator');

class CitationGenerator {
  constructor() {
    this.db = admin.firestore();
    this.sourceValidator = new SourceValidator();
    
    // Citation style templates
    this.styleTemplates = {
      apa: {
        book: '{author} ({year}). {title}. {publisher}.',
        journal: '{author} ({year}). {title}. {journal}, {volume}({issue}), {pages}. {doi}',
        website: '{author} ({year}). {title}. Retrieved from {url}',
        government: '{agency} ({year}). {title}. {publisher}.'
      },
      mla: {
        book: '{author}. {title}. {publisher}, {year}.',
        journal: '{author}. "{title}." {journal}, vol. {volume}, no. {issue}, {year}, pp. {pages}.',
        website: '{author}. "{title}." {website}, {date}, {url}.',
        government: '{agency}. {title}. {publisher}, {year}.'
      },
      chicago: {
        book: '{author}. {title}. {city}: {publisher}, {year}.',
        journal: '{author}. "{title}." {journal} {volume}, no. {issue} ({year}): {pages}.',
        website: '{author}. "{title}." {website}. Accessed {accessDate}. {url}.',
        government: '{agency}. {title}. {city}: {publisher}, {year}.'
      },
      harvard: {
        book: '{author} {year}, {title}, {publisher}, {city}.',
        journal: '{author} {year}, \'{title}\', {journal}, vol. {volume}, no. {issue}, pp. {pages}.',
        website: '{author} {year}, {title}, viewed {accessDate}, <{url}>.',
        government: '{agency} {year}, {title}, {publisher}, {city}.'
      }
    };
    
    // Field mappings for different source types
    this.fieldMappings = {
      book: ['author', 'year', 'title', 'publisher', 'city', 'isbn'],
      journal: ['author', 'year', 'title', 'journal', 'volume', 'issue', 'pages', 'doi'],
      website: ['author', 'year', 'title', 'website', 'url', 'accessDate'],
      government: ['agency', 'year', 'title', 'publisher', 'city'],
      conference: ['author', 'year', 'title', 'conference', 'location', 'pages'],
      thesis: ['author', 'year', 'title', 'degree', 'institution', 'location']
    };
  }

  /**
   * Generate citations for research sources
   * @param {Array} sources - Array of source objects
   * @param {string} style - Citation style (apa, mla, chicago, harvard)
   * @param {Object} options - Additional options
   * @returns {Object} Generated citations with metadata
   */
  async generateCitations(sources, style = 'apa', options = {}) {
    try {
      // Validate sources first
      const validationResult = await this.sourceValidator.validateSources(
        sources, 
        options.researchTopic
      );
      
      if (!validationResult.success) {
        throw new Error(`Source validation failed: ${validationResult.error}`);
      }
      
      const citations = {
        style: style.toLowerCase(),
        generated: new Date(),
        sources: [],
        inText: [],
        bibliography: [],
        metadata: {
          totalSources: validationResult.sources.length,
          validationSummary: validationResult.summary,
          recommendations: validationResult.recommendations
        }
      };
      
      // Process each validated source
      for (let i = 0; i < validationResult.sources.length; i++) {
        const source = validationResult.sources[i];
        const citationData = await this.processSingleSource(source, style, i + 1, options);
        
        citations.sources.push(citationData.source);
        citations.inText.push(citationData.inText);
        citations.bibliography.push(citationData.bibliography);
      }
      
      // Sort bibliography alphabetically by author/title
      citations.bibliography.sort((a, b) => {
        return a.sortKey.localeCompare(b.sortKey);
      });
      
      // Generate formatted bibliography text
      citations.formattedBibliography = this.formatBibliography(
        citations.bibliography, 
        style
      );
      
      return {
        success: true,
        citations,
        validation: validationResult
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
   * Process a single source for citation generation
   */
  async processSingleSource(source, style, index, options) {
    // Extract metadata from source
    const metadata = this.extractSourceMetadata(source);
    
    // Determine source type
    const sourceType = this.determineSourceType(source, metadata);
    
    // Generate in-text citation
    const inTextCitation = this.generateInTextCitation(
      metadata, 
      style, 
      sourceType, 
      index
    );
    
    // Generate bibliography entry
    const bibliographyEntry = this.generateBibliographyEntry(
      metadata, 
      style, 
      sourceType
    );
    
    return {
      source: {
        index,
        originalCitation: source.citation,
        type: sourceType,
        reliability: source.reliability,
        metadata,
        enhanced: source.enhanced,
        flagged: source.flagged
      },
      inText: {
        index,
        citation: inTextCitation,
        type: sourceType,
        style
      },
      bibliography: {
        index,
        citation: bibliographyEntry,
        sortKey: this.generateSortKey(metadata, sourceType),
        type: sourceType,
        style
      }
    };
  }

  /**
   * Extract metadata from source citation
   */
  extractSourceMetadata(source) {
    const metadata = {
      author: null,
      year: null,
      title: null,
      journal: null,
      volume: null,
      issue: null,
      pages: null,
      publisher: null,
      city: null,
      url: null,
      doi: null,
      isbn: null,
      accessDate: null,
      website: null,
      agency: null
    };
    
    const citation = source.citation;
    
    // Extract author(s)
    const authorMatch = citation.match(/^([^(]+)(?=\s*\()/); // Text before first parenthesis
    if (authorMatch) {
      metadata.author = authorMatch[1].trim().replace(/\.$/, '');
    }
    
    // Extract year
    const yearMatch = citation.match(/\((\d{4})\)/);
    if (yearMatch) {
      metadata.year = yearMatch[1];
    }
    
    // Extract title (quoted or italicized)
    const quotedTitleMatch = citation.match(/"([^"]+)"/);
    const italicTitleMatch = citation.match(/\*([^*]+)\*/);
    if (quotedTitleMatch) {
      metadata.title = quotedTitleMatch[1];
    } else if (italicTitleMatch) {
      metadata.title = italicTitleMatch[1];
    }
    
    // Extract DOI
    const doiMatch = citation.match(/doi:\s*(10\.\d+\/[^\s]+)/i);
    if (doiMatch) {
      metadata.doi = doiMatch[1];
    }
    
    // Extract URL
    const urlMatch = citation.match(/(https?:\/\/[^\s]+)/);
    if (urlMatch) {
      metadata.url = urlMatch[1];
    }
    
    // Extract journal information
    const journalMatch = citation.match(/([A-Z][^,]+),\s*(\d+)(?:\((\d+)\))?/);
    if (journalMatch) {
      metadata.journal = journalMatch[1].trim();
      metadata.volume = journalMatch[2];
      metadata.issue = journalMatch[3];
    }
    
    // Extract pages
    const pagesMatch = citation.match(/(?:pp?\.?\s*)(\d+(?:-\d+)?)/i);
    if (pagesMatch) {
      metadata.pages = pagesMatch[1];
    }
    
    // Extract publisher
    const publisherMatch = citation.match(/([A-Z][^.]+Press|[A-Z][^.]+Publishers?|[A-Z][^.]+Books?)/);
    if (publisherMatch) {
      metadata.publisher = publisherMatch[1].trim();
    }
    
    // Use enhanced metadata if available
    if (source.metadata) {
      Object.assign(metadata, source.metadata);
    }
    
    return metadata;
  }

  /**
   * Determine source type based on content analysis
   */
  determineSourceType(source, metadata) {
    const citation = source.citation.toLowerCase();
    
    // Check for journal indicators
    if (metadata.journal || citation.includes('journal') || metadata.doi) {
      return 'journal';
    }
    
    // Check for book indicators
    if (citation.includes('press') || citation.includes('publisher') || metadata.isbn) {
      return 'book';
    }
    
    // Check for government source
    if (citation.includes('.gov') || citation.includes('department') || citation.includes('ministry')) {
      return 'government';
    }
    
    // Check for conference
    if (citation.includes('conference') || citation.includes('proceedings')) {
      return 'conference';
    }
    
    // Check for thesis
    if (citation.includes('thesis') || citation.includes('dissertation')) {
      return 'thesis';
    }
    
    // Default to website
    return 'website';
  }

  /**
   * Generate in-text citation
   */
  generateInTextCitation(metadata, style, sourceType, index) {
    const author = metadata.author || 'Unknown';
    const year = metadata.year || 'n.d.';
    
    switch (style.toLowerCase()) {
      case 'apa':
        return `(${this.formatAuthorLastName(author)}, ${year})`;
      
      case 'mla':
        return `(${this.formatAuthorLastName(author)})`;
      
      case 'chicago':
        return `(${this.formatAuthorLastName(author)} ${year})`;
      
      case 'harvard':
        return `(${this.formatAuthorLastName(author)} ${year})`;
      
      default:
        return `[${index}]`;
    }
  }

  /**
   * Generate bibliography entry
   */
  generateBibliographyEntry(metadata, style, sourceType) {
    const template = this.getTemplate(style, sourceType);
    
    if (!template) {
      return this.generateGenericCitation(metadata, style);
    }
    
    // Replace template variables with actual values
    let citation = template;
    
    const replacements = {
      '{author}': metadata.author || 'Unknown Author',
      '{year}': metadata.year || 'n.d.',
      '{title}': metadata.title || 'Untitled',
      '{journal}': metadata.journal || '',
      '{volume}': metadata.volume || '',
      '{issue}': metadata.issue || '',
      '{pages}': metadata.pages || '',
      '{publisher}': metadata.publisher || '',
      '{city}': metadata.city || '',
      '{url}': metadata.url || '',
      '{doi}': metadata.doi ? `https://doi.org/${metadata.doi}` : '',
      '{website}': metadata.website || this.extractWebsiteName(metadata.url),
      '{accessDate}': metadata.accessDate || new Date().toLocaleDateString(),
      '{agency}': metadata.agency || metadata.author || 'Unknown Agency'
    };
    
    // Apply replacements
    for (const [placeholder, value] of Object.entries(replacements)) {
      citation = citation.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
    }
    
    // Clean up empty fields and extra punctuation
    citation = this.cleanCitation(citation);
    
    return citation;
  }

  /**
   * Get citation template for style and source type
   */
  getTemplate(style, sourceType) {
    const styleTemplates = this.styleTemplates[style.toLowerCase()];
    if (!styleTemplates) {
      return null;
    }
    
    return styleTemplates[sourceType] || styleTemplates.website;
  }

  /**
   * Generate generic citation when template is not available
   */
  generateGenericCitation(metadata, style) {
    const parts = [];
    
    if (metadata.author) parts.push(metadata.author);
    if (metadata.year) parts.push(`(${metadata.year})`);
    if (metadata.title) parts.push(`"${metadata.title}"`);
    if (metadata.journal) parts.push(metadata.journal);
    if (metadata.url) parts.push(`Retrieved from ${metadata.url}`);
    
    return parts.join('. ') + '.';
  }

  /**
   * Format author last name for in-text citations
   */
  formatAuthorLastName(author) {
    if (!author || author === 'Unknown') return 'Unknown';
    
    // Handle "Last, First" format
    if (author.includes(',')) {
      return author.split(',')[0].trim();
    }
    
    // Handle "First Last" format
    const parts = author.trim().split(/\s+/);
    return parts[parts.length - 1];
  }

  /**
   * Extract website name from URL
   */
  extractWebsiteName(url) {
    if (!url) return '';
    
    try {
      const domain = new URL(url).hostname;
      return domain.replace(/^www\./, '');
    } catch {
      return url;
    }
  }

  /**
   * Generate sort key for bibliography ordering
   */
  generateSortKey(metadata, sourceType) {
    const author = metadata.author || 'ZZZ Unknown';
    const year = metadata.year || '9999';
    const title = metadata.title || 'ZZZ Untitled';
    
    // Use last name for sorting
    const sortAuthor = this.formatAuthorLastName(author);
    
    return `${sortAuthor}_${year}_${title}`.toLowerCase();
  }

  /**
   * Clean citation by removing empty fields and fixing punctuation
   */
  cleanCitation(citation) {
    return citation
      .replace(/\s*,\s*,/g, ',') // Remove double commas
      .replace(/\s*\.\s*\./g, '.') // Remove double periods
      .replace(/\s*,\s*\./g, '.') // Remove comma before period
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/\s*,\s*$/g, '.') // Replace trailing comma with period
      .replace(/\([^)]*\)/g, match => {
        // Remove empty parentheses
        const content = match.slice(1, -1).trim();
        return content ? match : '';
      })
      .trim();
  }

  /**
   * Format complete bibliography
   */
  formatBibliography(bibliographyEntries, style) {
    const header = this.getBibliographyHeader(style);
    const entries = bibliographyEntries.map((entry, index) => {
      const prefix = style.toLowerCase() === 'mla' ? '' : `${index + 1}. `;
      return `${prefix}${entry.citation}`;
    });
    
    return {
      header,
      entries,
      formatted: `${header}\n\n${entries.join('\n\n')}`,
      style,
      count: entries.length
    };
  }

  /**
   * Get bibliography header for different styles
   */
  getBibliographyHeader(style) {
    const headers = {
      apa: 'References',
      mla: 'Works Cited',
      chicago: 'Bibliography',
      harvard: 'Reference List'
    };
    
    return headers[style.toLowerCase()] || 'References';
  }

  /**
   * Generate citation report
   */
  generateCitationReport(citations) {
    const report = {
      summary: {
        totalSources: citations.sources.length,
        style: citations.style,
        generatedAt: citations.generated,
        sourceTypes: {},
        reliabilityDistribution: {},
        enhancedSources: 0,
        flaggedSources: 0
      },
      quality: {
        score: 0,
        factors: [],
        recommendations: []
      },
      statistics: {
        averageReliability: 0,
        sourceTypeDistribution: {},
        citationCompleteness: 0
      }
    };
    
    // Calculate statistics
    let reliabilitySum = 0;
    const reliabilityWeights = { high: 3, medium: 2, low: 1 };
    
    for (const source of citations.sources) {
      // Count source types
      report.summary.sourceTypes[source.type] = 
        (report.summary.sourceTypes[source.type] || 0) + 1;
      
      // Count reliability distribution
      report.summary.reliabilityDistribution[source.reliability] = 
        (report.summary.reliabilityDistribution[source.reliability] || 0) + 1;
      
      // Count enhanced and flagged sources
      if (source.enhanced) report.summary.enhancedSources++;
      if (source.flagged) report.summary.flaggedSources++;
      
      // Calculate reliability score
      reliabilitySum += reliabilityWeights[source.reliability] || 1;
    }
    
    // Calculate quality score (0-100)
    const maxReliabilityScore = citations.sources.length * 3;
    const reliabilityScore = (reliabilitySum / maxReliabilityScore) * 100;
    
    const diversityScore = Object.keys(report.summary.sourceTypes).length * 10;
    const flaggedPenalty = report.summary.flaggedSources * 5;
    
    report.quality.score = Math.max(0, Math.min(100, 
      reliabilityScore + diversityScore - flaggedPenalty
    ));
    
    // Generate recommendations
    if (report.summary.flaggedSources > 0) {
      report.quality.recommendations.push(
        `Review ${report.summary.flaggedSources} flagged sources for quality`
      );
    }
    
    if (reliabilityScore < 60) {
      report.quality.recommendations.push(
        'Consider adding more high-reliability sources'
      );
    }
    
    if (Object.keys(report.summary.sourceTypes).length < 3) {
      report.quality.recommendations.push(
        'Diversify source types for better research coverage'
      );
    }
    
    return report;
  }

  /**
   * Export citations in various formats
   */
  async exportCitations(citations, format = 'text') {
    try {
      switch (format.toLowerCase()) {
        case 'text':
          return this.exportAsText(citations);
        
        case 'json':
          return this.exportAsJSON(citations);
        
        case 'bibtex':
          return this.exportAsBibTeX(citations);
        
        case 'ris':
          return this.exportAsRIS(citations);
        
        default:
          throw new Error(`Unsupported export format: ${format}`);
      }
    } catch (error) {
      console.error('Citation export error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Export as plain text
   */
  exportAsText(citations) {
    const bibliography = citations.formattedBibliography;
    return {
      success: true,
      format: 'text',
      content: bibliography.formatted,
      filename: `bibliography_${citations.style}_${Date.now()}.txt`
    };
  }

  /**
   * Export as JSON
   */
  exportAsJSON(citations) {
    return {
      success: true,
      format: 'json',
      content: JSON.stringify(citations, null, 2),
      filename: `citations_${citations.style}_${Date.now()}.json`
    };
  }

  /**
   * Export as BibTeX (basic implementation)
   */
  exportAsBibTeX(citations) {
    const entries = citations.sources.map((source, index) => {
      const type = this.getBibTeXType(source.type);
      const key = `source${index + 1}`;
      
      const fields = [];
      if (source.metadata.author) fields.push(`  author = {${source.metadata.author}}`);
      if (source.metadata.title) fields.push(`  title = {${source.metadata.title}}`);
      if (source.metadata.year) fields.push(`  year = {${source.metadata.year}}`);
      if (source.metadata.journal) fields.push(`  journal = {${source.metadata.journal}}`);
      if (source.metadata.url) fields.push(`  url = {${source.metadata.url}}`);
      
      return `@${type}{${key},\n${fields.join(',\n')}\n}`;
    });
    
    return {
      success: true,
      format: 'bibtex',
      content: entries.join('\n\n'),
      filename: `bibliography_${Date.now()}.bib`
    };
  }

  /**
   * Export as RIS format (basic implementation)
   */
  exportAsRIS(citations) {
    const entries = citations.sources.map(source => {
      const lines = [];
      lines.push(`TY  - ${this.getRISType(source.type)}`);
      if (source.metadata.author) lines.push(`AU  - ${source.metadata.author}`);
      if (source.metadata.title) lines.push(`TI  - ${source.metadata.title}`);
      if (source.metadata.year) lines.push(`PY  - ${source.metadata.year}`);
      if (source.metadata.journal) lines.push(`JO  - ${source.metadata.journal}`);
      if (source.metadata.url) lines.push(`UR  - ${source.metadata.url}`);
      lines.push('ER  - ');
      
      return lines.join('\n');
    });
    
    return {
      success: true,
      format: 'ris',
      content: entries.join('\n\n'),
      filename: `bibliography_${Date.now()}.ris`
    };
  }

  /**
   * Get BibTeX entry type
   */
  getBibTeXType(sourceType) {
    const typeMap = {
      journal: 'article',
      book: 'book',
      website: 'misc',
      conference: 'inproceedings',
      thesis: 'phdthesis',
      government: 'techreport'
    };
    
    return typeMap[sourceType] || 'misc';
  }

  /**
   * Get RIS entry type
   */
  getRISType(sourceType) {
    const typeMap = {
      journal: 'JOUR',
      book: 'BOOK',
      website: 'ELEC',
      conference: 'CONF',
      thesis: 'THES',
      government: 'RPRT'
    };
    
    return typeMap[sourceType] || 'GEN';
  }
}

module.exports = CitationGenerator;