const express = require('express');
const router = express.Router();
const { DetectorService } = require('../services/detectorService');
const { authenticateToken } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');

// Initialize detector service
const detectorService = new DetectorService();

// Rate limiting for detector endpoints
const detectorRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 requests per windowMs
  message: {
    error: 'Too many detector requests from this IP, please try again later.',
    retryAfter: 15 * 60 // 15 minutes in seconds
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Apply rate limiting to all detector routes
router.use(detectorRateLimit);

/**
 * @route POST /api/detector/analyze
 * @desc Analyze content for plagiarism, AI detection, and readability
 * @access Private
 */
router.post('/analyze', authenticateToken, async (req, res) => {
  try {
    const { content, options = {} } = req.body;
    const userId = req.user.id;

    // Validate input
    if (!content || typeof content !== 'string') {
      return res.status(400).json({
        error: 'Content is required and must be a string'
      });
    }

    if (content.trim().length === 0) {
      return res.status(400).json({
        error: 'Content cannot be empty'
      });
    }

    if (content.length > 50000) { // 50k character limit
      return res.status(400).json({
        error: 'Content exceeds maximum length of 50,000 characters'
      });
    }

    // Validate options
    const validOptions = {
      plagiarismDetection: options.plagiarismDetection !== false,
      aiDetection: options.aiDetection !== false,
      readabilityAnalysis: options.readabilityAnalysis !== false
    };

    // Ensure at least one analysis type is selected
    if (!validOptions.plagiarismDetection && !validOptions.aiDetection && !validOptions.readabilityAnalysis) {
      return res.status(400).json({
        error: 'At least one analysis type must be selected'
      });
    }

    // Perform analysis
    const result = await detectorService.analyzeContent(userId, content, validOptions);

    res.json({
      success: true,
      message: 'Content analysis completed successfully',
      data: result
    });

  } catch (error) {
    console.error('Detector analysis error:', error);
    
    if (error.message.includes('Insufficient credits')) {
      return res.status(402).json({
        error: 'Insufficient credits',
        message: error.message
      });
    }
    
    if (error.message.includes('requires Pro or Custom plan')) {
      return res.status(403).json({
        error: 'Plan upgrade required',
        message: error.message
      });
    }

    res.status(500).json({
      error: 'Analysis failed',
      message: 'An error occurred while analyzing the content'
    });
  }
});

/**
 * @route POST /api/detector/remove-all
 * @desc Remove detected issues from content using AI
 * @access Private
 */
router.post('/remove-all', authenticateToken, async (req, res) => {
  try {
    const { content, detectionResults, options = {} } = req.body;
    const userId = req.user.id;

    // Validate input
    if (!content || typeof content !== 'string') {
      return res.status(400).json({
        error: 'Content is required and must be a string'
      });
    }

    if (!detectionResults || typeof detectionResults !== 'object') {
      return res.status(400).json({
        error: 'Detection results are required'
      });
    }

    if (content.trim().length === 0) {
      return res.status(400).json({
        error: 'Content cannot be empty'
      });
    }

    if (content.length > 50000) {
      return res.status(400).json({
        error: 'Content exceeds maximum length of 50,000 characters'
      });
    }

    // Check if there are any issues to remove
    const hasIssues = (
      (detectionResults.plagiarism && detectionResults.plagiarism.score > 30) ||
      (detectionResults.aiContent && detectionResults.aiContent.score > 70) ||
      (detectionResults.readability && detectionResults.readability.fleschKincaidGrade > 12)
    );

    if (!hasIssues) {
      return res.status(400).json({
        error: 'No significant issues detected to remove',
        message: 'Content appears to be in good condition'
      });
    }

    // Remove detected issues
    const result = await detectorService.removeDetectedIssues(userId, content, detectionResults, options);

    res.json({
      success: true,
      message: 'Content issues removed successfully',
      data: result
    });

  } catch (error) {
    console.error('Detector removal error:', error);
    
    if (error.message.includes('Insufficient credits')) {
      return res.status(402).json({
        error: 'Insufficient credits',
        message: error.message
      });
    }
    
    if (error.message.includes('requires Pro or Custom plan')) {
      return res.status(403).json({
        error: 'Plan upgrade required',
        message: error.message
      });
    }

    res.status(500).json({
      error: 'Content improvement failed',
      message: 'An error occurred while improving the content'
    });
  }
});

/**
 * @route GET /api/detector/history
 * @desc Get detection history for the user
 * @access Private
 */
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 10;

    if (limit > 50) {
      return res.status(400).json({
        error: 'Limit cannot exceed 50'
      });
    }

    const history = await detectorService.getDetectionHistory(userId, limit);

    res.json({
      success: true,
      data: {
        history,
        count: history.length
      }
    });

  } catch (error) {
    console.error('Detector history error:', error);
    res.status(500).json({
      error: 'Failed to fetch detection history',
      message: 'An error occurred while retrieving your detection history'
    });
  }
});

/**
 * @route POST /api/detector/workflow
 * @desc Complete workflow: detect and remove issues with two-cycle loop
 * @access Private
 */
router.post('/workflow', authenticateToken, async (req, res) => {
  try {
    const { content, options = {} } = req.body;
    const userId = req.user.id;

    // Validate input
    if (!content || typeof content !== 'string') {
      return res.status(400).json({
        error: 'Content is required and must be a string'
      });
    }

    if (content.trim().length === 0) {
      return res.status(400).json({
        error: 'Content cannot be empty'
      });
    }

    if (content.length > 50000) {
      return res.status(400).json({
        error: 'Content exceeds maximum length of 50,000 characters'
      });
    }

    // Validate options
    const validOptions = {
      plagiarismDetection: options.plagiarismDetection !== false,
      aiDetection: options.aiDetection !== false,
      readabilityAnalysis: options.readabilityAnalysis !== false
    };

    // Ensure at least one analysis type is selected
    if (!validOptions.plagiarismDetection && !validOptions.aiDetection && !validOptions.readabilityAnalysis) {
      return res.status(400).json({
        error: 'At least one analysis type must be selected'
      });
    }

    // Execute complete workflow
    const result = await detectorService.detectAndRemoveWorkflow(userId, content, validOptions);

    res.json({
      success: true,
      message: result.message,
      data: {
        originalContent: content,
        finalContent: result.finalContent,
        initialDetection: result.initialDetection,
        finalDetection: result.finalDetection,
        cyclesUsed: result.cyclesUsed,
        detectedWordCount: result.detectedWordCount,
        totalCreditsUsed: result.totalCreditsUsed,
        improvementSummary: {
          plagiarismReduced: result.initialDetection.plagiarism && result.finalDetection.plagiarism ? 
            result.initialDetection.plagiarism.score - result.finalDetection.plagiarism.score : 0,
          aiContentReduced: result.initialDetection.aiContent && result.finalDetection.aiContent ? 
            result.initialDetection.aiContent.score - result.finalDetection.aiContent.score : 0,
          readabilityImproved: result.initialDetection.readability && result.finalDetection.readability ? 
            result.initialDetection.readability.fleschKincaidGrade - result.finalDetection.readability.fleschKincaidGrade : 0
        }
      }
    });

  } catch (error) {
    console.error('Detector workflow error:', error);
    
    if (error.message.includes('Insufficient credits')) {
      return res.status(402).json({
        error: 'Insufficient credits',
        message: error.message
      });
    }
    
    if (error.message.includes('requires Pro or Custom plan')) {
      return res.status(403).json({
        error: 'Plan upgrade required',
        message: error.message
      });
    }

    res.status(500).json({
      error: 'Workflow failed',
      message: 'An error occurred during the detection and removal workflow'
    });
  }
});

/**
 * @route GET /api/detector/credits
 * @desc Get credit cost information for detector operations
 * @access Private
 */
router.get('/credits', authenticateToken, async (req, res) => {
  try {
    const { wordCount } = req.query;

    if (!wordCount || isNaN(wordCount) || wordCount <= 0) {
      return res.status(400).json({
        error: 'Valid word count is required'
      });
    }

    const words = parseInt(wordCount);
    const detectionCredits = detectorService.calculateDetectionCredits(words);
    const generationCredits = detectorService.calculateGenerationCredits(words);

    res.json({
      success: true,
      data: {
        wordCount: words,
        detectionCredits,
        generationCredits
      }
    });

  } catch (error) {
    console.error('Credit calculation error:', error);
    res.status(500).json({
      error: 'Failed to calculate credits',
      message: 'An error occurred while calculating credit costs'
    });
  }
});

/**
 * @route POST /api/detector/validate
 * @desc Validate content before analysis (check length, format, etc.)
 * @access Private
 */
router.post('/validate', authenticateToken, async (req, res) => {
  try {
    const { content } = req.body;
    const userId = req.user.id;

    if (!content || typeof content !== 'string') {
      return res.status(400).json({
        error: 'Content is required and must be a string'
      });
    }

    const wordCount = detectorService.calculateWordCount(content);
    const detectionCredits = detectorService.calculateDetectionCredits(wordCount);
    const generationCredits = detectorService.calculateGenerationCredits(wordCount);

    // Check user plan and credits
    const planValidator = detectorService.planValidator;
    const userPlan = await planValidator.getUserPlan(userId);
    const userCredits = await planValidator.getUserCredits(userId);

    const validation = {
      valid: true,
      issues: [],
      wordCount,
      detectionCredits,
      generationCredits,
      hasDetectorAccess: userPlan.hasDetectorAccess,
      availableCredits: userCredits
    };

    // Validate content length
    if (content.length > 50000) {
      validation.valid = false;
      validation.issues.push('Content exceeds maximum length of 50,000 characters');
    }

    if (content.trim().length === 0) {
      validation.valid = false;
      validation.issues.push('Content cannot be empty');
    }

    if (wordCount < 10) {
      validation.valid = false;
      validation.issues.push('Content must contain at least 10 words');
    }

    // Validate plan access
    if (!userPlan.hasDetectorAccess) {
      validation.valid = false;
      validation.issues.push('Detector tool requires Pro or Custom plan');
    }

    // Validate credits for detection
    if (userCredits < detectionCredits) {
      validation.valid = false;
      validation.issues.push(`Insufficient credits for analysis. Need ${detectionCredits}, available: ${userCredits}`);
    }

    res.json({
      success: true,
      data: validation
    });

  } catch (error) {
    console.error('Content validation error:', error);
    res.status(500).json({
      error: 'Validation failed',
      message: 'An error occurred while validating the content'
    });
  }
});

module.exports = router;