const fs = require('fs');
const path = require('path');
const axios = require('axios');

/**
 * File Processing Service
 * Handles extraction of content from uploaded files (PDF, DOCX, TXT)
 * and generates prompts for AI content generation
 */
class FileProcessingService {
    constructor() {
        this.supportedTypes = ['.pdf', '.docx', '.txt'];
        this.maxFileSize = 10 * 1024 * 1024; // 10MB
        this.maxFiles = 5;
    }

    /**
     * Validate uploaded files
     * @param {Array} files - Array of uploaded files
     * @returns {Object} Validation result
     */
    validateFiles(files) {
        const errors = [];
        
        if (!files || files.length === 0) {
            return { valid: false, errors: ['No files provided'] };
        }
        
        if (files.length > this.maxFiles) {
            errors.push(`Maximum ${this.maxFiles} files allowed`);
        }
        
        files.forEach((file, index) => {
            // Check file size
            if (file.size > this.maxFileSize) {
                errors.push(`File ${index + 1} (${file.originalname}) exceeds 10MB limit`);
            }
            
            // Check file type
            const ext = path.extname(file.originalname).toLowerCase();
            if (!this.supportedTypes.includes(ext)) {
                errors.push(`File ${index + 1} (${file.originalname}) has unsupported format. Supported: PDF, DOCX, TXT`);
            }
        });
        
        return {
            valid: errors.length === 0,
            errors: errors
        };
    }

    /**
     * Extract content from uploaded files
     * @param {Array} files - Array of uploaded files
     * @returns {Promise<Array>} Array of extracted content
     */
    async extractContent(files) {
        const extractedContent = [];
        
        for (const file of files) {
            try {
                const ext = path.extname(file.originalname).toLowerCase();
                let content = '';
                
                switch (ext) {
                    case '.txt':
                        content = await this.extractTextContent(file);
                        break;
                    case '.pdf':
                        content = await this.extractPDFContent(file);
                        break;
                    case '.docx':
                        content = await this.extractDocxContent(file);
                        break;
                    default:
                        throw new Error(`Unsupported file type: ${ext}`);
                }
                
                extractedContent.push({
                    filename: file.originalname,
                    type: ext,
                    content: content,
                    size: file.size,
                    extractedAt: new Date().toISOString()
                });
                
            } catch (error) {
                console.error(`Error extracting content from ${file.originalname}:`, error);
                extractedContent.push({
                    filename: file.originalname,
                    type: path.extname(file.originalname).toLowerCase(),
                    content: '',
                    error: error.message,
                    size: file.size,
                    extractedAt: new Date().toISOString()
                });
            }
        }
        
        return extractedContent;
    }

    /**
     * Extract content from text files
     * @param {Object} file - Uploaded file object
     * @returns {Promise<string>} Extracted text content
     */
    async extractTextContent(file) {
        return new Promise((resolve, reject) => {
            try {
                const content = file.buffer.toString('utf8');
                resolve(content);
            } catch (error) {
                reject(new Error(`Failed to read text file: ${error.message}`));
            }
        });
    }

    /**
     * Extract content from PDF files
     * Note: This is a simplified implementation. In production, you'd use a library like pdf-parse
     * @param {Object} file - Uploaded file object
     * @returns {Promise<string>} Extracted text content
     */
    async extractPDFContent(file) {
        // For now, return a simulated extraction
        // In production, you would use a library like pdf-parse:
        // const pdfParse = require('pdf-parse');
        // const data = await pdfParse(file.buffer);
        // return data.text;
        
        // TODO: Implement actual PDF parsing using pdf-parse library
        throw new Error('PDF extraction requires backend integration with pdf-parse library');
    }

    /**
     * Extract content from DOCX files
     * Note: This is a simplified implementation. In production, you'd use a library like mammoth
     * @param {Object} file - Uploaded file object
     * @returns {Promise<string>} Extracted text content
     */
    async extractDocxContent(file) {
        // For now, return a simulated extraction
        // In production, you would use a library like mammoth:
        // const mammoth = require('mammoth');
        // const result = await mammoth.extractRawText({buffer: file.buffer});
        // return result.value;
        
        // TODO: Implement actual DOCX parsing using mammoth library
        throw new Error('DOCX extraction requires backend integration with mammoth library');
    }

    /**
     * Generate AI prompt from extracted file contents
     * @param {Array} extractedContent - Array of extracted content objects
     * @param {string} additionalPrompt - Additional user prompt
     * @param {string} style - Writing style preference
     * @param {string} tone - Writing tone preference
     * @returns {string} Generated prompt for AI
     */
    generatePromptFromFiles(extractedContent, additionalPrompt = '', style = 'Academic', tone = 'Formal') {
        let prompt = `Based on the following uploaded documents, generate comprehensive ${style.toLowerCase()} content with a ${tone.toLowerCase()} tone:\n\n`;
        
        // Add content from each file
        extractedContent.forEach((file, index) => {
            if (file.content && !file.error) {
                prompt += `Document ${index + 1}: ${file.filename} (${file.type.toUpperCase()})\n`;
                prompt += `Content: ${file.content.substring(0, 1000)}${file.content.length > 1000 ? '...' : ''}\n\n`;
            } else if (file.error) {
                prompt += `Document ${index + 1}: ${file.filename} (${file.type.toUpperCase()}) - Error: ${file.error}\n\n`;
            }
        });
        
        // Add additional instructions if provided
        if (additionalPrompt.trim()) {
            prompt += `Additional Instructions: ${additionalPrompt}\n\n`;
        }
        
        // Add generation guidelines
        prompt += `Please create well-structured, professional content that:\n`;
        prompt += `1. Synthesizes information from the uploaded documents\n`;
        prompt += `2. Maintains ${style.toLowerCase()} writing standards\n`;
        prompt += `3. Uses a ${tone.toLowerCase()} tone throughout\n`;
        prompt += `4. Includes relevant insights and analysis\n`;
        prompt += `5. Provides clear structure with headings and sections\n`;
        prompt += `6. Ensures originality while incorporating source material\n\n`;
        
        return prompt;
    }

    /**
     * Process files and generate content using Gemini 2.5 Flash
     * @param {Array} files - Uploaded files
     * @param {string} additionalPrompt - Additional user prompt
     * @param {string} style - Writing style
     * @param {string} tone - Writing tone
     * @returns {Promise<Object>} Processing result
     */
    async processFilesAndGenerate(files, additionalPrompt = '', style = 'Academic', tone = 'Formal') {
        try {
            // Validate files
            const validation = this.validateFiles(files);
            if (!validation.valid) {
                return {
                    success: false,
                    error: 'File validation failed',
                    details: validation.errors
                };
            }
            
            // Extract content from files
            const extractedContent = await this.extractContent(files);
            
            // Generate prompt
            const prompt = this.generatePromptFromFiles(extractedContent, additionalPrompt, style, tone);
            
            // Simulate Gemini 2.5 Flash API call
            // In production, you would integrate with the actual Gemini API
            const generatedContent = await this.simulateGeminiGeneration(prompt, extractedContent);
            
            return {
                success: true,
                extractedContent: extractedContent,
                prompt: prompt,
                generatedContent: generatedContent,
                metadata: {
                    filesProcessed: files.length,
                    totalSize: files.reduce((sum, file) => sum + file.size, 0),
                    processedAt: new Date().toISOString(),
                    style: style,
                    tone: tone
                }
            };
            
        } catch (error) {
            console.error('Error processing files:', error);
            return {
                success: false,
                error: 'File processing failed',
                details: error.message
            };
        }
    }

    /**
     * Simulate Gemini 2.5 Flash API call
     * @param {string} prompt - Generated prompt
     * @param {Array} extractedContent - Extracted file contents
     * @returns {Promise<string>} Generated content
     */
    async simulateGeminiGeneration(prompt, extractedContent) {
        // Simulate API delay
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const fileNames = extractedContent.map(f => f.filename).join(', ');
        const fileTypes = [...new Set(extractedContent.map(f => f.type))].join(', ');
        
        // TODO: Replace with actual Gemini API integration
        throw new Error('Content generation requires backend integration with Gemini API service');
    }

    /**
     * Clean up temporary files
     * @param {Array} files - Files to clean up
     */
    async cleanupFiles(files) {
        for (const file of files) {
            try {
                if (file.path && fs.existsSync(file.path)) {
                    fs.unlinkSync(file.path);
                }
            } catch (error) {
                console.error(`Error cleaning up file ${file.originalname}:`, error);
            }
        }
    }
}

module.exports = FileProcessingService;