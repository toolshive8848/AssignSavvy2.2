const { GoogleGenerativeAI } = require('@google/generative-ai');
const { CSL } = require('citeproc');
const admin = require('firebase-admin');

class ZoteroCSLProcessor {
  constructor() {
    // TODO: Add your Gemini API key here - Get from Google AI Studio (https://makersuite.google.com/app/apikey)
    // Required for Gemini 2.5 Pro model used in citation generation
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY); // Add your Gemini API key
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });
    
    // TODO: Add your Zotero API key here if using Zotero Web API - Get from https://www.zotero.org/settings/keys
    // Optional: For direct Zotero library integration
    this.zoteroApiKey = process.env.ZOTERO_API_KEY; // Add your Zotero API key (optional)
    this.db = admin.firestore();
    
    // Common citation styles
    this.citationStyles = {
      'apa': 'american-psychological-association-7th-edition',
      'mla': 'modern-language-association',
      'chicago': 'chicago-author-date',
      'harvard': 'harvard-cite-them-right',
      'ieee': 'ieee',
      'vancouver': 'vancouver'
    };
  }

  /**
   * Extract citation requirements from content and generate bibliographic data
   * @param {string} content - The content to analyze for citations
   * @param {string} style - Citation style (apa, mla, chicago, etc.)
   * @param {string} topic - Topic for context-aware citation generation
   * @returns {Object} Citation data and formatted references
   */
  async processCitations(content, style = 'apa', topic = '') {
    try {
      // Step 1: Analyze content for citation needs
      const citationNeeds = await this.analyzeCitationRequirements(content, topic);
      
      if (!citationNeeds.requiresCitations) {
        return {
          requiresCitations: false,
          processedContent: content,
          bibliography: [],
          inTextCitations: []
        };
      }

      // Step 2: Generate bibliographic data using Gemini
      const bibliographicData = await this.generateBibliographicData(citationNeeds, topic);
      
      // Step 3: Format citations using CSL processor
      const formattedCitations = await this.formatCitations(bibliographicData, style);
      
      // Step 4: Insert in-text citations into content
      const processedContent = await this.insertInTextCitations(content, formattedCitations);
      
      return {
        requiresCitations: true,
        processedContent,
        bibliography: formattedCitations.bibliography,
        inTextCitations: formattedCitations.inTextCitations,
        citationCount: bibliographicData.length,
        style: style
      };
      
    } catch (error) {
      console.error('Citation processing error:', error);
      return {
        requiresCitations: false,
        processedContent: content,
        bibliography: [],
        inTextCitations: [],
        error: error.message
      };
    }
  }

  /**
   * Analyze content to determine if citations are needed
   * @param {string} content - Content to analyze
   * @param {string} topic - Topic context
   * @returns {Object} Citation requirements analysis
   */
  async analyzeCitationRequirements(content, topic) {
    const prompt = `
      Analyze the following content and determine if academic citations are needed.
      
      Content: "${content.substring(0, 2000)}..."
      Topic: "${topic}"
      
      Determine:
      1. Does this content make factual claims that need citations?
      2. Are there statistics, research findings, or expert opinions mentioned?
      3. What types of sources would be most appropriate?
      4. How many citations would be reasonable?
      
      Respond in JSON format:
      {
        "requiresCitations": boolean,
        "citationPoints": ["specific claims that need citations"],
        "sourceTypes": ["journal articles", "books", "reports", etc.],
        "estimatedCount": number,
        "academicLevel": "undergraduate" | "graduate" | "professional"
      }
    `;

    try {
      const result = await this.model.generateContent(prompt);
      const response = result.response.text();
      return JSON.parse(response.replace(/```json\n?|```/g, ''));
    } catch (error) {
      console.error('Citation analysis error:', error);
      return { requiresCitations: false, citationPoints: [], sourceTypes: [], estimatedCount: 0 };
    }
  }

  /**
   * Generate realistic bibliographic data using Gemini
   * @param {Object} citationNeeds - Citation requirements from analysis
   * @param {string} topic - Topic context
   * @returns {Array} Array of bibliographic entries
   */
  async generateBibliographicData(citationNeeds, topic) {
    const prompt = `
      Generate realistic bibliographic data for academic sources related to: "${topic}"
      
      Requirements:
      - Generate ${citationNeeds.estimatedCount} sources
      - Source types needed: ${citationNeeds.sourceTypes.join(', ')}
      - Academic level: ${citationNeeds.academicLevel}
      - Citation points to address: ${citationNeeds.citationPoints.join('; ')}
      
      For each source, provide realistic but fictional bibliographic data in CSL-JSON format:
      {
        "id": "unique_id",
        "type": "article-journal" | "book" | "report" | "webpage",
        "title": "realistic title",
        "author": [{"family": "LastName", "given": "FirstName"}],
        "container-title": "Journal/Publisher Name",
        "issued": {"date-parts": [[year, month, day]]},
        "volume": "volume_number",
        "issue": "issue_number",
        "page": "page_range",
        "DOI": "10.xxxx/realistic.doi",
        "URL": "https://realistic.url.com"
      }
      
      Respond with a JSON array of bibliographic entries.
    `;

    try {
      const result = await this.model.generateContent(prompt);
      const response = result.response.text();
      const bibliographicData = JSON.parse(response.replace(/```json\n?|```/g, ''));
      
      // Store generated citations for future reference
      await this.storeCitationData(topic, bibliographicData);
      
      return bibliographicData;
    } catch (error) {
      console.error('Bibliographic generation error:', error);
      return [];
    }
  }

  /**
   * Format citations using CSL processor
   * @param {Array} bibliographicData - Raw bibliographic data
   * @param {string} style - Citation style
   * @returns {Object} Formatted citations and bibliography
   */
  async formatCitations(bibliographicData, style) {
    try {
      // Get CSL style (simplified - in production, load actual CSL files)
      const cslStyle = await this.getCSLStyle(style);
      
      // Format each citation
      const formattedCitations = bibliographicData.map((item, index) => {
        return {
          id: item.id,
          inText: this.generateInTextCitation(item, style, index + 1),
          bibliography: this.generateBibliographyEntry(item, style)
        };
      });

      return {
        inTextCitations: formattedCitations.map(c => c.inText),
        bibliography: formattedCitations.map(c => c.bibliography)
      };
      
    } catch (error) {
      console.error('Citation formatting error:', error);
      return { inTextCitations: [], bibliography: [] };
    }
  }

  /**
   * Generate in-text citation based on style
   * @param {Object} item - Bibliographic item
   * @param {string} style - Citation style
   * @param {number} number - Citation number
   * @returns {string} Formatted in-text citation
   */
  generateInTextCitation(item, style, number) {
    const author = item.author?.[0];
    const year = item.issued?.['date-parts']?.[0]?.[0];
    
    switch (style.toLowerCase()) {
      case 'apa':
        return `(${author?.family}, ${year})`;
      case 'mla':
        return `(${author?.family} ${item.page?.split('-')[0] || ''})`;
      case 'chicago':
        return `(${author?.family} ${year})`;
      case 'ieee':
        return `[${number}]`;
      case 'vancouver':
        return `(${number})`;
      default:
        return `(${author?.family}, ${year})`;
    }
  }

  /**
   * Generate bibliography entry based on style
   * @param {Object} item - Bibliographic item
   * @param {string} style - Citation style
   * @returns {string} Formatted bibliography entry
   */
  generateBibliographyEntry(item, style) {
    const author = item.author?.[0];
    const year = item.issued?.['date-parts']?.[0]?.[0];
    
    switch (style.toLowerCase()) {
      case 'apa':
        return `${author?.family}, ${author?.given?.charAt(0)}. (${year}). ${item.title}. ${item['container-title']}, ${item.volume}(${item.issue}), ${item.page}.`;
      case 'mla':
        return `${author?.family}, ${author?.given}. "${item.title}." ${item['container-title']}, vol. ${item.volume}, no. ${item.issue}, ${year}, pp. ${item.page}.`;
      case 'chicago':
        return `${author?.family}, ${author?.given}. "${item.title}." ${item['container-title']} ${item.volume}, no. ${item.issue} (${year}): ${item.page}.`;
      default:
        return `${author?.family}, ${author?.given}. "${item.title}." ${item['container-title']} ${item.volume}.${item.issue} (${year}): ${item.page}.`;
    }
  }

  /**
   * Insert in-text citations into content
   * @param {string} content - Original content
   * @param {Object} formattedCitations - Formatted citation data
   * @returns {string} Content with inserted citations
   */
  async insertInTextCitations(content, formattedCitations) {
    const prompt = `
      Insert appropriate in-text citations into the following content.
      
      Content: "${content}"
      
      Available citations: ${JSON.stringify(formattedCitations.inTextCitations)}
      
      Rules:
      1. Insert citations after factual claims, statistics, or expert opinions
      2. Don't over-cite - use citations strategically
      3. Maintain natural flow of the text
      4. Place citations before periods and commas
      
      Return the content with citations inserted naturally.
    `;

    try {
      const result = await this.model.generateContent(prompt);
      return result.response.text().replace(/```\n?|```/g, '');
    } catch (error) {
      console.error('Citation insertion error:', error);
      return content;
    }
  }

  /**
   * Get CSL style configuration
   * @param {string} style - Citation style name
   * @returns {Object} CSL style configuration
   */
  async getCSLStyle(style) {
    // Simplified CSL style mapping
    // In production, load actual CSL XML files
    return {
      styleId: this.citationStyles[style.toLowerCase()] || this.citationStyles.apa,
      locale: 'en-US'
    };
  }

  /**
   * Store citation data for future reference
   * @param {string} topic - Topic context
   * @param {Array} bibliographicData - Generated citations
   */
  async storeCitationData(topic, bibliographicData) {
    try {
      const citationDoc = {
        topic,
        citations: bibliographicData,
        generatedAt: admin.firestore.FieldValue.serverTimestamp(),
        usageCount: 0
      };
      
      await this.db.collection('citations').add(citationDoc);
    } catch (error) {
      console.error('Citation storage error:', error);
    }
  }

  /**
   * Retrieve existing citations for a topic
   * @param {string} topic - Topic to search for
   * @returns {Array} Existing citation data
   */
  async getExistingCitations(topic) {
    try {
      const snapshot = await this.db.collection('citations')
        .where('topic', '==', topic)
        .orderBy('generatedAt', 'desc')
        .limit(1)
        .get();
      
      if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        await doc.ref.update({
          usageCount: admin.firestore.FieldValue.increment(1)
        });
        return doc.data().citations;
      }
      
      return [];
    } catch (error) {
      console.error('Citation retrieval error:', error);
      return [];
    }
  }
}

module.exports = ZoteroCSLProcessor;