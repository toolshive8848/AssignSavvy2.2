const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Load environment variables
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// CORS origins from environment or defaults
const corsOrigins = process.env.CORS_ORIGIN 
    ? process.env.CORS_ORIGIN.split(',')
    : ['http://localhost:5173', 'http://localhost:3000'];

// File size limit from environment or default
const fileSizeLimit = process.env.MAX_FILE_SIZE || '50mb';

// Middleware
app.use(helmet({
    contentSecurityPolicy: process.env.HELMET_CSP !== 'false',
    crossOriginEmbedderPolicy: process.env.HELMET_COEP !== 'false'
}));
app.use(cors({
    origin: corsOrigins,
    credentials: true
}));
app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: fileSizeLimit }));
app.use(express.urlencoded({ extended: true, limit: fileSizeLimit }));

// Serve static files
const uploadDir = process.env.UPLOAD_DIR || '../uploads';
app.use('/uploads', express.static(path.join(__dirname, uploadDir)));

// Database connection
const dbPath = process.env.DATABASE_URL 
    ? process.env.DATABASE_URL.replace('sqlite:', '')
    : path.join(__dirname, '../assignment_writer.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to SQLite database');
        
        // Initialize database schema
        const schemaPath = path.join(__dirname, '../schema.sql');
        if (fs.existsSync(schemaPath)) {
            const initSql = fs.readFileSync(schemaPath, 'utf8');
            db.exec(initSql, (err) => {
                if (err) {
                    console.error('Error initializing database:', err.message);
                } else {
                    console.log('Database schema initialized');
                }
            });
        }
    }
});

// Make database available to routes
app.locals.db = db;

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/assignments', require('./routes/assignments'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/users', require('./routes/users'));
app.use('/api/research', require('./research'));
app.use('/api/detector', require('./routes/detector'));
app.use('/api/prompt', require('./routes/promptEngineer'));
app.use('/api/writer', require('./routes/writer'));

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ 
        error: 'Something went wrong!',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
    });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Received SIGINT. Graceful shutdown...');
    db.close((err) => {
        if (err) {
            console.error(err.message);
        }
        console.log('Database connection closed.');
        process.exit(0);
    });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${NODE_ENV}`);
    console.log(`CORS Origins: ${corsOrigins.join(', ')}`);
    console.log(`Database: ${dbPath}`);
    
    // Log API key status (without exposing actual keys)
    console.log('API Keys Status:');
    console.log(`- OpenAI: ${process.env.OPENAI_API_KEY ? '✓ Configured' : '✗ Missing'}`);
    console.log(`- Gemini: ${process.env.GEMINI_API_KEY ? '✓ Configured' : '✗ Missing'}`);
    console.log(`- Originality.ai: ${process.env.ORIGINALITY_AI_API_KEY ? '✓ Configured' : '✗ Missing'}`);
    console.log(`- Zotero: ${process.env.ZOTERO_API_KEY ? '✓ Configured' : '○ Optional'}`);
});