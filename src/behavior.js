const express = require('express');
const router = express.Router();

// Store for behavior baseline per user socket
// Structure: { socketId: { state: 'training' | 'active', batchesProcessed: 0, baselineWpm: 0, baselineMouseSpeed: 0, wpmSum: 0, mouseSpeedSum: 0 } }
const userBaselines = {};

router.post('/collect-behavior', (req, res) => {
    const { socketId, data } = req.body;
    const io = req.app.locals.io;

    if (!data || data.length === 0) {
        return res.json({ status: 'no_data' });
    }

    // Initialize baseline tracking if not present
    if (!userBaselines[socketId]) {
        userBaselines[socketId] = {
            state: 'training',
            batchesProcessed: 0,
            wpmSum: 0,
            mouseSpeedSum: 0,
            baselineWpm: 0,
            baselineMouseSpeed: 0
        };
    }

    const tracker = userBaselines[socketId];

    // Process current batch averages
    let totalWpm = 0;
    let wpmCount = 0;
    let totalMouseSpeed = 0;
    let mouseSpeedCount = 0;
    let clickCount = 0;

    data.forEach(entry => {
        if (entry.type === 'keystroke' && entry.wpm > 0) {
            totalWpm += entry.wpm;
            wpmCount++;
        }
        if (entry.type === 'mousemove' && entry.speed > 0) {
            totalMouseSpeed += entry.speed;
            mouseSpeedCount++;
        }
        if (entry.type === 'click') {
            clickCount++;
        }
    });

    // Don't count zero-activity batches for training/averaging
    if (wpmCount === 0 && mouseSpeedCount === 0) {
        return res.json({ status: 'no_activity' });
    }

    const avgWpm = wpmCount > 0 ? (totalWpm / wpmCount) : 0;
    const avgMouseSpeed = mouseSpeedCount > 0 ? (totalMouseSpeed / mouseSpeedCount) : 0;

    console.log(`[Behavior Batch: ${socketId}] State: ${tracker.state} | Avg WPM: ${avgWpm.toFixed(2)} | Avg Mouse Speed: ${avgMouseSpeed.toFixed(2)}`);

    // Training Phase
    if (tracker.state === 'training') {
        tracker.wpmSum += avgWpm;
        tracker.mouseSpeedSum += avgMouseSpeed;
        tracker.batchesProcessed++;

        // After 3 active batches, lock in the baseline
        if (tracker.batchesProcessed >= 3) {
            tracker.baselineWpm = tracker.wpmSum / tracker.batchesProcessed;
            tracker.baselineMouseSpeed = tracker.mouseSpeedSum / tracker.batchesProcessed;
            tracker.state = 'active';
            console.log(`[Baseline Locked - ${socketId}] WPM: ${tracker.baselineWpm.toFixed(2)}, MouseSpeed: ${tracker.baselineMouseSpeed.toFixed(2)}`);
        }
        return res.json({ status: 'training' });
    }

    // Active Phase - Anomaly Detection
    if (tracker.state === 'active') {
        // Calculate deviations (only check if they are actually acting, we don't punish idling usually, but here we can)
        let wpmDeviation = 0;
        let mouseDeviation = 0;

        if (tracker.baselineWpm > 0 && avgWpm > 0) {
            wpmDeviation = Math.abs((avgWpm - tracker.baselineWpm) / tracker.baselineWpm);
        }

        if (tracker.baselineMouseSpeed > 0 && avgMouseSpeed > 0) {
            mouseDeviation = Math.abs((avgMouseSpeed - tracker.baselineMouseSpeed) / tracker.baselineMouseSpeed);
        }

        console.log(`[Deviation - ${socketId}] WPM Delta: ${(wpmDeviation * 100).toFixed(1)}%, Mouse Delta: ${(mouseDeviation * 100).toFixed(1)}%`);

        // If deviation is > 40% (0.4) on either metric, trigger Ransomware Lockout
        if ((wpmDeviation > 0.4 && avgWpm > 0) || (mouseDeviation > 0.4 && avgMouseSpeed > 0)) {
            let reason = wpmDeviation > 0.4 ? `Typing Pattern Mismatch: ${(wpmDeviation * 100).toFixed(1)}% deviation from baseline.` : `Cursor Velocity Mismatch: ${(mouseDeviation * 100).toFixed(1)}% deviation from baseline.`;
            
            console.warn(`[Suspicious Activity Detected] socket: ${socketId} -> ${reason}`);
            
            // Emit to admin dashboard
            io.emit('alert_high_risk', {
                id: socketId,
                reason: reason,
                wpm: avgWpm,
                clicks: clickCount
            });

            // Emit directly to the compromised client to trigger ransomware screen
            io.to(socketId).emit('anomaly_lockout', { reason });
        }
    }

    res.json({ status: 'received' });
});

module.exports = router;
