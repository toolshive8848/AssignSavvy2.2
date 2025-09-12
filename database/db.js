// Simple database abstraction layer
// This module provides a unified interface for database operations
// Currently configured to use Firebase as the backend

const { db, isInitialized } = require('../config/firebase');

class Database {
    constructor() {
        this.isReady = isInitialized;
    }

    // Get a document from a collection
    async get(collection, docId) {
        if (!this.isReady) {
            throw new Error('Database service is not available. Please check your configuration and try again.');
        }

        try {
            const docRef = db.collection(collection).doc(docId);
            const doc = await docRef.get();
            return doc;
        } catch (error) {
            console.error('Database get error:', error);
            throw error;
        }
    }

    // Set a document in a collection
    async set(collection, docId, data) {
        if (!this.isReady) {
            throw new Error('Database service is not available. Please check your configuration and try again.');
        }

        try {
            const docRef = db.collection(collection).doc(docId);
            await docRef.set(data, { merge: true });
            return { success: true };
        } catch (error) {
            console.error('Database set error:', error);
            throw error;
        }
    }

    // Update a document in a collection
    async update(collection, docId, data) {
        if (!this.isReady) {
            throw new Error('Database service is not available. Please check your configuration and try again.');
        }

        try {
            const docRef = db.collection(collection).doc(docId);
            await docRef.update(data);
            return { success: true };
        } catch (error) {
            console.error('Database update error:', error);
            throw error;
        }
    }

    // Delete a document from a collection
    async delete(collection, docId) {
        if (!this.isReady) {
            throw new Error('Database service is not available. Please check your configuration and try again.');
        }

        try {
            const docRef = db.collection(collection).doc(docId);
            await docRef.delete();
            return { success: true };
        } catch (error) {
            console.error('Database delete error:', error);
            throw error;
        }
    }

    // Query documents in a collection
    async query(collection, filters = []) {
        if (!this.isReady) {
            throw new Error('Database service is not available. Please check your configuration and try again.');
        }

        try {
            let query = db.collection(collection);
            
            // Apply filters
            filters.forEach(filter => {
                query = query.where(filter.field, filter.operator, filter.value);
            });

            const snapshot = await query.get();
            return snapshot;
        } catch (error) {
            console.error('Database query error:', error);
            throw error;
        }
    }
}

// Export a singleton instance
module.exports = new Database();