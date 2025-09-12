/**
 * Comprehensive error handling middleware for the application
 * This centralizes error handling and provides consistent error responses
 */

/**
 * Global error handler middleware
 * Should be placed after all routes in the Express app
 */
const globalErrorHandler = (err, req, res, next) => {
    console.error('Global error handler:', {
        error: err.message,
        stack: err.stack,
        url: req.url,
        method: req.method,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        timestamp: new Date().toISOString()
    });

    // Default error response
    let statusCode = err.statusCode || err.status || 500;
    let message = err.message || 'Internal server error';
    let errorCode = err.code || 'INTERNAL_ERROR';

    // Handle specific error types
    if (err.name === 'ValidationError') {
        statusCode = 400;
        message = 'Validation failed';
        errorCode = 'VALIDATION_ERROR';
    } else if (err.name === 'CastError') {
        statusCode = 400;
        message = 'Invalid data format';
        errorCode = 'CAST_ERROR';
    } else if (err.name === 'MongoError' || err.name === 'MongoServerError') {
        statusCode = 500;
        message = 'Database operation failed';
        errorCode = 'DATABASE_ERROR';
    } else if (err.code === 'ENOENT') {
        statusCode = 404;
        message = 'File not found';
        errorCode = 'FILE_NOT_FOUND';
    } else if (err.code === 'EACCES') {
        statusCode = 403;
        message = 'Permission denied';
        errorCode = 'PERMISSION_DENIED';
    } else if (err.code === 'EMFILE' || err.code === 'ENFILE') {
        statusCode = 503;
        message = 'Too many open files';
        errorCode = 'RESOURCE_EXHAUSTED';
    }

    // Handle Firebase errors
    if (err.code && err.code.startsWith('auth/')) {
        statusCode = 401;
        errorCode = 'AUTH_ERROR';
        
        switch (err.code) {
            case 'auth/id-token-expired':
                message = 'Authentication token has expired';
                break;
            case 'auth/id-token-revoked':
                message = 'Authentication token has been revoked';
                break;
            case 'auth/invalid-id-token':
                message = 'Invalid authentication token';
                break;
            case 'auth/user-not-found':
                statusCode = 404;
                message = 'User not found';
                break;
            default:
                message = 'Authentication failed';
        }
    }

    // Handle Multer errors (file upload)
    if (err.code === 'LIMIT_FILE_SIZE') {
        statusCode = 413;
        message = 'File size too large';
        errorCode = 'FILE_TOO_LARGE';
    } else if (err.code === 'LIMIT_FILE_COUNT') {
        statusCode = 400;
        message = 'Too many files uploaded';
        errorCode = 'TOO_MANY_FILES';
    } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        statusCode = 400;
        message = 'Unexpected file field';
        errorCode = 'UNEXPECTED_FILE';
    }

    // Handle JWT errors
    if (err.name === 'JsonWebTokenError') {
        statusCode = 401;
        message = 'Invalid token';
        errorCode = 'INVALID_TOKEN';
    } else if (err.name === 'TokenExpiredError') {
        statusCode = 401;
        message = 'Token expired';
        errorCode = 'TOKEN_EXPIRED';
    }

    // Don't expose internal errors in production
    if (process.env.NODE_ENV === 'production' && statusCode === 500) {
        message = 'Something went wrong';
    }

    const errorResponse = {
        error: errorCode,
        message: message,
        timestamp: new Date().toISOString(),
        path: req.path
    };

    // Include stack trace in development
    if (process.env.NODE_ENV === 'development') {
        errorResponse.stack = err.stack;
        errorResponse.details = err.details || null;
    }

    res.status(statusCode).json(errorResponse);
};

/**
 * Async error wrapper to catch errors in async route handlers
 * Usage: router.get('/route', asyncErrorHandler(async (req, res) => { ... }))
 */
const asyncErrorHandler = (fn) => {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};

/**
 * 404 handler for unmatched routes
 */
const notFoundHandler = (req, res, next) => {
    const error = new Error(`Route not found: ${req.method} ${req.path}`);
    error.statusCode = 404;
    error.code = 'ROUTE_NOT_FOUND';
    next(error);
};

/**
 * Request validation error handler
 */
const validationErrorHandler = (errors) => {
    const error = new Error('Validation failed');
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    error.details = errors;
    return error;
};

/**
 * Database error handler
 */
const databaseErrorHandler = (err, operation = 'Database operation') => {
    console.error(`${operation} failed:`, err);
    
    const error = new Error(`${operation} failed`);
    error.statusCode = 500;
    error.code = 'DATABASE_ERROR';
    error.originalError = err.message;
    
    return error;
};

/**
 * File operation error handler
 */
const fileErrorHandler = (err, operation = 'File operation') => {
    console.error(`${operation} failed:`, err);
    
    let statusCode = 500;
    let message = `${operation} failed`;
    let code = 'FILE_ERROR';
    
    if (err.code === 'ENOENT') {
        statusCode = 404;
        message = 'File not found';
        code = 'FILE_NOT_FOUND';
    } else if (err.code === 'EACCES') {
        statusCode = 403;
        message = 'Permission denied';
        code = 'PERMISSION_DENIED';
    } else if (err.code === 'ENOSPC') {
        statusCode = 507;
        message = 'Insufficient storage space';
        code = 'INSUFFICIENT_STORAGE';
    }
    
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    error.originalError = err.message;
    
    return error;
};

/**
 * API rate limit error handler
 */
const rateLimitErrorHandler = (service = 'API') => {
    const error = new Error(`${service} rate limit exceeded`);
    error.statusCode = 429;
    error.code = 'RATE_LIMIT_EXCEEDED';
    return error;
};

/**
 * Credit/payment error handler
 */
const creditErrorHandler = (message = 'Insufficient credits') => {
    const error = new Error(message);
    error.statusCode = 402;
    error.code = 'INSUFFICIENT_CREDITS';
    return error;
};

module.exports = {
    globalErrorHandler,
    asyncErrorHandler,
    notFoundHandler,
    validationErrorHandler,
    databaseErrorHandler,
    fileErrorHandler,
    rateLimitErrorHandler,
    creditErrorHandler
};