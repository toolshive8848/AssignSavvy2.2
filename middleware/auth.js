// Import the unified authentication middleware
const { unifiedAuth, firebaseAuth, adminAuth } = require('./unifiedAuth');

// Use unified authentication as the default
const authenticateToken = unifiedAuth;

// Legacy function names for backward compatibility
const verifyFirebaseToken = firebaseAuth;
const verifyToken = unifiedAuth;

/**
 * Middleware to check if user has admin privileges
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const requireAdmin = async (req, res, next) => {
    try {
        if (!req.user) {
            return res.status(401).json({ 
                error: 'Authentication required',
                message: 'Please authenticate first'
            });
        }
        
        // Check if user has admin custom claims
        const userRecord = await admin.auth().getUser(req.user.uid);
        
        if (!userRecord.customClaims || !userRecord.customClaims.admin) {
            return res.status(403).json({ 
                error: 'Admin access required',
                message: 'You do not have permission to access this resource'
            });
        }
        
        req.user.isAdmin = true;
        next();
        
    } catch (error) {
        console.error('Admin check error:', error);
        return res.status(500).json({ 
            error: 'Authorization check failed',
            message: 'Unable to verify admin privileges'
        });
    }
};

/**
 * Middleware to check if user has premium subscription
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const requirePremium = async (req, res, next) => {
    try {
        if (!req.user) {
            return res.status(401).json({ 
                error: 'Authentication required',
                message: 'Please authenticate first'
            });
        }
        
        // Check if user has premium custom claims
        const userRecord = await admin.auth().getUser(req.user.uid);
        
        if (!userRecord.customClaims || !userRecord.customClaims.premium) {
            return res.status(403).json({ 
                error: 'Premium subscription required',
                message: 'This feature requires a premium subscription'
            });
        }
        
        req.user.isPremium = true;
        next();
        
    } catch (error) {
        console.error('Premium check error:', error);
        return res.status(500).json({ 
            error: 'Subscription check failed',
            message: 'Unable to verify premium subscription'
        });
    }
};

/**
 * Optional authentication middleware - doesn't fail if no token provided
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const optionalAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader) {
            return next(); // Continue without authentication
        }
        
        const token = authHeader.split(' ')[1];
        
        if (!token) {
            return next(); // Continue without authentication
        }
        
        // Try to verify the token
        const decodedToken = await admin.auth().verifyIdToken(token);
        
        req.user = {
            uid: decodedToken.uid,
            email: decodedToken.email,
            emailVerified: decodedToken.email_verified,
            name: decodedToken.name,
            picture: decodedToken.picture,
            firebase: decodedToken
        };
        
        next();
        
    } catch (error) {
        // If token verification fails, continue without authentication
        console.warn('Optional auth failed:', error.message);
        next();
    }
};

module.exports = {
    authenticateToken,
    requireAdmin,
    requirePremium,
    optionalAuth
};