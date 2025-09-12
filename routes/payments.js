const express = require('express');
const router = express.Router();
const { admin, db } = require('../config/firebase');

/**
 * Payment Routes for Stripe Integration
 * Handles subscription management, credit purchases, and payment processing
 */

// TODO: Add your Stripe API keys here - Get from https://dashboard.stripe.com/apikeys
// Required for payment processing and subscription management
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); // Add your Stripe secret key
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY; // Add your Stripe publishable key

// Firebase database reference is imported above

/**
 * Create Payment Intent for Credit Purchase
 * POST /api/payments/create-payment-intent
 */
router.post('/create-payment-intent', async (req, res) => {
    try {
        const { amount, currency = 'usd', credits, userId } = req.body;
        
        if (!amount || !credits || !userId) {
            return res.status(400).json({
                error: 'Missing required fields: amount, credits, userId'
            });
        }

        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amount * 100), // Convert to cents
            currency: currency,
            metadata: {
                userId: userId.toString(),
                credits: credits.toString(),
                type: 'credit_purchase'
            }
        });

        res.json({
            clientSecret: paymentIntent.client_secret,
            paymentIntentId: paymentIntent.id
        });
    } catch (error) {
        console.error('Error creating payment intent:', error);
        res.status(500).json({ error: 'Failed to create payment intent' });
    }
});

/**
 * Create Checkout Session for Credit Purchase
 * POST /api/payments/create-checkout-session
 */
router.post('/create-checkout-session', async (req, res) => {
    try {
        const { amount, credits, userId, planType = 'credit_purchase' } = req.body;
        
        if (!amount || !credits || !userId) {
            return res.status(400).json({
                error: 'Missing required fields: amount, credits, userId'
            });
        }

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: `${credits} Credits`,
                        description: `Purchase ${credits} credits for your account`
                    },
                    unit_amount: Math.round(amount * 100) // Convert to cents
                },
                quantity: 1
            }],
            mode: 'payment',
            success_url: `${req.headers.origin}/payment-success.html?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${req.headers.origin}/payment.html?cancelled=true`,
            metadata: {
                userId: userId.toString(),
                credits: credits.toString(),
                type: planType
            }
        });

        res.json({ url: session.url, sessionId: session.id });
    } catch (error) {
        console.error('Error creating checkout session:', error);
        res.status(500).json({ error: 'Failed to create checkout session' });
    }
});

/**
 * Create Subscription Checkout Session for Pro Plan
 * POST /api/payments/create-subscription-checkout
 */
router.post('/create-subscription-checkout', async (req, res) => {
    try {
        const { userId, priceId, planName } = req.body;
        
        if (!userId || !priceId) {
            return res.status(400).json({
                error: 'Missing required fields: userId, priceId'
            });
        }

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price: priceId,
                quantity: 1
            }],
            mode: 'subscription',
            success_url: `${req.headers.origin}/payment-success.html?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${req.headers.origin}/payment.html?cancelled=true`,
            metadata: {
                userId: userId.toString(),
                planName: planName || 'Pro Plan'
            }
        });

        res.json({ url: session.url, sessionId: session.id });
    } catch (error) {
        console.error('Error creating subscription checkout:', error);
        res.status(500).json({ error: 'Failed to create subscription checkout' });
    }
});

/**
 * Webhook Handler for Stripe Events
 * POST /api/payments/webhook
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    
    let event;
    
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    switch (event.type) {
        case 'checkout.session.completed':
            const session = event.data.object;
            await handleCheckoutSessionCompleted(session);
            break;
            
        case 'payment_intent.succeeded':
            const paymentIntent = event.data.object;
            await handleSuccessfulPayment(paymentIntent);
            break;
            
        case 'invoice.payment_succeeded':
            const invoice = event.data.object;
            await handleSuccessfulSubscription(invoice);
            break;
            
        case 'customer.subscription.deleted':
            const subscription = event.data.object;
            await handleCancelledSubscription(subscription);
            break;
            
        default:
            console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
});

/**
 * Get Stripe Publishable Key
 * GET /api/payments/config
 */
router.get('/config', (req, res) => {
    res.json({
        publishableKey: STRIPE_PUBLISHABLE_KEY
    });
});

/**
 * Get User's Payment History
 * GET /api/payments/history/:userId
 */
router.get('/history/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        const paymentsSnapshot = await db.collection('payments')
            .where('userId', '==', userId)
            .orderBy('createdAt', 'desc')
            .limit(50)
            .get();
        
        const payments = [];
        paymentsSnapshot.forEach(doc => {
            payments.push({
                id: doc.id,
                ...doc.data()
            });
        });
        
        res.json({ payments });
    } catch (error) {
        console.error('Error in payment history:', error);
        res.status(500).json({ error: 'Failed to fetch payment history' });
    }
});

// Helper Functions

async function handleCheckoutSessionCompleted(session) {
    try {
        const { userId, credits, type, planName } = session.metadata;
        
        if (session.mode === 'payment' && credits) {
            // Handle credit purchase
            const creditsToAdd = parseInt(credits);
            
            const batch = db.batch();
            
            // Get user reference
            const userRef = db.collection('users').doc(userId);
            const userDoc = await userRef.get();
            
            if (!userDoc.exists) {
                throw new Error('User not found');
            }
            
            const userData = userDoc.data();
            const currentCredits = userData.credits || 0;
            
            // Update user credits
            batch.update(userRef, {
                credits: currentCredits + creditsToAdd,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            
            // Record payment in database
            const paymentRef = db.collection('payments').doc();
            batch.set(paymentRef, {
                userId: userId,
                amount: session.amount_total / 100,
                currency: session.currency,
                status: 'completed',
                stripeSessionId: session.id,
                credits: creditsToAdd,
                type: 'credit_purchase',
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
            
            await batch.commit();
            console.log(`Successfully added ${creditsToAdd} credits to user ${userId} via checkout session`);
            
        } else if (session.mode === 'subscription') {
            // Handle subscription
            const userRef = db.collection('users').doc(userId);
            await userRef.update({
                subscriptionId: session.subscription,
                subscriptionStatus: 'active',
                customerId: session.customer,
                planName: planName || 'Pro Plan',
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            
            // Record subscription payment
            const paymentRef = db.collection('payments').doc();
            await paymentRef.set({
                userId: userId,
                amount: session.amount_total / 100,
                currency: session.currency,
                status: 'completed',
                stripeSessionId: session.id,
                subscriptionId: session.subscription,
                type: 'subscription',
                planName: planName || 'Pro Plan',
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
            
            console.log(`Subscription activated for user ${userId} via checkout session`);
        }
        
    } catch (error) {
        console.error('Error handling checkout session completion:', error);
    }
}

async function handleSuccessfulPayment(paymentIntent) {
    try {
        const { userId, credits } = paymentIntent.metadata;
        const creditsToAdd = parseInt(credits);
        
        const batch = db.batch();
        
        // Get user reference
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();
        
        if (!userDoc.exists) {
            throw new Error('User not found');
        }
        
        const userData = userDoc.data();
        const currentCredits = userData.credits || 0;
        
        // Update user credits
        batch.update(userRef, {
            credits: currentCredits + creditsToAdd,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        // Record payment in database
        const paymentRef = db.collection('payments').doc();
        batch.set(paymentRef, {
            userId: userId,
            amount: paymentIntent.amount / 100,
            currency: paymentIntent.currency,
            status: 'completed',
            stripePaymentIntentId: paymentIntent.id,
            credits: creditsToAdd,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        await batch.commit();
        console.log(`Successfully added ${creditsToAdd} credits to user ${userId}`);
        console.log(`Payment recorded for user ${userId}: ${paymentIntent.amount / 100} ${paymentIntent.currency}`);
        
    } catch (error) {
        console.error('Error handling successful payment:', error);
    }
}

async function handleSuccessfulSubscription(invoice) {
    try {
        const customerId = invoice.customer;
        const subscriptionId = invoice.subscription;
        
        // Get customer to find userId
        const customer = await stripe.customers.retrieve(customerId);
        const userId = customer.metadata.userId;
        
        if (userId) {
            const userRef = db.collection('users').doc(userId);
            await userRef.update({
                subscriptionId: subscriptionId,
                subscriptionStatus: 'active',
                customerId: customerId,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log(`Subscription activated for user ${userId}`);
        }
        
    } catch (error) {
        console.error('Error handling successful subscription:', error);
    }
}

async function handleCancelledSubscription(subscription) {
    try {
        const customerId = subscription.customer;
        const subscriptionId = subscription.id;
        
        // Find user by subscription ID and update status
        const usersSnapshot = await db.collection('users')
            .where('subscriptionId', '==', subscriptionId)
            .get();
        
        const batch = db.batch();
        usersSnapshot.forEach(doc => {
            batch.update(doc.ref, {
                subscriptionStatus: 'cancelled',
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        });
        
        await batch.commit();
        console.log(`Subscription cancelled for customer ${customerId}`);
        
    } catch (error) {
        console.error('Error handling cancelled subscription:', error);
    }
}

module.exports = router;