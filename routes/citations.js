const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const CitationGenerator = require('../services/citationGenerator');
const AtomicCreditSystem = require('../services/atomicCreditSystem');

// Initialize Citation Generator and Credit System
const citationGenerator = new CitationGenerator();
const atomicCreditSystem = new AtomicCreditSystem();

/**
 * @route POST /api/citations/generate
 * @desc Generate citations for a given topic
 * @access Private
 */
router.post('/generate', authenticateToken, async (req, res) => {
    try {
        const { topic, count = 3, style = 'apa' } = req.body;
        const userId = req.user.uid;
        
        if (!topic || !topic.trim()) {
            return res.status(400).json({ error: 'Topic is required for citation generation' });
        }
        
        if (count < 1 || count > 10) {
            return res.status(400).json({ error: 'Citation count must be between 1 and 10' });
        }
        
        // Calculate credits needed (1 credit per citation)
        const creditsNeeded = count;
        
        // Check and deduct credits
        const creditResult = await atomicCreditSystem.deductCreditsAtomic(userId, creditsNeeded, 'pro', 'citation');
        if (!creditResult.success) {
            return res.status(402).json({ 
                error: 'Insufficient credits',
                message: `You need ${creditsNeeded} credits to generate ${count} citations. Current balance: ${creditResult.currentCredits}`,
                creditsNeeded,
                currentCredits: creditResult.currentCredits
            });
        }
        
        try {
            // Generate citations using AI
            const citations = await citationGenerator.generateCitations(topic, count, style);
            
            if (!citations || citations.length === 0) {
                // Refund credits if generation failed
                await atomicCreditSystem.refundCredits(userId, creditsNeeded, 'Citation generation failed');
                return res.status(500).json({ 
                    error: 'Failed to generate citations',
                    message: 'No citations could be generated for the given topic'
                });
            }
            
            res.json({ 
                success: true, 
                citations: citations,
                topic: topic,
                style: style,
                count: citations.length,
                creditsUsed: creditsNeeded,
                remainingCredits: creditResult.remainingCredits
            });
            
        } catch (generationError) {
            // Refund credits if generation failed
            await atomicCreditSystem.refundCredits(userId, creditsNeeded, 'Citation generation error');
            throw generationError;
        }
        
    } catch (error) {
        console.error('Error generating citations:', error);
        res.status(500).json({ 
            error: 'Failed to generate citations',
            message: error.message
        });
    }
});

/**
 * @route POST /api/citations/validate
 * @desc Validate and enhance citation format
 * @access Private
 */
router.post('/validate', authenticateToken, async (req, res) => {
    try {
        const { citation, style = 'apa' } = req.body;
        
        if (!citation || !citation.trim()) {
            return res.status(400).json({ error: 'Citation text is required' });
        }
        
        // Validate and enhance citation
        const result = await citationGenerator.validateCitation(citation, style);
        
        res.json({ 
            success: true, 
            original: citation,
            validated: result.citation,
            style: style,
            suggestions: result.suggestions || [],
            isValid: result.isValid,
            errors: result.errors || []
        });
        
    } catch (error) {
        console.error('Error validating citation:', error);
        res.status(500).json({ 
            error: 'Failed to validate citation',
            message: error.message
        });
    }
});

/**
 * @route POST /api/citations/format
 * @desc Format citation from URL or DOI
 * @access Private
 */
router.post('/format', authenticateToken, async (req, res) => {
    try {
        const { url, doi, style = 'apa' } = req.body;
        const userId = req.user.uid;
        
        if (!url && !doi) {
            return res.status(400).json({ error: 'URL or DOI is required' });
        }
        
        // Deduct 1 credit for citation formatting
        const creditResult = await atomicCreditSystem.deductCreditsAtomic(userId, 1, 'pro', 'citation');
        if (!creditResult.success) {
            return res.status(402).json({ 
                error: 'Insufficient credits',
                message: 'You need 1 credit to format a citation',
                creditsNeeded: 1,
                currentCredits: creditResult.currentCredits
            });
        }
        
        try {
            // Format citation from URL or DOI
            const citation = await citationGenerator.formatFromSource(url || doi, style);
            
            if (!citation) {
                // Refund credit if formatting failed
                await atomicCreditSystem.refundCredits(userId, 1, 'Citation formatting failed');
                return res.status(500).json({ 
                    error: 'Failed to format citation',
                    message: 'Could not extract citation information from the provided source'
                });
            }
            
            res.json({ 
                success: true, 
                citation: citation,
                source: url || doi,
                style: style,
                creditsUsed: 1,
                remainingCredits: creditResult.remainingCredits
            });
            
        } catch (formattingError) {
            // Refund credit if formatting failed
            await atomicCreditSystem.refundCredits(userId, 1, 'Citation formatting error');
            throw formattingError;
        }
        
    } catch (error) {
        console.error('Error formatting citation:', error);
        res.status(500).json({ 
            error: 'Failed to format citation',
            message: error.message
        });
    }
});

/**
 * @route GET /api/citations/styles
 * @desc Get available citation styles
 * @access Private
 */
router.get('/styles', authenticateToken, async (req, res) => {
    try {
        const styles = [
            { 
                id: 'apa', 
                name: 'APA Style', 
                description: 'American Psychological Association 7th edition',
                example: 'Smith, J. (2023). Title of article. Journal Name, 15(3), 123-145.'
            },
            { 
                id: 'mla', 
                name: 'MLA Style', 
                description: 'Modern Language Association 9th edition',
                example: 'Smith, John. "Title of Article." Journal Name, vol. 15, no. 3, 2023, pp. 123-145.'
            },
            { 
                id: 'chicago', 
                name: 'Chicago Style', 
                description: 'Chicago Manual of Style 17th edition',
                example: 'Smith, John. "Title of Article." Journal Name 15, no. 3 (2023): 123-145.'
            },
            { 
                id: 'harvard', 
                name: 'Harvard Style', 
                description: 'Harvard referencing style',
                example: 'Smith, J. (2023) \'Title of article\', Journal Name, 15(3), pp. 123-145.'
            },
            { 
                id: 'ieee', 
                name: 'IEEE Style', 
                description: 'Institute of Electrical and Electronics Engineers',
                example: 'J. Smith, "Title of article," Journal Name, vol. 15, no. 3, pp. 123-145, 2023.'
            },
            { 
                id: 'vancouver', 
                name: 'Vancouver Style', 
                description: 'International Committee of Medical Journal Editors',
                example: 'Smith J. Title of article. Journal Name. 2023;15(3):123-145.'
            }
        ];
        
        res.json({ 
            success: true, 
            styles: styles
        });
        
    } catch (error) {
        console.error('Error getting citation styles:', error);
        res.status(500).json({ 
            error: 'Failed to get citation styles',
            message: error.message
        });
    }
});

/**
 * @route POST /api/citations/bibliography
 * @desc Generate bibliography from multiple citations
 * @access Private
 */
router.post('/bibliography', authenticateToken, async (req, res) => {
    try {
        const { citations, style = 'apa', title = 'References' } = req.body;
        
        if (!citations || !Array.isArray(citations) || citations.length === 0) {
            return res.status(400).json({ error: 'Citations array is required' });
        }
        
        // Generate formatted bibliography
        const bibliography = await citationGenerator.generateBibliography(citations, style, title);
        
        res.json({ 
            success: true, 
            bibliography: bibliography,
            style: style,
            title: title,
            count: citations.length
        });
        
    } catch (error) {
        console.error('Error generating bibliography:', error);
        res.status(500).json({ 
            error: 'Failed to generate bibliography',
            message: error.message
        });
    }
});

module.exports = router;