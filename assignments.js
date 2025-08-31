const express = require('express');
const jwt = require('jsonwebtoken');
const fs = require('fs').promises;
const path = require('path');
const llmService = require('./services/llmService');
const contentProcessor = require('./services/contentProcessor');
const creditSystem = require('./services/creditSystem');
const contentValidator = require('./services/contentValidator');
const draftManager = require('./services/draftManager');
const ContentFormatter = require('./services/contentFormatter');
const PlanValidator = require('./services/planValidator');
const AtomicCreditSystem = require('./services/atomicCreditSystem');
const ContentDatabase = require('./services/contentDatabase');
const MultiPartGenerator = require('./services/multiPartGenerator');
const OriginalityDetection = require('./services/originalityDetection');
const ZoteroCSLProcessor = require('./services/zoteroCSL');
const ContentHistoryService = require('./services/contentHistory');
const FinalDetectionService = require('./services/finalDetection');
const router = express.Router();

// Initialize services
const contentFormatterInstance = new ContentFormatter();
const planValidatorInstance = new PlanValidator();
const atomicCreditSystem = new AtomicCreditSystem();
const contentDatabase = new ContentDatabase();
const multiPartGenerator = new MultiPartGenerator();
const originalityDetection = new OriginalityDetection();
const zoteroCSLProcessor = new ZoteroCSLProcessor();
const contentHistoryService = new ContentHistoryService();
const finalDetectionService = new FinalDetectionService();

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(403).json({ error: 'Invalid or expired token' });
    }
};

// Enhanced AI content generation service with style and tone support
const generateAssignmentContent = async (title, description, wordCount, citationStyle, style = 'Academic', tone = 'Formal') => {
    // This is an enhanced mock implementation. In production, integrate with OpenAI GPT-4 or similar
    const styleTemplates = {
        'Academic': {
            introduction: 'This scholarly examination explores',
            transition: 'Furthermore, research indicates that',
            conclusion: 'In conclusion, the evidence demonstrates'
        },
        'Business': {
            introduction: 'This business analysis examines',
            transition: 'Market data suggests that',
            conclusion: 'The strategic implications indicate'
        },
        'Creative': {
            introduction: 'Imagine a world where',
            transition: 'As we delve deeper into this narrative',
            conclusion: 'The story ultimately reveals'
        }
    };
    
    const selectedStyle = styleTemplates[style] || styleTemplates['Academic'];
    
    const mockContent = `
# ${title}

## Introduction

${selectedStyle.introduction} the topic of "${title}" with detailed analysis and research-based insights. The following content has been generated based on the provided instructions: ${description}

## Main Body

${selectedStyle.transition} Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.

Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.

### Key Points

1. First main argument with supporting evidence
2. Second critical analysis point
3. Third perspective on the topic
4. Fourth consideration and implications

## Analysis

The research indicates several important findings that contribute to our understanding of this topic. These insights are particularly relevant in the current academic discourse.

## Conclusion

In conclusion, this analysis of "${title}" reveals significant insights that contribute to the broader understanding of the subject matter. The implications of these findings extend beyond the immediate scope of this assignment.

## References

${citationStyle === 'APA' ? 
`Smith, J. (2023). Academic Writing in the Digital Age. Journal of Modern Education, 45(2), 123-145.

Johnson, M. & Brown, A. (2022). Research Methodologies for Students. Academic Press.` :
citationStyle === 'MLA' ?
`Smith, John. "Academic Writing in the Digital Age." Journal of Modern Education, vol. 45, no. 2, 2023, pp. 123-145.

Johnson, Mary, and Anne Brown. Research Methodologies for Students. Academic Press, 2022.` :
`Smith, J. (2023). Academic Writing in the Digital Age. Journal of Modern Education 45, no. 2: 123-145.

Johnson, M., and A. Brown. Research Methodologies for Students. Academic Press, 2022.`}
    `.trim();

    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    return mockContent.substring(0, Math.min(mockContent.length, wordCount * 6)); // Rough word estimation
};

// Mock plagiarism checking service
const checkPlagiarism = async (content) => {
    // This is a mock implementation. In production, integrate with Originality.ai, Copyleaks, etc.
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Return a random originality score between 85-98%
    const score = 85 + Math.random() * 13;
    return Math.round(score * 100) / 100;
};

// Create new assignment
// New endpoint for AI Writer tool content generation
router.post('/generate', authenticateToken, async (req, res) => {
    const { prompt, style, tone, wordCount, subject, additionalInstructions, citationStyle, requiresCitations } = req.body;
    const userId = req.user.id;
    const db = req.app.locals.db;

    // Validate input parameters
    if (!prompt || !wordCount) {
        return res.status(400).json({ error: 'Prompt and word count are required' });
    }

    if (wordCount < 100) {
        return res.status(400).json({ error: 'Word count must be at least 100' });
    }

    // CRITICAL: Strict freemium checks and plan validation
    console.log(`Validating request for user ${userId}: prompt=${prompt.length} chars, wordCount=${wordCount}`);
    
    try {
        const planValidation = await planValidatorInstance.validateRequest(userId, prompt, wordCount, 'writing');
        
        if (!planValidation.isValid) {
            console.warn(`Plan validation failed for user ${userId}:`, planValidation.error);
            
            // Return specific error responses based on error code
            const statusCode = getStatusCodeForValidationError(planValidation.errorCode);
            
            return res.status(statusCode).json({
                error: planValidation.error,
                errorCode: planValidation.errorCode,
                details: {
                    planType: planValidation.planType,
                    currentUsage: planValidation.currentUsage,
                    limits: planValidation.monthlyLimit || planValidation.maxLength || planValidation.maxCount,
                    upgradeOptions: planValidation.planType ? planValidatorInstance.getUpgradeOptions(planValidation.planType) : null
                },
                timestamp: new Date().toISOString()
            });
        }
        
        console.log(`Plan validation passed for user ${userId}:`, {
            planType: planValidation.userPlan.planType,
            promptWords: planValidation.promptWordCount,
            requestedWords: planValidation.requestedWordCount,
            estimatedCredits: planValidation.estimatedCredits
        });
    } catch (validationError) {
        console.error('Plan validation error:', validationError);
        return res.status(500).json({ error: 'Plan validation failed' });
    }

    try {
        // Get user information and check credits
        db.get('SELECT credits, is_premium FROM users WHERE id = ?', [userId], async (err, user) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Database error' });
            }

            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            // Step 2: Atomic credit deduction with 1:10 word-to-credit ratio
            console.log(`Attempting atomic credit deduction for ${wordCount} words`);
            
            const creditDeductionResult = await atomicCreditSystem.deductCreditsAtomic(
                req.user.id,
                wordCount, // Pass requested word count directly
                planValidation.userPlan.planType,
                'writing'
            );
            
            if (!creditDeductionResult.success) {
                return res.status(402).json({
                    success: false,
                    error: 'Insufficient credits. Please top-up.',
                    errorCode: 'INSUFFICIENT_CREDITS',
                    details: {
                        requiredCredits: creditDeductionResult.creditsDeducted || Math.ceil(wordCount / 5),
                        currentBalance: creditDeductionResult.previousBalance || 0,
                        shortfall: (creditDeductionResult.creditsDeducted || Math.ceil(wordCount / 5)) - (creditDeductionResult.previousBalance || 0)
                    }
                });
            }
            
            console.log(`Credits deducted successfully. Transaction ID: ${creditDeductionResult.transactionId}`);

            try {
                // Step 3: Multi-part LLM generation with iterative detection
                const generationResult = await multiPartGenerator.generateMultiPartContent({
                    userId: req.user.id,
                    prompt,
                    requestedWordCount: wordCount,
                    userPlan: planValidation.userPlan.planType || 'freemium',
                    style,
                    tone,
                    subject: subject || '',
                    additionalInstructions: additionalInstructions || ''
                });
                
                // Step 4: Process citations if required
                let citationData = {
                    requiresCitations: false,
                    processedContent: generationResult.content,
                    bibliography: [],
                    inTextCitations: [],
                    citationCount: 0
                };
                
                if (requiresCitations && citationStyle) {
                    console.log(`Processing citations with style: ${citationStyle}`);
                    citationData = await zoteroCSLProcessor.processCitations(
                        generationResult.content,
                        citationStyle,
                        subject || prompt.substring(0, 100)
                    );
                }
                
                // Step 5: Final detection processing for combined content
                console.log('Running final detection on combined content');
                const finalDetectionResults = await finalDetectionService.processFinalDetection(
                    citationData.processedContent,
                    generationResult.chunkDetectionResults || [],
                    {
                        contentId: generationResult.contentId,
                        userId: req.user.id,
                        isMultiPart: generationResult.chunksGenerated > 1,
                        generationMethod: 'multi-part'
                    }
                );
                
                // Generate assignment ID
                const assignmentId = `assign_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                
                try {
                    // Record usage after successful generation
                    await planValidatorInstance.recordUsage({
                        userId: req.user.id,
                        wordsGenerated: citationData.processedContent ? citationData.processedContent.split(/\s+/).length : generationResult.wordCount,
                        creditsUsed: creditDeductionResult.creditsDeducted,
                        generationType: 'assignment'
                    });
                    
                    // Step 6: Save to content history with comprehensive metadata
                    const contentHistoryData = {
                        finalContent: citationData.processedContent,
                        title: `${subject || 'Assignment'} - ${new Date().toLocaleDateString()}`,
                        prompt,
                        style,
                        tone,
                        finalWordCount: citationData.processedContent ? citationData.processedContent.split(/\s+/).length : generationResult.wordCount,
                        isMultiPart: generationResult.chunksGenerated > 1,
                        chunksGenerated: generationResult.chunksGenerated,
                        refinementCycles: generationResult.refinementCycles,
                        finalDetectionResults,
                        citationsUsed: citationData.requiresCitations,
                        citationStyle: citationStyle || null,
                        citationCount: citationData.citationCount,
                        bibliography: citationData.bibliography,
                        generationTime: generationResult.generationTime,
                         creditsUsed: creditDeductionResult.creditsDeducted,
                         transactionId: creditDeductionResult.transactionId,
                        usedSimilarContent: generationResult.usedSimilarContent,
                        similarContentId: generationResult.similarContentId,
                        optimizationApplied: generationResult.usedSimilarContent,
                        userPlan: planValidation.userPlan.planType,
                        planLimits: planValidation.userPlan,
                        tags: [subject, style, tone].filter(Boolean)
                    };
                    
                    const historyResult = await contentHistoryService.saveContentToHistory(req.user.id, contentHistoryData);
                    
                    const assignment = {
                        id: assignmentId,
                        userId: req.user.id,
                        prompt,
                        content: citationData.processedContent,
                        wordCount: contentHistoryData.finalWordCount,
                        style,
                        tone,
                        subject: subject || 'General',
                        additionalInstructions: additionalInstructions || '',
                        status: 'completed',
                        createdAt: new Date(),
                        updatedAt: new Date(),
                        contentHistoryId: historyResult.contentId,
                        metadata: {
                            chunksGenerated: generationResult.chunksGenerated,
                            refinementCycles: generationResult.refinementCycles,
                            generationTime: generationResult.generationTime,
                            contentId: generationResult.contentId,
                            usedSimilarContent: generationResult.usedSimilarContent,
                            creditsUsed: creditDeductionResult.creditsDeducted,
                             transactionId: creditDeductionResult.transactionId,
                            citationsProcessed: citationData.requiresCitations,
                            finalDetectionScore: finalDetectionResults.qualityScore,
                            requiresReview: finalDetectionResults.requiresReview
                        }
                    };
                    
                    // Save to Firestore
                    await db.collection('assignments').doc(assignmentId).set(assignment);
                    
                    res.json({
                        success: true,
                        assignment: {
                            id: assignment.id,
                            prompt: assignment.prompt,
                            content: assignment.content,
                            wordCount: assignment.wordCount,
                            style: assignment.style,
                            tone: assignment.tone,
                            subject: assignment.subject,
                            status: assignment.status,
                            createdAt: assignment.createdAt,
                            contentHistoryId: assignment.contentHistoryId,
                            metadata: assignment.metadata
                        },
                        generationStats: {
                            chunksGenerated: generationResult.chunksGenerated,
                            refinementCycles: generationResult.refinementCycles,
                            generationTime: generationResult.generationTime,
                            creditsUsed: creditDeductionResult.creditsDeducted,
                            usedSimilarContent: generationResult.usedSimilarContent
                        },
                        citationData: {
                            requiresCitations: citationData.requiresCitations,
                            citationStyle: citationStyle,
                            citationCount: citationData.citationCount,
                            bibliography: citationData.bibliography,
                            inTextCitations: citationData.inTextCitations
                        },
                        finalDetectionResults: {
                            originalityScore: finalDetectionResults.originalityScore,
                            aiDetectionScore: finalDetectionResults.aiDetectionScore,
                            plagiarismScore: finalDetectionResults.plagiarismScore,
                            qualityScore: finalDetectionResults.qualityScore,
                            severity: finalDetectionResults.severity,
                            confidence: finalDetectionResults.confidence,
                            requiresReview: finalDetectionResults.requiresReview,
                            isAcceptable: finalDetectionResults.isAcceptable,
                            recommendations: finalDetectionResults.recommendations
                        }
                    });
                } catch (generationError) {
                    console.error('Content generation failed, rolling back credits:', generationError);
                    
                    // Rollback credit deduction if generation fails
                    try {
                        await atomicCreditSystem.rollbackTransaction(
                            req.user.id,
                            creditDeductionResult.transactionId,
                            creditDeductionResult.creditsDeducted,
                            creditDeductionResult.wordsAllocated
                        );
                        console.log(`Credits rolled back for transaction: ${creditDeductionResult.transactionId}`);
                    } catch (rollbackError) {
                        console.error('Failed to rollback credits:', rollbackError);
                    }
                    
                    throw generationError;
                }
            } catch (generationError) {
                console.error('Content generation error:', generationError);
                return res.status(500).json({ error: 'Failed to generate content' });
            }
        });
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/create', authenticateToken, async (req, res) => {
    const { title, description, wordCount, citationStyle } = req.body;
    const db = req.app.locals.db;
    const userId = req.user.id;

    if (!title || !wordCount || !citationStyle) {
        return res.status(400).json({ error: 'Title, word count, and citation style are required' });
    }

    if (wordCount < 100 || wordCount > 5000) {
        return res.status(400).json({ error: 'Word count must be between 100 and 5000' });
    }

    // Calculate credits needed (1 credit = 10 words)
    const creditsNeeded = Math.ceil(wordCount / 10);

    try {
        // Check user credits
        db.get('SELECT credits FROM users WHERE id = ?', [userId], async (err, user) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Database error' });
            }

            if (!user || user.credits < creditsNeeded) {
                return res.status(400).json({ 
                    error: 'Insufficient credits',
                    required: creditsNeeded,
                    available: user ? user.credits : 0
                });
            }

            try {
                // Create assignment record
                db.run(
                    'INSERT INTO assignments (user_id, title, description, word_count, citation_style, status, credits_used) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [userId, title, description, wordCount, citationStyle, 'generating', creditsNeeded],
                    async function(err) {
                        if (err) {
                            console.error('Database error:', err);
                            return res.status(500).json({ error: 'Error creating assignment' });
                        }

                        const assignmentId = this.lastID;

                        // Deduct credits
                        db.run(
                            'UPDATE users SET credits = credits - ? WHERE id = ?',
                            [creditsNeeded, userId],
                            (err) => {
                                if (err) {
                                    console.error('Error updating credits:', err);
                                }
                            }
                        );

                        res.json({
                            message: 'Assignment creation started',
                            assignmentId: assignmentId,
                            creditsUsed: creditsNeeded
                        });

                        // Generate content asynchronously
                        try {
                            const content = await generateAssignmentContent(title, description, wordCount, citationStyle);
                            const originalityScore = await checkPlagiarism(content);

                            // Update assignment with generated content
                            db.run(
                                'UPDATE assignments SET content = ?, originality_score = ?, status = ? WHERE id = ?',
                                [content, originalityScore, 'completed', assignmentId],
                                (err) => {
                                    if (err) {
                                        console.error('Error updating assignment:', err);
                                        db.run(
                                            'UPDATE assignments SET status = ? WHERE id = ?',
                                            ['failed', assignmentId]
                                        );
                                    } else {
                                        console.log(`Assignment ${assignmentId} completed successfully`);
                                    }
                                }
                            );
                        } catch (error) {
                            console.error('Error generating content:', error);
                            db.run(
                                'UPDATE assignments SET status = ? WHERE id = ?',
                                ['failed', assignmentId]
                            );
                        }
                    }
                );
            } catch (error) {
                console.error('Assignment creation error:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });
    } catch (error) {
        console.error('Assignment creation error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get assignment by ID
router.get('/:id', authenticateToken, (req, res) => {
    const assignmentId = req.params.id;
    const userId = req.user.id;
    const db = req.app.locals.db;

    db.get(
        'SELECT * FROM assignments WHERE id = ? AND user_id = ?',
        [assignmentId, userId],
        (err, assignment) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Database error' });
            }

            if (!assignment) {
                return res.status(404).json({ error: 'Assignment not found' });
            }

            res.json({
                id: assignment.id,
                title: assignment.title,
                description: assignment.description,
                wordCount: assignment.word_count,
                citationStyle: assignment.citation_style,
                content: assignment.content,
                originalityScore: assignment.originality_score,
                status: assignment.status,
                creditsUsed: assignment.credits_used,
                createdAt: assignment.created_at
            });
        }
    );
});

// Get user's assignment history
router.get('/', authenticateToken, (req, res) => {
    const userId = req.user.userId;
    const db = req.app.locals.db;

    db.all(
        'SELECT id, title, word_count, citation_style, status, originality_score, credits_used, created_at FROM assignments WHERE user_id = ? ORDER BY created_at DESC',
        [userId],
        (err, assignments) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Database error' });
            }

            const formattedAssignments = assignments.map(assignment => ({
                id: assignment.id,
                title: assignment.title,
                wordCount: assignment.word_count,
                citationStyle: assignment.citation_style,
                status: assignment.status,
                originalityScore: assignment.originality_score,
                creditsUsed: assignment.credits_used,
                createdAt: assignment.created_at
            }));

            res.json(formattedAssignments);
        }
    );
});

// Download assignment as text file
router.get('/:id/download', authenticateToken, async (req, res) => {
    const assignmentId = req.params.id;
    const userId = req.user.userId;
    const db = req.app.locals.db;

    db.get(
        'SELECT title, content FROM assignments WHERE id = ? AND user_id = ? AND status = "completed"',
        [assignmentId, userId],
        async (err, assignment) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Database error' });
            }

            if (!assignment) {
                return res.status(404).json({ error: 'Assignment not found or not completed' });
            }

            try {
                const filename = `${assignment.title.replace(/[^a-zA-Z0-9]/g, '_')}.txt`;
                
                res.setHeader('Content-Type', 'text/plain');
                res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
                res.send(assignment.content);
            } catch (error) {
                console.error('Download error:', error);
                res.status(500).json({ error: 'Error generating download' });
            }
        }
    );
});

// Draft Management Endpoints

// Create new draft
router.post('/drafts', authenticateToken, async (req, res) => {
    try {
        const { title, content, prompt, style, tone, targetWordCount } = req.body;
        const userId = req.user.id;

        if (!title || title.trim().length === 0) {
            return res.status(400).json({ error: 'Title is required' });
        }

        const draft = await draftManager.createDraft({
            userId,
            title: title.trim(),
            content: content || '',
            prompt: prompt || '',
            style: style || 'Academic',
            tone: tone || 'Formal',
            targetWordCount: targetWordCount || 0
        }, db);

        res.status(201).json({
            success: true,
            draft: draft
        });
    } catch (error) {
        console.error('Error creating draft:', error);
        res.status(500).json({ error: 'Failed to create draft' });
    }
});

// Get user's drafts
router.get('/drafts', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { status, limit, offset, orderBy, orderDirection } = req.query;

        const drafts = await draftManager.getUserDrafts(userId, db, {
            status,
            limit: parseInt(limit) || 50,
            offset: parseInt(offset) || 0,
            orderBy: orderBy || 'updated_at',
            orderDirection: orderDirection || 'DESC'
        });

        res.json({
            success: true,
            drafts: drafts
        });
    } catch (error) {
        console.error('Error fetching drafts:', error);
        res.status(500).json({ error: 'Failed to fetch drafts' });
    }
});

// Get specific draft
router.get('/drafts/:id', authenticateToken, async (req, res) => {
    try {
        const draftId = parseInt(req.params.id);
        const userId = req.user.id;

        const draft = await draftManager.getDraft(draftId, userId, db);

        if (!draft) {
            return res.status(404).json({ error: 'Draft not found' });
        }

        res.json({
            success: true,
            draft: draft
        });
    } catch (error) {
        console.error('Error fetching draft:', error);
        res.status(500).json({ error: 'Failed to fetch draft' });
    }
});

// Update draft
router.put('/drafts/:id', authenticateToken, async (req, res) => {
    try {
        const draftId = parseInt(req.params.id);
        const userId = req.user.id;
        const { title, content, prompt, style, tone, targetWordCount, status, createVersion } = req.body;

        // Verify ownership
        const existingDraft = await draftManager.getDraft(draftId, userId, db);
        if (!existingDraft) {
            return res.status(404).json({ error: 'Draft not found' });
        }

        const updateData = {};
        if (title !== undefined) updateData.title = title;
        if (content !== undefined) updateData.content = content;
        if (prompt !== undefined) updateData.prompt = prompt;
        if (style !== undefined) updateData.style = style;
        if (tone !== undefined) updateData.tone = tone;
        if (targetWordCount !== undefined) updateData.targetWordCount = targetWordCount;
        if (status !== undefined) updateData.status = status;

        const result = await draftManager.updateDraft(
            draftId, 
            updateData, 
            db, 
            createVersion === true
        );

        res.json({
            success: true,
            result: result
        });
    } catch (error) {
        console.error('Error updating draft:', error);
        res.status(500).json({ error: 'Failed to update draft' });
    }
});

// Get draft versions
router.get('/drafts/:id/versions', authenticateToken, async (req, res) => {
    try {
        const draftId = parseInt(req.params.id);
        const userId = req.user.id;

        // Verify ownership
        const draft = await draftManager.getDraft(draftId, userId, db);
        if (!draft) {
            return res.status(404).json({ error: 'Draft not found' });
        }

        const versions = await draftManager.getDraftVersions(draftId, db);

        res.json({
            success: true,
            versions: versions
        });
    } catch (error) {
        console.error('Error fetching draft versions:', error);
        res.status(500).json({ error: 'Failed to fetch draft versions' });
    }
});

// Restore draft version
router.post('/drafts/:id/restore/:version', authenticateToken, async (req, res) => {
    try {
        const draftId = parseInt(req.params.id);
        const versionNumber = parseInt(req.params.version);
        const userId = req.user.id;

        // Verify ownership
        const draft = await draftManager.getDraft(draftId, userId, db);
        if (!draft) {
            return res.status(404).json({ error: 'Draft not found' });
        }

        const result = await draftManager.restoreDraftVersion(draftId, versionNumber, db);

        res.json({
            success: true,
            result: result
        });
    } catch (error) {
        console.error('Error restoring draft version:', error);
        res.status(500).json({ error: 'Failed to restore draft version' });
    }
});

// Create auto-save session
router.post('/drafts/:id/autosave-session', authenticateToken, async (req, res) => {
    try {
        const draftId = parseInt(req.params.id);
        const userId = req.user.id;

        // Verify ownership
        const draft = await draftManager.getDraft(draftId, userId, db);
        if (!draft) {
            return res.status(404).json({ error: 'Draft not found' });
        }

        const sessionToken = await draftManager.createAutoSaveSession(draftId, db);

        res.json({
            success: true,
            sessionToken: sessionToken,
            autoSaveInterval: draftManager.autoSaveInterval
        });
    } catch (error) {
        console.error('Error creating auto-save session:', error);
        res.status(500).json({ error: 'Failed to create auto-save session' });
    }
});

// Auto-save draft content
router.post('/drafts/autosave', async (req, res) => {
    try {
        const { sessionToken, content } = req.body;

        if (!sessionToken || content === undefined) {
            return res.status(400).json({ error: 'Session token and content are required' });
        }

        const result = await draftManager.autoSaveDraft(sessionToken, content, db);

        res.json({
            success: true,
            result: result
        });
    } catch (error) {
        console.error('Error auto-saving draft:', error);
        res.status(500).json({ error: 'Failed to auto-save draft' });
    }
});

// Delete draft
router.delete('/drafts/:id', authenticateToken, async (req, res) => {
    try {
        const draftId = parseInt(req.params.id);
        const userId = req.user.id;

        const result = await draftManager.deleteDraft(draftId, userId, db);

        res.json({
            success: true,
            result: result
        });
    } catch (error) {
        console.error('Error deleting draft:', error);
        res.status(500).json({ error: 'Failed to delete draft' });
    }
});

// Get draft statistics
router.get('/drafts-stats', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const stats = await draftManager.getDraftStatistics(userId, db);

        res.json({
            success: true,
            statistics: stats
        });
    } catch (error) {
        console.error('Error fetching draft statistics:', error);
        res.status(500).json({ error: 'Failed to fetch draft statistics' });
    }
});

// Export content in various formats
router.post('/export', async (req, res) => {
    try {
        const { content, format, options = {} } = req.body;
        
        if (!content) {
            return res.status(400).json({
                error: 'Content is required for export'
            });
        }
        
        if (!format) {
            return res.status(400).json({
                error: 'Export format is required',
                supportedFormats: contentFormatterInstance.getSupportedFormats()
            });
        }
        
        // Format the content
        const formattedResult = await contentFormatterInstance.formatContent(content, format, options);
        
        // Save to file
        const saveResult = await contentFormatterInstance.saveToFile(formattedResult);
        
        res.json({
            success: true,
            export: {
                filename: saveResult.filename,
                format: saveResult.format,
                size: saveResult.size,
                downloadUrl: `/api/assignments/download/${saveResult.filename}`,
                timestamp: formattedResult.timestamp
            },
            metadata: {
                wordCount: contentFormatterInstance.countWords(content),
                characterCount: content.length,
                exportedAt: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Error exporting content:', error);
        res.status(500).json({
            error: 'Failed to export content',
            message: error.message
        });
    }
});

// Download exported file
router.get('/download/:filename', async (req, res) => {
    try {
        const { filename } = req.params;
        const filepath = path.join(contentFormatterInstance.exportDirectory, filename);
        
        // Check if file exists
        try {
            await fs.access(filepath);
        } catch (error) {
            return res.status(404).json({
                error: 'File not found',
                filename
            });
        }
        
        // Set appropriate headers
        const ext = path.extname(filename).toLowerCase();
        const mimeTypes = {
            '.txt': 'text/plain',
            '.html': 'text/html',
            '.pdf': 'application/pdf',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        };
        
        const mimeType = mimeTypes[ext] || 'application/octet-stream';
        
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        
        // Stream the file
        const fileStream = fs.createReadStream(filepath);
        fileStream.pipe(res);
        
    } catch (error) {
        console.error('Error downloading file:', error);
        res.status(500).json({
            error: 'Failed to download file',
            message: error.message
        });
    }
});

// Get supported export formats
router.get('/export/formats', (req, res) => {
    res.json({
        success: true,
        formats: contentFormatterInstance.getSupportedFormats(),
        descriptions: {
            txt: 'Plain text format with optional formatting',
            html: 'HTML format with CSS styling',
            pdf: 'PDF-ready HTML (requires PDF conversion service)',
            docx: 'Structured data for DOCX generation (requires DOCX library)'
        }
    });
});

// Preview formatted content (without saving)
router.post('/export/preview', async (req, res) => {
    try {
        const { content, format, options = {} } = req.body;
        
        if (!content) {
            return res.status(400).json({
                error: 'Content is required for preview'
            });
        }
        
        if (!format) {
            return res.status(400).json({
                error: 'Export format is required',
                supportedFormats: contentFormatterInstance.getSupportedFormats()
            });
        }
        
        // Format the content without saving
        const formattedResult = await contentFormatterInstance.formatContent(content, format, options);
        
        res.json({
            success: true,
            preview: {
                content: formattedResult.content,
                format: formattedResult.format,
                size: formattedResult.size,
                filename: formattedResult.filename
            },
            metadata: {
                wordCount: contentFormatterInstance.countWords(content),
                characterCount: content.length,
                previewedAt: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Error previewing content:', error);
        res.status(500).json({
            error: 'Failed to preview content',
            message: error.message
        });
    }
});

/**
 * Get appropriate HTTP status code for validation error
 * @param {string} errorCode - Validation error code
 * @returns {number} HTTP status code
 */
function getStatusCodeForValidationError(errorCode) {
    const statusCodes = {
        'PROMPT_TOO_LONG': 413, // Payload Too Large
        'OUTPUT_LIMIT_EXCEEDED': 413, // Payload Too Large
        'MONTHLY_WORD_LIMIT_REACHED': 402, // Payment Required
        'MONTHLY_WORD_LIMIT_WOULD_EXCEED': 402, // Payment Required
        'MONTHLY_CREDIT_LIMIT_REACHED': 402, // Payment Required
        'INSUFFICIENT_CREDITS': 402, // Payment Required
        'PLAN_NOT_FOUND': 404, // Not Found
        'INVALID_PLAN': 400, // Bad Request
        'VALIDATION_ERROR': 500, // Internal Server Error
        'MONTHLY_VALIDATION_ERROR': 500, // Internal Server Error
        'CREDIT_VALIDATION_ERROR': 500 // Internal Server Error
    };
    
    return statusCodes[errorCode] || 400; // Default to Bad Request
}

// Usage tracking endpoints

/**
 * Get current monthly usage for authenticated user
 */
router.get('/usage/monthly', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const monthlyUsage = await planValidatorInstance.getMonthlyUsage(userId);
        const freemiumLimits = planValidatorInstance.getFreemiumLimits();
        
        res.json({
            success: true,
            usage: monthlyUsage,
            limits: freemiumLimits,
            remainingWords: Math.max(0, freemiumLimits.monthlyWordLimit - monthlyUsage.wordsGenerated),
            remainingCredits: Math.max(0, freemiumLimits.monthlyCreditLimit - monthlyUsage.creditsUsed),
            utilizationPercentage: {
                words: Math.round((monthlyUsage.wordsGenerated / freemiumLimits.monthlyWordLimit) * 100),
                credits: Math.round((monthlyUsage.creditsUsed / freemiumLimits.monthlyCreditLimit) * 100)
            }
        });
    } catch (error) {
        console.error('Error getting monthly usage:', error);
        res.status(500).json({
            error: 'Failed to retrieve monthly usage'
        });
    }
});

/**
 * Get usage history for authenticated user
 */
router.get('/usage/history', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const months = parseInt(req.query.months) || 6;
        
        if (months < 1 || months > 12) {
            return res.status(400).json({
                error: 'Months parameter must be between 1 and 12'
            });
        }
        
        const usageHistory = await planValidatorInstance.getUserUsageHistory(userId, months);
        
        res.json({
            success: true,
            history: usageHistory,
            totalMonths: months
        });
    } catch (error) {
        console.error('Error getting usage history:', error);
        res.status(500).json({
            error: 'Failed to retrieve usage history'
        });
    }
});

/**
 * Get usage statistics and plan information
 */
router.get('/usage/stats', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        
        // Get current month usage
        const monthlyUsage = await planValidatorInstance.getMonthlyUsage(userId);
        
        // Get user plan
        const userPlan = await planValidatorInstance.getUserPlan(userId);
        
        // Get freemium limits
        const limits = planValidatorInstance.getFreemiumLimits();
        
        // Calculate statistics
        const stats = {
            currentMonth: {
                wordsGenerated: monthlyUsage.wordsGenerated,
                creditsUsed: monthlyUsage.creditsUsed,
                requestCount: monthlyUsage.requestCount
            },
            plan: {
                type: userPlan.planType,
                name: userPlan.planName || userPlan.planType.charAt(0).toUpperCase() + userPlan.planType.slice(1),
                isFreemium: userPlan.planType === 'freemium'
            },
            limits: userPlan.planType === 'freemium' ? limits : null,
            remaining: userPlan.planType === 'freemium' ? {
                words: Math.max(0, limits.monthlyWordLimit - monthlyUsage.wordsGenerated),
                credits: Math.max(0, limits.monthlyCreditLimit - monthlyUsage.creditsUsed)
            } : null,
            utilization: userPlan.planType === 'freemium' ? {
                words: Math.round((monthlyUsage.wordsGenerated / limits.monthlyWordLimit) * 100),
                credits: Math.round((monthlyUsage.creditsUsed / limits.monthlyCreditLimit) * 100)
            } : null,
            upgradeOptions: planValidatorInstance.getUpgradeOptions(userPlan.planType)
        };
        
        res.json({
            success: true,
            stats
        });
    } catch (error) {
        console.error('Error getting usage stats:', error);
        res.status(500).json({
            error: 'Failed to retrieve usage statistics'
        });
    }
});

module.exports = router;