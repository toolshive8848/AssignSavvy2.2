const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

/**
 * Payment Routes for Stripe Integration
 * Handles subscription management, credit purchases, and payment processing
 */

// TODO: Add your Stripe API keys here - Get from https://dashboard.stripe.com/apikeys
// Required for payment processing and subscription management
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); // Add your Stripe secret key
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY; // Add your Stripe publishable key

// Database connection
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', 'database.db');
const db = new sqlite3.Database(dbPath);

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
 * Create Subscription for Pro Plan
 * POST /api/payments/create-subscription
 */
router.post('/create-subscription', async (req, res) => {
    try {
        const { userId, priceId, paymentMethodId } = req.body;
        
        if (!userId || !priceId || !paymentMethodId) {
            return res.status(400).json({
                error: 'Missing required fields: userId, priceId, paymentMethodId'
            });
        }

        // Create customer if doesn't exist
        const customer = await stripe.customers.create({
            metadata: {
                userId: userId.toString()
            }
        });

        // Attach payment method to customer
        await stripe.paymentMethods.attach(paymentMethodId, {
            customer: customer.id
        });

        // Create subscription
        const subscription = await stripe.subscriptions.create({
            customer: customer.id,
            items: [{ price: priceId }],
            default_payment_method: paymentMethodId,
            expand: ['latest_invoice.payment_intent']
        });

        res.json({
            subscriptionId: subscription.id,
            clientSecret: subscription.latest_invoice.payment_intent.client_secret
        });
    } catch (error) {
        console.error('Error creating subscription:', error);
        res.status(500).json({ error: 'Failed to create subscription' });
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
        const db = req.app.locals.db;
        
        db.all(
            'SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
            [userId],
            (err, payments) => {
                if (err) {
                    console.error('Error fetching payment history:', err);
                    return res.status(500).json({ error: 'Failed to fetch payment history' });
                }
                res.json({ payments });
            }
        );
    } catch (error) {
        console.error('Error in payment history:', error);
        res.status(500).json({ error: 'Failed to fetch payment history' });
    }
});

// Helper Functions

async function handleSuccessfulPayment(paymentIntent) {
    try {
        const { userId, credits } = paymentIntent.metadata;
        const creditsToAdd = parseInt(credits);
        const userIdInt = parseInt(userId);
        
        // Add credits to user account
        await new Promise((resolve, reject) => {
            db.run(
                'UPDATE users SET credits = credits + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [creditsToAdd, userIdInt],
                function(err) {
                    if (err) {
                        console.error('Error updating user credits:', err);
                        reject(err);
                        return;
                    }
                    console.log(`Successfully added ${creditsToAdd} credits to user ${userIdInt}`);
                    resolve();
                }
            );
        });
        
        // Record payment in database
        await new Promise((resolve, reject) => {
            db.run(
                'INSERT INTO payments (user_id, amount, currency, status, stripe_payment_intent_id, created_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
                [userIdInt, paymentIntent.amount / 100, paymentIntent.currency, 'completed', paymentIntent.id],
                function(err) {
                    if (err) {
                        console.error('Error recording payment:', err);
                        reject(err);
                        return;
                    }
                    console.log(`Payment recorded for user ${userIdInt}: ${paymentIntent.amount / 100} ${paymentIntent.currency}`);
                    resolve();
                }
            );
        });
        
    } catch (error) {
        console.error('Error handling successful payment:', error);
    }
}

async function handleSuccessfulSubscription(invoice) {
    try {
        const customerId = invoice.customer;
        
        // Update user's subscription status
        console.log(`Subscription payment succeeded for customer ${customerId}`);
        
    } catch (error) {
        console.error('Error handling successful subscription:', error);
    }
}

async function handleCancelledSubscription(subscription) {
    try {
        const customerId = subscription.customer;
        
        // Update user's subscription status to cancelled
        console.log(`Subscription cancelled for customer ${customerId}`);
        
    } catch (error) {
        console.error('Error handling cancelled subscription:', error);
    }
}

module.exports = router;