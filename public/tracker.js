// Behavioral Biometrics Tracker
// This script is responsible for silently tracking keystrokes and mouse movements.

let trackingActive = false;
let userSocketId = null;

// Batched Data Array
let currentBatch = [];

// Trackers
let keystrokeCount = 0;
let lastKeyTime = Date.now();

let lastMouseX = 0;
let lastMouseY = 0;
let lastMouseTime = Date.now();

// Activate Tracker (Called from app.js when access is granted)
window.startTracker = function(socketId) {
    if (trackingActive) return; // Prevent double firing
    
    trackingActive = true;
    userSocketId = socketId;
    console.log("SECURE TOUCH Tracker Enabled. Monitoring user behavior in the background...");
    
    // Start interval publisher (Send batch every 5 seconds)
    setInterval(publishBatch, 5000);
    
    // Attach Listeners
    document.addEventListener('keydown', handleKeypress);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('click', handleClick);
};

// Listeners
function handleKeypress(e) {
    if (!trackingActive) return;
    
    // Basic tracking of frequency for Words Per Minute approx (assume 5 chars = 1 word)
    keystrokeCount++;
    const now = Date.now();
    const timeDiffMinutes = (now - lastKeyTime) / 60000;
    
    // Just a quick localized wpm for this specific cluster 
    const currentWpm = timeDiffMinutes > 0 ? ((keystrokeCount / 5) / timeDiffMinutes) : 0;
    
    // reset for next cluster every so often so it's a moving average, 
    // but for MVP we just push points into batch
    currentBatch.push({
        type: 'keystroke',
        wpm: currentWpm,
        timestamp: now
    });
    
    // Reset localized cluster
    if (keystrokeCount > 10) {
        keystrokeCount = 0;
        lastKeyTime = now;
    }
}

function handleMouseMove(e) {
    if (!trackingActive) return;
    
    const now = Date.now();
    const timeDiff = now - lastMouseTime;
    
    // Calculate distance
    const dist = Math.sqrt(Math.pow(e.clientX - lastMouseX, 2) + Math.pow(e.clientY - lastMouseY, 2));
    
    // Quick Speed calculation (pixels per ms)
    const speed = timeDiff > 0 ? (dist / timeDiff) : 0;
    
    // To prevent overflowing batch size with hundreds of move events, we only sample every 100ms
    if (timeDiff > 100) {
        currentBatch.push({
            type: 'mousemove',
            x: e.clientX,
            y: e.clientY,
            speed: speed * 1000, /* pixels per sec approx */
            timestamp: now
        });
        
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
        lastMouseTime = now;
    }
}

function handleClick(e) {
    if (!trackingActive) return;
    
    currentBatch.push({
        type: 'click',
        x: e.clientX,
        y: e.clientY,
        timestamp: Date.now()
    });
}

// Publish payload continuously
async function publishBatch() {
    if (!trackingActive || !userSocketId) return;
    
    if (currentBatch.length === 0) {
        // Ping empty payload just to prove active session
        return;
    }

    // copy and clear array to prevent duplicate sends
    const payload = [...currentBatch];
    currentBatch = [];
    
    try {
        const response = await fetch('/api/collect-behavior', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                socketId: userSocketId,
                data: payload
            })
        });
        
        const result = await response.json();
    } catch (error) {
        console.error("Tracker payload failed to transmit:", error);
    }
}
