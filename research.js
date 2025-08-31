const express = require('express');
const ResearchService = require('./services/researchService');
const AtomicCreditSystem = require('./services/atomicCreditSystem');
const PlanValidator = require('./services/planValidator');
const PDFGenerator = require('./services/pdfGenerator');
const { authenticateToken } = require('./auth');

const router = express.Router();

// Initialize services
const researchService = new ResearchService();
const atomicCreditSystem = new AtomicCreditSystem();
const planValidator = new PlanValidator();
const pdfGenerator = new PDFGenerator();

/**
 * POST /api/research/query
 * Conduct deep research using Gemini 2.5 Pro
 */
router.post('/query', authenticateToken, async (req, res) => {
  try {
    const { 
      query, 
      researchType = 'general', 
      depth = 3, 
      sources = [],
      saveToHistory = true 
    } = req.body;

    // Input validation
    if (!query || query.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Research query is required'
      });
    }

    if (query.length > 2000) {
      return res.status(400).json({
        success: false,
        error: 'Research query too long. Maximum 2000 characters allowed.'
      });
    }

    if (depth < 1 || depth > 5) {
      return res.status(400).json({
        success: false,
        error: 'Research depth must be between 1 and 5'
      });
    }

    const validResearchTypes = ['general', 'academic', 'technical', 'market', 'scientific', 'historical'];
    if (!validResearchTypes.includes(researchType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid research type. Must be one of: ${validResearchTypes.join(', ')}`
      });
    }

    // Step 1: Estimate research output (research uses 1:10 word-to-credit ratio)
    const estimatedWordCount = Math.min(depth * 1000, 8000); // Estimate based on depth
    const estimatedCredits = researchService.calculateResearchCredits(estimatedWordCount, depth);
    console.log(`Estimated research credits needed: ${estimatedCredits} for ${estimatedWordCount} words at depth ${depth} (1:10 ratio)`);

    // Step 2: Plan validation and input limits
    const planValidation = await planValidator.validateRequest(req.user.id, query, estimatedWordCount, 'research');
    
    if (!planValidation.isValid) {
      return res.status(403).json({
        success: false,
        error: planValidation.error,
        errorCode: planValidation.errorCode,
        details: {
          planType: planValidation.planType,
          currentUsage: planValidation.currentUsage,
          limits: planValidation.monthlyLimit || planValidation.maxLength || planValidation.maxCount
        }
      });
    }

    // Step 3: Atomic credit deduction for research
    const creditDeductionResult = await atomicCreditSystem.deductCreditsAtomic(
      req.user.id,
      estimatedCredits,
      planValidation.userPlan.planType,
      'research'
    );

    if (!creditDeductionResult.success) {
      return res.status(402).json({
        success: false,
        error: 'Insufficient credits for research',
        details: {
          required: estimatedCredits,
          available: creditDeductionResult.availableCredits,
          planType: planValidation.userPlan.planType
        }
      });
    }

    // Step 4: Conduct research
    const startTime = Date.now();
    const researchResult = await researchService.conductResearch(
      query,
      researchType,
      depth,
      sources,
      req.user.id
    );
    const processingTime = Date.now() - startTime;

    // Step 5: Calculate actual credits based on output
    const actualCredits = researchService.calculateResearchCredits(researchResult.wordCount, depth);
    
    // Step 6: Adjust credits if needed (refund or charge difference)
    let finalCreditsUsed = creditDeductionResult.creditsDeducted;
    if (actualCredits !== estimatedCredits) {
      const creditDifference = actualCredits - estimatedCredits;
      if (creditDifference > 0) {
        // Need to charge more credits
        const additionalDeduction = await atomicCreditSystem.deductCreditsAtomic(
          req.user.id,
          creditDifference,
          planValidation.userPlan.planType
        );
        if (additionalDeduction.success) {
          finalCreditsUsed += creditDifference;
        }
      } else if (creditDifference < 0) {
        // Refund excess credits
        await atomicCreditSystem.refundCredits(
          req.user.id,
          Math.abs(creditDifference),
          creditDeductionResult.transactionId
        );
        finalCreditsUsed = actualCredits;
      }
    }

    // Step 7: Save to research history with enhanced data
    let researchId = null;
    if (saveToHistory) {
      researchId = await researchService.saveResearchToHistory(
        req.user.id,
        researchResult.data,
        {
          ...researchResult.metadata,
          processingTime,
          creditsUsed: finalCreditsUsed,
          transactionId: creditDeductionResult.transactionId,
          citations: researchResult.data.citations,
          sourceValidation: researchResult.data.sourceValidation,
          recommendations: researchResult.data.recommendations,
          qualityScore: researchResult.data.qualityScore
        }
      );
    }

    // Step 8: Record usage
    await planValidator.recordUsage(
      req.user.id,
      researchResult.wordCount,
      finalCreditsUsed,
      'research'
    );

    // Step 9: Return research results
    res.json({
      success: true,
      data: {
        researchId,
        query,
        researchType,
        depth,
        results: researchResult.data,
        metadata: {
          wordCount: researchResult.wordCount,
          processingTime,
          creditsUsed: finalCreditsUsed,
          timestamp: new Date().toISOString(),
          sources: researchResult.data.sources || [],
          citations: researchResult.data.citations || [],
          sourceValidation: researchResult.data.sourceValidation || {},
          recommendations: researchResult.data.recommendations || [],
          qualityScore: researchResult.data.qualityScore || 0
        }
      }
    });

  } catch (error) {
    console.error('Research query error:', error);
    
    // Rollback credits on error
    if (creditDeductionResult && creditDeductionResult.success) {
      try {
        await atomicCreditSystem.rollbackTransaction(
          req.user.id,
          creditDeductionResult.transactionId,
          creditDeductionResult.creditsDeducted,
          creditDeductionResult.wordsAllocated
        );
      } catch (rollbackError) {
        console.error('Credit rollback failed:', rollbackError);
      }
    }

    res.status(500).json({
      success: false,
      error: 'Research generation failed',
      details: error.message
    });
  }
});

/**
 * GET /api/research/history
 * Get user's research history
 */
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    
    const parsedLimit = Math.min(parseInt(limit) || 20, 100); // Max 100 items
    const parsedOffset = Math.max(parseInt(offset) || 0, 0);

    const history = await researchService.getResearchHistory(
      req.user.id,
      parsedLimit,
      parsedOffset
    );

    res.json({
      success: true,
      data: {
        history,
        pagination: {
          limit: parsedLimit,
          offset: parsedOffset,
          hasMore: history.length === parsedLimit
        }
      }
    });

  } catch (error) {
    console.error('Research history error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch research history',
      details: error.message
    });
  }
});

/**
 * GET /api/research/:id
 * Get specific research by ID
 */
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Research ID is required'
      });
    }

    const research = await researchService.getResearchById(id, req.user.id);

    res.json({
      success: true,
      data: research
    });

  } catch (error) {
    console.error('Get research error:', error);
    
    if (error.message === 'Research not found') {
      return res.status(404).json({
        success: false,
        error: 'Research not found'
      });
    }
    
    if (error.message === 'Unauthorized access to research') {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized access to research'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to fetch research',
      details: error.message
    });
  }
});

/**
 * DELETE /api/research/:id
 * Delete specific research from history
 */
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Research ID is required'
      });
    }

    // First verify ownership
    const research = await researchService.getResearchById(id, req.user.id);
    
    // Delete the research
    await researchService.db.collection('research_history').doc(id).delete();

    res.json({
      success: true,
      message: 'Research deleted successfully'
    });

  } catch (error) {
    console.error('Delete research error:', error);
    
    if (error.message === 'Research not found') {
      return res.status(404).json({
        success: false,
        error: 'Research not found'
      });
    }
    
    if (error.message === 'Unauthorized access to research') {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized access to research'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to delete research',
      details: error.message
    });
  }
});

/**
 * POST /api/research/export/:id
 * Export research results in various formats
 */
router.post('/export/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { format = 'json' } = req.body;
    
    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Research ID is required'
      });
    }

    const validFormats = ['json', 'txt', 'markdown', 'citations', 'pdf', 'bibliography', 'pdf-citations'];
    if (!validFormats.includes(format)) {
      return res.status(400).json({
        success: false,
        error: `Invalid format. Must be one of: ${validFormats.join(', ')}`
      });
    }

    // Get research data
    const research = await researchService.getResearchById(id, req.user.id);
    
    let exportData;
    let contentType;
    let filename;

    switch (format) {
      case 'json':
        exportData = JSON.stringify(research, null, 2);
        contentType = 'application/json';
        filename = `research-${id}.json`;
        break;
        
      case 'txt':
        exportData = formatAsText(research);
        contentType = 'text/plain';
        filename = `research-${id}.txt`;
        break;
        
      case 'markdown':
        exportData = formatAsMarkdown(research);
        contentType = 'text/markdown';
        filename = `research-${id}.md`;
        break;
        
      case 'citations':
        exportData = formatCitations(research);
        contentType = 'text/plain';
        filename = `research-citations-${id}.txt`;
        break;
        
      case 'bibliography':
        exportData = formatBibliography(research);
        contentType = 'text/plain';
        filename = `research-bibliography-${id}.txt`;
        break;
        
      case 'pdf':
        exportData = await pdfGenerator.generateResearchPDF(research);
        contentType = 'application/pdf';
        filename = `research-report-${id}.pdf`;
        break;
        
      case 'pdf-citations':
        if (research.citations) {
          exportData = await pdfGenerator.generateCitationsPDF(research.citations);
        } else {
          return res.status(400).json({
            success: false,
            error: 'No citations available for this research'
          });
        }
        contentType = 'application/pdf';
        filename = `research-citations-${id}.pdf`;
        break;
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(exportData);

  } catch (error) {
    console.error('Export research error:', error);
    
    if (error.message === 'Research not found') {
      return res.status(404).json({
        success: false,
        error: 'Research not found'
      });
    }
    
    if (error.message === 'Unauthorized access to research') {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized access to research'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to export research',
      details: error.message
    });
  }
});

/**
 * Helper function to format research as plain text
 */
function formatAsText(research) {
  const results = research.results;
  let text = `Research Query: ${research.query}\n`;
  text += `Research Type: ${research.researchType}\n`;
  text += `Depth Level: ${research.depth}\n`;
  text += `Date: ${new Date(research.timestamp.toDate()).toLocaleDateString()}\n\n`;
  
  if (results.executiveSummary) {
    text += `EXECUTIVE SUMMARY\n${'-'.repeat(50)}\n${results.executiveSummary}\n\n`;
  }
  
  if (results.mainFindings) {
    text += `MAIN FINDINGS\n${'-'.repeat(50)}\n${results.mainFindings}\n\n`;
  }
  
  if (results.keyInsights) {
    text += `KEY INSIGHTS\n${'-'.repeat(50)}\n${results.keyInsights}\n\n`;
  }
  
  if (results.recommendations) {
    text += `RECOMMENDATIONS\n${'-'.repeat(50)}\n${results.recommendations}\n\n`;
  }
  
  if (results.sources && results.sources.length > 0) {
    text += `SOURCES\n${'-'.repeat(50)}\n`;
    results.sources.forEach((source, index) => {
      text += `${index + 1}. ${source.citation}\n`;
    });
  }
  
  return text;
}

/**
 * Helper function to format research as markdown
 */
function formatAsMarkdown(research) {
  const results = research.results;
  let markdown = `# Research Report\n\n`;
  markdown += `**Query:** ${research.query}\n\n`;
  markdown += `**Type:** ${research.researchType}\n\n`;
  markdown += `**Depth:** ${research.depth}/5\n\n`;
  markdown += `**Date:** ${new Date(research.timestamp.toDate()).toLocaleDateString()}\n\n`;
  
  if (results.executiveSummary) {
    markdown += `## Executive Summary\n\n${results.executiveSummary}\n\n`;
  }
  
  if (results.mainFindings) {
    markdown += `## Main Findings\n\n${results.mainFindings}\n\n`;
  }
  
  if (results.keyInsights) {
    markdown += `## Key Insights\n\n${results.keyInsights}\n\n`;
  }
  
  if (results.recommendations) {
    markdown += `## Recommendations\n\n${results.recommendations}\n\n`;
  }
  
  if (results.sources && results.sources.length > 0) {
    markdown += `## Sources\n\n`;
    results.sources.forEach((source, index) => {
      markdown += `${index + 1}. ${source.citation}\n`;
    });
  }
  
  return markdown;
}

/**
 * Helper function to format citations only
 */
function formatCitations(research) {
  const results = research.results;
  let citations = `Citations for Research: ${research.query}\n`;
  citations += `Generated on: ${new Date(research.timestamp.toDate()).toLocaleDateString()}\n\n`;
  
  if (results.sources && results.sources.length > 0) {
    results.sources.forEach((source, index) => {
      citations += `[${index + 1}] ${source.citation}\n`;
    });
  } else {
    citations += 'No sources found in this research.\n';
  }
  
  return citations;
}

/**
 * Helper function to format bibliography
 */
function formatBibliography(research) {
  let bibliography = 'BIBLIOGRAPHY\n';
  bibliography += '='.repeat(50) + '\n\n';
  
  if (research.citations && research.citations.style) {
    bibliography += `Citation Style: ${research.citations.style.toUpperCase()}\n\n`;
  }
  
  if (research.sources && research.sources.length > 0) {
    research.sources.forEach((source, index) => {
      bibliography += `${index + 1}. `;
      
      if (source.citation) {
        bibliography += source.citation;
      } else {
        // Fallback formatting
        const title = source.title || 'Untitled';
        const url = source.url || 'No URL available';
        const type = source.type || 'Unknown';
        const date = source.date || 'No date';
        
        bibliography += `${title}. Retrieved from ${url}. Type: ${type}. Date: ${date}`;
      }
      
      bibliography += '\n\n';
    });
  } else {
    bibliography += 'No sources available for bibliography.\n';
  }
  
  if (research.citations && research.citations.totalSources) {
    bibliography += `\nTotal Sources: ${research.citations.totalSources}\n`;
  }
  
  if (research.qualityScore) {
    bibliography += `Research Quality Score: ${research.qualityScore}/100\n`;
  }
  
  bibliography += `\nGenerated: ${new Date().toLocaleString()}`;
  
  return bibliography;
}

/**
 * POST /api/research/validate-sources
 * Validate and score research sources
 */
router.post('/validate-sources', authenticateToken, async (req, res) => {
  try {
    const { sources } = req.body;

    if (!sources || !Array.isArray(sources) || sources.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Sources array is required'
      });
    }

    if (sources.length > 50) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 50 sources allowed per validation request'
      });
    }

    // Plan validation
    const planValidation = await planValidator.validateRequest(req.user.id, '', 0, 'research');
    if (!planValidation.isValid) {
      return res.status(403).json({
        success: false,
        error: planValidation.error,
        errorCode: planValidation.errorCode
      });
    }

    // Estimate credits for source validation
    const estimatedCredits = Math.ceil(sources.length * 0.5); // 0.5 credits per source

    // Deduct credits
    const creditDeductionResult = await atomicCreditSystem.deductCreditsAtomic(
      req.user.id,
      estimatedCredits,
      planValidation.userPlan.planType,
      'research'
    );

    if (!creditDeductionResult.success) {
      return res.status(402).json({
        success: false,
        error: 'Insufficient credits for source validation',
        details: {
          required: estimatedCredits,
          available: creditDeductionResult.availableCredits
        }
      });
    }

    // Validate sources
    const validationResult = await researchService.validateSources(sources);

    // Record usage
    await planValidator.recordUsage(
      req.user.id,
      sources.length,
      estimatedCredits,
      'source_validation'
    );

    res.json({
      success: true,
      data: {
        validatedSources: validationResult.validatedSources,
        overallScore: validationResult.overallScore,
        creditsUsed: estimatedCredits,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Source validation error:', error);
    res.status(500).json({
      success: false,
      error: 'Source validation failed',
      details: error.message
    });
  }
});

/**
 * POST /api/research/generate-citations
 * Generate formatted citations from sources
 */
router.post('/generate-citations', authenticateToken, async (req, res) => {
  try {
    const { sources, format = 'apa' } = req.body;

    if (!sources || !Array.isArray(sources) || sources.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Sources array is required'
      });
    }

    const validFormats = ['apa', 'mla', 'chicago', 'harvard'];
    if (!validFormats.includes(format)) {
      return res.status(400).json({
        success: false,
        error: `Invalid citation format. Must be one of: ${validFormats.join(', ')}`
      });
    }

    if (sources.length > 100) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 100 sources allowed per citation request'
      });
    }

    // Plan validation
    const planValidation = await planValidator.validateRequest(req.user.id, '', 0, 'research');
    if (!planValidation.isValid) {
      return res.status(403).json({
        success: false,
        error: planValidation.error,
        errorCode: planValidation.errorCode
      });
    }

    // Estimate credits for citation generation
    const estimatedCredits = Math.ceil(sources.length * 0.3); // 0.3 credits per citation

    // Deduct credits
    const creditDeductionResult = await atomicCreditSystem.deductCreditsAtomic(
      req.user.id,
      estimatedCredits,
      planValidation.userPlan.planType,
      'research'
    );

    if (!creditDeductionResult.success) {
      return res.status(402).json({
        success: false,
        error: 'Insufficient credits for citation generation',
        details: {
          required: estimatedCredits,
          available: creditDeductionResult.availableCredits
        }
      });
    }

    // Generate citations
    const citationResult = await researchService.generateCitations(sources, format);

    // Record usage
    await planValidator.recordUsage(
      req.user.id,
      sources.length,
      estimatedCredits,
      'citation_generation'
    );

    res.json({
      success: true,
      data: {
        citations: citationResult.citations,
        bibliography: citationResult.bibliography,
        format,
        creditsUsed: estimatedCredits,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Citation generation error:', error);
    res.status(500).json({
      success: false,
      error: 'Citation generation failed',
      details: error.message
    });
  }
});

module.exports = router;