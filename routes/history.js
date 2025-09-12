const express = require('express');
const router = express.Router();
const { verifyFirebaseToken } = require('../services/firebaseAuth');
const ContentHistoryService = require('../services/contentHistory');
const ResearchService = require('../services/researchService');
const DetectorService = require('../services/detectorService');
const PromptEngineerService = require('../services/promptEngineerService');
const AtomicCreditSystem = require('../services/atomicCreditSystem');

const contentHistoryService = new ContentHistoryService();
const researchService = new ResearchService();
const detectorService = new DetectorService();
const promptService = new PromptEngineerService();
const creditSystem = new AtomicCreditSystem();

/**
 * @route GET /api/history
 * @desc Get comprehensive user history from all services
 * @access Private
 */
router.get('/', verifyFirebaseToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 20, offset = 0, type = 'all', status = 'all' } = req.query;
    
    const parsedLimit = Math.min(parseInt(limit) || 20, 100);
    const parsedOffset = parseInt(offset) || 0;
    
    let allHistory = [];
    
    // Fetch from different services based on type filter
    if (type === 'all' || type === 'content') {
      try {
        const contentHistory = await contentHistoryService.getUserContentHistory(userId, {
          limit: parsedLimit,
          offset: parsedOffset
        });
        
        if (contentHistory.content) {
          const formattedContent = contentHistory.content.map(item => ({
            id: item.id,
            type: 'content',
            title: item.title || 'Untitled Content',
            status: item.status || 'completed',
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            wordCount: item.wordCount || 0,
            creditsUsed: item.creditsUsed || 0,
            originalityScore: item.originalityScore,
            aiDetectionScore: item.aiDetectionScore,
            preview: item.content ? item.content.substring(0, 200) + '...' : '',
            metadata: {
              style: item.style,
              tone: item.tone,
              citationsUsed: item.citationsUsed,
              isMultiPart: item.isMultiPart
            }
          }));
          allHistory = allHistory.concat(formattedContent);
        }
      } catch (error) {
        console.error('Error fetching content history:', error);
      }
    }
    
    if (type === 'all' || type === 'research') {
      try {
        const researchHistory = await researchService.getResearchHistory(userId, parsedLimit, parsedOffset);
        
        const formattedResearch = researchHistory.map(item => ({
          id: item.id,
          type: 'research',
          title: item.title || item.topic || 'Research Project',
          status: item.status || 'completed',
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          wordCount: item.wordCount || 0,
          creditsUsed: item.creditsUsed || 0,
          preview: item.summary || item.content?.substring(0, 200) + '...' || '',
          metadata: {
            topic: item.topic,
            sourceCount: item.sourceCount || 0,
            citationStyle: item.citationStyle,
            researchType: item.researchType
          }
        }));
        allHistory = allHistory.concat(formattedResearch);
      } catch (error) {
        console.error('Error fetching research history:', error);
      }
    }
    
    if (type === 'all' || type === 'detection') {
      try {
        const detectionHistory = await detectorService.getDetectionHistory(userId, parsedLimit);
        
        const formattedDetection = detectionHistory.map(item => ({
          id: item.id,
          type: 'detection',
          title: `Detection Analysis - ${new Date(item.createdAt?.toDate?.() || item.createdAt).toLocaleDateString()}`,
          status: item.status || 'completed',
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          wordCount: item.wordCount || 0,
          creditsUsed: item.creditsUsed || 0,
          preview: item.content ? item.content.substring(0, 200) + '...' : '',
          metadata: {
            originalityScore: item.originalityScore,
            aiDetectionScore: item.aiDetectionScore,
            plagiarismScore: item.plagiarismScore,
            detectionType: item.detectionType
          }
        }));
        allHistory = allHistory.concat(formattedDetection);
      } catch (error) {
        console.error('Error fetching detection history:', error);
      }
    }
    
    if (type === 'all' || type === 'prompts') {
      try {
        const promptHistory = await promptService.getPromptHistory(userId, parsedLimit);
        
        if (promptHistory.optimizations) {
          const formattedPrompts = promptHistory.optimizations.map(item => ({
            id: item.id,
            type: 'prompts',
            title: `Prompt Optimization - ${new Date(item.createdAt?.toDate?.() || item.createdAt).toLocaleDateString()}`,
            status: 'completed',
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            wordCount: item.originalPrompt?.length || 0,
            creditsUsed: item.creditsUsed || 0,
            preview: item.optimizedPrompt ? item.optimizedPrompt.substring(0, 200) + '...' : '',
            metadata: {
              originalPrompt: item.originalPrompt,
              category: item.category,
              improvementScore: item.improvementScore
            }
          }));
          allHistory = allHistory.concat(formattedPrompts);
        }
      } catch (error) {
        console.error('Error fetching prompt history:', error);
      }
    }
    
    // Sort by creation date (newest first)
    allHistory.sort((a, b) => {
      const dateA = a.createdAt?.toDate?.() || new Date(a.createdAt);
      const dateB = b.createdAt?.toDate?.() || new Date(b.createdAt);
      return dateB - dateA;
    });
    
    // Apply status filter
    if (status !== 'all') {
      allHistory = allHistory.filter(item => item.status === status);
    }
    
    // Apply pagination
    const paginatedHistory = allHistory.slice(parsedOffset, parsedOffset + parsedLimit);
    
    // Calculate statistics
    const stats = {
      totalProjects: allHistory.length,
      completed: allHistory.filter(item => item.status === 'completed').length,
      inProgress: allHistory.filter(item => item.status === 'in_progress').length,
      failed: allHistory.filter(item => item.status === 'failed').length,
      totalWords: allHistory.reduce((sum, item) => sum + (item.wordCount || 0), 0),
      totalCreditsUsed: allHistory.reduce((sum, item) => sum + (item.creditsUsed || 0), 0)
    };
    
    res.json({
      success: true,
      history: paginatedHistory,
      stats,
      pagination: {
        total: allHistory.length,
        limit: parsedLimit,
        offset: parsedOffset,
        hasMore: parsedOffset + parsedLimit < allHistory.length
      }
    });
    
  } catch (error) {
    console.error('History fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch history',
      message: 'An error occurred while retrieving your project history'
    });
  }
});

/**
 * @route GET /api/history/:id
 * @desc Get specific history item details
 * @access Private
 */
router.get('/:id', verifyFirebaseToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { type } = req.query;
    
    let historyItem = null;
    
    // Try to fetch from different services based on type or try all
    if (type === 'content' || !type) {
      try {
        historyItem = await contentHistoryService.getContentById(id, userId);
        if (historyItem) {
          historyItem.type = 'content';
        }
      } catch (error) {
        console.error('Error fetching content item:', error);
      }
    }
    
    if (!historyItem && (type === 'research' || !type)) {
      try {
        historyItem = await researchService.getResearchById(id, userId);
        if (historyItem) {
          historyItem.type = 'research';
        }
      } catch (error) {
        console.error('Error fetching research item:', error);
      }
    }
    
    if (!historyItem) {
      return res.status(404).json({
        success: false,
        error: 'History item not found'
      });
    }
    
    res.json({
      success: true,
      item: historyItem
    });
    
  } catch (error) {
    console.error('History item fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch history item'
    });
  }
});

/**
 * @route DELETE /api/history/:id
 * @desc Delete specific history item
 * @access Private
 */
router.delete('/:id', verifyFirebaseToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { type } = req.query;
    
    let deleted = false;
    
    // Try to delete from appropriate service
    if (type === 'content') {
      try {
        await contentHistoryService.deleteContent(id, userId);
        deleted = true;
      } catch (error) {
        console.error('Error deleting content:', error);
      }
    }
    
    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'History item not found or could not be deleted'
      });
    }
    
    res.json({
      success: true,
      message: 'History item deleted successfully'
    });
    
  } catch (error) {
    console.error('History delete error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete history item'
    });
  }
});

/**
 * @route POST /api/history/export
 * @desc Export user history
 * @access Private
 */
router.post('/export', verifyFirebaseToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { format = 'json', type = 'all' } = req.body;
    
    // Get all history data
    const historyResponse = await fetch(`${req.protocol}://${req.get('host')}/api/history?limit=1000&type=${type}`, {
      headers: {
        'Authorization': req.headers.authorization
      }
    });
    
    const historyData = await historyResponse.json();
    
    if (format === 'csv') {
      // Convert to CSV format
      const csv = convertToCSV(historyData.history);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="history.csv"');
      res.send(csv);
    } else {
      // Return JSON format
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="history.json"');
      res.json(historyData);
    }
    
  } catch (error) {
    console.error('History export error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to export history'
    });
  }
});

// Helper function to convert history to CSV
function convertToCSV(history) {
  if (!history || history.length === 0) {
    return 'No data available';
  }
  
  const headers = ['ID', 'Type', 'Title', 'Status', 'Created At', 'Word Count', 'Credits Used'];
  const rows = history.map(item => [
    item.id,
    item.type,
    item.title,
    item.status,
    new Date(item.createdAt?.toDate?.() || item.createdAt).toISOString(),
    item.wordCount || 0,
    item.creditsUsed || 0
  ]);
  
  return [headers, ...rows].map(row => row.map(field => `"${field}"`).join(',')).join('\n');
}

module.exports = router;