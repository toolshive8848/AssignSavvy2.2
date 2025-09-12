const express = require('express');
const { admin, db } = require('../config/firebase');
const { verifyFirebaseToken } = require('./firebaseAuth');
const router = express.Router();

// Get user profile with detailed information
router.get('/profile/:userId', verifyFirebaseToken, async (req, res) => {
    const { userId } = req.params;
    
    // Ensure user can only access their own profile or admin access
    if (req.user.uid !== userId && !req.user.admin) {
        return res.status(403).json({ error: 'Access denied' });
    }

    try {
        const userDoc = await db.collection('users').doc(userId).get();
        
        if (!userDoc.exists) {
            return res.status(404).json({ error: 'User not found' });
        }

        const userData = userDoc.data();
        
        // Get user statistics
        const statsDoc = await db.collection('userStats').doc(userId).get();
        const stats = statsDoc.exists ? statsDoc.data() : {
            totalAssignments: 0,
            totalWordsGenerated: 0,
            totalCreditsUsed: 0,
            averageScore: 0
        };

        res.json({
            uid: userId,
            email: userData.email,
            name: userData.name,
            credits: userData.credits || 0,
            isPremium: userData.isPremium || false,
            subscriptionEndDate: userData.subscriptionEndDate,
            createdAt: userData.createdAt,
            updatedAt: userData.updatedAt,
            stats
        });
    } catch (error) {
        console.error('Profile fetch error:', error);
        return res.status(500).json({ error: 'Error fetching user profile' });
    }
});

// Get all users (admin only)
router.get('/all', verifyFirebaseToken, async (req, res) => {
    // Check if user is admin (you can implement admin check logic)
    if (!req.user.admin) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    try {
        const { limit = 50, offset = 0, search = '' } = req.query;
        
        let query = db.collection('users')
            .orderBy('createdAt', 'desc')
            .limit(parseInt(limit));

        if (offset > 0) {
            // For pagination, you'd need to implement cursor-based pagination
            // This is a simplified version
        }

        const snapshot = await query.get();
        const users = [];

        snapshot.forEach(doc => {
            const userData = doc.data();
            if (!search || 
                userData.name.toLowerCase().includes(search.toLowerCase()) ||
                userData.email.toLowerCase().includes(search.toLowerCase())) {
                users.push({
                    uid: doc.id,
                    email: userData.email,
                    name: userData.name,
                    credits: userData.credits || 0,
                    isPremium: userData.isPremium || false,
                    createdAt: userData.createdAt,
                    updatedAt: userData.updatedAt
                });
            }
        });

        res.json({
            users,
            total: users.length,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
    } catch (error) {
        console.error('Users fetch error:', error);
        return res.status(500).json({ error: 'Error fetching users' });
    }
});

// Update user credits
router.put('/credits/:userId', verifyFirebaseToken, async (req, res) => {
    const { userId } = req.params;
    const { credits, operation = 'set' } = req.body; // operation: 'set', 'add', 'subtract'
    
    // Ensure user can only update their own credits or admin access
    if (req.user.uid !== userId && !req.user.admin) {
        return res.status(403).json({ error: 'Access denied' });
    }

    if (typeof credits !== 'number' || credits < 0) {
        return res.status(400).json({ error: 'Credits must be a positive number' });
    }

    try {
        const userRef = db.collection('users').doc(userId);
        
        if (operation === 'set') {
            await userRef.update({
                credits: credits,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        } else if (operation === 'add') {
            await userRef.update({
                credits: admin.firestore.FieldValue.increment(credits),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        } else if (operation === 'subtract') {
            await userRef.update({
                credits: admin.firestore.FieldValue.increment(-credits),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        }

        // Get updated user data
        const updatedDoc = await userRef.get();
        const updatedData = updatedDoc.data();

        res.json({
            message: 'Credits updated successfully',
            credits: updatedData.credits
        });
    } catch (error) {
        console.error('Credits update error:', error);
        return res.status(500).json({ error: 'Error updating credits' });
    }
});

// Update premium status
router.put('/premium/:userId', verifyFirebaseToken, async (req, res) => {
    const { userId } = req.params;
    const { isPremium, subscriptionEndDate } = req.body;
    
    // Only admin can update premium status
    if (!req.user.admin) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    try {
        const updateData = {
            isPremium: Boolean(isPremium),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        if (subscriptionEndDate) {
            updateData.subscriptionEndDate = admin.firestore.Timestamp.fromDate(new Date(subscriptionEndDate));
        } else if (isPremium === false) {
            updateData.subscriptionEndDate = null;
        }

        await db.collection('users').doc(userId).update(updateData);

        res.json({ message: 'Premium status updated successfully' });
    } catch (error) {
        console.error('Premium update error:', error);
        return res.status(500).json({ error: 'Error updating premium status' });
    }
});

// Delete user account
router.delete('/:userId', verifyFirebaseToken, async (req, res) => {
    const { userId } = req.params;
    
    // Ensure user can only delete their own account or admin access
    if (req.user.uid !== userId && !req.user.admin) {
        return res.status(403).json({ error: 'Access denied' });
    }

    try {
        // Delete user from Firebase Auth
        await admin.auth().deleteUser(userId);
        
        // Delete user document from Firestore
        await db.collection('users').doc(userId).delete();
        
        // Delete related data (assignments, drafts, etc.)
        const batch = db.batch();
        
        // Delete user's assignments
        const assignmentsSnapshot = await db.collection('assignments')
            .where('userId', '==', userId)
            .get();
        assignmentsSnapshot.forEach(doc => {
            batch.delete(doc.ref);
        });
        
        // Delete user's drafts
        const draftsSnapshot = await db.collection('drafts')
            .where('userId', '==', userId)
            .get();
        draftsSnapshot.forEach(doc => {
            batch.delete(doc.ref);
        });
        
        // Delete user stats
        batch.delete(db.collection('userStats').doc(userId));
        
        await batch.commit();

        res.json({ message: 'User account deleted successfully' });
    } catch (error) {
        console.error('User deletion error:', error);
        return res.status(500).json({ error: 'Error deleting user account' });
    }
});

// Get user usage statistics
router.get('/stats/:userId', verifyFirebaseToken, async (req, res) => {
    const { userId } = req.params;
    
    // Ensure user can only access their own stats or admin access
    if (req.user.uid !== userId && !req.user.admin) {
        return res.status(403).json({ error: 'Access denied' });
    }

    try {
        // Get user stats
        const statsDoc = await db.collection('userStats').doc(userId).get();
        const stats = statsDoc.exists ? statsDoc.data() : {};
        
        // Get monthly usage
        const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
        const monthlyUsageDoc = await db.collection('monthlyUsage')
            .doc(`${userId}_${currentMonth}`)
            .get();
        const monthlyUsage = monthlyUsageDoc.exists ? monthlyUsageDoc.data() : {
            wordCount: 0,
            creditsUsed: 0
        };
        
        // Get recent assignments count
        const recentAssignments = await db.collection('assignments')
            .where('userId', '==', userId)
            .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)))
            .get();

        res.json({
            totalStats: stats,
            monthlyUsage,
            recentAssignmentsCount: recentAssignments.size
        });
    } catch (error) {
        console.error('Stats fetch error:', error);
        return res.status(500).json({ error: 'Error fetching user statistics' });
    }
});

// Test profile endpoint for development
router.get('/test-profile', (req, res) => {
    res.json({
        success: true,
        user: {
            id: 'test-user-123',
            name: 'Test User',
            email: 'test@example.com',
            credits: 1500,
            plan: 'premium',
            avatar: null
        }
    });
});

module.exports = router;