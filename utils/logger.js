const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Custom format for console output
const consoleFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.colorize(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
        let metaStr = '';
        if (Object.keys(meta).length > 0) {
            metaStr = ` ${JSON.stringify(meta)}`;
        }
        return `${timestamp} [${level}]: ${message}${metaStr}`;
    })
);

// Custom format for file output
const fileFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
);

// Create the logger
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: fileFormat,
    defaultMeta: { service: 'academic-writer' },
    transports: [
        // Error log file
        new winston.transports.File({
            filename: path.join(logsDir, 'error.log'),
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5,
            tailable: true
        }),
        
        // Combined log file
        new winston.transports.File({
            filename: path.join(logsDir, 'combined.log'),
            maxsize: 5242880, // 5MB
            maxFiles: 10,
            tailable: true
        }),
        
        // Access log file for HTTP requests
        new winston.transports.File({
            filename: path.join(logsDir, 'access.log'),
            level: 'http',
            maxsize: 5242880, // 5MB
            maxFiles: 7,
            tailable: true
        })
    ],
    
    // Handle uncaught exceptions
    exceptionHandlers: [
        new winston.transports.File({
            filename: path.join(logsDir, 'exceptions.log'),
            maxsize: 5242880,
            maxFiles: 3
        })
    ],
    
    // Handle unhandled promise rejections
    rejectionHandlers: [
        new winston.transports.File({
            filename: path.join(logsDir, 'rejections.log'),
            maxsize: 5242880,
            maxFiles: 3
        })
    ]
});

// Add console transport for development
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: consoleFormat,
        level: 'debug'
    }));
}

// Custom logging methods for specific use cases
class Logger {
    constructor() {
        this.winston = logger;
    }
    
    // Standard logging methods
    error(message, meta = {}) {
        logger.error(message, meta);
    }
    
    warn(message, meta = {}) {
        logger.warn(message, meta);
    }
    
    info(message, meta = {}) {
        logger.info(message, meta);
    }
    
    debug(message, meta = {}) {
        logger.debug(message, meta);
    }
    
    // HTTP request logging
    http(message, meta = {}) {
        logger.http(message, meta);
    }
    
    // API-specific logging methods
    apiRequest(req, res, responseTime) {
        const logData = {
            method: req.method,
            url: req.originalUrl,
            ip: req.ip || req.connection.remoteAddress,
            userAgent: req.get('User-Agent'),
            statusCode: res.statusCode,
            responseTime: `${responseTime}ms`,
            userId: req.user?.uid || 'anonymous'
        };
        
        if (res.statusCode >= 400) {
            this.error('API Request Failed', logData);
        } else {
            this.http('API Request', logData);
        }
    }
    
    // Authentication logging
    authSuccess(userId, method, ip) {
        this.info('Authentication Success', {
            userId,
            method,
            ip,
            timestamp: new Date().toISOString()
        });
    }
    
    authFailure(email, method, ip, reason) {
        this.warn('Authentication Failed', {
            email,
            method,
            ip,
            reason,
            timestamp: new Date().toISOString()
        });
    }
    
    // Payment logging
    paymentAttempt(userId, amount, currency, paymentId) {
        this.info('Payment Attempt', {
            userId,
            amount,
            currency,
            paymentId,
            timestamp: new Date().toISOString()
        });
    }
    
    paymentSuccess(userId, amount, currency, paymentId) {
        this.info('Payment Success', {
            userId,
            amount,
            currency,
            paymentId,
            timestamp: new Date().toISOString()
        });
    }
    
    paymentFailure(userId, amount, currency, paymentId, error) {
        this.error('Payment Failed', {
            userId,
            amount,
            currency,
            paymentId,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
    
    // Database operation logging
    dbOperation(operation, collection, userId, success, error = null) {
        const logData = {
            operation,
            collection,
            userId,
            success,
            timestamp: new Date().toISOString()
        };
        
        if (error) {
            logData.error = error.message;
            this.error('Database Operation Failed', logData);
        } else {
            this.debug('Database Operation', logData);
        }
    }
    
    // AI service logging
    aiRequest(service, userId, prompt, tokens, success, error = null) {
        const logData = {
            service,
            userId,
            promptLength: prompt?.length || 0,
            tokens,
            success,
            timestamp: new Date().toISOString()
        };
        
        if (error) {
            logData.error = error.message;
            this.error('AI Service Request Failed', logData);
        } else {
            this.info('AI Service Request', logData);
        }
    }
    
    // Security logging
    securityEvent(event, userId, ip, details) {
        this.warn('Security Event', {
            event,
            userId,
            ip,
            details,
            timestamp: new Date().toISOString()
        });
    }
    
    // Performance logging
    performance(operation, duration, userId = null) {
        const logData = {
            operation,
            duration: `${duration}ms`,
            timestamp: new Date().toISOString()
        };
        
        if (userId) {
            logData.userId = userId;
        }
        
        if (duration > 5000) {
            this.warn('Slow Operation', logData);
        } else {
            this.debug('Performance', logData);
        }
    }
    
    // System health logging
    systemHealth(metrics) {
        this.info('System Health', {
            ...metrics,
            timestamp: new Date().toISOString()
        });
    }
    
    // Log cleanup utility
    async cleanupLogs(daysToKeep = 30) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
        
        try {
            const files = await fs.promises.readdir(logsDir);
            
            for (const file of files) {
                const filePath = path.join(logsDir, file);
                const stats = await fs.promises.stat(filePath);
                
                if (stats.mtime < cutoffDate) {
                    await fs.promises.unlink(filePath);
                    this.info('Log file cleaned up', { file });
                }
            }
        } catch (error) {
            this.error('Log cleanup failed', { error: error.message });
        }
    }
}

// Create and export logger instance
const loggerInstance = new Logger();

// Express middleware for request logging
const requestLogger = (req, res, next) => {
    const start = Date.now();
    
    res.on('finish', () => {
        const responseTime = Date.now() - start;
        loggerInstance.apiRequest(req, res, responseTime);
    });
    
    next();
};

// Error handling middleware
const errorLogger = (err, req, res, next) => {
    loggerInstance.error('Unhandled Error', {
        error: err.message,
        stack: err.stack,
        url: req.originalUrl,
        method: req.method,
        ip: req.ip,
        userId: req.user?.uid || 'anonymous'
    });
    
    next(err);
};

module.exports = {
    logger: loggerInstance,
    requestLogger,
    errorLogger,
    winston: logger
};