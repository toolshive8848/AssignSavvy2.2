const admin = require('firebase-admin');

/**
 * Firebase-only authentication middleware for Google Cloud deployment
 * Validates Firebase ID tokens exclusively
 */
const unifiedAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ 
                error: 'Authorization header missing or invalid format',
                code: 'AUTH_HEADER_MISSING'
            });
        }

        const token = authHeader.substring(7); // Remove 'Bearer ' prefix
        
        if (!token) {
            return res.status(401).json({ 
                error: 'Token missing',
                code: 'TOKEN_MISSING'
            });
        }

        try {
            const decodedToken = await admin.auth().verifyIdToken(token);
            
            // Set user info in request object
            req.user = {
                uid: decodedToken.uid,
                email: decodedToken.email,
                emailVerified: decodedToken.email_verified,
                displayName: decodedToken.name,
                photoURL: decodedToken.picture,
                // For backward compatibility with existing routes
                userId: decodedToken.uid
            };
            
            return next();
            
        } catch (firebaseError) {
            return res.status(401).json({ 
                error: 'Invalid or expired Firebase token',
                code: 'FIREBASE_TOKEN_INVALID'
            });
        }
        
    } catch (error) {
        console.error('Firebase auth middleware error:', error);
        return res.status(500).json({ 
            error: 'Authentication service error',
            code: 'AUTH_SERVICE_ERROR'
        });
    }
};

/**
 * Firebase-only authentication middleware for routes that specifically require Firebase
 */
const firebaseAuth = async (req, res, next) => {
    try {
        // Check if Firebase is initialized
        if (!isInitialized || !admin) {
            return res.status(503).json({ 
                error: 'Authentication service unavailable',
                message: 'Firebase authentication is currently not configured. Please contact support.'
            });
        }
        
        const authHeader = req.headers.authorization;
        
        if (!authHeader) {
            return res.status(401).json({ 
                error: 'Authorization header missing',
                message: 'Please provide a valid Firebase authentication token'
            });
        }
        
        const token = authHeader.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({ 
                error: 'Token missing',
                message: 'Please provide a valid Firebase authentication token'
            });
        }
        
        const decodedToken = await admin.auth().verifyIdToken(token);
        
        req.user = {
            uid: decodedToken.uid,
            id: decodedToken.uid,
            email: decodedToken.email,
            emailVerified: decodedToken.email_verified,
            name: decodedToken.name,
            picture: decodedToken.picture,
            firebase: decodedToken,
            authType: 'firebase'
        };
        
        next();
        
    } catch (error) {
        console.error('Firebase authentication error:', error);
        
        if (error.code === 'auth/id-token-expired') {
            return res.status(401).json({ 
                error: 'Token expired',
                message: 'Your session has expired. Please log in again.'
            });
        }
        
        if (error.code === 'auth/id-token-revoked') {
            return res.status(401).json({ 
                error: 'Token revoked',
                message: 'Your session has been revoked. Please log in again.'
            });
        }
        
        if (error.code === 'auth/invalid-id-token') {
            return res.status(401).json({ 
                error: 'Invalid token',
                message: 'The provided authentication token is invalid.'
            });
        }
        
        return res.status(401).json({ 
            error: 'Authentication failed',
            message: 'Unable to verify Firebase authentication token'
        });
    }
};

/**
 * Admin-only authentication middleware
 */
const adminAuth = async (req, res, next) => {
    try {
        // First authenticate the user
        await unifiedAuth(req, res, () => {});
        
        // Check if user has admin privileges
        if (!req.user.admin && !req.user.firebase?.admin) {
            return res.status(403).json({ 
                error: 'Access denied',
                message: 'Administrator privileges required'
            });
        }
        
        next();
        
    } catch (error) {
        console.error('Admin authentication error:', error);
        return res.status(500).json({ 
            error: 'Authentication service error',
            message: 'An error occurred while verifying admin privileges'
        });
    }
};

module.exports = {
    unifiedAuth,
    firebaseAuth,
    adminAuth,
    // Legacy exports for backward compatibility
    authenticateToken: unifiedAuth,
    verifyFirebaseToken: firebaseAuth,
    verifyToken: unifiedAuth
};