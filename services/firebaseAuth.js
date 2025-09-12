const express = require('express');
const { admin, db, auth, isInitialized } = require('../config/firebase');
const { logger } = require('../utils/logger');
const router = express.Router();

// Middleware to verify Firebase ID token
const verifyFirebaseToken = async (req, res, next) => {
    try {
        // If Firebase is not initialized, return authentication error
        if (!isInitialized) {
            return res.status(503).json({ 
                error: 'Authentication service unavailable',
                message: 'The authentication service is currently not configured. Please contact support.' 
            });
        }

        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const token = authHeader.split('Bearer ')[1];
        const decodedToken = await auth.verifyIdToken(token);
        req.user = decodedToken;
        next();
    } catch (error) {
        logger.error('Token verification error', {
            service: 'AuthRouter',
            method: 'verifyFirebaseToken',
            error: error.message,
            stack: error.stack
        });
        return res.status(401).json({ error: 'Invalid token' });
    }
};

// Register endpoint - Create user in Firebase Auth and Firestore
router.post('/register', async (req, res) => {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // If Firebase is not initialized, return service unavailable error
    if (!isInitialized) {
        return res.status(503).json({
            error: 'Registration service unavailable',
            message: 'The registration service is currently not configured. Please contact support.'
        });
    }

    try {
        // Create user in Firebase Auth
        const userRecord = await auth.createUser({
            email: email,
            password: password,
            displayName: name
        });

        // Create user document in Firestore
        const userDoc = {
            uid: userRecord.uid,
            email: email,
            name: name,
            credits: 200,
            isPremium: false,
            subscriptionEndDate: null,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        await db.collection('users').doc(userRecord.uid).set(userDoc);

        // Generate custom token for immediate login
        const customToken = await auth.createCustomToken(userRecord.uid);

        res.status(201).json({
            message: 'User created successfully',
            token: customToken,
            user: {
                uid: userRecord.uid,
                email: email,
                name: name,
                credits: 200,
                isPremium: false
            }
        });
    } catch (error) {
        logger.error('Registration error', {
            service: 'AuthRouter',
            method: 'register',
            email,
            error: error.message
        });
        
        if (error.code === 'auth/email-already-exists') {
            return res.status(400).json({ error: 'User already exists with this email' });
        }
        
        return res.status(500).json({ error: 'Error creating user' });
    }
});

// Login endpoint - Verify credentials and return custom token
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }

    // If Firebase is not initialized, return mock response
    if (!isInitialized) {
        logger.warn('Firebase not initialized, returning mock login response', {
            service: 'AuthRouter',
            method: 'login'
        });
        return res.status(200).json({
            message: 'Login successful (Demo Mode)',
            token: 'mock-token-for-demo',
            user: {
                uid: 'mock-user-id',
                email: email,
                name: 'Demo User',
                credits: 200,
                isPremium: false
            }
        });
    }

    try {
        // Note: Firebase Admin SDK doesn't support password verification
        // This endpoint is mainly for custom token generation
        // Client should use Firebase Client SDK for authentication
        
        // Get user by email
        const userRecord = await auth.getUserByEmail(email);
        
        // Get user data from Firestore
        const userDoc = await db.collection('users').doc(userRecord.uid).get();
        
        if (!userDoc.exists) {
            return res.status(404).json({ error: 'User data not found' });
        }

        const userData = userDoc.data();
        
        // Generate custom token
        const customToken = await auth.createCustomToken(userRecord.uid);

        res.json({
            message: 'Login successful',
            token: customToken,
            user: {
                uid: userRecord.uid,
                email: userData.email,
                name: userData.name,
                credits: userData.credits,
                isPremium: userData.isPremium
            }
        });
    } catch (error) {
        logger.error('Login error', {
            service: 'AuthRouter',
            method: 'login',
            email,
            error: error.message
        });
        
        if (error.code === 'auth/user-not-found') {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        
        return res.status(500).json({ error: 'Login failed' });
    }
});

// Get user profile
router.get('/profile', verifyFirebaseToken, async (req, res) => {
    try {
        const userDoc = await db.collection('users').doc(req.user.uid).get();
        
        if (!userDoc.exists) {
            return res.status(404).json({ error: 'User not found' });
        }

        const userData = userDoc.data();
        
        res.json({
            uid: req.user.uid,
            email: userData.email,
            name: userData.name,
            credits: userData.credits,
            isPremium: userData.isPremium,
            subscriptionEndDate: userData.subscriptionEndDate
        });
    } catch (error) {
        logger.error('Profile fetch error', {
            service: 'AuthRouter',
            method: 'profile',
            userId: req.user.uid,
            error: error.message
        });
        return res.status(500).json({ error: 'Error fetching profile' });
    }
});

// Update user credits
router.post('/update-credits', verifyFirebaseToken, async (req, res) => {
    const { credits } = req.body;
    
    if (typeof credits !== 'number') {
        return res.status(400).json({ error: 'Credits must be a number' });
    }

    try {
        await db.collection('users').doc(req.user.uid).update({
            credits: credits,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        res.json({ message: 'Credits updated successfully', credits });
    } catch (error) {
        logger.error('Credits update error', {
            service: 'AuthRouter',
            method: 'updateCredits',
            userId: req.user.uid,
            error: error.message
        });
        return res.status(500).json({ error: 'Error updating credits' });
    }
});

// Update premium status
router.post('/update-premium', verifyFirebaseToken, async (req, res) => {
    const { isPremium, subscriptionEndDate } = req.body;

    try {
        const updateData = {
            isPremium: Boolean(isPremium),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        if (subscriptionEndDate) {
            updateData.subscriptionEndDate = new Date(subscriptionEndDate);
        }

        await db.collection('users').doc(req.user.uid).update(updateData);

        res.json({ message: 'Premium status updated successfully' });
    } catch (error) {
        logger.error('Premium update error', {
            service: 'AuthRouter',
            method: 'updatePremium',
            userId: req.user.uid,
            error: error.message
        });
        return res.status(500).json({ error: 'Error updating premium status' });
    }
});

module.exports = { router, verifyFirebaseToken };