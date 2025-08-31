const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

/**
 * PDFGenerator class for creating PDF exports of research data using Puppeteer
 * Supports research reports, citations, and bibliographies
 */
class PDFGenerator {
  constructor() {
    this.defaultOptions = {
      format: 'A4',
      margin: {
        top: '1in',
        right: '1in',
        bottom: '1in',
        left: '1in'
      },
      printBackground: true
    };
  }

  /**
   * Generate PDF for research report
   * @param {Object} research - Research data
   * @param {Object} options - PDF generation options
   * @returns {Promise<Buffer>} PDF buffer
   */
  async generateResearchPDF(research, options = {}) {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    
    try {
      const html = this.generateResearchHTML(research);
      await page.setContent(html, { waitUntil: 'networkidle0' });
      
      const pdfOptions = { ...this.defaultOptions, ...options };
      const pdfBuffer = await page.pdf(pdfOptions);
      
      return pdfBuffer;
    } finally {
      await browser.close();
    }
  }

  /**
   * Generate PDF for citations
   * @param {Object} citations - Citations data
   * @param {Object} options - PDF generation options
   * @returns {Promise<Buffer>} PDF buffer
   */
  async generateCitationsPDF(citations, options = {}) {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    
    try {
      const html = this.generateCitationsHTML(citations);
      await page.setContent(html, { waitUntil: 'networkidle0' });
      
      const pdfOptions = { ...this.defaultOptions, ...options };
      const pdfBuffer = await page.pdf(pdfOptions);
      
      return pdfBuffer;
    } finally {
      await browser.close();
    }
  }

  /**
   * Generate PDF for bibliography
   * @param {Array} sources - Sources array
   * @param {string} style - Citation style
   * @param {Object} options - PDF generation options
   * @returns {Promise<Buffer>} PDF buffer
   */
  async generateBibliographyPDF(sources, style = 'APA', options = {}) {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    
    try {
      const html = this.generateBibliographyHTML(sources, style);
      await page.setContent(html, { waitUntil: 'networkidle0' });
      
      const pdfOptions = { ...this.defaultOptions, ...options };
      const pdfBuffer = await page.pdf(pdfOptions);
      
      return pdfBuffer;
    } finally {
      await browser.close();
    }
  }

  /**
   * Generate HTML for research report
   * @param {Object} research - Research data
   * @returns {string} HTML content
   */
  generateResearchHTML(research) {
    const metadata = this.getPDFMetadata(research);
    
    return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Research Report</title>
      <style>
        body {
          font-family: 'Times New Roman', serif;
          line-height: 1.6;
          color: #333;
          max-width: 800px;
          margin: 0 auto;
          padding: 20px;
        }
        .header {
          text-align: center;
          margin-bottom: 30px;
          border-bottom: 2px solid #333;
          padding-bottom: 20px;
        }
        .title {
          font-size: 24px;
          font-weight: bold;
          margin-bottom: 10px;
        }
        .metadata {
          font-size: 12px;
          color: #666;
          margin-bottom: 20px;
        }
        .section {
          margin-bottom: 25px;
        }
        .section-title {
          font-size: 18px;
          font-weight: bold;
          margin-bottom: 10px;
          color: #2c3e50;
          border-bottom: 1px solid #bdc3c7;
          padding-bottom: 5px;
        }
        .query-box {
          background-color: #f8f9fa;
          border-left: 4px solid #007bff;
          padding: 15px;
          margin: 15px 0;
          font-style: italic;
        }
        .results {
          text-align: justify;
          margin: 15px 0;
        }
        .sources {
          margin-top: 20px;
        }
        .source-item {
          margin-bottom: 15px;
          padding: 10px;
          background-color: #f8f9fa;
          border-radius: 5px;
        }
        .source-title {
          font-weight: bold;
          color: #2c3e50;
        }
        .source-url {
          color: #007bff;
          font-size: 12px;
          word-break: break-all;
        }
        .stats {
          display: flex;
          justify-content: space-between;
          background-color: #e9ecef;
          padding: 15px;
          border-radius: 5px;
          margin: 20px 0;
        }
        .stat-item {
          text-align: center;
        }
        .stat-value {
          font-size: 18px;
          font-weight: bold;
          color: #2c3e50;
        }
        .stat-label {
          font-size: 12px;
          color: #6c757d;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="title">Research Report</div>
        <div class="metadata">
          Generated: ${metadata.generatedDate}<br>
          Research ID: ${research.id || 'N/A'}<br>
          Word Count: ${research.wordCount || 0} words
        </div>
      </div>

      <div class="section">
        <div class="section-title">Research Query</div>
        <div class="query-box">
          ${research.query || 'No query specified'}
        </div>
      </div>

      <div class="section">
        <div class="section-title">Research Results</div>
        <div class="results">
          ${research.results || 'No results available'}
        </div>
      </div>

      <div class="stats">
        <div class="stat-item">
          <div class="stat-value">${research.sources?.length || 0}</div>
          <div class="stat-label">Sources</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${research.wordCount || 0}</div>
          <div class="stat-label">Words</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${research.qualityScore || 'N/A'}</div>
          <div class="stat-label">Quality Score</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${research.creditsUsed || 0}</div>
          <div class="stat-label">Credits Used</div>
        </div>
      </div>

      ${research.sources && research.sources.length > 0 ? `
      <div class="section">
        <div class="section-title">Sources (${research.sources.length})</div>
        <div class="sources">
          ${research.sources.map((source, index) => `
            <div class="source-item">
              <div class="source-title">${index + 1}. ${source.title || 'Untitled'}</div>
              <div class="source-url">${source.url || 'No URL'}</div>
              ${source.type ? `<div><strong>Type:</strong> ${source.type}</div>` : ''}
              ${source.date ? `<div><strong>Date:</strong> ${source.date}</div>` : ''}
              ${source.reliability ? `<div><strong>Reliability:</strong> ${source.reliability}/100</div>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
      ` : ''}
    </body>
    </html>
    `;
  }

  /**
   * Generate HTML for citations
   * @param {Object} citations - Citations data
   * @returns {string} HTML content
   */
  generateCitationsHTML(citations) {
    return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Research Citations</title>
      <style>
        body {
          font-family: 'Times New Roman', serif;
          line-height: 1.6;
          color: #333;
          max-width: 800px;
          margin: 0 auto;
          padding: 20px;
        }
        .header {
          text-align: center;
          margin-bottom: 30px;
          border-bottom: 2px solid #333;
          padding-bottom: 20px;
        }
        .title {
          font-size: 24px;
          font-weight: bold;
          margin-bottom: 10px;
        }
        .citation-style {
          font-size: 14px;
          color: #666;
          margin-bottom: 20px;
        }
        .citation-item {
          margin-bottom: 20px;
          padding: 15px;
          background-color: #f8f9fa;
          border-left: 4px solid #007bff;
          text-align: justify;
        }
        .citation-number {
          font-weight: bold;
          color: #2c3e50;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="title">Research Citations</div>
        <div class="citation-style">
          Citation Style: ${citations.style || 'APA'}<br>
          Generated: ${new Date().toLocaleString()}
        </div>
      </div>

      ${citations.formattedBibliography ? `
        <div style="white-space: pre-line; text-align: justify;">
          ${citations.formattedBibliography}
        </div>
      ` : `
        <div>
          ${citations.sources?.map((source, index) => `
            <div class="citation-item">
              <span class="citation-number">${index + 1}.</span>
              ${source.citation || `${source.title || 'Untitled'} - ${source.url || 'No URL'}`}
            </div>
          `).join('') || '<p>No citations available</p>'}
        </div>
      `}
    </body>
    </html>
    `;
  }

  /**
   * Generate HTML for bibliography
   * @param {Array} sources - Sources array
   * @param {string} style - Citation style
   * @returns {string} HTML content
   */
  generateBibliographyHTML(sources, style) {
    return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Bibliography</title>
      <style>
        body {
          font-family: 'Times New Roman', serif;
          line-height: 1.6;
          color: #333;
          max-width: 800px;
          margin: 0 auto;
          padding: 20px;
        }
        .header {
          text-align: center;
          margin-bottom: 30px;
          border-bottom: 2px solid #333;
          padding-bottom: 20px;
        }
        .title {
          font-size: 24px;
          font-weight: bold;
          margin-bottom: 10px;
        }
        .style-info {
          font-size: 14px;
          color: #666;
          margin-bottom: 20px;
        }
        .source-item {
          margin-bottom: 20px;
          padding: 15px;
          background-color: #f8f9fa;
          border-radius: 5px;
          text-align: justify;
        }
        .source-number {
          font-weight: bold;
          color: #2c3e50;
        }
        .source-details {
          margin-top: 10px;
          font-size: 12px;
          color: #666;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="title">Bibliography</div>
        <div class="style-info">
          Citation Style: ${style.toUpperCase()}<br>
          Total Sources: ${sources?.length || 0}<br>
          Generated: ${new Date().toLocaleString()}
        </div>
      </div>

      ${sources && sources.length > 0 ? `
        <div>
          ${sources.map((source, index) => `
            <div class="source-item">
              <div>
                <span class="source-number">${index + 1}.</span>
                ${source.citation || `${source.title || 'Untitled'}. Retrieved from ${source.url || 'No URL available'}.`}
              </div>
              <div class="source-details">
                ${source.type ? `Type: ${source.type} | ` : ''}
                ${source.date ? `Date: ${source.date} | ` : ''}
                ${source.reliability ? `Reliability: ${source.reliability}/100` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      ` : '<p>No sources available for bibliography.</p>'}
    </body>
    </html>
    `;
  }

  /**
   * Get PDF metadata
   * @param {Object} research - Research data
   * @returns {Object} Metadata object
   */
  getPDFMetadata(research) {
    return {
      title: `Research Report - ${research.query || 'Untitled'}`,
      author: 'Assignment Writer Platform',
      subject: 'Academic Research Report',
      creator: 'Research Tool',
      generatedDate: new Date().toLocaleString(),
      wordCount: research.wordCount || 0,
      sourceCount: research.sources?.length || 0
    };
  }
}

module.exports = PDFGenerator;