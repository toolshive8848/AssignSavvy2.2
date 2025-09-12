# Google Cloud Platform Deployment Guide

## Prerequisites
1. Google Cloud Platform account
2. Firebase project setup
3. Google Cloud CLI installed
4. Node.js application ready for deployment

## Step 1: Set up Firebase Project

### Create Firebase Project
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Add project" or "Create a project"
3. Enter your project name
4. Enable Google Analytics (optional)
5. Click "Create project"

### Get Firebase Configuration

#### For Web App (Client-side):
1. In Firebase Console, click "Add app" → Web icon
2. Register your app with a nickname
3. Copy the Firebase config object:
```javascript
const firebaseConfig = {
  apiKey: "your-api-key",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "your-app-id"
};
```
4. Update `config/firebase-web.js` with this configuration

#### For Server-side (Admin SDK):
1. Go to Project Settings → Service Accounts
2. Click "Generate new private key"
3. Download the JSON file
4. Rename it to `firebase-admin-key.json`
5. Place it in your `config/` directory
6. **IMPORTANT**: Add this file to `.gitignore` for security

### Enable Firebase Services
1. **Authentication**: Go to Authentication → Sign-in method
   - Enable Email/Password
   - Enable Google Sign-in
   - Add your domain to authorized domains

2. **Firestore Database**: Go to Firestore Database
   - Click "Create database"
   - Choose production mode
   - Select a location

3. **Storage**: Go to Storage
   - Click "Get started"
   - Set up security rules

## Step 2: Prepare for Google Cloud Deployment

### Install Google Cloud CLI
```bash
# Download and install from: https://cloud.google.com/sdk/docs/install
# After installation, authenticate:
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
```

### Create app.yaml for App Engine
Create `app.yaml` in your project root:
```yaml
runtime: nodejs18

env_variables:
  NODE_ENV: production
  PORT: 8080

automatic_scaling:
  min_instances: 1
  max_instances: 10
  target_cpu_utilization: 0.6

handlers:
- url: /.*
  script: auto
  secure: always
```

### Update package.json
Ensure your `package.json` has:
```json
{
  "scripts": {
    "start": "node server.js",
    "gcp-build": "npm install --production"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

## Step 3: Environment Variables Setup

### Create .env file for local development:
```env
# Firebase
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY_ID=your-private-key-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
FIREBASE_CLIENT_ID=your-client-id
FIREBASE_AUTH_URI=https://accounts.google.com/o/oauth2/auth
FIREBASE_TOKEN_URI=https://oauth2.googleapis.com/token

# App Configuration
NODE_ENV=production
PORT=8080
SESSION_SECRET=your-session-secret

# External APIs
OPENAI_API_KEY=your-openai-key
STRIPE_SECRET_KEY=your-stripe-secret
STRIPE_PUBLISHABLE_KEY=your-stripe-publishable
```

### Set environment variables in Google Cloud:
```bash
# Set environment variables for App Engine
gcloud app deploy --set-env-vars="NODE_ENV=production,FIREBASE_PROJECT_ID=your-project-id,SESSION_SECRET=your-session-secret"
```

## Step 4: Deploy to Google Cloud

### Option 1: App Engine (Recommended for beginners)
```bash
# Deploy to App Engine
gcloud app deploy

# View your app
gcloud app browse
```

### Option 2: Cloud Run (More flexible)
```bash
# Build and deploy to Cloud Run
gcloud run deploy your-app-name \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated
```

### Option 3: Compute Engine (Full control)
1. Create VM instance
2. Install Node.js and dependencies
3. Set up reverse proxy (nginx)
4. Configure SSL certificates

## Step 5: Domain and SSL Setup

### Custom Domain (App Engine)
```bash
# Map custom domain
gcloud app domain-mappings create your-domain.com
```

### SSL Certificate
- App Engine: Automatic SSL for custom domains
- Cloud Run: Automatic SSL
- Compute Engine: Use Let's Encrypt or Google-managed certificates

## Step 6: Database and Storage

### Firestore Security Rules
Update Firestore rules in Firebase Console:
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users can only access their own data
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Public read access for certain collections
    match /public/{document=**} {
      allow read: if true;
      allow write: if request.auth != null;
    }
  }
}
```

### Storage Security Rules
```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /users/{userId}/{allPaths=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## Step 7: Monitoring and Logging

### Enable Cloud Logging
```javascript
// In your server.js
const { Logging } = require('@google-cloud/logging');
const logging = new Logging();

// Create a Winston logger that streams to Cloud Logging
const winston = require('winston');
const { LoggingWinston } = require('@google-cloud/logging-winston');

const loggingWinston = new LoggingWinston();

const logger = winston.createLogger({
  level: 'info',
  transports: [
    new winston.transports.Console(),
    loggingWinston,
  ],
});
```

### Set up Error Reporting
```bash
npm install @google-cloud/error-reporting
```

## Step 8: CI/CD with GitHub Actions

Update `.github/workflows/ci-cd.yml`:
```yaml
name: Deploy to Google Cloud

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Google Cloud CLI
      uses: google-github-actions/setup-gcloud@v1
      with:
        service_account_key: ${{ secrets.GCP_SA_KEY }}
        project_id: ${{ secrets.GCP_PROJECT_ID }}
    
    - name: Deploy to App Engine
      run: gcloud app deploy --quiet
```

## Security Checklist

- [ ] Firebase Admin SDK key is secure and not in version control
- [ ] Environment variables are properly set
- [ ] Firestore security rules are configured
- [ ] HTTPS is enforced
- [ ] CORS is properly configured
- [ ] Rate limiting is implemented
- [ ] Input validation is in place
- [ ] Authentication is required for sensitive operations

## Cost Optimization

1. **App Engine**: Use automatic scaling with min_instances: 0
2. **Cloud Run**: Pay per request, scales to zero
3. **Firestore**: Optimize queries and use indexes
4. **Storage**: Set lifecycle policies for old files
5. **Monitoring**: Set up billing alerts

## Troubleshooting

### Common Issues:
1. **Build failures**: Check Node.js version compatibility
2. **Environment variables**: Ensure all required vars are set
3. **Firebase permissions**: Check service account roles
4. **CORS errors**: Configure proper origins
5. **Memory issues**: Increase instance memory in app.yaml

### Useful Commands:
```bash
# View logs
gcloud app logs tail -s default

# Check app status
gcloud app versions list

# SSH into instance (Compute Engine)
gcloud compute ssh instance-name

# Update environment variables
gcloud app deploy --set-env-vars="KEY=value"
```

## Next Steps

1. Set up monitoring and alerting
2. Implement backup strategies
3. Configure CDN for static assets
4. Set up staging environment
5. Implement blue-green deployments

For more detailed information, refer to:
- [Google Cloud Documentation](https://cloud.google.com/docs)
- [Firebase Documentation](https://firebase.google.com/docs)
- [App Engine Node.js Guide](https://cloud.google.com/appengine/docs/standard/nodejs)