-- Drop existing tables if they exist
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS assignments;
DROP TABLE IF EXISTS users;

-- Users table
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    credits INTEGER DEFAULT 200,
    is_premium BOOLEAN DEFAULT 0,
    subscription_end_date DATETIME NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Assignments table
CREATE TABLE assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    word_count INTEGER NOT NULL,
    citation_style TEXT NOT NULL DEFAULT 'APA',
    content TEXT,
    originality_score REAL DEFAULT NULL,
    status TEXT DEFAULT 'pending',
    credits_used INTEGER DEFAULT 0,
    file_path TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Payments table
CREATE TABLE payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    currency TEXT DEFAULT 'USD',
    status TEXT DEFAULT 'pending',
    stripe_payment_intent_id TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- User usage tracking table
CREATE TABLE IF NOT EXISTS user_usage_tracking (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    word_count INTEGER NOT NULL,
    credits_used INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Drafts table for saving work in progress
CREATE TABLE IF NOT EXISTS drafts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title VARCHAR(255) NOT NULL,
    content TEXT,
    prompt TEXT,
    style VARCHAR(50) DEFAULT 'Academic',
    tone VARCHAR(50) DEFAULT 'Formal',
    target_word_count INTEGER,
    current_word_count INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'draft', -- draft, completed, archived
    version INTEGER DEFAULT 1,
    parent_draft_id INTEGER NULL, -- For version control
    auto_saved BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (parent_draft_id) REFERENCES drafts(id)
);

-- Draft versions table for detailed version history
CREATE TABLE IF NOT EXISTS draft_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    draft_id INTEGER NOT NULL,
    version_number INTEGER NOT NULL,
    content TEXT,
    change_summary TEXT,
    word_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (draft_id) REFERENCES drafts(id),
    UNIQUE(draft_id, version_number)
);

-- Auto-save sessions table
CREATE TABLE IF NOT EXISTS auto_save_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    draft_id INTEGER NOT NULL,
    session_token VARCHAR(255) NOT NULL,
    last_auto_save DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (draft_id) REFERENCES drafts(id)
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_drafts_user_id ON drafts(user_id);
CREATE INDEX IF NOT EXISTS idx_drafts_status ON drafts(status);
CREATE INDEX IF NOT EXISTS idx_drafts_updated_at ON drafts(updated_at);
CREATE INDEX IF NOT EXISTS idx_draft_versions_draft_id ON draft_versions(draft_id);
CREATE INDEX IF NOT EXISTS idx_auto_save_sessions_draft_id ON auto_save_sessions(draft_id);
CREATE INDEX IF NOT EXISTS idx_auto_save_sessions_token ON auto_save_sessions(session_token);

-- Insert sample data for testing
INSERT INTO users (email, password_hash, name, credits, is_premium) VALUES 
('test@example.com', '$2a$10$N9qo8uLOickgx2ZMRZoMye1K6zVv/9FKc6kT4xbFl7xqR2e6cJgKu', 'Test User', 200, 0),
('premium@example.com', '$2a$10$N9qo8uLOickgx2ZMRZoMye1K6zVv/9FKc6kT4xbFl7xqR2e6cJgKu', 'Premium User', 2000, 1);