/**
 * Content Validation Service
 * Provides quality assurance checks for generated content
 */

class ContentValidator {
    constructor() {
        this.minWordThreshold = 0.8; // Content should be at least 80% of requested length
        this.maxWordThreshold = 1.2; // Content should not exceed 120% of requested length
    }

    /**
     * Validate generated content for quality and requirements
     * @param {string} content - The generated content
     * @param {Object} requirements - Original requirements
     * @returns {Object} Validation result
     */
    validateContent(content, requirements) {
        const validation = {
            isValid: true,
            issues: [],
            warnings: [],
            metrics: {},
            suggestions: []
        };

        try {
            // Basic content checks
            this._validateBasicRequirements(content, requirements, validation);
            
            // Word count validation
            this._validateWordCount(content, requirements.wordCount, validation);
            
            // Structure validation
            this._validateStructure(content, validation);
            
            // Content quality checks
            this._validateQuality(content, validation);
            
            // Style and tone validation
            this._validateStyleAndTone(content, requirements, validation);

            // Calculate overall metrics
            validation.metrics = this._calculateMetrics(content);

        } catch (error) {
            validation.isValid = false;
            validation.issues.push(`Validation error: ${error.message}`);
        }

        return validation;
    }

    /**
     * Validate basic content requirements
     */
    _validateBasicRequirements(content, requirements, validation) {
        // Check if content exists
        if (!content || content.trim().length === 0) {
            validation.isValid = false;
            validation.issues.push('Content is empty or missing');
            return;
        }

        // Check minimum content length
        if (content.trim().length < 50) {
            validation.isValid = false;
            validation.issues.push('Content is too short (minimum 50 characters)');
        }

        // Check for placeholder text
        const placeholders = ['[placeholder]', '[content]', '[insert]', 'lorem ipsum'];
        const hasPlaceholders = placeholders.some(placeholder => 
            content.toLowerCase().includes(placeholder)
        );
        
        if (hasPlaceholders) {
            validation.isValid = false;
            validation.issues.push('Content contains placeholder text');
        }
    }

    /**
     * Validate word count against requirements
     */
    _validateWordCount(content, targetWordCount, validation) {
        const actualWordCount = this._countWords(content);
        const minWords = Math.floor(targetWordCount * this.minWordThreshold);
        const maxWords = Math.ceil(targetWordCount * this.maxWordThreshold);

        validation.metrics.actualWordCount = actualWordCount;
        validation.metrics.targetWordCount = targetWordCount;
        validation.metrics.wordCountAccuracy = (actualWordCount / targetWordCount) * 100;

        if (actualWordCount < minWords) {
            validation.isValid = false;
            validation.issues.push(
                `Content is too short: ${actualWordCount} words (minimum: ${minWords})`
            );
        } else if (actualWordCount > maxWords) {
            validation.warnings.push(
                `Content exceeds target: ${actualWordCount} words (maximum: ${maxWords})`
            );
        }
    }

    /**
     * Validate content structure
     */
    _validateStructure(content, validation) {
        const paragraphs = content.split('\n\n').filter(p => p.trim().length > 0);
        const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);

        validation.metrics.paragraphCount = paragraphs.length;
        validation.metrics.sentenceCount = sentences.length;

        // Check for proper paragraph structure
        if (paragraphs.length < 3) {
            validation.warnings.push('Content has fewer than 3 paragraphs');
        }

        // Check for very long paragraphs
        const longParagraphs = paragraphs.filter(p => this._countWords(p) > 200);
        if (longParagraphs.length > 0) {
            validation.warnings.push(`${longParagraphs.length} paragraph(s) exceed 200 words`);
        }

        // Check for very short paragraphs
        const shortParagraphs = paragraphs.filter(p => this._countWords(p) < 20);
        if (shortParagraphs.length > paragraphs.length * 0.3) {
            validation.warnings.push('Many paragraphs are very short (< 20 words)');
        }
    }

    /**
     * Validate content quality
     */
    _validateQuality(content, validation) {
        // Check for repetitive content
        const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
        const uniqueSentences = new Set(sentences.map(s => s.trim().toLowerCase()));
        
        if (sentences.length > 0 && uniqueSentences.size / sentences.length < 0.8) {
            validation.warnings.push('Content may contain repetitive sentences');
        }

        // Check for proper capitalization
        const properCapitalization = /^[A-Z]/.test(content.trim());
        if (!properCapitalization) {
            validation.issues.push('Content should start with a capital letter');
        }

        // Check for basic punctuation
        const hasPunctuation = /[.!?]$/.test(content.trim());
        if (!hasPunctuation) {
            validation.warnings.push('Content should end with proper punctuation');
        }

        // Check for excessive capitalization
        const capsWords = content.match(/\b[A-Z]{2,}\b/g) || [];
        if (capsWords.length > 5) {
            validation.warnings.push('Content contains excessive capitalization');
        }
    }

    /**
     * Validate style and tone requirements
     */
    _validateStyleAndTone(content, requirements, validation) {
        const style = requirements.style || 'Academic';
        const tone = requirements.tone || 'Formal';

        // Academic style checks
        if (style === 'Academic') {
            const hasThirdPerson = !/\b(I|we|you|your)\b/i.test(content);
            if (!hasThirdPerson) {
                validation.warnings.push('Academic style should avoid first/second person');
            }
        }

        // Formal tone checks
        if (tone === 'Formal') {
            const informalWords = ['gonna', 'wanna', 'kinda', 'sorta', 'yeah', 'ok', 'okay'];
            const hasInformalWords = informalWords.some(word => 
                content.toLowerCase().includes(word)
            );
            
            if (hasInformalWords) {
                validation.warnings.push('Formal tone should avoid informal language');
            }
        }

        // Creative style checks
        if (style === 'Creative') {
            const hasVariedSentences = this._checkSentenceVariety(content);
            if (!hasVariedSentences) {
                validation.suggestions.push('Consider varying sentence structure for creative writing');
            }
        }
    }

    /**
     * Calculate content metrics
     */
    _calculateMetrics(content) {
        const words = this._countWords(content);
        const characters = content.length;
        const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
        const paragraphs = content.split('\n\n').filter(p => p.trim().length > 0).length;

        return {
            wordCount: words,
            characterCount: characters,
            sentenceCount: sentences,
            paragraphCount: paragraphs,
            averageWordsPerSentence: sentences > 0 ? Math.round(words / sentences) : 0,
            averageWordsPerParagraph: paragraphs > 0 ? Math.round(words / paragraphs) : 0,
            readabilityScore: this._calculateReadabilityScore(words, sentences, content)
        };
    }

    /**
     * Count words in text
     */
    _countWords(text) {
        return text.trim().split(/\s+/).filter(word => word.length > 0).length;
    }

    /**
     * Check sentence variety for creative writing
     */
    _checkSentenceVariety(content) {
        const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
        const lengths = sentences.map(s => this._countWords(s));
        
        if (lengths.length < 3) return true;
        
        const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
        const variance = lengths.reduce((sum, len) => sum + Math.pow(len - avgLength, 2), 0) / lengths.length;
        
        return variance > 10; // Good variety if variance > 10
    }

    /**
     * Calculate basic readability score
     */
    _calculateReadabilityScore(words, sentences, content) {
        if (sentences === 0) return 0;
        
        const avgWordsPerSentence = words / sentences;
        const syllables = this._estimateSyllables(content);
        const avgSyllablesPerWord = syllables / words;
        
        // Simplified Flesch Reading Ease formula
        const score = 206.835 - (1.015 * avgWordsPerSentence) - (84.6 * avgSyllablesPerWord);
        return Math.max(0, Math.min(100, Math.round(score)));
    }

    /**
     * Estimate syllable count
     */
    _estimateSyllables(text) {
        const words = text.toLowerCase().match(/\b\w+\b/g) || [];
        return words.reduce((total, word) => {
            const syllableCount = word.match(/[aeiouy]+/g)?.length || 1;
            return total + Math.max(1, syllableCount);
        }, 0);
    }

    /**
     * Generate improvement suggestions
     */
    generateSuggestions(validation) {
        const suggestions = [...validation.suggestions];
        
        if (validation.metrics.averageWordsPerSentence > 25) {
            suggestions.push('Consider breaking down long sentences for better readability');
        }
        
        if (validation.metrics.paragraphCount < 3) {
            suggestions.push('Add more paragraphs to improve content structure');
        }
        
        if (validation.metrics.readabilityScore < 30) {
            suggestions.push('Content may be difficult to read - consider simplifying language');
        }
        
        return suggestions;
    }
}

module.exports = new ContentValidator();