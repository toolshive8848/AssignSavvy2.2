/**
 * Unified database abstraction layer
 * This provides a consistent interface for database operations
 * Currently configured for Firebase Firestore
 */

const { admin, db, isInitialized } = require('../config/firebase');
const { databaseErrorHandler } = require('../middleware/errorHandler');

/**
 * Database connection status
 */
const getConnectionStatus = () => {
    return {
        isConnected: isInitialized && db !== null,
        type: 'firebase_firestore',
        timestamp: new Date().toISOString()
    };
};

/**
 * Generic database operations
 */
class DatabaseService {
    constructor() {
        this.db = db;
        this.admin = admin;
    }

    /**
     * Check if database is available
     */
    isAvailable() {
        return isInitialized && this.db !== null;
    }

    /**
     * Get a document by ID
     */
    async getDocument(collection, documentId) {
        try {
            if (!this.isAvailable()) {
                throw new Error('Database not available');
            }

            const doc = await this.db.collection(collection).doc(documentId).get();
            
            if (!doc.exists) {
                return null;
            }

            return {
                id: doc.id,
                ...doc.data(),
                _metadata: {
                    created: doc.createTime,
                    updated: doc.updateTime
                }
            };
        } catch (error) {
            throw databaseErrorHandler(error, `Get document ${documentId} from ${collection}`);
        }
    }

    /**
     * Get multiple documents with optional filtering
     */
    async getDocuments(collection, options = {}) {
        try {
            if (!this.isAvailable()) {
                throw new Error('Database not available');
            }

            let query = this.db.collection(collection);

            // Apply filters
            if (options.where) {
                for (const [field, operator, value] of options.where) {
                    query = query.where(field, operator, value);
                }
            }

            // Apply ordering
            if (options.orderBy) {
                for (const [field, direction = 'asc'] of options.orderBy) {
                    query = query.orderBy(field, direction);
                }
            }

            // Apply pagination
            if (options.limit) {
                query = query.limit(options.limit);
            }

            if (options.offset) {
                query = query.offset(options.offset);
            }

            const snapshot = await query.get();
            
            const documents = [];
            snapshot.forEach(doc => {
                documents.push({
                    id: doc.id,
                    ...doc.data(),
                    _metadata: {
                        created: doc.createTime,
                        updated: doc.updateTime
                    }
                });
            });

            return {
                documents,
                total: documents.length,
                hasMore: snapshot.size === options.limit
            };
        } catch (error) {
            throw databaseErrorHandler(error, `Get documents from ${collection}`);
        }
    }

    /**
     * Create a new document
     */
    async createDocument(collection, data, documentId = null) {
        try {
            if (!this.isAvailable()) {
                throw new Error('Database not available');
            }

            const timestamp = admin.firestore.FieldValue.serverTimestamp();
            const documentData = {
                ...data,
                createdAt: timestamp,
                updatedAt: timestamp
            };

            let docRef;
            if (documentId) {
                docRef = this.db.collection(collection).doc(documentId);
                await docRef.set(documentData);
            } else {
                docRef = await this.db.collection(collection).add(documentData);
            }

            return {
                id: docRef.id,
                ...documentData
            };
        } catch (error) {
            throw databaseErrorHandler(error, `Create document in ${collection}`);
        }
    }

    /**
     * Update an existing document
     */
    async updateDocument(collection, documentId, data) {
        try {
            if (!this.isAvailable()) {
                throw new Error('Database not available');
            }

            const updateData = {
                ...data,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            };

            await this.db.collection(collection).doc(documentId).update(updateData);

            return {
                id: documentId,
                ...updateData
            };
        } catch (error) {
            throw databaseErrorHandler(error, `Update document ${documentId} in ${collection}`);
        }
    }

    /**
     * Delete a document
     */
    async deleteDocument(collection, documentId) {
        try {
            if (!this.isAvailable()) {
                throw new Error('Database not available');
            }

            await this.db.collection(collection).doc(documentId).delete();
            return { id: documentId, deleted: true };
        } catch (error) {
            throw databaseErrorHandler(error, `Delete document ${documentId} from ${collection}`);
        }
    }

    /**
     * Perform a transaction
     */
    async runTransaction(callback) {
        try {
            if (!this.isAvailable()) {
                throw new Error('Database not available');
            }

            return await this.db.runTransaction(callback);
        } catch (error) {
            throw databaseErrorHandler(error, 'Run database transaction');
        }
    }

    /**
     * Perform a batch operation
     */
    async runBatch(operations) {
        try {
            if (!this.isAvailable()) {
                throw new Error('Database not available');
            }

            const batch = this.db.batch();
            const timestamp = admin.firestore.FieldValue.serverTimestamp();

            for (const operation of operations) {
                const { type, collection, documentId, data } = operation;
                const docRef = this.db.collection(collection).doc(documentId);

                switch (type) {
                    case 'create':
                    case 'set':
                        batch.set(docRef, {
                            ...data,
                            createdAt: timestamp,
                            updatedAt: timestamp
                        });
                        break;
                    case 'update':
                        batch.update(docRef, {
                            ...data,
                            updatedAt: timestamp
                        });
                        break;
                    case 'delete':
                        batch.delete(docRef);
                        break;
                    default:
                        throw new Error(`Unknown batch operation type: ${type}`);
                }
            }

            await batch.commit();
            return { success: true, operations: operations.length };
        } catch (error) {
            throw databaseErrorHandler(error, 'Run batch operation');
        }
    }

    /**
     * Search documents (basic text search)
     */
    async searchDocuments(collection, searchField, searchTerm, options = {}) {
        try {
            if (!this.isAvailable()) {
                throw new Error('Database not available');
            }

            // Firestore doesn't have full-text search, so we use array-contains or prefix matching
            let query = this.db.collection(collection);

            // For prefix search
            if (options.prefixSearch) {
                query = query
                    .where(searchField, '>=', searchTerm)
                    .where(searchField, '<=', searchTerm + '\uf8ff');
            } else {
                // For exact match or array contains
                query = query.where(searchField, options.operator || '==', searchTerm);
            }

            if (options.limit) {
                query = query.limit(options.limit);
            }

            const snapshot = await query.get();
            const documents = [];
            
            snapshot.forEach(doc => {
                documents.push({
                    id: doc.id,
                    ...doc.data()
                });
            });

            return documents;
        } catch (error) {
            throw databaseErrorHandler(error, `Search documents in ${collection}`);
        }
    }

    /**
     * Get collection statistics
     */
    async getCollectionStats(collection) {
        try {
            if (!this.isAvailable()) {
                throw new Error('Database not available');
            }

            const snapshot = await this.db.collection(collection).get();
            return {
                collection,
                documentCount: snapshot.size,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            throw databaseErrorHandler(error, `Get stats for collection ${collection}`);
        }
    }
}

// Create singleton instance
const databaseService = new DatabaseService();

// Export both the service and individual functions for backward compatibility
module.exports = {
    databaseService,
    getConnectionStatus,
    
    // Backward compatibility exports
    db,
    admin,
    isInitialized,
    
    // Convenience methods
    getDocument: (collection, id) => databaseService.getDocument(collection, id),
    getDocuments: (collection, options) => databaseService.getDocuments(collection, options),
    createDocument: (collection, data, id) => databaseService.createDocument(collection, data, id),
    updateDocument: (collection, id, data) => databaseService.updateDocument(collection, id, data),
    deleteDocument: (collection, id) => databaseService.deleteDocument(collection, id),
    runTransaction: (callback) => databaseService.runTransaction(callback),
    runBatch: (operations) => databaseService.runBatch(operations),
    searchDocuments: (collection, field, term, options) => databaseService.searchDocuments(collection, field, term, options)
};