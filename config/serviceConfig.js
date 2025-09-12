/**
 * Service Configuration System
 * Centralized configuration for all service hardcoded data
 */

class ServiceConfig {
    constructor() {
        this.config = {
            // Source Validator Configuration
            sourceValidator: {
                trustedDomains: [
                    'scholar.google.com', 'pubmed.ncbi.nlm.nih.gov', 'jstor.org',
                    'springer.com', 'nature.com', 'science.org', 'ieee.org',
                    'arxiv.org', 'researchgate.net', 'sciencedirect.com'
                ],
                sourcePatterns: {
                    academic: /\.(edu|ac\.[a-z]{2}|org)$/i,
                    government: /\.(gov|mil)$/i,
                    news: /\.(com|net|org)$/i,
                    commercial: /\.(com|biz|info)$/i
                },
                datePatterns: [
                    /\b(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})\b/,
                    /\b(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})\b/,
                    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/i
                ]
            },
            
            // Citation Generator Configuration
            citationGenerator: {
                fieldMappings: {
                    book: ['title', 'author', 'publisher', 'year', 'isbn'],
                    journal: ['title', 'author', 'journal', 'volume', 'issue', 'pages', 'year', 'doi'],
                    website: ['title', 'author', 'url', 'accessDate', 'publishDate'],
                    government: ['title', 'author', 'agency', 'year', 'url'],
                    conference: ['title', 'author', 'conference', 'year', 'pages'],
                    thesis: ['title', 'author', 'institution', 'year', 'type']
                }
            },
            
            // Content Validator Configuration
            contentValidator: {
                informalWords: [
                    'gonna', 'wanna', 'gotta', 'kinda', 'sorta', 'dunno',
                    'yeah', 'nah', 'ok', 'okay', 'cool', 'awesome', 'super',
                    'really', 'very', 'pretty', 'stuff', 'things', 'guys',
                    'folks', 'basically', 'literally', 'actually'
                ],
                placeholderPatterns: [
                    /\[placeholder\]/gi,
                    /\[.*?\]/g,
                    /TODO:/gi,
                    /TBD/gi,
                    /XXX/gi,
                    /\{\{.*?\}\}/g
                ]
            },
            
            // Research Service Configuration
            researchService: {
                stopWords: [
                    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at',
                    'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were',
                    'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does',
                    'did', 'will', 'would', 'could', 'should', 'may', 'might',
                    'can', 'this', 'that', 'these', 'those', 'research',
                    'study', 'analysis', 'paper', 'article', 'journal',
                    'academic', 'scholar'
                ]
            }
        };
    }
    
    /**
     * Get configuration for a specific service
     * @param {string} serviceName - Name of the service
     * @returns {Object} Service configuration
     */
    getServiceConfig(serviceName) {
        return this.config[serviceName] || {};
    }
    
    /**
     * Get specific configuration value
     * @param {string} serviceName - Name of the service
     * @param {string} configKey - Configuration key
     * @returns {*} Configuration value
     */
    getConfig(serviceName, configKey) {
        const serviceConfig = this.getServiceConfig(serviceName);
        return serviceConfig[configKey];
    }
    
    /**
     * Update configuration
     * @param {string} serviceName - Name of the service
     * @param {string} configKey - Configuration key
     * @param {*} value - New value
     */
    updateConfig(serviceName, configKey, value) {
        if (!this.config[serviceName]) {
            this.config[serviceName] = {};
        }
        this.config[serviceName][configKey] = value;
    }
    
    /**
     * Load configuration from external source (file, database, etc.)
     * @param {string} source - Configuration source
     * @returns {Promise<void>}
     */
    async loadFromSource(source) {
        try {
            // TODO: Implement loading from external sources
            // This could load from JSON files, environment variables, database, etc.
            console.log(`Loading configuration from: ${source}`);
        } catch (error) {
            console.error('Error loading configuration:', error);
        }
    }
}

// Singleton instance
const serviceConfig = new ServiceConfig();

module.exports = serviceConfig;