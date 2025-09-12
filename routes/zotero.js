const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const ZoteroCSLProcessor = require('../services/zoteroCSL');

// Initialize Zotero CSL Processor
const zoteroProcessor = new ZoteroCSLProcessor();

/**
 * @route POST /api/zotero/library
 * @desc Load Zotero library items
 * @access Private
 */
router.post('/library', authenticateToken, async (req, res) => {
    try {
        const { libraryId } = req.body;
        
        if (!libraryId) {
            return res.status(400).json({ error: 'Library ID is required' });
        }
        
        // Check if Zotero API key is configured
        if (!process.env.ZOTERO_API_KEY) {
            return res.status(500).json({ 
                error: 'Zotero API key not configured on server',
                message: 'Please contact administrator to configure Zotero integration'
            });
        }
        
        // Fetch library items from Zotero API
        const response = await fetch(`https://api.zotero.org/users/${libraryId}/items?format=json&limit=50`, {
            headers: {
                'Authorization': `Bearer ${process.env.ZOTERO_API_KEY}`,
                'User-Agent': 'Academic Writer Tool/1.0'
            }
        });
        
        if (!response.ok) {
            if (response.status === 403) {
                return res.status(403).json({ 
                    error: 'Access denied to Zotero library',
                    message: 'Please check your library ID and API key permissions'
                });
            }
            throw new Error(`Zotero API error: ${response.statusText}`);
        }
        
        const items = await response.json();
        
        // Filter and format items for display
        const formattedItems = items
            .filter(item => item.data && item.data.itemType !== 'attachment')
            .map(item => ({
                key: item.key,
                title: item.data.title || 'Untitled',
                itemType: item.data.itemType,
                creators: item.data.creators || [],
                date: item.data.date || '',
                url: item.data.url || '',
                DOI: item.data.DOI || '',
                publicationTitle: item.data.publicationTitle || '',
                volume: item.data.volume || '',
                issue: item.data.issue || '',
                pages: item.data.pages || '',
                publisher: item.data.publisher || '',
                place: item.data.place || '',
                abstractNote: item.data.abstractNote || '',
                tags: item.data.tags || []
            }));
        
        res.json({ 
            success: true, 
            items: formattedItems,
            total: formattedItems.length
        });
        
    } catch (error) {
        console.error('Error loading Zotero library:', error);
        res.status(500).json({ 
            error: 'Failed to load Zotero library',
            message: error.message
        });
    }
});

/**
 * @route POST /api/zotero/format
 * @desc Format Zotero item as citation
 * @access Private
 */
router.post('/format', authenticateToken, async (req, res) => {
    try {
        const { item, style = 'apa' } = req.body;
        
        if (!item) {
            return res.status(400).json({ error: 'Item data is required' });
        }
        
        // Format citation using Zotero CSL Processor
        const citation = await zoteroProcessor.formatCitation(item, style);
        
        res.json({ 
            success: true, 
            citation: citation,
            style: style,
            item: {
                title: item.title,
                type: item.itemType
            }
        });
        
    } catch (error) {
        console.error('Error formatting Zotero citation:', error);
        res.status(500).json({ 
            error: 'Failed to format citation',
            message: error.message
        });
    }
});

/**
 * @route GET /api/zotero/styles
 * @desc Get available citation styles
 * @access Private
 */
router.get('/styles', authenticateToken, async (req, res) => {
    try {
        const styles = [
            { id: 'apa', name: 'APA Style', description: 'American Psychological Association 7th edition' },
            { id: 'mla', name: 'MLA Style', description: 'Modern Language Association 9th edition' },
            { id: 'chicago', name: 'Chicago Style', description: 'Chicago Manual of Style 17th edition' },
            { id: 'harvard', name: 'Harvard Style', description: 'Harvard referencing style' },
            { id: 'ieee', name: 'IEEE Style', description: 'Institute of Electrical and Electronics Engineers' },
            { id: 'vancouver', name: 'Vancouver Style', description: 'International Committee of Medical Journal Editors' }
        ];
        
        res.json({ 
            success: true, 
            styles: styles
        });
        
    } catch (error) {
        console.error('Error getting citation styles:', error);
        res.status(500).json({ 
            error: 'Failed to get citation styles',
            message: error.message
        });
    }
});

/**
 * @route POST /api/zotero/search
 * @desc Search Zotero library
 * @access Private
 */
router.post('/search', authenticateToken, async (req, res) => {
    try {
        const { libraryId, query, limit = 20 } = req.body;
        
        if (!libraryId || !query) {
            return res.status(400).json({ error: 'Library ID and search query are required' });
        }
        
        if (!process.env.ZOTERO_API_KEY) {
            return res.status(500).json({ 
                error: 'Zotero API key not configured on server'
            });
        }
        
        // Search Zotero library
        const response = await fetch(`https://api.zotero.org/users/${libraryId}/items?format=json&q=${encodeURIComponent(query)}&limit=${limit}`, {
            headers: {
                'Authorization': `Bearer ${process.env.ZOTERO_API_KEY}`,
                'User-Agent': 'Academic Writer Tool/1.0'
            }
        });
        
        if (!response.ok) {
            throw new Error(`Zotero API error: ${response.statusText}`);
        }
        
        const items = await response.json();
        
        // Format search results
        const formattedItems = items
            .filter(item => item.data && item.data.itemType !== 'attachment')
            .map(item => ({
                key: item.key,
                title: item.data.title || 'Untitled',
                itemType: item.data.itemType,
                creators: item.data.creators || [],
                date: item.data.date || '',
                url: item.data.url || '',
                publicationTitle: item.data.publicationTitle || ''
            }));
        
        res.json({ 
            success: true, 
            items: formattedItems,
            query: query,
            total: formattedItems.length
        });
        
    } catch (error) {
        console.error('Error searching Zotero library:', error);
        res.status(500).json({ 
            error: 'Failed to search Zotero library',
            message: error.message
        });
    }
});

module.exports = router;