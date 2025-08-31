/**
 * Draft Management Service
 * Handles draft saving, version control, and auto-save functionality
 */

const crypto = require('crypto');

class DraftManager {
    constructor() {
        this.autoSaveInterval = 30000; // 30 seconds
        this.maxVersionsPerDraft = 50;
    }

    /**
     * Create a new draft
     * @param {Object} draftData - Draft information
     * @param {Object} db - Database connection
     * @returns {Promise<Object>} Created draft
     */
    async createDraft(draftData, db) {
        const {
            userId,
            title,
            content = '',
            prompt = '',
            style = 'Academic',
            tone = 'Formal',
            targetWordCount = 0
        } = draftData;

        const currentWordCount = this._countWords(content);

        return new Promise((resolve, reject) => {
            const stmt = db.prepare(`
                INSERT INTO drafts (
                    user_id, title, content, prompt, style, tone, 
                    target_word_count, current_word_count, status, version
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', 1)
            `);

            stmt.run(
                [userId, title, content, prompt, style, tone, targetWordCount, currentWordCount],
                function(err) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    const draftId = this.lastID;

                    // Create initial version
                    const versionStmt = db.prepare(`
                        INSERT INTO draft_versions (
                            draft_id, version_number, content, change_summary, word_count
                        ) VALUES (?, 1, ?, 'Initial draft creation', ?)
                    `);

                    versionStmt.run([draftId, content, currentWordCount], (versionErr) => {
                        if (versionErr) {
                            reject(versionErr);
                            return;
                        }

                        resolve({
                            id: draftId,
                            userId,
                            title,
                            content,
                            prompt,
                            style,
                            tone,
                            targetWordCount,
                            currentWordCount,
                            status: 'draft',
                            version: 1,
                            createdAt: new Date().toISOString()
                        });
                    });
                }
            );
        });
    }

    /**
     * Update an existing draft
     * @param {number} draftId - Draft ID
     * @param {Object} updateData - Data to update
     * @param {Object} db - Database connection
     * @param {boolean} createVersion - Whether to create a new version
     * @returns {Promise<Object>} Updated draft
     */
    async updateDraft(draftId, updateData, db, createVersion = false) {
        const {
            title,
            content,
            prompt,
            style,
            tone,
            targetWordCount,
            status,
            changeSummary = 'Content updated'
        } = updateData;

        const currentWordCount = content ? this._countWords(content) : undefined;

        return new Promise((resolve, reject) => {
            // First, get current draft data
            db.get('SELECT * FROM drafts WHERE id = ?', [draftId], (err, draft) => {
                if (err) {
                    reject(err);
                    return;
                }

                if (!draft) {
                    reject(new Error('Draft not found'));
                    return;
                }

                // Build update query dynamically
                const updates = [];
                const values = [];

                if (title !== undefined) {
                    updates.push('title = ?');
                    values.push(title);
                }
                if (content !== undefined) {
                    updates.push('content = ?');
                    values.push(content);
                }
                if (prompt !== undefined) {
                    updates.push('prompt = ?');
                    values.push(prompt);
                }
                if (style !== undefined) {
                    updates.push('style = ?');
                    values.push(style);
                }
                if (tone !== undefined) {
                    updates.push('tone = ?');
                    values.push(tone);
                }
                if (targetWordCount !== undefined) {
                    updates.push('target_word_count = ?');
                    values.push(targetWordCount);
                }
                if (currentWordCount !== undefined) {
                    updates.push('current_word_count = ?');
                    values.push(currentWordCount);
                }
                if (status !== undefined) {
                    updates.push('status = ?');
                    values.push(status);
                }

                updates.push('updated_at = CURRENT_TIMESTAMP');

                if (createVersion) {
                    updates.push('version = version + 1');
                }

                values.push(draftId);

                const updateQuery = `UPDATE drafts SET ${updates.join(', ')} WHERE id = ?`;

                db.run(updateQuery, values, function(updateErr) {
                    if (updateErr) {
                        reject(updateErr);
                        return;
                    }

                    // Create version if requested
                    if (createVersion && content !== undefined) {
                        const newVersion = draft.version + 1;
                        const versionStmt = db.prepare(`
                            INSERT INTO draft_versions (
                                draft_id, version_number, content, change_summary, word_count
                            ) VALUES (?, ?, ?, ?, ?)
                        `);

                        versionStmt.run(
                            [draftId, newVersion, content, changeSummary, currentWordCount],
                            (versionErr) => {
                                if (versionErr) {
                                    reject(versionErr);
                                    return;
                                }

                                // Clean up old versions if needed
                                this._cleanupOldVersions(draftId, db);
                                resolve({ success: true, version: newVersion });
                            }
                        );
                    } else {
                        resolve({ success: true });
                    }
                });
            });
        });
    }

    /**
     * Get draft by ID
     * @param {number} draftId - Draft ID
     * @param {number} userId - User ID for security
     * @param {Object} db - Database connection
     * @returns {Promise<Object>} Draft data
     */
    async getDraft(draftId, userId, db) {
        return new Promise((resolve, reject) => {
            db.get(
                'SELECT * FROM drafts WHERE id = ? AND user_id = ?',
                [draftId, userId],
                (err, draft) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve(draft);
                }
            );
        });
    }

    /**
     * Get all drafts for a user
     * @param {number} userId - User ID
     * @param {Object} db - Database connection
     * @param {Object} options - Query options
     * @returns {Promise<Array>} List of drafts
     */
    async getUserDrafts(userId, db, options = {}) {
        const {
            status = null,
            limit = 50,
            offset = 0,
            orderBy = 'updated_at',
            orderDirection = 'DESC'
        } = options;

        return new Promise((resolve, reject) => {
            let query = 'SELECT * FROM drafts WHERE user_id = ?';
            const params = [userId];

            if (status) {
                query += ' AND status = ?';
                params.push(status);
            }

            query += ` ORDER BY ${orderBy} ${orderDirection} LIMIT ? OFFSET ?`;
            params.push(limit, offset);

            db.all(query, params, (err, drafts) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(drafts);
            });
        });
    }

    /**
     * Get draft versions
     * @param {number} draftId - Draft ID
     * @param {Object} db - Database connection
     * @returns {Promise<Array>} List of versions
     */
    async getDraftVersions(draftId, db) {
        return new Promise((resolve, reject) => {
            db.all(
                'SELECT * FROM draft_versions WHERE draft_id = ? ORDER BY version_number DESC',
                [draftId],
                (err, versions) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve(versions);
                }
            );
        });
    }

    /**
     * Restore draft to a specific version
     * @param {number} draftId - Draft ID
     * @param {number} versionNumber - Version to restore
     * @param {Object} db - Database connection
     * @returns {Promise<Object>} Restoration result
     */
    async restoreDraftVersion(draftId, versionNumber, db) {
        return new Promise((resolve, reject) => {
            // Get the version content
            db.get(
                'SELECT * FROM draft_versions WHERE draft_id = ? AND version_number = ?',
                [draftId, versionNumber],
                (err, version) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    if (!version) {
                        reject(new Error('Version not found'));
                        return;
                    }

                    // Update draft with version content and create new version
                    this.updateDraft(
                        draftId,
                        {
                            content: version.content,
                            changeSummary: `Restored to version ${versionNumber}`
                        },
                        db,
                        true
                    ).then(resolve).catch(reject);
                }
            );
        });
    }

    /**
     * Create auto-save session
     * @param {number} draftId - Draft ID
     * @param {Object} db - Database connection
     * @returns {Promise<string>} Session token
     */
    async createAutoSaveSession(draftId, db) {
        const sessionToken = crypto.randomBytes(32).toString('hex');

        return new Promise((resolve, reject) => {
            // Deactivate existing sessions for this draft
            db.run(
                'UPDATE auto_save_sessions SET is_active = FALSE WHERE draft_id = ?',
                [draftId],
                (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    // Create new session
                    db.run(
                        'INSERT INTO auto_save_sessions (draft_id, session_token) VALUES (?, ?)',
                        [draftId, sessionToken],
                        function(insertErr) {
                            if (insertErr) {
                                reject(insertErr);
                                return;
                            }
                            resolve(sessionToken);
                        }
                    );
                }
            );
        });
    }

    /**
     * Auto-save draft content
     * @param {string} sessionToken - Session token
     * @param {string} content - Content to save
     * @param {Object} db - Database connection
     * @returns {Promise<Object>} Save result
     */
    async autoSaveDraft(sessionToken, content, db) {
        return new Promise((resolve, reject) => {
            // Get session and draft info
            db.get(
                `SELECT s.*, d.id as draft_id FROM auto_save_sessions s 
                 JOIN drafts d ON s.draft_id = d.id 
                 WHERE s.session_token = ? AND s.is_active = TRUE`,
                [sessionToken],
                (err, session) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    if (!session) {
                        reject(new Error('Invalid or expired session'));
                        return;
                    }

                    const wordCount = this._countWords(content);

                    // Update draft content and mark as auto-saved
                    db.run(
                        `UPDATE drafts SET 
                         content = ?, current_word_count = ?, auto_saved = TRUE, updated_at = CURRENT_TIMESTAMP 
                         WHERE id = ?`,
                        [content, wordCount, session.draft_id],
                        (updateErr) => {
                            if (updateErr) {
                                reject(updateErr);
                                return;
                            }

                            // Update session timestamp
                            db.run(
                                'UPDATE auto_save_sessions SET last_auto_save = CURRENT_TIMESTAMP WHERE session_token = ?',
                                [sessionToken],
                                (sessionErr) => {
                                    if (sessionErr) {
                                        reject(sessionErr);
                                        return;
                                    }

                                    resolve({
                                        success: true,
                                        wordCount,
                                        lastSaved: new Date().toISOString()
                                    });
                                }
                            );
                        }
                    );
                }
            );
        });
    }

    /**
     * Delete draft
     * @param {number} draftId - Draft ID
     * @param {number} userId - User ID for security
     * @param {Object} db - Database connection
     * @returns {Promise<Object>} Deletion result
     */
    async deleteDraft(draftId, userId, db) {
        return new Promise((resolve, reject) => {
            // Verify ownership
            db.get(
                'SELECT id FROM drafts WHERE id = ? AND user_id = ?',
                [draftId, userId],
                (err, draft) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    if (!draft) {
                        reject(new Error('Draft not found or access denied'));
                        return;
                    }

                    // Delete related data
                    db.serialize(() => {
                        db.run('DELETE FROM auto_save_sessions WHERE draft_id = ?', [draftId]);
                        db.run('DELETE FROM draft_versions WHERE draft_id = ?', [draftId]);
                        db.run('DELETE FROM drafts WHERE id = ?', [draftId], function(deleteErr) {
                            if (deleteErr) {
                                reject(deleteErr);
                                return;
                            }
                            resolve({ success: true, deletedRows: this.changes });
                        });
                    });
                }
            );
        });
    }

    /**
     * Clean up old versions to maintain performance
     * @param {number} draftId - Draft ID
     * @param {Object} db - Database connection
     */
    _cleanupOldVersions(draftId, db) {
        db.run(
            `DELETE FROM draft_versions 
             WHERE draft_id = ? AND version_number NOT IN (
                 SELECT version_number FROM draft_versions 
                 WHERE draft_id = ? 
                 ORDER BY version_number DESC 
                 LIMIT ?
             )`,
            [draftId, draftId, this.maxVersionsPerDraft],
            (err) => {
                if (err) {
                    console.error('Error cleaning up old versions:', err);
                }
            }
        );
    }

    /**
     * Count words in text
     * @param {string} text - Text to count
     * @returns {number} Word count
     */
    _countWords(text) {
        if (!text) return 0;
        return text.trim().split(/\s+/).filter(word => word.length > 0).length;
    }

    /**
     * Get draft statistics for a user
     * @param {number} userId - User ID
     * @param {Object} db - Database connection
     * @returns {Promise<Object>} Statistics
     */
    async getDraftStatistics(userId, db) {
        return new Promise((resolve, reject) => {
            db.get(
                `SELECT 
                    COUNT(*) as total_drafts,
                    COUNT(CASE WHEN status = 'draft' THEN 1 END) as active_drafts,
                    COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_drafts,
                    SUM(current_word_count) as total_words,
                    AVG(current_word_count) as avg_words_per_draft
                 FROM drafts WHERE user_id = ?`,
                [userId],
                (err, stats) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve(stats);
                }
            );
        });
    }
}

module.exports = new DraftManager();