const express = require('express');
const { admin, db } = require('../config/firebase');
const { verifyFirebaseToken } = require('./firebaseAuth');
const router = express.Router();

// Create payment record
router.post('/create', verifyFirebaseToken, async (req, res) => {
    const {
        amount,
        currency = 'USD',
        paymentMethod,
        transactionId,
        status = 'pending',
        creditsAwarded = 0,
        premiumDays = 0,
        metadata = {}
    } = req.body;

    const userId = req.user.uid;

    if (!amount || !paymentMethod || !transactionId) {
        return res.status(400).json({ 
            error: 'Amount, payment method, and transaction ID are required' 
        });
    }

    try {
        // Create payment document
        const paymentDoc = {
            userId: userId,
            amount: parseFloat(amount),
            currency: currency,
            paymentMethod: paymentMethod,
            transactionId: transactionId,
            status: status,
            creditsAwarded: parseInt(creditsAwarded),
            premiumDays: parseInt(premiumDays),
            metadata: metadata,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            processedAt: null
        };

        const docRef = await db.collection('payments').add(paymentDoc);

        res.status(201).json({
            message: 'Payment record created successfully',
            paymentId: docRef.id,
            payment: {
                id: docRef.id,
                ...paymentDoc
            }
        });
    } catch (error) {
        console.error('Payment creation error:', error);
        return res.status(500).json({ error: 'Error creating payment record' });
    }
});

// Process payment (update status and award credits/premium)
router.post('/:paymentId/process', verifyFirebaseToken, async (req, res) => {
    const { paymentId } = req.params;
    const { status, failureReason } = req.body;

    if (!status || !['completed', 'failed', 'refunded'].includes(status)) {
        return res.status(400).json({ 
            error: 'Valid status (completed, failed, refunded) is required' 
        });
    }

    try {
        const paymentDoc = await db.collection('payments').doc(paymentId).get();
        
        if (!paymentDoc.exists) {
            return res.status(404).json({ error: 'Payment not found' });
        }

        const paymentData = paymentDoc.data();
        
        // Ensure user can only process their own payments (or admin)
        if (req.user.uid !== paymentData.userId && !req.user.admin) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Check if payment is already processed
        if (paymentData.status !== 'pending') {
            return res.status(400).json({ 
                error: `Payment already processed with status: ${paymentData.status}` 
            });
        }

        const batch = db.batch();
        
        // Update payment status
        const updateData = {
            status: status,
            processedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        if (failureReason) {
            updateData.failureReason = failureReason;
        }

        batch.update(db.collection('payments').doc(paymentId), updateData);

        // If payment completed, award credits and/or premium
        if (status === 'completed') {
            const userRef = db.collection('users').doc(paymentData.userId);
            const userDoc = await userRef.get();
            
            if (userDoc.exists) {
                const userData = userDoc.data();
                const userUpdates = {
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                };

                // Award credits
                if (paymentData.creditsAwarded > 0) {
                    userUpdates.credits = admin.firestore.FieldValue.increment(paymentData.creditsAwarded);
                }

                // Award premium days
                if (paymentData.premiumDays > 0) {
                    const currentPremiumUntil = userData.premiumUntil ? userData.premiumUntil.toDate() : new Date();
                    const newPremiumUntil = new Date(Math.max(currentPremiumUntil.getTime(), Date.now()) + (paymentData.premiumDays * 24 * 60 * 60 * 1000));
                    
                    userUpdates.premiumUntil = admin.firestore.Timestamp.fromDate(newPremiumUntil);
                    userUpdates.isPremium = true;
                }

                batch.update(userRef, userUpdates);

                // Create transaction record
                const transactionRef = db.collection('transactions').doc();
                batch.set(transactionRef, {
                    userId: paymentData.userId,
                    paymentId: paymentId,
                    type: 'payment',
                    amount: paymentData.amount,
                    currency: paymentData.currency,
                    creditsAwarded: paymentData.creditsAwarded,
                    premiumDays: paymentData.premiumDays,
                    description: `Payment processed: ${paymentData.paymentMethod}`,
                    createdAt: admin.firestore.FieldValue.serverTimestamp()
                });
            }
        }

        await batch.commit();

        res.json({ 
            message: `Payment ${status} successfully`,
            paymentId: paymentId,
            status: status
        });
    } catch (error) {
        console.error('Payment processing error:', error);
        return res.status(500).json({ error: 'Error processing payment' });
    }
});

// Get user's payments
router.get('/user/:userId', verifyFirebaseToken, async (req, res) => {
    const { userId } = req.params;
    const { limit = 20, status, orderBy = 'createdAt', orderDirection = 'desc' } = req.query;

    // Ensure user can only access their own payments
    if (req.user.uid !== userId && !req.user.admin) {
        return res.status(403).json({ error: 'Access denied' });
    }

    try {
        let query = db.collection('payments')
            .where('userId', '==', userId)
            .orderBy(orderBy, orderDirection)
            .limit(parseInt(limit));

        if (status) {
            query = query.where('status', '==', status);
        }

        const snapshot = await query.get();
        const payments = [];

        snapshot.forEach(doc => {
            payments.push({
                id: doc.id,
                ...doc.data()
            });
        });

        res.json({ payments });
    } catch (error) {
        console.error('Payments fetch error:', error);
        return res.status(500).json({ error: 'Error fetching payments' });
    }
});

// Get specific payment
router.get('/:paymentId', verifyFirebaseToken, async (req, res) => {
    const { paymentId } = req.params;

    try {
        const paymentDoc = await db.collection('payments').doc(paymentId).get();
        
        if (!paymentDoc.exists) {
            return res.status(404).json({ error: 'Payment not found' });
        }

        const paymentData = paymentDoc.data();
        
        // Ensure user can only access their own payments
        if (req.user.uid !== paymentData.userId && !req.user.admin) {
            return res.status(403).json({ error: 'Access denied' });
        }

        res.json({
            id: paymentDoc.id,
            ...paymentData
        });
    } catch (error) {
        console.error('Payment fetch error:', error);
        return res.status(500).json({ error: 'Error fetching payment' });
    }
});

// Get payment statistics for user
router.get('/stats/:userId', verifyFirebaseToken, async (req, res) => {
    const { userId } = req.params;
    const { startDate, endDate } = req.query;

    // Ensure user can only access their own stats
    if (req.user.uid !== userId && !req.user.admin) {
        return res.status(403).json({ error: 'Access denied' });
    }

    try {
        let query = db.collection('payments').where('userId', '==', userId);

        // Add date filters if provided
        if (startDate) {
            query = query.where('createdAt', '>=', admin.firestore.Timestamp.fromDate(new Date(startDate)));
        }
        if (endDate) {
            query = query.where('createdAt', '<=', admin.firestore.Timestamp.fromDate(new Date(endDate)));
        }

        const snapshot = await query.get();
        
        const stats = {
            totalPayments: 0,
            totalAmount: 0,
            totalCreditsAwarded: 0,
            totalPremiumDays: 0,
            paymentsByStatus: {
                pending: 0,
                completed: 0,
                failed: 0,
                refunded: 0
            },
            paymentsByMethod: {},
            averagePayment: 0
        };

        snapshot.forEach(doc => {
            const payment = doc.data();
            
            stats.totalPayments++;
            stats.totalAmount += payment.amount || 0;
            stats.totalCreditsAwarded += payment.creditsAwarded || 0;
            stats.totalPremiumDays += payment.premiumDays || 0;
            
            // Count by status
            if (stats.paymentsByStatus.hasOwnProperty(payment.status)) {
                stats.paymentsByStatus[payment.status]++;
            }
            
            // Count by payment method
            const method = payment.paymentMethod || 'unknown';
            stats.paymentsByMethod[method] = (stats.paymentsByMethod[method] || 0) + 1;
        });

        stats.averagePayment = stats.totalPayments > 0 ? stats.totalAmount / stats.totalPayments : 0;

        res.json({ stats });
    } catch (error) {
        console.error('Payment statistics error:', error);
        return res.status(500).json({ error: 'Error fetching payment statistics' });
    }
});

// Refund payment
router.post('/:paymentId/refund', verifyFirebaseToken, async (req, res) => {
    const { paymentId } = req.params;
    const { reason, refundAmount } = req.body;

    try {
        const paymentDoc = await db.collection('payments').doc(paymentId).get();
        
        if (!paymentDoc.exists) {
            return res.status(404).json({ error: 'Payment not found' });
        }

        const paymentData = paymentDoc.data();
        
        // Ensure user can only refund their own payments (or admin)
        if (req.user.uid !== paymentData.userId && !req.user.admin) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Check if payment can be refunded
        if (paymentData.status !== 'completed') {
            return res.status(400).json({ 
                error: 'Only completed payments can be refunded' 
            });
        }

        const actualRefundAmount = refundAmount || paymentData.amount;
        
        if (actualRefundAmount > paymentData.amount) {
            return res.status(400).json({ 
                error: 'Refund amount cannot exceed original payment amount' 
            });
        }

        const batch = db.batch();
        
        // Update payment status
        batch.update(db.collection('payments').doc(paymentId), {
            status: 'refunded',
            refundAmount: actualRefundAmount,
            refundReason: reason,
            refundedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Deduct credits and premium if they were awarded
        const userRef = db.collection('users').doc(paymentData.userId);
        const userDoc = await userRef.get();
        
        if (userDoc.exists) {
            const userUpdates = {
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            };

            // Deduct credits
            if (paymentData.creditsAwarded > 0) {
                userUpdates.credits = admin.firestore.FieldValue.increment(-paymentData.creditsAwarded);
            }

            // Handle premium refund (simplified - just mark as non-premium if no other active payments)
            if (paymentData.premiumDays > 0) {
                // This is a simplified approach - in a real system you'd want more sophisticated premium management
                userUpdates.isPremium = false;
                userUpdates.premiumUntil = null;
            }

            batch.update(userRef, userUpdates);

            // Create refund transaction record
            const transactionRef = db.collection('transactions').doc();
            batch.set(transactionRef, {
                userId: paymentData.userId,
                paymentId: paymentId,
                type: 'refund',
                amount: -actualRefundAmount,
                currency: paymentData.currency,
                creditsDeducted: paymentData.creditsAwarded,
                description: `Refund processed: ${reason || 'No reason provided'}`,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
        }

        await batch.commit();

        res.json({ 
            message: 'Payment refunded successfully',
            paymentId: paymentId,
            refundAmount: actualRefundAmount
        });
    } catch (error) {
        console.error('Payment refund error:', error);
        return res.status(500).json({ error: 'Error processing refund' });
    }
});

// Admin: Get all payments with filters
router.get('/admin/all', verifyFirebaseToken, async (req, res) => {
    // Check if user is admin
    if (!req.user.admin) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    const { 
        limit = 50, 
        status, 
        paymentMethod, 
        startDate, 
        endDate,
        orderBy = 'createdAt', 
        orderDirection = 'desc' 
    } = req.query;

    try {
        let query = db.collection('payments')
            .orderBy(orderBy, orderDirection)
            .limit(parseInt(limit));

        if (status) {
            query = query.where('status', '==', status);
        }
        if (paymentMethod) {
            query = query.where('paymentMethod', '==', paymentMethod);
        }
        if (startDate) {
            query = query.where('createdAt', '>=', admin.firestore.Timestamp.fromDate(new Date(startDate)));
        }
        if (endDate) {
            query = query.where('createdAt', '<=', admin.firestore.Timestamp.fromDate(new Date(endDate)));
        }

        const snapshot = await query.get();
        const payments = [];

        snapshot.forEach(doc => {
            payments.push({
                id: doc.id,
                ...doc.data()
            });
        });

        res.json({ payments });
    } catch (error) {
        console.error('Admin payments fetch error:', error);
        return res.status(500).json({ error: 'Error fetching payments' });
    }
});

module.exports = router;