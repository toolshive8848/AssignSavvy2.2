const express = require('express');
const multer = require('multer');
const path = require('path');
const FileProcessingService = require('../services/fileProcessingService');
const LLMService = require('../services/llmService');
const ContentDatabase = require('../services/contentDatabase');
const MultiPartGenerator = require('../services/multiPartGenerator');
const { authenticateToken } = require('../middleware/auth');
const AtomicCreditSystem = require('../services/atomicCreditSystem');
const PlanValidator = require('../services/planValidator');

const router = express.Router();
const fileProcessingService = new FileProcessingService();
const llmService = new LLMService();
const contentDatabase = new ContentDatabase();
const multiPartGenerator = new MultiPartGenerator();
const atomicCreditSystem = new AtomicCreditSystem();
const planValidator = new PlanValidator();

// Configure multer for file uploads
const storage = multer.memoryStorage(); // Store files in memory for processing
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
        files: 5 // Maximum 5 files
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['.pdf', '.docx', '.txt'];
        const ext = path.extname(file.originalname).toLowerCase();
        
        if (allowedTypes.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error(`Unsupported file type: ${ext}. Allowed types: PDF, DOCX, TXT`), false);
        }
    }
});

/**
 * POST /api/writer/generate
 * Generate content from text prompt
 */
router.post('/generate', authenticateToken, async (req, res) => {
    try {
        const { prompt, style = 'Academic', tone = 'Formal', wordCount = 500 } = req.body;
        const userId = req.user.userId;
        
        if (!prompt || prompt.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Prompt is required'
            });
        }
        
        if (wordCount < 100 || wordCount > 2000) {
            return res.status(400).json({
                success: false,
                error: 'Word count must be between 100 and 2000'
            });
        }
        
        // Validate user plan and calculate credits
        const planValidation = await planValidator.validateUserPlan(userId, {
            toolType: 'writing',
            requestType: 'generation'
        });
        
        if (!planValidation.isValid) {
            return res.status(403).json({
                success: false,
                error: planValidation.error || 'Plan validation failed'
            });
        }
        
        // Calculate credits needed (1:5 ratio - 1 credit per 5 words)
        const creditsNeeded = atomicCreditSystem.calculateRequiredCredits(wordCount, 'writing');
        
        // Deduct credits atomically
        const creditResult = await atomicCreditSystem.deductCreditsAtomic(
            userId,
            creditsNeeded,
            planValidation.userPlan.planType,
            'writing'
        );
        
        if (!creditResult.success) {
            return res.status(400).json({
                success: false,
                error: `Insufficient credits. Need ${creditsNeeded}, available: ${creditResult.previousBalance || 0}`
            });
        }
        
        try {
            let result;
            let contentSource = 'new_generation';
            
            // Determine if multi-part generation is needed
            // Use multi-part for requests > 800 words or when user plan supports it
            const useMultiPart = wordCount > 800 || 
                               (planValidation.userPlan.planType !== 'freemium' && wordCount > 500);
            
            if (useMultiPart) {
                console.log(`Using multi-part generation for ${wordCount} words`);
                
                // Use MultiPartGenerator for chunk-based generation with iterative detection
                result = await multiPartGenerator.generateMultiPartContent({
                    userId,
                    prompt,
                    requestedWordCount: wordCount,
                    userPlan: planValidation.userPlan.planType,
                    style,
                    tone,
                    subject: req.body.subject || '',
                    additionalInstructions: req.body.additionalInstructions || '',
                    requiresCitations: req.body.requiresCitations || false,
                    citationStyle: req.body.citationStyle || 'apa'
                });
                
                contentSource = result.usedSimilarContent ? 'multipart_optimized' : 'multipart_new';
            } else {
                // Use traditional single-generation for smaller content
                console.log(`Using single generation for ${wordCount} words`);
                
                // Check for similar content in database (80%+ matching)
                const similarContent = await contentDatabase.findSimilarContent(prompt, style, tone, wordCount);
                
                if (similarContent && similarContent.length > 0) {
                    // Use existing similar content as base for polishing
                    console.log(`Found ${similarContent.length} similar content matches`);
                    const bestMatch = similarContent[0]; // Highest similarity score
                    
                    // Get content for polishing and refinement
                    const polishingContent = await contentDatabase.getContentForPolishing(bestMatch.contentId, wordCount);
                    
                    if (polishingContent && polishingContent.sections) {
                        // Use existing content as base, polish to match new requirements
                        result = await llmService.polishExistingContent(
                            polishingContent.sections,
                            prompt,
                            style,
                            tone,
                            wordCount
                        );
                        contentSource = 'optimized_existing';
                        
                        // Update access statistics for the reused content
                        await contentDatabase.updateAccessStatistics([bestMatch.contentId]);
                    } else {
                        // Fallback to new generation if polishing fails
                        result = await llmService.generateContent(prompt, style, tone, wordCount);
                    }
                } else {
                    // No similar content found, generate new content
                    console.log('No similar content found, generating new content');
                    result = await llmService.generateContent(prompt, style, tone, wordCount);
                }
                
                // Store the new/polished content in database for future optimization
                if (result && result.content) {
                    await contentDatabase.storeContent(userId, prompt, result.content, {
                        style,
                        tone,
                        generationTime: result.generationTime,
                        source: contentSource,
                        wordCount: wordCount
                    });
                }
            }
            
            res.json({
                success: true,
                content: result.content,
                metadata: {
                    source: result.source || 'multipart_generation',
                    generationTime: result.generationTime,
                    fallbackUsed: result.fallbackUsed,
                    contentSource: contentSource,
                    similarContentFound: result.usedSimilarContent || false,
                    style: style,
                    tone: tone,
                    wordCount: result.wordCount || wordCount,
                    creditsUsed: creditsNeeded,
                    remainingCredits: creditResult.newBalance,
                    // Multi-part specific metadata
                    isMultiPart: useMultiPart,
                    chunksGenerated: result.chunksGenerated || 1,
                    refinementCycles: result.refinementCycles || 0,
                    contentId: result.contentId,
                    requiresCitations: result.citationData?.requiresCitations || false,
                    citationCount: result.citationData?.citationCount || 0,
                    citationStyle: result.citationData?.style || null,
                    bibliography: result.citationData?.bibliography || [],
                    inTextCitations: result.citationData?.inTextCitations || [],
                    // Final detection results
                    originalityScore: result.finalDetectionResults?.originalityScore || null,
                    aiDetectionScore: result.finalDetectionResults?.aiDetectionScore || null,
                    plagiarismScore: result.finalDetectionResults?.plagiarismScore || null,
                    qualityScore: result.finalDetectionResults?.qualityScore || null,
                    requiresReview: result.finalDetectionResults?.requiresReview || false,
                    isAcceptable: result.finalDetectionResults?.isAcceptable || true,
                    detectionConfidence: result.finalDetectionResults?.confidence || null,
                    detectionRecommendations: result.finalDetectionResults?.recommendations || []
                }
            });
            
        } catch (generationError) {
            console.error('Content generation failed, rolling back credits:', generationError);
            
            // Rollback credits on generation failure
            try {
                await atomicCreditSystem.refundCreditsAtomic(
                    userId,
                    creditsNeeded,
                    planValidation.userPlan.planType,
                    'writing_rollback'
                );
            } catch (rollbackError) {
                console.error('Credit rollback failed:', rollbackError);
            }
            
            return res.status(500).json({
                success: false,
                error: 'Content generation failed',
                details: generationError.message
            });
        }
        
    } catch (error) {
        console.error('Error in writer generate endpoint:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

/**
 * POST /api/writer/upload-and-generate
 * Upload files and generate content based on file contents
 */
router.post('/upload-and-generate', authenticateToken, upload.array('files', 5), async (req, res) => {
    try {
        const { additionalPrompt = '', style = 'Academic', tone = 'Formal', wordCount = 500 } = req.body;
        const files = req.files;
        const userId = req.user.userId;
        
        if (!files || files.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No files uploaded'
            });
        }
        
        if (wordCount < 100 || wordCount > 2000) {
            return res.status(400).json({
                success: false,
                error: 'Word count must be between 100 and 2000'
            });
        }
        
        // Validate user plan and calculate credits
        const planValidation = await planValidator.validateUserPlan(userId, {
            toolType: 'writing',
            requestType: 'generation'
        });
        
        if (!planValidation.isValid) {
            return res.status(403).json({
                success: false,
                error: planValidation.error || 'Plan validation failed'
            });
        }
        
        // Calculate credits needed (1:5 ratio - 1 credit per 5 words)
        const creditsNeeded = atomicCreditSystem.calculateRequiredCredits(wordCount, 'writing');
        
        // Deduct credits atomically
        const creditResult = await atomicCreditSystem.deductCreditsAtomic(
            userId,
            creditsNeeded,
            planValidation.userPlan.planType,
            'writing'
        );
        
        if (!creditResult.success) {
            return res.status(400).json({
                success: false,
                error: `Insufficient credits. Need ${creditsNeeded}, available: ${creditResult.previousBalance || 0}`
            });
        }
        
        try {
        
        // Process files and generate content
        const result = await fileProcessingService.processFilesAndGenerate(
            files,
            additionalPrompt,
            style,
            tone
        );
        
            if (!result.success) {
                // Rollback credits on file processing failure
                try {
                    await atomicCreditSystem.refundCreditsAtomic(
                        userId,
                        creditsNeeded,
                        planValidation.userPlan.planType,
                        'writing_rollback'
                    );
                } catch (rollbackError) {
                    console.error('Credit rollback failed:', rollbackError);
                }
                return res.status(400).json(result);
            }
            
            let llmResult;
            let contentSource = 'new_generation';
            
            // Determine if multi-part generation is needed for file-based content
            const useMultiPart = wordCount > 800 || 
                               (planValidation.userPlan.planType !== 'freemium' && wordCount > 500);
            
            if (useMultiPart) {
                console.log(`Using multi-part generation for file-based content: ${wordCount} words`);
                
                // Use MultiPartGenerator for chunk-based generation with iterative detection
                llmResult = await multiPartGenerator.generateMultiPartContent({
                    userId,
                    prompt: result.prompt,
                    requestedWordCount: wordCount,
                    userPlan: planValidation.userPlan.planType,
                    style,
                    tone,
                    subject: req.body.subject || '',
                    additionalInstructions: additionalPrompt,
                    requiresCitations: req.body.requiresCitations || false,
                    citationStyle: req.body.citationStyle || 'apa'
                });
                
                contentSource = llmResult.usedSimilarContent ? 'multipart_optimized_files' : 'multipart_new_files';
            } else {
                // Use traditional single-generation for smaller file-based content
                console.log(`Using single generation for file-based content: ${wordCount} words`);
                
                // Check for similar content in database (80%+ matching) using the generated prompt
                const similarContent = await contentDatabase.findSimilarContent(result.prompt, style, tone, wordCount);
                
                if (similarContent && similarContent.length > 0) {
                    // Use existing similar content as base for polishing
                    console.log(`Found ${similarContent.length} similar content matches for file-based prompt`);
                    const bestMatch = similarContent[0]; // Highest similarity score
                    
                    // Get content for polishing and refinement
                    const polishingContent = await contentDatabase.getContentForPolishing(bestMatch.contentId, wordCount);
                    
                    if (polishingContent && polishingContent.sections) {
                        // Use existing content as base, polish to match new requirements
                        llmResult = await llmService.polishExistingContent(
                            polishingContent.sections,
                            result.prompt,
                            style,
                            tone,
                            wordCount
                        );
                        contentSource = 'optimized_existing';
                        
                        // Update access statistics for the reused content
                        await contentDatabase.updateAccessStatistics([bestMatch.contentId]);
                    } else {
                        // Fallback to new generation if polishing fails
                        llmResult = await llmService.generateContent(
                            result.prompt,
                            style,
                            tone,
                            wordCount
                        );
                    }
                } else {
                    // No similar content found, generate new content
                    console.log('No similar content found for file-based prompt, generating new content');
                    llmResult = await llmService.generateContent(
                        result.prompt,
                        style,
                        tone,
                        wordCount
                    );
                }
                
                // Store the new/polished content in database for future optimization
                if (llmResult && llmResult.content) {
                    await contentDatabase.storeContent(userId, result.prompt, llmResult.content, {
                        style,
                        tone,
                        generationTime: llmResult.generationTime,
                        source: contentSource,
                        wordCount: wordCount,
                        basedOnFiles: true,
                        fileCount: files.length
                    });
                }
            }
            
            // Prepare response with multi-part metadata if applicable
            const response = {
                success: true,
                content: llmResult.content,
                extractedContent: result.extractedContent,
                generatedPrompt: result.prompt,
                metadata: {
                    ...result.metadata,
                    llmSource: llmResult.source,
                    generationTime: llmResult.generationTime,
                    fallbackUsed: llmResult.fallbackUsed,
                    contentSource: contentSource,
                    creditsUsed: creditsNeeded,
                    remainingCredits: creditResult.newBalance,
                    basedOnFiles: true,
                    fileCount: files.length
                }
            };
            
            if (useMultiPart) {
                // Add multi-part specific metadata
                response.metadata.isMultiPart = true;
                response.metadata.chunksGenerated = llmResult.chunksGenerated || 0;
                response.metadata.refinementCycles = llmResult.refinementCycles || 0;
                response.metadata.contentId = llmResult.contentId;
                response.metadata.similarContentFound = llmResult.usedSimilarContent || false;
                response.metadata.requiresCitations = llmResult.citationData?.requiresCitations || false;
                response.metadata.citationCount = llmResult.citationData?.citationCount || 0;
                response.metadata.citationStyle = llmResult.citationData?.style || null;
                response.metadata.bibliography = llmResult.citationData?.bibliography || [];
                response.metadata.inTextCitations = llmResult.citationData?.inTextCitations || [];
                // Final detection results
                response.metadata.originalityScore = llmResult.finalDetectionResults?.originalityScore || null;
                response.metadata.aiDetectionScore = llmResult.finalDetectionResults?.aiDetectionScore || null;
                response.metadata.plagiarismScore = llmResult.finalDetectionResults?.plagiarismScore || null;
                response.metadata.qualityScore = llmResult.finalDetectionResults?.qualityScore || null;
                response.metadata.requiresReview = llmResult.finalDetectionResults?.requiresReview || false;
                response.metadata.isAcceptable = llmResult.finalDetectionResults?.isAcceptable || true;
                response.metadata.detectionConfidence = llmResult.finalDetectionResults?.confidence || null;
                response.metadata.detectionRecommendations = llmResult.finalDetectionResults?.recommendations || [];
            } else {
                // Add single-generation metadata
                response.metadata.isMultiPart = false;
                response.metadata.similarContentFound = contentSource === 'optimized_existing';
            }
            
            res.json(response);
            
        } catch (generationError) {
            console.error('Content generation failed, rolling back credits:', generationError);
            
            // Rollback credits on generation failure
            try {
                await atomicCreditSystem.refundCreditsAtomic(
                    userId,
                    creditsNeeded,
                    planValidation.userPlan.planType,
                    'writing_rollback'
                );
            } catch (rollbackError) {
                console.error('Credit rollback failed:', rollbackError);
            }
            
            return res.status(500).json({
                success: false,
                error: 'Content generation failed',
                details: generationError.message
            });
        }
        
    } catch (error) {
        console.error('Error in upload-and-generate endpoint:', error);
        
        // Handle multer errors
        if (error instanceof multer.MulterError) {
            if (error.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({
                    success: false,
                    error: 'File too large',
                    details: 'Maximum file size is 10MB'
                });
            }
            if (error.code === 'LIMIT_FILE_COUNT') {
                return res.status(400).json({
                    success: false,
                    error: 'Too many files',
                    details: 'Maximum 5 files allowed'
                });
            }
        }
        
        res.status(500).json({
            success: false,
            error: 'File processing and content generation failed',
            details: error.message
        });
    }
});

/**
 * GET /api/writer/supported-formats
 * Get list of supported file formats
 */
router.get('/supported-formats', (req, res) => {
    res.json({
        success: true,
        formats: [
            {
                extension: '.pdf',
                description: 'Portable Document Format',
                maxSize: '10MB'
            },
            {
                extension: '.docx',
                description: 'Microsoft Word Document',
                maxSize: '10MB'
            },
            {
                extension: '.txt',
                description: 'Plain Text File',
                maxSize: '10MB'
            }
        ],
        limits: {
            maxFiles: 5,
            maxFileSize: '10MB',
            totalMaxSize: '50MB'
        }
    });
});

/**
 * POST /api/writer/validate-files
 * Validate files before upload
 */
router.post('/validate-files', upload.array('files', 5), (req, res) => {
    try {
        const files = req.files;
        
        if (!files || files.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No files provided for validation'
            });
        }
        
        const validation = fileProcessingService.validateFiles(files);
        
        res.json({
            success: validation.valid,
            valid: validation.valid,
            errors: validation.errors || [],
            fileInfo: files.map(file => ({
                name: file.originalname,
                size: file.size,
                type: path.extname(file.originalname).toLowerCase(),
                sizeFormatted: `${(file.size / 1024 / 1024).toFixed(2)} MB`
            }))
        });
        
    } catch (error) {
        console.error('Error validating files:', error);
        res.status(500).json({
            success: false,
            error: 'File validation failed',
            details: error.message
        });
    }
});

/**
 * Error handling middleware for multer
 */
router.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                error: 'File too large',
                details: 'Maximum file size is 10MB'
            });
        }
        if (error.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({
                success: false,
                error: 'Too many files',
                details: 'Maximum 5 files allowed'
            });
        }
        if (error.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({
                success: false,
                error: 'Unexpected file field',
                details: 'Please use the correct file field name'
            });
        }
    }
    
    if (error.message.includes('Unsupported file type')) {
        return res.status(400).json({
            success: false,
            error: 'Unsupported file type',
            details: error.message
        });
    }
    
    next(error);
});

module.exports = router;