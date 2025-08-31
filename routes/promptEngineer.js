const express = require('express');
const router = express.Router();
const PromptEngineerService = require('../services/promptEngineerService');
const AtomicCreditSystem = require('../services/atomicCreditSystem');
const admin = require('firebase-admin');

const promptService = new PromptEngineerService();
const atomicCredit = new AtomicCreditSystem();

// Middleware to verify Firebase ID token
const verifyToken = async (req, res, next) => {
    try {
        const idToken = req.headers.authorization?.split('Bearer ')[1];
        if (!idToken) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const decodedToken = await admin.auth().verifyIdToken(idToken);
        req.user = decodedToken;
        next();
    } catch (error) {
        console.error('Token verification error:', error);
        res.status(401).json({ error: 'Invalid token' });
    }
};

// Optimize prompt endpoint
router.post('/optimize', verifyToken, async (req, res) => {
    try {
        const { prompt, category = 'general' } = req.body;
        const userId = req.user.uid;

        if (!prompt || prompt.trim().length === 0) {
            return res.status(400).json({ 
                error: 'Prompt is required and cannot be empty' 
            });
        }

        // Calculate word count for validation
        const wordCount = prompt.trim().split(/\s+/).filter(word => word.length > 0).length;
        
        if (wordCount > 15000) {
            return res.status(400).json({ 
                error: 'Prompt exceeds maximum length of 15,000 words' 
            });
        }

        const validCategories = ['general', 'academic', 'creative', 'technical', 'business'];
        if (!validCategories.includes(category)) {
            return res.status(400).json({ 
                error: 'Invalid category. Must be one of: ' + validCategories.join(', ') 
            });
        }

        const result = await promptService.optimizePrompt(prompt, category, userId);
        
        // Handle limit exceeded responses
        if (!result.success && result.error === 'LIMIT_EXCEEDED') {
            return res.status(429).json({
                error: result.message,
                requiresUpgrade: result.requiresUpgrade,
                limitExceeded: true
            });
        }
        
        // Handle insufficient credits
        if (!result.success && result.error === 'INSUFFICIENT_CREDITS') {
            return res.status(402).json({
                error: result.message,
                requiresUpgrade: false,
                insufficientCredits: true
            });
        }
        
        res.json(result);

    } catch (error) {
        console.error('Prompt optimization error:', error);
        
        if (error.message.includes('insufficient credits') || error.message.includes('plan')) {
            return res.status(402).json({ 
                error: error.message,
                requiresUpgrade: true 
            });
        }
        
        res.status(500).json({ 
            error: error.message || 'Failed to optimize prompt' 
        });
    }
});

// Analyze prompt quality endpoint
router.post('/analyze', verifyToken, async (req, res) => {
    try {
        const { prompt } = req.body;
        const userId = req.user.uid;

        if (!prompt || prompt.trim().length === 0) {
            return res.status(400).json({ 
                error: 'Prompt is required and cannot be empty' 
            });
        }

        // Calculate word count for validation
        const wordCount = prompt.trim().split(/\s+/).filter(word => word.length > 0).length;
        
        if (wordCount > 15000) {
            return res.status(400).json({ 
                error: 'Prompt exceeds maximum length of 15,000 words' 
            });
        }

        const result = await promptService.analyzePromptWithCredits(prompt, userId);
        
        // Handle limit exceeded responses
        if (!result.success && result.error === 'LIMIT_EXCEEDED') {
            return res.status(429).json({
                error: result.message,
                requiresUpgrade: result.requiresUpgrade,
                limitExceeded: true
            });
        }
        
        // Handle insufficient credits
        if (!result.success && result.error === 'INSUFFICIENT_CREDITS') {
            return res.status(402).json({
                error: result.message,
                requiresUpgrade: false,
                insufficientCredits: true
            });
        }
        
        res.json(result);

    } catch (error) {
        console.error('Prompt analysis error:', error);
        
        if (error.message.includes('insufficient credits') || error.message.includes('plan')) {
            return res.status(402).json({ 
                error: error.message,
                requiresUpgrade: true 
            });
        }
        
        res.status(500).json({ 
            error: error.message || 'Failed to analyze prompt' 
        });
    }
});

// Get prompt history endpoint
router.get('/history', verifyToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        const limit = parseInt(req.query.limit) || 20;

        if (limit > 100) {
            return res.status(400).json({ 
                error: 'Limit cannot exceed 100' 
            });
        }

        const history = await promptService.getPromptHistory(userId, limit);
        res.json({
            success: true,
            history
        });

    } catch (error) {
        console.error('Get prompt history error:', error);
        res.status(500).json({ 
            error: 'Failed to retrieve prompt history' 
        });
    }
});

// Get quick templates endpoint
router.get('/templates', (req, res) => {
    try {
        const templates = promptService.getQuickTemplates();
        res.json({
            success: true,
            templates
        });
    } catch (error) {
        console.error('Get templates error:', error);
        res.status(500).json({ 
            error: 'Failed to retrieve templates' 
        });
    }
});

// Get user credits endpoint
router.get('/credits', verifyToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        const credits = await atomicCredit.getUserCredits(userId);
        
        res.json({
            success: true,
            credits: credits,
            costs: {
                optimization: promptService.OPTIMIZATION_CREDITS,
                analysis: promptService.ANALYSIS_CREDITS
            }
        });
    } catch (error) {
        console.error('Get credits error:', error);
        res.status(500).json({ 
            error: 'Failed to retrieve credits' 
        });
    }
});

// Validate user plan endpoint
router.get('/validate', verifyToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        const validation = await promptService.planValidator.validateUserPlan(userId);
        
        res.json({
            success: true,
            validation
        });
    } catch (error) {
        console.error('Plan validation error:', error);
        res.status(500).json({ 
            error: 'Failed to validate plan' 
        });
    }
});

// Get daily usage statistics
router.get('/usage', verifyToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        const result = await promptService.getDailyUsageStats(userId);
        res.json(result);
    } catch (error) {
        console.error('Daily usage stats error:', error);
        res.status(500).json({ 
            error: error.message || 'Failed to get usage statistics' 
        });
    }
});

// Free prompt analysis (no authentication required)
router.post('/analyze-free', async (req, res) => {
    try {
        const { prompt } = req.body;

        if (!prompt || prompt.trim().length === 0) {
            return res.status(400).json({ 
                error: 'Prompt is required and cannot be empty' 
            });
        }

        // Calculate word count for validation
        const wordCount = prompt.trim().split(/\s+/).filter(word => word.length > 0).length;
        
        if (wordCount > 2000) {
            return res.status(400).json({ 
                error: 'Prompt exceeds maximum length of 2,000 words for free analysis' 
            });
        }

        const result = await promptService.analyzePromptFree(prompt);
        res.json(result);

    } catch (error) {
        console.error('Free prompt analysis error:', error);
        res.status(500).json({ 
            error: 'Failed to analyze prompt' 
        });
    }
});

module.exports = router;