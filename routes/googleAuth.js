const express = require('express');
const jwt = require('jsonwebtoken');
const admin = require('firebase-admin');
const router = express.Router();

// Google OAuth authentication endpoint
router.post('/google', async (req, res) => {
  try {
    const { uid, email, displayName, photoURL } = req.body;
    
    if (!uid || !email) {
      return res.status(400).json({
        success: false,
        message: 'Missing required Google user data'
      });
    }
    
    // Verify the Firebase ID token (in production, you'd verify the actual token)
    // For now, we'll trust the frontend verification
    
    // Check if user exists in Firestore
    const userRef = admin.firestore().collection('users').doc(uid);
    const userDoc = await userRef.get();
    
    let userData;
    
    if (!userDoc.exists) {
      // Create new user
      userData = {
        uid,
        email,
        displayName: displayName || email.split('@')[0],
        photoURL: photoURL || null,
        provider: 'google',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        lastLoginAt: admin.firestore.FieldValue.serverTimestamp(),
        credits: 200, // Default free credits
        plan: 'free',
        isActive: true
      };
      
      await userRef.set(userData);
      console.log('New Google user created:', email);
    } else {
      // Update existing user's last login
      userData = userDoc.data();
      await userRef.update({
        lastLoginAt: admin.firestore.FieldValue.serverTimestamp(),
        displayName: displayName || userData.displayName,
        photoURL: photoURL || userData.photoURL
      });
      console.log('Existing Google user logged in:', email);
    }
    
    // Generate JWT token
    const token = jwt.sign(
      {
        uid: userData.uid,
        email: userData.email,
        provider: 'google'
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
    
    // Return success response
    res.json({
      success: true,
      message: 'Google authentication successful',
      token,
      user: {
        uid: userData.uid,
        email: userData.email,
        displayName: userData.displayName,
        photoURL: userData.photoURL,
        credits: userData.credits,
        plan: userData.plan,
        provider: 'google'
      }
    });
    
  } catch (error) {
    console.error('Google OAuth error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during Google authentication',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;