# Google Secret Manager Implementation Guide

## Step-by-Step Implementation for Your Project

### Step 1: Enable Secret Manager API

```bash
# Enable the Secret Manager API
gcloud services enable secretmanager.googleapis.com

# Verify it's enabled
gcloud services list --enabled --filter="name:secretmanager.googleapis.com"
```

### Step 2: Install Required Dependencies

```bash
# Install Google Secret Manager client
npm install @google-cloud/secret-manager

# Install other useful packages
npm install dotenv
```

### Step 3: Store Your Firebase Admin Key

```bash
# Method 1: From existing file
gcloud secrets create firebase-admin-key --data-file=config/firebase-admin-key.json

# Method 2: From environment variable (if you have the JSON as string)
echo $FIREBASE_ADMIN_KEY | gcloud secrets create firebase-admin-key --data-file=-

# Method 3: Interactive input
gcloud secrets create firebase-admin-key
# Then paste your JSON content when prompted
```

### Step 4: Store Other Sensitive Data

```bash
# Store OpenAI API key
echo "your-openai-api-key" | gcloud secrets create openai-api-key --data-file=-

# Store Stripe keys
echo "your-stripe-secret-key" | gcloud secrets create stripe-secret-key --data-file=-
echo "your-stripe-publishable-key" | gcloud secrets create stripe-publishable-key --data-file=-

# Store session secret
echo "your-session-secret" | gcloud secrets create session-secret --data-file=-

# Store database connection string (if using external DB)
echo "your-database-url" | gcloud secrets create database-url --data-file=-
```

### Step 5: Create Secret Manager Service

Create `services/secretManager.js`:

```javascript
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

class SecretManager {
  constructor() {
    this.client = new SecretManagerServiceClient();
    this.projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
    this.cache = new Map(); // Simple in-memory cache
  }

  async getSecret(secretName, useCache = true) {
    // Check cache first
    if (useCache && this.cache.has(secretName)) {
      return this.cache.get(secretName);
    }

    try {
      const name = `projects/${this.projectId}/secrets/${secretName}/versions/latest`;
      const [version] = await this.client.accessSecretVersion({ name });
      const secretValue = version.payload.data.toString();
      
      // Cache the secret
      if (useCache) {
        this.cache.set(secretName, secretValue);
      }
      
      return secretValue;
    } catch (error) {
      console.error(`Error accessing secret ${secretName}:`, error.message);
      throw new Error(`Failed to retrieve secret: ${secretName}`);
    }
  }

  async getSecretAsJSON(secretName, useCache = true) {
    const secretValue = await this.getSecret(secretName, useCache);
    try {
      return JSON.parse(secretValue);
    } catch (error) {
      throw new Error(`Secret ${secretName} is not valid JSON`);
    }
  }

  // Clear cache (useful for testing or forced refresh)
  clearCache() {
    this.cache.clear();
  }

  // Get multiple secrets at once
  async getSecrets(secretNames) {
    const promises = secretNames.map(name => 
      this.getSecret(name).then(value => ({ name, value }))
    );
    
    const results = await Promise.allSettled(promises);
    const secrets = {};
    
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        secrets[result.value.name] = result.value.value;
      } else {
        console.error(`Failed to get secret ${secretNames[index]}:`, result.reason);
      }
    });
    
    return secrets;
  }
}

module.exports = new SecretManager();
```

### Step 6: Update Firebase Configuration

Update `config/firebase.js`:

```javascript
const admin = require('firebase-admin');
const secretManager = require('../services/secretManager');

let firebaseApp;
let isInitialized = false;

async function initializeFirebase() {
  if (isInitialized) {
    return firebaseApp;
  }

  try {
    console.log('Initializing Firebase with Secret Manager...');
    
    // Get Firebase admin credentials from Secret Manager
    const serviceAccount = await secretManager.getSecretAsJSON('firebase-admin-key');
    
    // Initialize Firebase Admin SDK
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id,
      // Add other config as needed
      storageBucket: `${serviceAccount.project_id}.appspot.com`
    });
    
    isInitialized = true;
    console.log('✅ Firebase initialized successfully with Secret Manager');
    
    return firebaseApp;
  } catch (error) {
    console.error('❌ Failed to initialize Firebase:', error.message);
    throw error;
  }
}

// Get Firestore instance
function getFirestore() {
  if (!isInitialized) {
    throw new Error('Firebase not initialized. Call initializeFirebase() first.');
  }
  return admin.firestore();
}

// Get Firebase Auth instance
function getAuth() {
  if (!isInitialized) {
    throw new Error('Firebase not initialized. Call initializeFirebase() first.');
  }
  return admin.auth();
}

// Get Firebase Storage instance
function getStorage() {
  if (!isInitialized) {
    throw new Error('Firebase not initialized. Call initializeFirebase() first.');
  }
  return admin.storage();
}

module.exports = {
  initializeFirebase,
  getFirestore,
  getAuth,
  getStorage,
  admin
};
```

### Step 7: Update Environment Configuration

Create `config/environment.js`:

```javascript
const secretManager = require('../services/secretManager');

class Environment {
  constructor() {
    this.secrets = {};
    this.isLoaded = false;
  }

  async loadSecrets() {
    if (this.isLoaded) {
      return this.secrets;
    }

    try {
      console.log('Loading secrets from Secret Manager...');
      
      // Define all secrets you need
      const secretNames = [
        'openai-api-key',
        'stripe-secret-key',
        'stripe-publishable-key',
        'session-secret'
      ];
      
      // Load all secrets
      this.secrets = await secretManager.getSecrets(secretNames);
      
      // Add any environment-specific overrides
      this.secrets.nodeEnv = process.env.NODE_ENV || 'production';
      this.secrets.port = process.env.PORT || 8080;
      this.secrets.projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
      
      this.isLoaded = true;
      console.log('✅ Secrets loaded successfully');
      
      return this.secrets;
    } catch (error) {
      console.error('❌ Failed to load secrets:', error.message);
      throw error;
    }
  }

  get(key) {
    if (!this.isLoaded) {
      throw new Error('Secrets not loaded. Call loadSecrets() first.');
    }
    return this.secrets[key];
  }

  getAll() {
    if (!this.isLoaded) {
      throw new Error('Secrets not loaded. Call loadSecrets() first.');
    }
    return { ...this.secrets };
  }
}

module.exports = new Environment();
```

### Step 8: Update Your Server Startup

Update `server.js`:

```javascript
const express = require('express');
const { initializeFirebase } = require('./config/firebase');
const environment = require('./config/environment');

async function startServer() {
  try {
    console.log('🚀 Starting server...');
    
    // Load all secrets first
    await environment.loadSecrets();
    
    // Initialize Firebase with secrets
    await initializeFirebase();
    
    // Create Express app
    const app = express();
    
    // Middleware
    app.use(express.json());
    app.use(express.static('public'));
    
    // Session configuration with secret from Secret Manager
    const session = require('express-session');
    app.use(session({
      secret: environment.get('session-secret'),
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: environment.get('nodeEnv') === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
      }
    }));
    
    // Routes
    app.use('/api/auth', require('./routes/googleAuth'));
    app.use('/api/payments', require('./routes/payments'));
    app.use('/api/detector', require('./routes/detector'));
    // ... other routes
    
    // Error handling
    app.use((error, req, res, next) => {
      console.error('Server error:', error);
      res.status(500).json({ error: 'Internal server error' });
    });
    
    // Start server
    const PORT = environment.get('port');
    app.listen(PORT, () => {
      console.log(`✅ Server running on port ${PORT}`);
      console.log(`🌍 Environment: ${environment.get('nodeEnv')}`);
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully');
  process.exit(0);
});

startServer();
```

### Step 9: Update Service Files

Update any service that needs API keys, for example `services/llmService.js`:

```javascript
const environment = require('../config/environment');
const { OpenAI } = require('openai');

class LLMService {
  constructor() {
    this.openai = null;
  }

  async initialize() {
    if (!this.openai) {
      const apiKey = environment.get('openai-api-key');
      this.openai = new OpenAI({ apiKey });
    }
  }

  async generateText(prompt, options = {}) {
    await this.initialize();
    
    try {
      const response = await this.openai.chat.completions.create({
        model: options.model || 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: options.maxTokens || 1000,
        temperature: options.temperature || 0.7
      });
      
      return response.choices[0].message.content;
    } catch (error) {
      console.error('OpenAI API error:', error);
      throw error;
    }
  }
}

module.exports = new LLMService();
```

### Step 10: Set IAM Permissions

```bash
# Get your App Engine service account
PROJECT_ID=$(gcloud config get-value project)
SERVICE_ACCOUNT="${PROJECT_ID}@appspot.gserviceaccount.com"

# Grant access to all secrets
gcloud secrets add-iam-policy-binding firebase-admin-key \
    --member="serviceAccount:${SERVICE_ACCOUNT}" \
    --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding openai-api-key \
    --member="serviceAccount:${SERVICE_ACCOUNT}" \
    --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding stripe-secret-key \
    --member="serviceAccount:${SERVICE_ACCOUNT}" \
    --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding session-secret \
    --member="serviceAccount:${SERVICE_ACCOUNT}" \
    --role="roles/secretmanager.secretAccessor"

# Or grant access to all secrets at once
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${SERVICE_ACCOUNT}" \
    --role="roles/secretmanager.secretAccessor"
```

### Step 11: Update app.yaml

```yaml
runtime: nodejs18

env_variables:
  GOOGLE_CLOUD_PROJECT: your-project-id
  NODE_ENV: production

automatic_scaling:
  min_instances: 1
  max_instances: 10
  target_cpu_utilization: 0.6

handlers:
- url: /.*
  script: auto
  secure: always
```

### Step 12: Clean Up Local Files

```bash
# Remove the local Firebase admin key file
rm config/firebase-admin-key.json

# Make sure it's in .gitignore
echo "config/firebase-admin-key.json" >> .gitignore
echo ".env" >> .gitignore
echo "*.log" >> .gitignore
```

### Step 13: Test Locally (Optional)

For local development, you can still use the file-based approach:

```javascript
// In your config/firebase.js, add environment detection
async function initializeFirebase() {
  if (isInitialized) {
    return firebaseApp;
  }

  try {
    let serviceAccount;
    
    if (process.env.NODE_ENV === 'production') {
      // Use Secret Manager in production
      serviceAccount = await secretManager.getSecretAsJSON('firebase-admin-key');
    } else {
      // Use local file in development
      serviceAccount = require('./firebase-admin-key.json');
    }
    
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id
    });
    
    isInitialized = true;
    return firebaseApp;
  } catch (error) {
    console.error('Failed to initialize Firebase:', error);
    throw error;
  }
}
```

### Step 14: Deploy and Test

```bash
# Deploy to App Engine
gcloud app deploy

# Check logs to ensure secrets are loading correctly
gcloud app logs tail -s default

# Test your endpoints
curl https://your-project.appspot.com/api/health
```

## Benefits You'll Get:

✅ **No sensitive files in your repository**  
✅ **Centralized secret management**  
✅ **Automatic encryption and access control**  
✅ **Easy secret rotation without redeployment**  
✅ **Audit trail of all secret access**  
✅ **Works across all Google Cloud services**  

## Troubleshooting:

### Common Issues:

1. **Permission denied**: Make sure IAM roles are set correctly
2. **Secret not found**: Verify secret names and project ID
3. **JSON parsing error**: Ensure secrets are stored as valid JSON
4. **Timeout errors**: Increase timeout in Secret Manager client

### Debug Commands:

```bash
# List all secrets
gcloud secrets list

# View secret metadata
gcloud secrets describe firebase-admin-key

# Test secret access
gcloud secrets versions access latest --secret="firebase-admin-key"

# Check IAM permissions
gcloud secrets get-iam-policy firebase-admin-key
```

This implementation provides enterprise-grade security for your Firebase application while maintaining ease of use and deployment flexibility.