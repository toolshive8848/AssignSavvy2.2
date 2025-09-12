const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const compression = require('compression');
const swaggerUi = require('swagger-ui-express');
const { specs } = require('./scripts/generate-docs');
const { logger, requestLogger, errorLogger } = require('./utils/logger');
const morgan = require('morgan');

// Import new middleware
const { corsOptions, rateLimiters, securityHeaders, requestSizeLimiter } = require('./middleware/security');
const { globalErrorHandler, notFoundHandler, asyncErrorHandler } = require('./middleware/errorHandler');
const { sanitizeInput } = require('./middleware/validation');
const { unifiedAuth } = require('./middleware/unifiedAuth');

// Firebase configuration
require('./config/firebase'); // Initialize Firebase
const path = require('path');
const fs = require('fs');
const { CreditScheduler } = require('./services/creditScheduler');

// Load environment variables
require('dotenv').config();

// Validate required environment variables
function validateEnvironmentVariables() {
    const requiredVars = {
        'GEMINI_API_KEY': 'Gemini API key is required for content generation',
        'FIREBASE_PROJECT_ID': 'Firebase project ID is required for database operations'
    };
    
    const optionalVars = {
        'ORIGINALITY_AI_API_KEY': 'Originality.ai API key (optional - affects plagiarism detection)',
        'ZOTERO_API_KEY': 'Zotero API key (optional - affects citation features)',
        'STRIPE_SECRET_KEY': 'Stripe secret key (optional - affects payment processing)'
    };
    
    const missingRequired = [];
    const missingOptional = [];
    
    // Check required variables
    for (const [varName, description] of Object.entries(requiredVars)) {
        const value = process.env[varName];
        if (!value || value.trim() === '' || value.includes('your-') || value.includes('placeholder')) {
            missingRequired.push({ varName, description });
        }
    }
    
    // Check optional variables
    for (const [varName, description] of Object.entries(optionalVars)) {
        const value = process.env[varName];
        if (!value || value.trim() === '' || value.includes('your-') || value.includes('placeholder')) {
            missingOptional.push({ varName, description });
        }
    }
    
    // Log validation results
    if (missingRequired.length > 0) {
        console.error('\n❌ CRITICAL: Missing required environment variables:');
        missingRequired.forEach(({ varName, description }) => {
            console.error(`   - ${varName}: ${description}`);
        });
        console.error('\n📝 Please update your .env file with the required values.');
        console.error('💡 Copy from .env.example and replace placeholder values.\n');
        process.exit(1);
    }
    
    if (missingOptional.length > 0) {
        console.warn('\n⚠️  WARNING: Missing optional environment variables:');
        missingOptional.forEach(({ varName, description }) => {
            console.warn(`   - ${varName}: ${description}`);
        });
        console.warn('\n💡 Some features may be limited without these configurations.\n');
    }
    
    console.log('✅ Environment validation passed\n');
}

// Validate environment before starting server
validateEnvironmentVariables();

const app = express();
const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// CORS origins from environment or defaults
const corsOrigins = process.env.CORS_ORIGIN 
    ? process.env.CORS_ORIGIN.split(',')
    : ['http://localhost:5173', 'http://localhost:3000'];

// File size limit from environment or default
const fileSizeLimit = process.env.MAX_FILE_SIZE || '50mb';

// Security middleware (order matters)
app.use(securityHeaders); // Helmet security headers
app.use(cors(corsOptions)); // CORS with proper origin validation
app.use(compression());
app.use(requestSizeLimiter); // Request size limiting
app.use(rateLimiters.general); // General rate limiting
app.use(express.json({ limit: fileSizeLimit }));
app.use(express.urlencoded({ extended: true, limit: fileSizeLimit }));
app.use(sanitizeInput); // Input sanitization
app.use(requestLogger);
app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev'));

// API Documentation
app.use('/docs', swaggerUi.serve, swaggerUi.setup(specs, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Academic Writer API Documentation'
}));

// Serve static files
const uploadDir = process.env.UPLOAD_DIR || '../uploads';
app.use('/uploads', express.static(path.join(__dirname, uploadDir)));

// Serve HTML files and assets
app.use(express.static(__dirname));
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/styles', express.static(path.join(__dirname, 'styles')));
app.use('/js', express.static(path.join(__dirname, 'js')));

// Firebase is initialized in config/firebase.js
console.log('Using Firebase as the database');

// Routes with specific rate limiting
app.use('/api/auth', rateLimiters.auth, require('./services/firebaseAuth').router);
app.use('/api/auth', rateLimiters.auth, require('./routes/googleAuth')); // Google OAuth
app.use('/api/users', require('./services/firebaseUsers'));
app.use('/api/assignments', require('./services/firebaseAssignments'));
app.use('/api/payments', require('./services/firebasePayments'));
app.use('/api/research', require('./research'));
app.use('/api/detector', require('./routes/detector'));
app.use('/api/prompt', rateLimiters.generation, require('./routes/promptEngineer'));
app.use('/api/writer', rateLimiters.generation, require('./routes/writer'));
app.use('/api/history', require('./routes/history'));
app.use('/api/zotero', require('./routes/zotero'));
app.use('/api/citations', require('./routes/citations'));
app.use('/api/credit-test', require('./routes/creditTest'));

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Error handling middleware (must be last)
app.use(errorLogger);
app.use(notFoundHandler); // 404 handler for unmatched routes
app.use(globalErrorHandler); // Global error handler

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    // Firebase connections are managed automatically
    process.exit(0);
});

app.listen(PORT, () => {
    logger.info('Server started successfully', {
        port: PORT,
        environment: NODE_ENV,
        nodeVersion: process.version,
        timestamp: new Date().toISOString()
    });
    
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📱 Environment: ${NODE_ENV}`);
    console.log(`🔗 Server URL: http://localhost:${PORT}`);
    console.log(`📚 API Documentation: http://localhost:${PORT}/docs`);
    console.log(`🛠️  Development Dashboard: npm run dev:dashboard`);
    console.log(`📊 Generate API Docs: npm run docs:generate`);
    console.log(`CORS Origins: ${corsOrigins.join(', ')}`);
    console.log('Database: Firebase Firestore');
    
    // Initialize credit scheduler for automated monthly refresh
    const creditScheduler = new CreditScheduler();
    creditScheduler.start();
    console.log('✓ Monthly credit refresh scheduler started');
    
    // Log API key status (without exposing actual keys)
    console.log('API Keys Status:');
    console.log(`- Gemini: ${process.env.GEMINI_API_KEY ? '✓ Configured' : '✗ Missing'}`);
    console.log(`- Originality.ai: ${process.env.ORIGINALITY_AI_API_KEY ? '✓ Configured' : '✗ Missing'}`);
    console.log(`- Zotero: ${process.env.ZOTERO_API_KEY ? '✓ Configured' : '○ Optional'}`);
});