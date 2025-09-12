// Firebase Web Configuration
// Browser-compatible Firebase initialization

// Firebase configuration object
const firebaseConfig = {
  apiKey: "demo-api-key",
  authDomain: "assignsavvy-demo.firebaseapp.com",
  projectId: "assignsavvy-demo",
  storageBucket: "assignsavvy-demo.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef123456"
};

// Google Auth Provider
let googleProvider = null;

// Initialize Firebase
try {
  // Check if Firebase is already initialized
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
    console.log('Firebase initialized successfully');
    
    // Initialize Google Auth Provider
    googleProvider = new firebase.auth.GoogleAuthProvider();
    googleProvider.addScope('email');
    googleProvider.addScope('profile');
    
    console.log('Google Auth Provider initialized');
  } else {
    console.log('Firebase already initialized');
  }
} catch (error) {
  console.error('Error initializing Firebase:', error);
  
  // Fallback: Create mock Firebase object for demo purposes
  window.firebase = {
    apps: [],
    auth: () => ({
      currentUser: null,
      onAuthStateChanged: (callback) => {
        // Simulate no user for demo
        setTimeout(() => callback(null), 100);
        return () => {}; // unsubscribe function
      },
      signInWithEmailAndPassword: () => Promise.reject(new Error('Demo mode - authentication disabled')),
      signOut: () => Promise.resolve()
    }),
    firestore: () => ({
      collection: () => ({
        doc: () => ({
          get: () => Promise.resolve({
            exists: false,
            data: () => ({})
          }),
          update: () => Promise.resolve(),
          set: () => Promise.resolve()
        }),
        where: () => ({
          orderBy: () => ({
            limit: () => ({
              get: () => Promise.resolve({
                docs: []
              })
            })
          })
        }),
        add: () => Promise.resolve({ id: 'demo-id' })
      }),
      FieldValue: {
        increment: (value) => value,
        serverTimestamp: () => new Date()
      }
    })
  };
  
  console.log('Using Firebase demo mode');
}

// Google Authentication Functions
window.signInWithGoogle = async function() {
  try {
    if (!googleProvider) {
      throw new Error('Google Auth Provider not initialized');
    }
    
    const result = await firebase.auth().signInWithPopup(googleProvider);
    const user = result.user;
    
    console.log('Google sign-in successful:', user.email);
    
    // Store user session
    localStorage.setItem('userSession', JSON.stringify({
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
      provider: 'google'
    }));
    
    return {
      success: true,
      user: {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL
      }
    };
  } catch (error) {
    console.error('Google sign-in error:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

window.signOutUser = async function() {
  try {
    await firebase.auth().signOut();
    localStorage.removeItem('userSession');
    console.log('User signed out successfully');
    return { success: true };
  } catch (error) {
    console.error('Sign out error:', error);
    return { success: false, error: error.message };
  }
};

// Export for global access
window.firebaseConfig = firebaseConfig;
window.googleProvider = googleProvider;