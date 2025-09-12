# Assignment Writer Platform - Deployment Guide

## Overview
This is a full-stack academic assignment writing platform with AI-powered tools for writing, research, plagiarism detection, and prompt engineering.

## Prerequisites
- Node.js 18+ and npm
- SQLite3
- API keys for AI services (see Environment Setup)

## Quick Start

### 1. Clone and Install Dependencies
```bash
# Install backend dependencies
npm install

# Install frontend dependencies (if using separate frontend)
cd frontend && npm install
```

### 2. Environment Setup
Copy the example environment file and configure your API keys:
```bash
cp .env.example .env
```

Edit `.env` with your actual API keys:
- **Required**: `GEMINI_API_KEY` (get from https://aistudio.google.com/app/apikey)
- **Required**: `ORIGINALITY_AI_API_KEY` (get from https://originality.ai/api)
- **Required**: `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` (get from https://dashboard.stripe.com/apikeys)
- **Required**: `STRIPE_WEBHOOK_SECRET` (get from Stripe webhook configuration)
- **Optional**: `ZOTERO_API_KEY` (get from https://www.zotero.org/settings/keys)

### 3. Database Setup
The SQLite database will be automatically initialized on first run using `schema.sql`.

### 4. Start the Application
```bash
# Development mode
npm run dev

# Production mode
npm start
```

The server will start on `http://localhost:5000` (or your configured PORT).

## Features

### Available Tools (All Unlocked)
- **AI Writer**: Generate academic content with multiple AI models
  - **Standard Generation**: Fast content generation with standard quality (available for all users)
  - **Premium Generation**: Enhanced quality with 2-loop refinement system (Pro/Custom plans only, 2x credits)
- **Researcher**: AI-powered research and citation generation
- **Detector**: Plagiarism and AI content detection
- **Prompt Engineer**: Optimize prompts for better AI responses

### User System
- Credit-based usage system
- User authentication and profiles
- Dashboard with usage analytics
- Stripe payment integration for credit purchases and subscriptions

## API Endpoints

### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `GET /api/auth/profile` - Get user profile

### Tools
- `POST /api/writer/generate` - Generate content (supports `qualityTier`: 'standard' or 'premium')
- `POST /api/writer/upload-and-generate` - Generate content from uploaded files (supports `qualityTier`)
- `POST /api/research/search` - Research topics
- `POST /api/detector/check` - Check for plagiarism/AI content
- `POST /api/prompt/optimize` - Optimize prompts

### User Management
- `GET /api/users/credits` - Get user credits
- `POST /api/users/credits/deduct` - Deduct credits

### Payment Processing
- `POST /api/payments/create-payment-intent` - Create payment for credit purchase
- `POST /api/payments/create-subscription` - Create subscription for pro plan
- `POST /api/payments/webhook` - Handle Stripe webhook events
- `GET /api/payments/config` - Get Stripe publishable key
- `GET /api/payments/history/:userId` - Get user payment history

## Configuration

### Environment Variables
See `.env.example` for all available configuration options:

- **Server**: PORT, NODE_ENV, CORS_ORIGIN
- **Database**: DATABASE_URL
- **Security**: JWT_SECRET, JWT_EXPIRES_IN
- **API Keys**: GEMINI_API_KEY, ORIGINALITY_AI_API_KEY, etc.
- **File Uploads**: MAX_FILE_SIZE, UPLOAD_DIR
- **Credits**: DEFAULT_FREE_CREDITS, DEFAULT_PRO_CREDITS
- **Rate Limiting**: RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS

### Credit System
- **Free Users**: 200 credits (configurable)
- **Pro Users**: 2000 credits (configurable)
- **Custom Plans**: Configurable credit rates

### Tool Credit Costs
- **Writing (Standard)**: 1 credit per 3 words (available for all users)
- **Writing (Premium)**: 2 credits per 3 words (Pro/Custom plans only, includes 2-loop refinement system)
- **Research**: 1 credit per 5 words
- **Detection**: 1 credit per 5 words
- **Prompt Engineering**: 0.5 credits per word

## Production Deployment

### 1. Environment Setup
```bash
# Set production environment
export NODE_ENV=production

# Configure production database
export DATABASE_URL=sqlite:/path/to/production/database.db

# Set secure JWT secret
export JWT_SECRET=your-super-secure-random-string

# Configure CORS for your domain
export CORS_ORIGIN=https://yourdomain.com
```

### 2. Security Considerations
- Use strong JWT secrets
- Configure CORS for your specific domain
- Enable helmet security headers
- Set up HTTPS in production
- Regularly rotate API keys

### 3. Database Backup
```bash
# Backup SQLite database
cp assignment_writer.db assignment_writer_backup_$(date +%Y%m%d).db
```

### 4. Process Management
Use PM2 or similar for production process management:
```bash
npm install -g pm2
pm2 start src/server.js --name "assignment-writer"
pm2 startup
pm2 save
```

## Monitoring

The application logs:
- Server startup information
- API key configuration status
- Database connection status
- Request logs (Morgan)
- Error logs

## Troubleshooting

### Common Issues
1. **Missing API Keys**: Check console logs for API key status
2. **Database Errors**: Ensure SQLite3 is installed and database path is writable
3. **CORS Issues**: Configure CORS_ORIGIN environment variable
4. **File Upload Issues**: Check MAX_FILE_SIZE and UPLOAD_DIR settings

### Health Check
Visit `/api/health` to verify the server is running properly.

## Support
For issues or questions, check the application logs and ensure all required environment variables are properly configured.