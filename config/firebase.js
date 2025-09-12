const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin SDK
let firebaseInitialized = false;

if (!admin.apps.length) {
    try {
        // Check if Firebase credentials are properly configured
        const hasValidCredentials = process.env.FIREBASE_PROJECT_ID && 
            process.env.FIREBASE_CLIENT_EMAIL && 
            process.env.FIREBASE_PRIVATE_KEY &&
            !process.env.FIREBASE_PROJECT_ID.includes('your-') &&
            !process.env.FIREBASE_CLIENT_EMAIL.includes('your-');
            
        if (!hasValidCredentials) {
            console.log('⚠️  Firebase credentials not configured. Using mock mode.');
            console.log('   Please update your .env file with real Firebase credentials.');
            firebaseInitialized = false;
        } else {
            // For production, use service account key file
            const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
            
            if (serviceAccountPath && require('fs').existsSync(serviceAccountPath)) {
                const serviceAccount = require(serviceAccountPath);
                admin.initializeApp({
                    credential: admin.credential.cert(serviceAccount),
                    databaseURL: process.env.FIREBASE_DATABASE_URL
                });
            } else {
                // For development, use environment variables
                admin.initializeApp({
                    credential: admin.credential.cert({
                        projectId: process.env.FIREBASE_PROJECT_ID,
                        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
                    }),
                    databaseURL: process.env.FIREBASE_DATABASE_URL
                });
            }
            
            console.log('✅ Firebase Admin SDK initialized successfully');
            firebaseInitialized = true;
        }
    } catch (error) {
        console.error('❌ Error initializing Firebase Admin SDK:', error.message);
        firebaseInitialized = false;
        // Don't throw error in development to allow testing
        if (process.env.NODE_ENV === 'production') {
            throw error;
        }
    }
}

// Export Firebase services
module.exports = {
    admin: firebaseInitialized ? admin : null,
    db: firebaseInitialized ? admin.firestore() : null,
    auth: firebaseInitialized ? admin.auth() : null,
    storage: firebaseInitialized ? admin.storage() : null,
    isInitialized: firebaseInitialized
};