const { body, param, query, validationResult } = require('express-validator');
const { validationErrorHandler } = require('./errorHandler');
const { logger } = require('../utils/logger');
const DOMPurify = require('isomorphic-dompurify');

/**
 * Middleware to handle validation results
 */
const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    
    if (!errors.isEmpty()) {
        const formattedErrors = errors.array().map(error => ({
            field: error.path || error.param,
            message: error.msg,
            value: error.value,
            location: error.location
        }));
        
        logger.warn('Validation errors detected', {
            service: 'ValidationMiddleware',
            method: 'handleValidationErrors',
            errors: formattedErrors,
            userId: req.user?.uid || 'anonymous',
            ip: req.ip,
            userAgent: req.get('User-Agent')
        });
        
        const validationError = validationErrorHandler(formattedErrors);
        return next(validationError);
    }
    
    next();
};

/**
 * Common validation rules
 */
const validationRules = {
    // User validation
    email: body('email')
        .isEmail()
        .normalizeEmail()
        .withMessage('Please provide a valid email address'),
    
    password: body('password')
        .isLength({ min: 8 })
        .withMessage('Password must be at least 8 characters long')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
        .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),
    
    name: body('name')
        .trim()
        .isLength({ min: 2, max: 50 })
        .withMessage('Name must be between 2 and 50 characters')
        .matches(/^[a-zA-Z\s]+$/)
        .withMessage('Name can only contain letters and spaces'),
    
    // Assignment validation
    assignmentTitle: body('title')
        .trim()
        .isLength({ min: 5, max: 200 })
        .withMessage('Assignment title must be between 5 and 200 characters'),
    
    assignmentDescription: body('description')
        .trim()
        .isLength({ min: 10, max: 2000 })
        .withMessage('Assignment description must be between 10 and 2000 characters'),
    
    assignmentType: body('type')
        .isIn(['essay', 'research', 'report', 'analysis', 'creative', 'technical'])
        .withMessage('Invalid assignment type'),
    
    wordCount: body('wordCount')
        .isInt({ min: 100, max: 10000 })
        .withMessage('Word count must be between 100 and 10000'),
    
    academicLevel: body('academicLevel')
        .isIn(['high_school', 'undergraduate', 'graduate', 'phd'])
        .withMessage('Invalid academic level'),
    
    citationStyle: body('citationStyle')
        .isIn(['APA', 'MLA', 'Chicago', 'Harvard', 'IEEE'])
        .withMessage('Invalid citation style'),
    
    // File validation
    fileType: body('fileType')
        .optional()
        .isIn(['pdf', 'doc', 'docx', 'txt'])
        .withMessage('Invalid file type'),
    
    // Pagination validation
    page: query('page')
        .optional()
        .isInt({ min: 1 })
        .withMessage('Page must be a positive integer'),
    
    limit: query('limit')
        .optional()
        .isInt({ min: 1, max: 100 })
        .withMessage('Limit must be between 1 and 100'),
    
    // ID validation
    mongoId: param('id')
        .isMongoId()
        .withMessage('Invalid ID format'),
    
    uuid: param('id')
        .isUUID()
        .withMessage('Invalid UUID format'),
    
    // Search validation
    searchQuery: query('q')
        .trim()
        .isLength({ min: 1, max: 100 })
        .withMessage('Search query must be between 1 and 100 characters'),
    
    // Credit validation
    creditAmount: body('amount')
        .isInt({ min: 1, max: 1000 })
        .withMessage('Credit amount must be between 1 and 1000'),
    
    // URL validation
    url: body('url')
        .isURL()
        .withMessage('Please provide a valid URL'),
    
    // Date validation
    date: body('date')
        .isISO8601()
        .withMessage('Please provide a valid date in ISO format'),
    
    // Boolean validation
    boolean: (field) => body(field)
        .isBoolean()
        .withMessage(`${field} must be a boolean value`),
    
    // Custom text validation
    text: (field, min = 1, max = 1000) => body(field)
        .trim()
        .isLength({ min, max })
        .withMessage(`${field} must be between ${min} and ${max} characters`),
    
    // Array validation
    array: (field, minItems = 1, maxItems = 10) => body(field)
        .isArray({ min: minItems, max: maxItems })
        .withMessage(`${field} must be an array with ${minItems} to ${maxItems} items`),
    
    // Numeric validation
    number: (field, min = 0, max = Number.MAX_SAFE_INTEGER) => body(field)
        .isNumeric()
        .isFloat({ min, max })
        .withMessage(`${field} must be a number between ${min} and ${max}`)
};

/**
 * Predefined validation chains for common operations
 */
const validationChains = {
    // User operations
    createUser: [
        validationRules.email,
        validationRules.password,
        validationRules.name,
        handleValidationErrors
    ],
    
    updateUser: [
        validationRules.name.optional(),
        validationRules.email.optional(),
        handleValidationErrors
    ],
    
    // Assignment operations
    createAssignment: [
        validationRules.assignmentTitle,
        validationRules.assignmentDescription,
        validationRules.assignmentType,
        validationRules.wordCount,
        validationRules.academicLevel,
        validationRules.citationStyle,
        handleValidationErrors
    ],
    
    updateAssignment: [
        validationRules.assignmentTitle.optional(),
        validationRules.assignmentDescription.optional(),
        validationRules.assignmentType.optional(),
        validationRules.wordCount.optional(),
        validationRules.academicLevel.optional(),
        validationRules.citationStyle.optional(),
        handleValidationErrors
    ],
    
    // File upload validation
    fileUpload: [
        body('files')
            .custom((value, { req }) => {
                if (!req.files || req.files.length === 0) {
                    throw new Error('At least one file is required');
                }
                
                if (req.files.length > 5) {
                    throw new Error('Maximum 5 files allowed');
                }
                
                const allowedTypes = ['application/pdf', 'application/msword', 
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 
                    'text/plain'];
                
                for (const file of req.files) {
                    if (!allowedTypes.includes(file.mimetype)) {
                        throw new Error(`File type ${file.mimetype} is not allowed`);
                    }
                    
                    if (file.size > 10 * 1024 * 1024) { // 10MB
                        throw new Error(`File ${file.originalname} is too large (max 10MB)`);
                    }
                }
                
                return true;
            }),
        handleValidationErrors
    ],
    
    // Search validation
    search: [
        validationRules.searchQuery,
        validationRules.page,
        validationRules.limit,
        handleValidationErrors
    ],
    
    // Pagination validation
    pagination: [
        validationRules.page,
        validationRules.limit,
        handleValidationErrors
    ],
    
    // ID validation
    validateId: [
        validationRules.mongoId,
        handleValidationErrors
    ],
    
    // Research operations
    researchQuery: [
        body('query')
            .trim()
            .isLength({ min: 1, max: 500 })
            .withMessage('Research query must be between 1 and 500 characters'),
        body('researchType')
            .optional()
            .isIn(['general', 'academic', 'technical', 'market'])
            .withMessage('Research type must be one of: general, academic, technical, market'),
        body('depth')
            .optional()
            .isInt({ min: 1, max: 5 })
            .withMessage('Research depth must be between 1 and 5'),
        body('sources')
            .optional()
            .isArray({ max: 10 })
            .withMessage('Sources must be an array with maximum 10 items'),
        body('saveToHistory')
            .optional()
            .isBoolean()
            .withMessage('saveToHistory must be a boolean'),
        handleValidationErrors
    ],

    // Detector operations
    detectorAnalysis: [
        body('content')
            .trim()
            .isLength({ min: 1, max: 50000 })
            .withMessage('Content must be between 1 and 50000 characters'),
        body('options')
            .optional()
            .isObject()
            .withMessage('Options must be an object'),
        body('options.plagiarismCheck')
            .optional()
            .isBoolean()
            .withMessage('plagiarismCheck must be a boolean'),
        body('options.aiDetection')
            .optional()
            .isBoolean()
            .withMessage('aiDetection must be a boolean'),
        body('options.readabilityAnalysis')
            .optional()
            .isBoolean()
            .withMessage('readabilityAnalysis must be a boolean'),
        handleValidationErrors
    ],

    // Credit operations
    creditTransaction: [
        validationRules.creditAmount,
        body('description')
            .trim()
            .isLength({ min: 5, max: 200 })
            .withMessage('Description must be between 5 and 200 characters'),
        handleValidationErrors
    ],
    
    // Login validation
    login: [
        validationRules.email,
        body('password')
            .notEmpty()
            .withMessage('Password is required'),
        handleValidationErrors
    ],
    
    // Password reset
    passwordReset: [
        validationRules.email,
        handleValidationErrors
    ],
    
    // Change password
    changePassword: [
        body('currentPassword')
            .notEmpty()
            .withMessage('Current password is required'),
        validationRules.password,
        body('confirmPassword')
            .custom((value, { req }) => {
                if (value !== req.body.password) {
                    throw new Error('Password confirmation does not match');
                }
                return true;
            }),
        handleValidationErrors
    ],
    
    // Writer operations
    writerInput: [
        body('prompt')
            .trim()
            .isLength({ min: 1, max: 10000 })
            .withMessage('Prompt must be between 1 and 10000 characters'),
        body('style')
            .optional()
            .isIn(['Academic', 'Creative', 'Business', 'Technical', 'Casual'])
            .withMessage('Style must be one of: Academic, Creative, Business, Technical, Casual'),
        body('tone')
            .optional()
            .isIn(['Formal', 'Informal', 'Persuasive', 'Informative', 'Conversational'])
            .withMessage('Tone must be one of: Formal, Informal, Persuasive, Informative, Conversational'),
        body('wordCount')
            .optional()
            .isInt({ min: 100, max: 2000 })
            .withMessage('Word count must be between 100 and 2000'),
        body('qualityTier')
            .optional()
            .isIn(['standard', 'premium'])
            .withMessage('Quality tier must be either standard or premium'),
        body('contentType')
            .optional()
            .isIn(['general', 'assignment'])
            .withMessage('Content type must be either general or assignment'),
        body('assignmentTitle')
            .optional()
            .trim()
            .isLength({ min: 1, max: 200 })
            .withMessage('Assignment title must be between 1 and 200 characters'),
        body('citationStyle')
            .optional()
            .isIn(['APA', 'MLA', 'Chicago', 'Harvard', 'IEEE'])
            .withMessage('Citation style must be one of: APA, MLA, Chicago, Harvard, IEEE'),
        handleValidationErrors
    ]
};

/**
 * Input sanitization middleware
 * Sanitizes all string inputs to prevent XSS attacks
 */
const sanitizeInput = (req, res, next) => {
    const sanitizeObject = (obj) => {
        if (typeof obj === 'string') {
            // Use DOMPurify for comprehensive XSS protection
            let sanitized = DOMPurify.sanitize(obj, {
                ALLOWED_TAGS: [],
                ALLOWED_ATTR: [],
                KEEP_CONTENT: true
            });
            
            // Additional security measures
            sanitized = sanitized
                .replace(/javascript:/gi, '')
                .replace(/data:/gi, '')
                .replace(/vbscript:/gi, '')
                .replace(/on\w+\s*=/gi, '')
                .replace(/\\u[0-9a-fA-F]{4}/g, '') // Remove unicode escapes
                .replace(/\\x[0-9a-fA-F]{2}/g, '') // Remove hex escapes
                .trim();
                
            return sanitized;
        } else if (Array.isArray(obj)) {
            return obj.map(sanitizeObject);
        } else if (obj && typeof obj === 'object') {
            const sanitized = {};
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    // Sanitize object keys as well
                    const sanitizedKey = typeof key === 'string' ? 
                        key.replace(/[^a-zA-Z0-9_-]/g, '') : key;
                    sanitized[sanitizedKey] = sanitizeObject(obj[key]);
                }
            }
            return sanitized;
        }
        return obj;
    };

    try {
        // Sanitize request body
        if (req.body) {
            req.body = sanitizeObject(req.body);
        }

        // Sanitize query parameters
        if (req.query) {
            req.query = sanitizeObject(req.query);
        }

        // Sanitize URL parameters
        if (req.params) {
            req.params = sanitizeObject(req.params);
        }
        
        // Log suspicious input attempts
        const originalBody = JSON.stringify(req.body || {});
        if (originalBody.includes('<script') || originalBody.includes('javascript:') || 
            originalBody.includes('data:') || originalBody.includes('vbscript:')) {
            logger.warn('Suspicious input detected and sanitized', {
                service: 'ValidationMiddleware',
                method: 'sanitizeInput',
                userId: req.user?.uid || 'anonymous',
                ip: req.ip,
                userAgent: req.get('User-Agent'),
                path: req.path
            });
        }
    } catch (error) {
        logger.error('Input sanitization error', {
            service: 'ValidationMiddleware',
            method: 'sanitizeInput',
            error: error.message,
            userId: req.user?.uid || 'anonymous'
        });
    }

    next();
};

module.exports = {
    validationRules,
    validationChains,
    handleValidationErrors,
    sanitizeInput,
    validateResearchInput: validationChains.researchQuery,
    validateDetectorInput: validationChains.detectorAnalysis,
    validateWriterInput: validationChains.writerInput
};