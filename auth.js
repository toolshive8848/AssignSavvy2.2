const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Register endpoint
router.post('/register', async (req, res) => {
    const { name, email, password } = req.body;
    const db = req.app.locals.db;

    if (!name || !email || !password) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    try {
        // Check if user already exists
        db.get('SELECT id FROM users WHERE email = ?', [email], async (err, row) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Database error' });
            }

            if (row) {
                return res.status(400).json({ error: 'User already exists with this email' });
            }

            // Hash password
            const saltRounds = 10;
            const passwordHash = await bcrypt.hash(password, saltRounds);

            // Insert new user
            db.run(
                'INSERT INTO users (name, email, password_hash, credits, is_premium) VALUES (?, ?, ?, ?, ?)',
                [name, email, passwordHash, 200, 0],
                function(err) {
                    if (err) {
                        console.error('Database error:', err);
                        return res.status(500).json({ error: 'Error creating user' });
                    }

                    // Generate JWT token
                    const token = jwt.sign(
                        { userId: this.lastID, email: email },
                        JWT_SECRET,
                        { expiresIn: '7d' }
                    );

                    res.status(201).json({
                        message: 'User created successfully',
                        token: token,
                        user: {
                            id: this.lastID,
                            name: name,
                            email: email,
                            credits: 200,
                            is_premium: false
                        }
                    });
                }
            );
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Login endpoint
router.post('/login', (req, res) => {
    const { email, password } = req.body;
    const db = req.app.locals.db;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }

    db.get(
        'SELECT id, name, email, password_hash, credits, is_premium FROM users WHERE email = ?',
        [email],
        async (err, user) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Database error' });
            }

            if (!user) {
                return res.status(401).json({ error: 'Invalid email or password' });
            }

            try {
                // Check password
                const isValidPassword = await bcrypt.compare(password, user.password_hash);
                
                if (!isValidPassword) {
                    return res.status(401).json({ error: 'Invalid email or password' });
                }

                // Generate JWT token
                const token = jwt.sign(
                    { userId: user.id, email: user.email },
                    JWT_SECRET,
                    { expiresIn: '7d' }
                );

                res.json({
                    message: 'Login successful',
                    token: token,
                    user: {
                        id: user.id,
                        name: user.name,
                        email: user.email,
                        credits: user.credits,
                        is_premium: user.is_premium === 1
                    }
                });
            } catch (error) {
                console.error('Login error:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        }
    );
});

// Verify token endpoint
router.get('/verify', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const db = req.app.locals.db;

        db.get(
            'SELECT id, name, email, credits, is_premium FROM users WHERE id = ?',
            [decoded.userId],
            (err, user) => {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).json({ error: 'Database error' });
                }

                if (!user) {
                    return res.status(401).json({ error: 'User not found' });
                }

                res.json({
                    user: {
                        id: user.id,
                        name: user.name,
                        email: user.email,
                        credits: user.credits,
                        is_premium: user.is_premium === 1
                    }
                });
            }
        );
    } catch (error) {
        console.error('Token verification error:', error);
        res.status(401).json({ error: 'Invalid token' });
    }
});

module.exports = router;