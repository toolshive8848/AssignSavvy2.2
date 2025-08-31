const llmService = require('./llmService');

class ContentProcessor {
    constructor() {
        this.sectionWeights = {
            introduction: 0.15,  // 15% of total word count
            body: 0.70,          // 70% of total word count
            conclusion: 0.15     // 15% of total word count
        };
    }

    /**
     * Generate multi-part essay with structured sections
     * @param {string} prompt - User's writing request
     * @param {string} style - Writing style
     * @param {string} tone - Writing tone
     * @param {number} wordCount - Target word count
     * @returns {Promise<Object>} Structured essay content
     */
    async generateStructuredEssay(prompt, style = 'Academic', tone = 'Formal', wordCount = 1000) {
        try {
            // Calculate word counts for each section
            const sectionWordCounts = this.calculateSectionWordCounts(wordCount);
            
            // Generate each section separately for better control
            const sectionsResult = await this.generateAllSections(
                prompt, 
                style, 
                tone, 
                sectionWordCounts
            );

            // Extract sections and metadata
            const sections = sectionsResult.sections;
            const generationMetadata = sectionsResult.metadata;

            // Combine sections into final essay
            const fullEssay = this.combineEssaySections(sections);

            // Validate and adjust content
            const processedContent = await this.validateAndAdjustContent(
                fullEssay, 
                wordCount, 
                style
            );

            return {
                success: true,
                content: processedContent,
                sections: sections,
                source: generationMetadata.fallbackUsed ? 'mixed' : 'llm',
                fallbackUsed: generationMetadata.fallbackUsed,
                generationTime: generationMetadata.totalGenerationTime,
                attempt: generationMetadata.maxAttempts,
                metadata: {
                    totalWordCount: this.countWords(processedContent),
                    targetWordCount: wordCount,
                    style: style,
                    tone: tone,
                    sectionsGenerated: Object.keys(sections).length,
                    generationSources: generationMetadata.sources,
                    totalAttempts: generationMetadata.totalAttempts
                }
            };
        } catch (error) {
            console.error('Content processing error:', error);
            throw new Error('Failed to generate structured essay');
        }
    }

    /**
     * Calculate word counts for each section
     */
    calculateSectionWordCounts(totalWordCount) {
        return {
            introduction: Math.floor(totalWordCount * this.sectionWeights.introduction),
            body: Math.floor(totalWordCount * this.sectionWeights.body),
            conclusion: Math.floor(totalWordCount * this.sectionWeights.conclusion)
        };
    }

    /**
     * Generate all essay sections
     */
    async generateAllSections(prompt, style, tone, sectionWordCounts) {
        const sections = {};
        let generationMetadata = {
            totalAttempts: 0,
            fallbackUsed: false,
            sources: [],
            totalGenerationTime: 0,
            maxAttempts: 1
        };

        // Generate introduction
        const introResult = await this.generateSection(
            'introduction',
            prompt,
            style,
            tone,
            sectionWordCounts.introduction
        );
        sections.introduction = typeof introResult === 'string' ? introResult : introResult.content;
        
        // Track generation metadata
        if (typeof introResult === 'object') {
            generationMetadata.totalAttempts += introResult.attempt || 1;
            generationMetadata.fallbackUsed = generationMetadata.fallbackUsed || introResult.fallbackUsed;
            generationMetadata.sources.push(introResult.source);
            generationMetadata.totalGenerationTime += introResult.generationTime || 0;
            generationMetadata.maxAttempts = Math.max(generationMetadata.maxAttempts, introResult.attempt || 1);
        }

        // Generate main body (can be split into multiple parts)
        const bodyResult = await this.generateSection(
            'body',
            prompt,
            style,
            tone,
            sectionWordCounts.body
        );
        sections.body = typeof bodyResult === 'string' ? bodyResult : bodyResult.content;
        
        // Track generation metadata
        if (typeof bodyResult === 'object') {
            generationMetadata.totalAttempts += bodyResult.attempt || 1;
            generationMetadata.fallbackUsed = generationMetadata.fallbackUsed || bodyResult.fallbackUsed;
            generationMetadata.sources.push(bodyResult.source);
            generationMetadata.totalGenerationTime += bodyResult.generationTime || 0;
            generationMetadata.maxAttempts = Math.max(generationMetadata.maxAttempts, bodyResult.attempt || 1);
        }

        // Generate conclusion
        const conclusionResult = await this.generateSection(
            'conclusion',
            prompt,
            style,
            tone,
            sectionWordCounts.conclusion
        );
        sections.conclusion = typeof conclusionResult === 'string' ? conclusionResult : conclusionResult.content;
        
        // Track generation metadata
        if (typeof conclusionResult === 'object') {
            generationMetadata.totalAttempts += conclusionResult.attempt || 1;
            generationMetadata.fallbackUsed = generationMetadata.fallbackUsed || conclusionResult.fallbackUsed;
            generationMetadata.sources.push(conclusionResult.source);
            generationMetadata.totalGenerationTime += conclusionResult.generationTime || 0;
            generationMetadata.maxAttempts = Math.max(generationMetadata.maxAttempts, conclusionResult.attempt || 1);
        }

        return {
            sections,
            metadata: generationMetadata
        };
    }

    /**
     * Generate a specific section of the essay
     */
    async generateSection(sectionType, prompt, style, tone, wordCount) {
        const sectionPrompts = {
            introduction: `Write an engaging introduction for an essay about: ${prompt}. The introduction should hook the reader, provide background context, and present a clear thesis statement. Target length: ${wordCount} words.`,
            
            body: `Write the main body content for an essay about: ${prompt}. Include detailed analysis, evidence, examples, and multiple well-developed paragraphs that support the main argument. Use clear topic sentences and smooth transitions. Target length: ${wordCount} words.`,
            
            conclusion: `Write a strong conclusion for an essay about: ${prompt}. Summarize the main points, restate the thesis in new words, and provide final insights or call to action. Target length: ${wordCount} words.`
        };

        const sectionPrompt = sectionPrompts[sectionType] || sectionPrompts.body;
        
        return await llmService.generateContent(
            sectionPrompt,
            style,
            tone,
            wordCount
        );
    }

    /**
     * Combine essay sections into final document
     */
    combineEssaySections(sections) {
        let essay = '';
        
        if (sections.introduction) {
            essay += sections.introduction + '\n\n';
        }
        
        if (sections.body) {
            essay += sections.body + '\n\n';
        }
        
        if (sections.conclusion) {
            essay += sections.conclusion;
        }
        
        return essay.trim();
    }

    /**
     * Validate and adjust content quality
     */
    async validateAndAdjustContent(content, targetWordCount, style) {
        const actualWordCount = this.countWords(content);
        const wordCountDifference = Math.abs(actualWordCount - targetWordCount);
        const tolerance = targetWordCount * 0.1; // 10% tolerance

        // If word count is significantly off, log for monitoring
        if (wordCountDifference > tolerance) {
            console.log(`Word count variance: Target ${targetWordCount}, Actual ${actualWordCount}`);
        }

        // Add formatting improvements
        let processedContent = this.improveFormatting(content, style);
        
        // Ensure proper structure
        processedContent = this.ensureProperStructure(processedContent);
        
        return processedContent;
    }

    /**
     * Improve content formatting
     */
    improveFormatting(content, style) {
        let formatted = content;
        
        // Ensure proper paragraph spacing
        formatted = formatted.replace(/\n{3,}/g, '\n\n');
        
        // Add proper heading formatting if missing
        if (!formatted.includes('#') && style === 'Academic') {
            // Add basic structure if completely missing
            const lines = formatted.split('\n\n');
            if (lines.length >= 3) {
                lines[0] = '## Introduction\n\n' + lines[0];
                lines[lines.length - 1] = '## Conclusion\n\n' + lines[lines.length - 1];
                
                // Add body section header if there are middle paragraphs
                if (lines.length > 3) {
                    lines[1] = '## Main Analysis\n\n' + lines[1];
                }
                
                formatted = lines.join('\n\n');
            }
        }
        
        return formatted;
    }

    /**
     * Ensure proper essay structure
     */
    ensureProperStructure(content) {
        // Basic structure validation
        const paragraphs = content.split('\n\n').filter(p => p.trim().length > 0);
        
        if (paragraphs.length < 3) {
            console.warn('Essay may lack proper structure (minimum 3 paragraphs expected)');
        }
        
        return content;
    }

    /**
     * Count words in text
     */
    countWords(text) {
        if (!text || typeof text !== 'string') return 0;
        
        return text
            .replace(/[^\w\s]/g, ' ')  // Replace punctuation with spaces
            .split(/\s+/)              // Split on whitespace
            .filter(word => word.length > 0)  // Filter empty strings
            .length;
    }

    /**
     * Generate content outline for planning
     */
    async generateOutline(prompt, style, tone) {
        const outlinePrompt = `Create a detailed outline for an essay about: ${prompt}. Include main sections, key points, and supporting arguments. Format as a structured list.`;
        
        return await llmService.generateContent(
            outlinePrompt,
            style,
            tone,
            300  // Shorter word count for outline
        );
    }
}

module.exports = new ContentProcessor();