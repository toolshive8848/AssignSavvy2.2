const { admin, db } = require('../config/firebase');

class FirebaseDraftManager {
    constructor() {
        this.draftsCollection = 'drafts';
        this.versionsCollection = 'draftVersions';
        this.autoSaveCollection = 'autoSaveSessions';
    }

    /**
     * Create a new draft
     * @param {Object} draftData - Draft data
     * @param {string} userId - User ID
     */
    async createDraft(draftData, userId) {
        try {
            const draftDoc = {
                userId: userId,
                title: draftData.title || 'Untitled Draft',
                content: draftData.content || '',
                prompt: draftData.prompt || '',
                style: draftData.style || 'Academic',
                tone: draftData.tone || 'Formal',
                targetWordCount: draftData.targetWordCount || 0,
                currentWordCount: this.countWords(draftData.content || ''),
                status: draftData.status || 'draft',
                version: 1,
                parentDraftId: draftData.parentDraftId || null,
                autoSaved: false,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            };

            const docRef = await db.collection(this.draftsCollection).add(draftDoc);
            
            // Create initial version
            await this.createVersion(docRef.id, {
                content: draftDoc.content,
                changeSummary: 'Initial draft creation',
                wordCount: draftDoc.currentWordCount
            });

            return {
                success: true,
                draftId: docRef.id,
                draft: { id: docRef.id, ...draftDoc }
            };
        } catch (error) {
            console.error('Error creating draft:', error);
            throw new Error('Failed to create draft');
        }
    }

    /**
     * Update an existing draft
     * @param {string} draftId - Draft ID
     * @param {Object} updateData - Data to update
     * @param {string} userId - User ID
     * @param {boolean} createVersion - Whether to create a new version
     */
    async updateDraft(draftId, updateData, userId, createVersion = false) {
        try {
            // Verify ownership
            const draftDoc = await db.collection(this.draftsCollection).doc(draftId).get();
            if (!draftDoc.exists) {
                throw new Error('Draft not found');
            }

            const draftData = draftDoc.data();
            if (draftData.userId !== userId) {
                throw new Error('Access denied');
            }

            // Prepare update data
            const updates = {
                ...updateData,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            };

            if (updateData.content) {
                updates.currentWordCount = this.countWords(updateData.content);
            }

            if (createVersion) {
                updates.version = admin.firestore.FieldValue.increment(1);
            }

            // Update the draft
            await db.collection(this.draftsCollection).doc(draftId).update(updates);

            // Create version if requested
            if (createVersion && updateData.content) {
                await this.createVersion(draftId, {
                    content: updateData.content,
                    changeSummary: updateData.changeSummary || 'Draft updated',
                    wordCount: updates.currentWordCount
                });
            }

            return { success: true, draftId };
        } catch (error) {
            console.error('Error updating draft:', error);
            throw error;
        }
    }

    /**
     * Get a specific draft
     * @param {string} draftId - Draft ID
     * @param {string} userId - User ID
     */
    async getDraft(draftId, userId) {
        try {
            const draftDoc = await db.collection(this.draftsCollection).doc(draftId).get();
            
            if (!draftDoc.exists) {
                return null;
            }

            const draftData = draftDoc.data();
            if (draftData.userId !== userId) {
                throw new Error('Access denied');
            }

            return {
                id: draftDoc.id,
                ...draftData
            };
        } catch (error) {
            console.error('Error getting draft:', error);
            throw error;
        }
    }

    /**
     * Get user's drafts with pagination and filtering
     * @param {string} userId - User ID
     * @param {Object} options - Query options
     */
    async getUserDrafts(userId, options = {}) {
        try {
            const {
                limit = 20,
                status = null,
                orderBy = 'updatedAt',
                orderDirection = 'desc',
                startAfter = null
            } = options;

            let query = db.collection(this.draftsCollection)
                .where('userId', '==', userId)
                .orderBy(orderBy, orderDirection)
                .limit(limit);

            if (status) {
                query = query.where('status', '==', status);
            }

            if (startAfter) {
                query = query.startAfter(startAfter);
            }

            const snapshot = await query.get();
            const drafts = [];

            snapshot.forEach(doc => {
                drafts.push({
                    id: doc.id,
                    ...doc.data()
                });
            });

            return drafts;
        } catch (error) {
            console.error('Error getting user drafts:', error);
            throw error;
        }
    }

    /**
     * Get draft versions
     * @param {string} draftId - Draft ID
     */
    async getDraftVersions(draftId) {
        try {
            const versionsSnapshot = await db.collection(this.versionsCollection)
                .where('draftId', '==', draftId)
                .orderBy('versionNumber', 'desc')
                .get();

            const versions = [];
            versionsSnapshot.forEach(doc => {
                versions.push({
                    id: doc.id,
                    ...doc.data()
                });
            });

            return versions;
        } catch (error) {
            console.error('Error getting draft versions:', error);
            throw error;
        }
    }

    /**
     * Restore a specific version
     * @param {string} draftId - Draft ID
     * @param {number} versionNumber - Version number to restore
     * @param {string} userId - User ID
     */
    async restoreDraftVersion(draftId, versionNumber, userId) {
        try {
            // Get the version
            const versionSnapshot = await db.collection(this.versionsCollection)
                .where('draftId', '==', draftId)
                .where('versionNumber', '==', versionNumber)
                .limit(1)
                .get();

            if (versionSnapshot.empty) {
                throw new Error('Version not found');
            }

            const versionData = versionSnapshot.docs[0].data();

            // Update the draft with the version content
            await this.updateDraft(draftId, {
                content: versionData.content,
                changeSummary: `Restored to version ${versionNumber}`
            }, userId, true);

            return { success: true, restoredVersion: versionNumber };
        } catch (error) {
            console.error('Error restoring draft version:', error);
            throw error;
        }
    }

    /**
     * Create auto-save session
     * @param {string} draftId - Draft ID
     */
    async createAutoSaveSession(draftId) {
        try {
            const sessionToken = this.generateSessionToken();
            
            const sessionDoc = {
                draftId: draftId,
                sessionToken: sessionToken,
                lastAutoSave: admin.firestore.FieldValue.serverTimestamp(),
                isActive: true
            };

            await db.collection(this.autoSaveCollection).add(sessionDoc);
            
            return sessionToken;
        } catch (error) {
            console.error('Error creating auto-save session:', error);
            throw error;
        }
    }

    /**
     * Auto-save draft content
     * @param {string} sessionToken - Session token
     * @param {string} content - Content to save
     */
    async autoSaveDraft(sessionToken, content) {
        try {
            // Find the session
            const sessionSnapshot = await db.collection(this.autoSaveCollection)
                .where('sessionToken', '==', sessionToken)
                .where('isActive', '==', true)
                .limit(1)
                .get();

            if (sessionSnapshot.empty) {
                throw new Error('Invalid or expired session');
            }

            const sessionData = sessionSnapshot.docs[0].data();
            const draftId = sessionData.draftId;

            // Update the draft
            await db.collection(this.draftsCollection).doc(draftId).update({
                content: content,
                currentWordCount: this.countWords(content),
                autoSaved: true,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            // Update session timestamp
            await sessionSnapshot.docs[0].ref.update({
                lastAutoSave: admin.firestore.FieldValue.serverTimestamp()
            });

            return { success: true, draftId };
        } catch (error) {
            console.error('Error auto-saving draft:', error);
            throw error;
        }
    }

    /**
     * Delete a draft
     * @param {string} draftId - Draft ID
     * @param {string} userId - User ID
     */
    async deleteDraft(draftId, userId) {
        try {
            // Verify ownership
            const draftDoc = await db.collection(this.draftsCollection).doc(draftId).get();
            if (!draftDoc.exists) {
                throw new Error('Draft not found');
            }

            const draftData = draftDoc.data();
            if (draftData.userId !== userId) {
                throw new Error('Access denied');
            }

            // Delete in batch
            const batch = db.batch();

            // Delete the draft
            batch.delete(db.collection(this.draftsCollection).doc(draftId));

            // Delete versions
            const versionsSnapshot = await db.collection(this.versionsCollection)
                .where('draftId', '==', draftId)
                .get();
            versionsSnapshot.forEach(doc => {
                batch.delete(doc.ref);
            });

            // Delete auto-save sessions
            const sessionsSnapshot = await db.collection(this.autoSaveCollection)
                .where('draftId', '==', draftId)
                .get();
            sessionsSnapshot.forEach(doc => {
                batch.delete(doc.ref);
            });

            await batch.commit();

            return { success: true };
        } catch (error) {
            console.error('Error deleting draft:', error);
            throw error;
        }
    }

    /**
     * Get draft statistics for a user
     * @param {string} userId - User ID
     */
    async getDraftStatistics(userId) {
        try {
            const draftsSnapshot = await db.collection(this.draftsCollection)
                .where('userId', '==', userId)
                .get();

            let totalDrafts = 0;
            let completedDrafts = 0;
            let totalWords = 0;
            let draftsByStatus = {};

            draftsSnapshot.forEach(doc => {
                const data = doc.data();
                totalDrafts++;
                totalWords += data.currentWordCount || 0;
                
                if (data.status === 'completed') {
                    completedDrafts++;
                }

                draftsByStatus[data.status] = (draftsByStatus[data.status] || 0) + 1;
            });

            return {
                totalDrafts,
                completedDrafts,
                totalWords,
                draftsByStatus,
                averageWordsPerDraft: totalDrafts > 0 ? Math.round(totalWords / totalDrafts) : 0
            };
        } catch (error) {
            console.error('Error getting draft statistics:', error);
            throw error;
        }
    }

    /**
     * Create a new version
     * @param {string} draftId - Draft ID
     * @param {Object} versionData - Version data
     */
    async createVersion(draftId, versionData) {
        try {
            // Get current version count
            const versionsSnapshot = await db.collection(this.versionsCollection)
                .where('draftId', '==', draftId)
                .get();

            const versionNumber = versionsSnapshot.size + 1;

            const versionDoc = {
                draftId: draftId,
                versionNumber: versionNumber,
                content: versionData.content,
                changeSummary: versionData.changeSummary || '',
                wordCount: versionData.wordCount || 0,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            };

            await db.collection(this.versionsCollection).add(versionDoc);

            // Cleanup old versions (keep only last 10)
            await this.cleanupOldVersions(draftId);

            return versionNumber;
        } catch (error) {
            console.error('Error creating version:', error);
            throw error;
        }
    }

    /**
     * Cleanup old versions (keep only last 10)
     * @param {string} draftId - Draft ID
     */
    async cleanupOldVersions(draftId) {
        try {
            const versionsSnapshot = await db.collection(this.versionsCollection)
                .where('draftId', '==', draftId)
                .orderBy('versionNumber', 'desc')
                .get();

            if (versionsSnapshot.size > 10) {
                const batch = db.batch();
                const docsToDelete = versionsSnapshot.docs.slice(10);
                
                docsToDelete.forEach(doc => {
                    batch.delete(doc.ref);
                });

                await batch.commit();
            }
        } catch (error) {
            console.error('Error cleaning up old versions:', error);
        }
    }

    /**
     * Count words in text
     * @param {string} text - Text to count
     */
    countWords(text) {
        if (!text || typeof text !== 'string') return 0;
        return text.trim().split(/\s+/).filter(word => word.length > 0).length;
    }

    /**
     * Generate session token
     */
    generateSessionToken() {
        return Math.random().toString(36).substring(2, 15) + 
               Math.random().toString(36).substring(2, 15) + 
               Date.now().toString(36);
    }
}

module.exports = FirebaseDraftManager;