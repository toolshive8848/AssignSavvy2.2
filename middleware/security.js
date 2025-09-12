const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const { rateLimitErrorHandler } = require('./errorHandler');
const { logger } = require('../utils/logger');

/**
 * CORS configuration with proper origin validation
 */
const corsOptions = {
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, Postman, etc.)
        if (!origin) return callback(null, true);
        
        const allowedOrigins = [
            'http://localhost:3000',
            'http://localhost:3001',
            'http://localhost:5000',
            'http://127.0.0.1:3000',
            'http://127.0.0.1:3001',
            'http://127.0.0.1:5000'
        ];
        
        // Add production origins from environment variables
        if (process.env.FRONTEND_URL) {
            allowedOrigins.push(process.env.FRONTEND_URL);
        }
        
        if (process.env.ALLOWED_ORIGINS) {
            const envOrigins = process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim());
            allowedOrigins.push(...envOrigins);
        }
        
        // In development, allow localhost with any port
        if (process.env.NODE_ENV === 'development') {
            if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
                return callback(null, true);
            }
        }
        
        if (allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            logger.warn('CORS blocked origin', {
                service: 'SecurityMiddleware',
                method: 'corsOptions',
                origin: origin,
                allowedOrigins: allowedOrigins
            });
            callback(new Error('Not allowed by CORS policy'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
        'Origin',
        'X-Requested-With',
        'Content-Type',
        'Accept',
        'Authorization',
        'Cache-Control',
        'X-API-Key'
    ],
    exposedHeaders: ['X-Total-Count', 'X-Page-Count'],
    maxAge: 86400 // 24 hours
};

/**
 * Rate limiting configurations
 */
const rateLimiters = {
    // General API rate limit
    general: rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 100, // Limit each IP to 100 requests per windowMs
        message: {
            error: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests from this IP, please try again later.',
            retryAfter: '15 minutes'
        },
        standardHeaders: true,
        legacyHeaders: false,
        handler: (req, res) => {
            const error = rateLimitErrorHandler('General API');
            res.status(error.statusCode).json({
                error: error.code,
                message: error.message,
                retryAfter: '15 minutes'
            });
        }
    }),
    
    // Strict rate limit for authentication endpoints
    auth: rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 5, // Limit each IP to 5 login attempts per windowMs
        message: {
            error: 'AUTH_RATE_LIMIT_EXCEEDED',
            message: 'Too many authentication attempts, please try again later.',
            retryAfter: '15 minutes'
        },
        skipSuccessfulRequests: true,
        handler: (req, res) => {
            const error = rateLimitErrorHandler('Authentication');
            res.status(error.statusCode).json({
                error: error.code,
                message: error.message,
                retryAfter: '15 minutes'
            });
        }
    }),
    
    // Rate limit for file uploads
    upload: rateLimit({
        windowMs: 60 * 60 * 1000, // 1 hour
        max: 20, // Limit each IP to 20 uploads per hour
        message: {
            error: 'UPLOAD_RATE_LIMIT_EXCEEDED',
            message: 'Too many file uploads, please try again later.',
            retryAfter: '1 hour'
        },
        handler: (req, res) => {
            const error = rateLimitErrorHandler('File upload');
            res.status(error.statusCode).json({
                error: error.code,
                message: error.message,
                retryAfter: '1 hour'
            });
        }
    }),
    
    // Rate limit for content generation
    generation: rateLimit({
        windowMs: 60 * 60 * 1000, // 1 hour
        max: 10, // Limit each IP to 10 generations per hour
        message: {
            error: 'GENERATION_RATE_LIMIT_EXCEEDED',
            message: 'Too many content generation requests, please try again later.',
            retryAfter: '1 hour'
        },
        handler: (req, res) => {
            const error = rateLimitErrorHandler('Content generation');
            res.status(error.statusCode).json({
                error: error.code,
                message: error.message,
                retryAfter: '1 hour'
            });
        }
    }),
    
    // Rate limit for password reset
    passwordReset: rateLimit({
        windowMs: 60 * 60 * 1000, // 1 hour
        max: 3, // Limit each IP to 3 password reset attempts per hour
        message: {
            error: 'PASSWORD_RESET_RATE_LIMIT_EXCEEDED',
            message: 'Too many password reset attempts, please try again later.',
            retryAfter: '1 hour'
        },
        handler: (req, res) => {
            const error = rateLimitErrorHandler('Password reset');
            res.status(error.statusCode).json({
                error: error.code,
                message: error.message,
                retryAfter: '1 hour'
            });
        }
    })
};

/**
 * Security headers configuration using Helmet
 */
const securityHeaders = helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            fontSrc: ["'self'", 'https://fonts.gstatic.com'],
            imgSrc: ["'self'", 'data:', 'https:'],
            scriptSrc: ["'self'"],
            connectSrc: ["'self'", 'https://api.openai.com', 'https://api.anthropic.com', 'https://generativelanguage.googleapis.com'],
            reportUri: process.env.CSP_REPORT_URI || null,
            frameSrc: ["'none'"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
        }
    },
    crossOriginEmbedderPolicy: false, // Disable for API compatibility
    hsts: {
        maxAge: 31536000, // 1 year
        includeSubDomains: true,
        preload: true
    }
});

/**
 * File upload security middleware
 */
const fileUploadSecurity = (req, res, next) => {
    if (!req.files || req.files.length === 0) {
        return next();
    }
    
    const allowedMimeTypes = [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain',
        'text/csv'
    ];
    
    const maxFileSize = 10 * 1024 * 1024; // 10MB
    const maxFiles = 5;
    
    // Check file count
    if (req.files.length > maxFiles) {
        return res.status(400).json({
            error: 'TOO_MANY_FILES',
            message: `Maximum ${maxFiles} files allowed`
        });
    }
    
    // Validate each file
    for (const file of req.files) {
        // Check file size
        if (file.size > maxFileSize) {
            return res.status(413).json({
                error: 'FILE_TOO_LARGE',
                message: `File ${file.originalname} exceeds maximum size of 10MB`
            });
        }
        
        // Check MIME type
        if (!allowedMimeTypes.includes(file.mimetype)) {
            return res.status(400).json({
                error: 'INVALID_FILE_TYPE',
                message: `File type ${file.mimetype} is not allowed`
            });
        }
        
        // Check file extension
        const allowedExtensions = ['.pdf', '.doc', '.docx', '.txt', '.csv'];
        const fileExtension = file.originalname.toLowerCase().substring(file.originalname.lastIndexOf('.'));
        
        if (!allowedExtensions.includes(fileExtension)) {
            return res.status(400).json({
                error: 'INVALID_FILE_EXTENSION',
                message: `File extension ${fileExtension} is not allowed`
            });
        }
        
        // Basic filename validation
        if (!/^[a-zA-Z0-9._-]+$/.test(file.originalname.replace(/\.[^.]+$/, ''))) {
            return res.status(400).json({
                error: 'INVALID_FILENAME',
                message: 'Filename contains invalid characters'
            });
        }
    }
    
    next();
};

/**
 * API key validation middleware
 */
const validateApiKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey) {
        return res.status(401).json({
            error: 'API_KEY_MISSING',
            message: 'API key is required'
        });
    }
    
    // Validate API key format (basic validation)
    if (!/^[a-zA-Z0-9_-]{32,}$/.test(apiKey)) {
        return res.status(401).json({
            error: 'INVALID_API_KEY_FORMAT',
            message: 'Invalid API key format'
        });
    }
    
    // Add API key validation logic here
    // This should check against your API key storage/database
    
    next();
};

/**
 * Request size limiter
 */
const requestSizeLimiter = (req, res, next) => {
    const contentLength = parseInt(req.headers['content-length'] || '0');
    const maxSize = 50 * 1024 * 1024; // 50MB
    
    if (contentLength > maxSize) {
        return res.status(413).json({
            error: 'REQUEST_TOO_LARGE',
            message: 'Request body too large'
        });
    }
    
    next();
};

/**
 * IP whitelist middleware (for admin endpoints)
 */
const ipWhitelist = (allowedIPs = []) => {
    return (req, res, next) => {
        const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
        
        // In development, allow all IPs
        if (process.env.NODE_ENV === 'development') {
            return next();
        }
        
        if (allowedIPs.length === 0 || allowedIPs.includes(clientIP)) {
            return next();
        }
        
        console.warn(`Access denied for IP: ${clientIP}`);
        return res.status(403).json({
            error: 'ACCESS_DENIED',
            message: 'Access denied from this IP address'
        });
    };
};

module.exports = {
    corsOptions,
    rateLimiters,
    securityHeaders,
    fileUploadSecurity,
    validateApiKey,
    requestSizeLimiter,
    ipWhitelist
};