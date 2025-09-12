const express = require('express');
const { admin, db } = require('../config/firebase');
const { verifyFirebaseToken } = require('./firebaseAuth');
const FirebaseDraftManager = require('./firebaseDraftManager');
const router = express.Router();

const draftManager = new FirebaseDraftManager();

// Create new assignment
router.post('/create', verifyFirebaseToken, async (req, res) => {
    const {
        title,
        description,
        wordCount,
        citationStyle = 'APA',
        content = '',
        creditsUsed = 0
    } = req.body;

    const userId = req.user.uid;

    if (!title || !wordCount) {
        return res.status(400).json({ error: 'Title and word count are required' });
    }

    try {
        // Check user credits
        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) {
            return res.status(404).json({ error: 'User not found' });
        }

        const userData = userDoc.data();
        if (userData.credits < creditsUsed) {
            return res.status(400).json({ error: 'Insufficient credits' });
        }

        // Create assignment document
        const assignmentDoc = {
            userId: userId,
            title: title,
            description: description || '',
            wordCount: parseInt(wordCount),
            citationStyle: citationStyle,
            content: content,
            originalityScore: null,
            status: 'pending',
            creditsUsed: creditsUsed,
            filePath: null,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        const docRef = await db.collection('assignments').add(assignmentDoc);

        // Deduct credits if any were used
        if (creditsUsed > 0) {
            await db.collection('users').doc(userId).update({
                credits: admin.firestore.FieldValue.increment(-creditsUsed),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            // Record usage
            await db.collection('usageTracking').add({
                userId: userId,
                assignmentId: docRef.id,
                creditsUsed: creditsUsed,
                wordCount: parseInt(wordCount),
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
        }

        res.status(201).json({
            message: 'Assignment created successfully',
            assignmentId: docRef.id,
            assignment: {
                id: docRef.id,
                ...assignmentDoc
            }
        });
    } catch (error) {
        console.error('Assignment creation error:', error);
        return res.status(500).json({ error: 'Error creating assignment' });
    }
});

// Get user's assignments
router.get('/user/:userId', verifyFirebaseToken, async (req, res) => {
    const { userId } = req.params;
    const { limit = 20, status, orderBy = 'createdAt', orderDirection = 'desc' } = req.query;

    // Ensure user can only access their own assignments
    if (req.user.uid !== userId && !req.user.admin) {
        return res.status(403).json({ error: 'Access denied' });
    }

    try {
        let query = db.collection('assignments')
            .where('userId', '==', userId)
            .orderBy(orderBy, orderDirection)
            .limit(parseInt(limit));

        if (status) {
            query = query.where('status', '==', status);
        }

        const snapshot = await query.get();
        const assignments = [];

        snapshot.forEach(doc => {
            assignments.push({
                id: doc.id,
                ...doc.data()
            });
        });

        res.json({ assignments });
    } catch (error) {
        console.error('Assignments fetch error:', error);
        return res.status(500).json({ error: 'Error fetching assignments' });
    }
});

// Get specific assignment
router.get('/:assignmentId', verifyFirebaseToken, async (req, res) => {
    const { assignmentId } = req.params;

    try {
        const assignmentDoc = await db.collection('assignments').doc(assignmentId).get();
        
        if (!assignmentDoc.exists) {
            return res.status(404).json({ error: 'Assignment not found' });
        }

        const assignmentData = assignmentDoc.data();
        
        // Ensure user can only access their own assignments
        if (req.user.uid !== assignmentData.userId && !req.user.admin) {
            return res.status(403).json({ error: 'Access denied' });
        }

        res.json({
            id: assignmentDoc.id,
            ...assignmentData
        });
    } catch (error) {
        console.error('Assignment fetch error:', error);
        return res.status(500).json({ error: 'Error fetching assignment' });
    }
});

// Update assignment
router.put('/:assignmentId', verifyFirebaseToken, async (req, res) => {
    const { assignmentId } = req.params;
    const updateData = req.body;

    try {
        const assignmentDoc = await db.collection('assignments').doc(assignmentId).get();
        
        if (!assignmentDoc.exists) {
            return res.status(404).json({ error: 'Assignment not found' });
        }

        const assignmentData = assignmentDoc.data();
        
        // Ensure user can only update their own assignments
        if (req.user.uid !== assignmentData.userId && !req.user.admin) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Prepare update data
        const updates = {
            ...updateData,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        // Remove fields that shouldn't be updated directly
        delete updates.userId;
        delete updates.createdAt;
        delete updates.id;

        await db.collection('assignments').doc(assignmentId).update(updates);

        res.json({ message: 'Assignment updated successfully' });
    } catch (error) {
        console.error('Assignment update error:', error);
        return res.status(500).json({ error: 'Error updating assignment' });
    }
});

// Delete assignment
router.delete('/:assignmentId', verifyFirebaseToken, async (req, res) => {
    const { assignmentId } = req.params;

    try {
        const assignmentDoc = await db.collection('assignments').doc(assignmentId).get();
        
        if (!assignmentDoc.exists) {
            return res.status(404).json({ error: 'Assignment not found' });
        }

        const assignmentData = assignmentDoc.data();
        
        // Ensure user can only delete their own assignments
        if (req.user.uid !== assignmentData.userId && !req.user.admin) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Delete the assignment
        await db.collection('assignments').doc(assignmentId).delete();

        // Delete related usage tracking records
        const usageSnapshot = await db.collection('usageTracking')
            .where('assignmentId', '==', assignmentId)
            .get();
        
        const batch = db.batch();
        usageSnapshot.forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();

        res.json({ message: 'Assignment deleted successfully' });
    } catch (error) {
        console.error('Assignment deletion error:', error);
        return res.status(500).json({ error: 'Error deleting assignment' });
    }
});

// Draft management endpoints

// Create draft
router.post('/drafts/create', verifyFirebaseToken, async (req, res) => {
    try {
        const result = await draftManager.createDraft(req.body, req.user.uid);
        res.status(201).json(result);
    } catch (error) {
        console.error('Draft creation error:', error);
        return res.status(500).json({ error: error.message });
    }
});

// Get user drafts
router.get('/drafts/user/:userId', verifyFirebaseToken, async (req, res) => {
    const { userId } = req.params;
    
    // Ensure user can only access their own drafts
    if (req.user.uid !== userId && !req.user.admin) {
        return res.status(403).json({ error: 'Access denied' });
    }

    try {
        const drafts = await draftManager.getUserDrafts(userId, req.query);
        res.json({ drafts });
    } catch (error) {
        console.error('Drafts fetch error:', error);
        return res.status(500).json({ error: error.message });
    }
});

// Get specific draft
router.get('/drafts/:draftId', verifyFirebaseToken, async (req, res) => {
    const { draftId } = req.params;

    try {
        const draft = await draftManager.getDraft(draftId, req.user.uid);
        if (!draft) {
            return res.status(404).json({ error: 'Draft not found' });
        }
        res.json(draft);
    } catch (error) {
        console.error('Draft fetch error:', error);
        return res.status(500).json({ error: error.message });
    }
});

// Update draft
router.put('/drafts/:draftId', verifyFirebaseToken, async (req, res) => {
    const { draftId } = req.params;
    const { createVersion = false, ...updateData } = req.body;

    try {
        const result = await draftManager.updateDraft(draftId, updateData, req.user.uid, createVersion);
        res.json(result);
    } catch (error) {
        console.error('Draft update error:', error);
        return res.status(500).json({ error: error.message });
    }
});

// Delete draft
router.delete('/drafts/:draftId', verifyFirebaseToken, async (req, res) => {
    const { draftId } = req.params;

    try {
        const result = await draftManager.deleteDraft(draftId, req.user.uid);
        res.json(result);
    } catch (error) {
        console.error('Draft deletion error:', error);
        return res.status(500).json({ error: error.message });
    }
});

// Get draft versions
router.get('/drafts/:draftId/versions', verifyFirebaseToken, async (req, res) => {
    const { draftId } = req.params;

    try {
        // Verify access to draft first
        const draft = await draftManager.getDraft(draftId, req.user.uid);
        if (!draft) {
            return res.status(404).json({ error: 'Draft not found' });
        }

        const versions = await draftManager.getDraftVersions(draftId);
        res.json({ versions });
    } catch (error) {
        console.error('Draft versions fetch error:', error);
        return res.status(500).json({ error: error.message });
    }
});

// Restore draft version
router.post('/drafts/:draftId/restore/:versionNumber', verifyFirebaseToken, async (req, res) => {
    const { draftId, versionNumber } = req.params;

    try {
        const result = await draftManager.restoreDraftVersion(draftId, parseInt(versionNumber), req.user.uid);
        res.json(result);
    } catch (error) {
        console.error('Draft restore error:', error);
        return res.status(500).json({ error: error.message });
    }
});

// Auto-save endpoints
router.post('/drafts/:draftId/autosave/session', verifyFirebaseToken, async (req, res) => {
    const { draftId } = req.params;

    try {
        // Verify access to draft first
        const draft = await draftManager.getDraft(draftId, req.user.uid);
        if (!draft) {
            return res.status(404).json({ error: 'Draft not found' });
        }

        const sessionToken = await draftManager.createAutoSaveSession(draftId);
        res.json({ sessionToken });
    } catch (error) {
        console.error('Auto-save session creation error:', error);
        return res.status(500).json({ error: error.message });
    }
});

router.post('/drafts/autosave', verifyFirebaseToken, async (req, res) => {
    const { sessionToken, content } = req.body;

    if (!sessionToken || !content) {
        return res.status(400).json({ error: 'Session token and content are required' });
    }

    try {
        const result = await draftManager.autoSaveDraft(sessionToken, content);
        res.json(result);
    } catch (error) {
        console.error('Auto-save error:', error);
        return res.status(500).json({ error: error.message });
    }
});

// Get draft statistics
router.get('/drafts/stats/:userId', verifyFirebaseToken, async (req, res) => {
    const { userId } = req.params;
    
    // Ensure user can only access their own stats
    if (req.user.uid !== userId && !req.user.admin) {
        return res.status(403).json({ error: 'Access denied' });
    }

    try {
        const stats = await draftManager.getDraftStatistics(userId);
        res.json(stats);
    } catch (error) {
        console.error('Draft statistics error:', error);
        return res.status(500).json({ error: error.message });
    }
});

module.exports = router;