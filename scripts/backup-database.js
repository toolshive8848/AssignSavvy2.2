const admin = require('firebase-admin');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
    const serviceAccount = require('../config/firebase-admin-key.json');
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: process.env.FIREBASE_DATABASE_URL
    });
}

const db = admin.firestore();

// Ensure backup directory exists
const BACKUP_DIR = path.join(__dirname, '../backups');

async function ensureBackupDir() {
    try {
        await fs.access(BACKUP_DIR);
    } catch {
        await fs.mkdir(BACKUP_DIR, { recursive: true });
        console.log(`📁 Created backup directory: ${BACKUP_DIR}`);
    }
}

async function backupCollection(collectionName) {
    try {
        console.log(`📦 Backing up collection: ${collectionName}`);
        
        const snapshot = await db.collection(collectionName).get();
        const data = [];
        
        snapshot.forEach(doc => {
            const docData = doc.data();
            // Convert Firestore timestamps to ISO strings for JSON serialization
            const processedData = processFirestoreData(docData);
            data.push({
                id: doc.id,
                data: processedData
            });
        });
        
        console.log(`✓ Found ${data.length} documents in ${collectionName}`);
        return data;
        
    } catch (error) {
        console.error(`❌ Error backing up collection ${collectionName}:`, error);
        throw error;
    }
}

function processFirestoreData(data) {
    const processed = {};
    
    for (const [key, value] of Object.entries(data)) {
        if (value && typeof value === 'object') {
            if (value.toDate && typeof value.toDate === 'function') {
                // Firestore Timestamp
                processed[key] = {
                    _type: 'timestamp',
                    value: value.toDate().toISOString()
                };
            } else if (value.constructor && value.constructor.name === 'DocumentReference') {
                // Firestore Document Reference
                processed[key] = {
                    _type: 'reference',
                    path: value.path
                };
            } else if (Array.isArray(value)) {
                // Array - process each element
                processed[key] = value.map(item => 
                    typeof item === 'object' ? processFirestoreData(item) : item
                );
            } else {
                // Nested object
                processed[key] = processFirestoreData(value);
            }
        } else {
            processed[key] = value;
        }
    }
    
    return processed;
}

function restoreFirestoreData(data) {
    const restored = {};
    
    for (const [key, value] of Object.entries(data)) {
        if (value && typeof value === 'object' && value._type) {
            switch (value._type) {
                case 'timestamp':
                    restored[key] = admin.firestore.Timestamp.fromDate(new Date(value.value));
                    break;
                case 'reference':
                    restored[key] = db.doc(value.path);
                    break;
                default:
                    restored[key] = value;
            }
        } else if (value && typeof value === 'object' && Array.isArray(value)) {
            restored[key] = value.map(item => 
                typeof item === 'object' ? restoreFirestoreData(item) : item
            );
        } else if (value && typeof value === 'object') {
            restored[key] = restoreFirestoreData(value);
        } else {
            restored[key] = value;
        }
    }
    
    return restored;
}

async function createBackup() {
    try {
        await ensureBackupDir();
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFileName = `backup-${timestamp}.json`;
        const backupPath = path.join(BACKUP_DIR, backupFileName);
        
        console.log('🚀 Starting database backup...');
        
        const collections = ['users', 'assignments', 'payments', 'research_history'];
        const backup = {
            timestamp: new Date().toISOString(),
            collections: {}
        };
        
        for (const collectionName of collections) {
            backup.collections[collectionName] = await backupCollection(collectionName);
        }
        
        await fs.writeFile(backupPath, JSON.stringify(backup, null, 2));
        
        console.log('🎉 Backup completed successfully!');
        console.log(`📄 Backup saved to: ${backupPath}`);
        console.log('\n📊 Backup Summary:');
        
        for (const [collectionName, data] of Object.entries(backup.collections)) {
            console.log(`- ${collectionName}: ${data.length} documents`);
        }
        
        return backupPath;
        
    } catch (error) {
        console.error('❌ Backup failed:', error);
        throw error;
    }
}

async function restoreBackup(backupPath) {
    try {
        console.log(`🔄 Restoring backup from: ${backupPath}`);
        
        const backupData = JSON.parse(await fs.readFile(backupPath, 'utf8'));
        
        console.log(`📅 Backup created: ${backupData.timestamp}`);
        
        for (const [collectionName, documents] of Object.entries(backupData.collections)) {
            console.log(`📦 Restoring collection: ${collectionName}`);
            
            const batch = db.batch();
            let batchCount = 0;
            
            for (const doc of documents) {
                const docRef = db.collection(collectionName).doc(doc.id);
                const restoredData = restoreFirestoreData(doc.data);
                batch.set(docRef, restoredData);
                batchCount++;
                
                // Firestore batch limit is 500 operations
                if (batchCount >= 500) {
                    await batch.commit();
                    console.log(`✓ Committed batch of ${batchCount} documents`);
                    batchCount = 0;
                }
            }
            
            if (batchCount > 0) {
                await batch.commit();
                console.log(`✓ Committed final batch of ${batchCount} documents`);
            }
            
            console.log(`✓ Restored ${documents.length} documents to ${collectionName}`);
        }
        
        console.log('🎉 Restore completed successfully!');
        
    } catch (error) {
        console.error('❌ Restore failed:', error);
        throw error;
    }
}

async function listBackups() {
    try {
        await ensureBackupDir();
        
        const files = await fs.readdir(BACKUP_DIR);
        const backupFiles = files.filter(file => file.startsWith('backup-') && file.endsWith('.json'));
        
        if (backupFiles.length === 0) {
            console.log('📭 No backups found.');
            return;
        }
        
        console.log('📋 Available backups:');
        
        for (const file of backupFiles.sort().reverse()) {
            const filePath = path.join(BACKUP_DIR, file);
            const stats = await fs.stat(filePath);
            const size = (stats.size / 1024).toFixed(2);
            
            console.log(`  📄 ${file} (${size} KB, ${stats.mtime.toLocaleString()})`);
        }
        
    } catch (error) {
        console.error('❌ Error listing backups:', error);
        throw error;
    }
}

// Command line interface
const command = process.argv[2];
const backupFile = process.argv[3];

switch (command) {
    case 'create':
        createBackup().then(() => process.exit(0)).catch(() => process.exit(1));
        break;
    case 'restore':
        if (!backupFile) {
            console.error('❌ Please specify a backup file to restore');
            console.log('Usage: node backup-database.js restore <backup-file>');
            process.exit(1);
        }
        const restorePath = path.isAbsolute(backupFile) ? backupFile : path.join(BACKUP_DIR, backupFile);
        restoreBackup(restorePath).then(() => process.exit(0)).catch(() => process.exit(1));
        break;
    case 'list':
        listBackups().then(() => process.exit(0)).catch(() => process.exit(1));
        break;
    default:
        console.log('Usage: node backup-database.js [create|restore|list]');
        console.log('  create           - Create a new backup');
        console.log('  restore <file>   - Restore from a backup file');
        console.log('  list             - List available backups');
        process.exit(1);
}

module.exports = { createBackup, restoreBackup, listBackups };