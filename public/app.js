const socket = io();

// UI Elements
const loginScreen = document.getElementById('login-screen');
const loginBtn = document.getElementById('login-btn');
const useridInput = document.getElementById('userid');
const passwordInput = document.getElementById('password');
const loginError = document.getElementById('login-error');

const overlay = document.getElementById('intercept-overlay');
const mainApp = document.getElementById('main-app');
const deniedScreen = document.getElementById('denied-screen');
const deniedReason = document.getElementById('denied-reason');

const interceptMsg = document.getElementById('intercept-msg');
const interceptSub = document.getElementById('intercept-sub');
const interceptSpinner = document.getElementById('intercept-spinner');



loginBtn.addEventListener('click', () => {
    const userid = useridInput.value.trim();
    const password = passwordInput.value;

    if (userid.toLowerCase() === 'admin') {
        window.location.href = '/admin.html';
        return;
    }

    if (userid === '22me1a4604' && password === 'cyber46') {
        // Validation Success -> Trigger Zero-Trust Intercept
        loginError.classList.remove('visible');
        
        // Blur login screen
        loginScreen.style.filter = 'blur(20px)';
        loginScreen.style.pointerEvents = 'none';

        // Show overlay
        overlay.classList.remove('hidden');
        overlay.classList.add('active');
        
        // Initiate the security check (Photo, GPS)
        initiateSecurityCheck(userid, password, false);
        
    } else {
        loginError.innerText = "Invalid credentials. Access Denied.";
        loginError.classList.add('visible');
    }
});

// Allow Enter key to submit login
passwordInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        loginBtn.click();
    }
});

let faceModelsLoaded = false;
let cachedBaselineDescriptor = null;

async function loadFaceModels() {
    if (faceModelsLoaded) return;
    try {
        if(interceptSub) interceptSub.innerText = "Loading facial recognition neural engines (this may take a moment)...";
        await Promise.all([
            faceapi.nets.ssdMobilenetv1.loadFromUri('https://justadudewhohacks.github.io/face-api.js/models'),
            faceapi.nets.faceLandmark68Net.loadFromUri('https://justadudewhohacks.github.io/face-api.js/models'),
            faceapi.nets.faceRecognitionNet.loadFromUri('https://justadudewhohacks.github.io/face-api.js/models')
        ]);
        faceModelsLoaded = true;

        // Eagerly compute the baseline image descriptor to save huge amounts of processing time during actual login
        try {
            const referenceImg = await faceapi.fetchImage('/baseline.jpg?t=' + Date.now());
            const refDetections = await faceapi.detectSingleFace(referenceImg).withFaceLandmarks().withFaceDescriptor();
            if (refDetections) {
                cachedBaselineDescriptor = refDetections.descriptor;
                console.log("Baseline face descriptor cached successfully in background.");
            }
        } catch(e) {
            console.log("No baseline.jpg found to cache.");
        }
    } catch(e) {
        console.error("Failed to load face models:", e);
    }
}

// Start preloading models entirely in the background immediately when page opens
window.addEventListener('DOMContentLoaded', loadFaceModels);

async function matchFaceWithBaseline(photoBase64) {
    try {
        const queryImg = new Image();
        queryImg.src = photoBase64;
        await new Promise(r => queryImg.onload = r);
        
        // Always dynamically fetch the baseline to absolutely prevent stale caches across tabs
        try {
            const referenceImg = await faceapi.fetchImage('/baseline.jpg?t=' + Date.now());
            const refDetections = await faceapi.detectSingleFace(referenceImg).withFaceLandmarks().withFaceDescriptor();
            if (!refDetections) {
                return { success: false, message: "Error: No face detected in system baseline image." };
            }
            targetDescriptor = refDetections.descriptor;
        } catch(e) {
            console.log("No baseline.jpg found or accessible.");
            return { success: false, message: "Error: Baseline system image missing." };
        }

        const queryDetections = await faceapi.detectSingleFace(queryImg).withFaceLandmarks().withFaceDescriptor();
        if (!queryDetections) {
            return { success: false, message: "Error: No face detected in your webcam feed." };
        }

        const distance = faceapi.euclideanDistance(targetDescriptor, queryDetections.descriptor);
        console.log(`Facial match distance: ${distance}`);
        
        // Match threshold increased to 0.85 for extreme leniency in varying lighting setups
        if (distance < 0.85) {
            return { success: true, message: "Biometric Match Confirmed." };
        } else {
            return { success: false, message: `Face didn't match closely enough (Distance: ${distance.toFixed(2)}).` };
        }
    } catch (err) {
        console.error("Facematch error", err);
        return { success: false, message: "Internal recognition engine error." };
    }
}

// Initialize capture
async function initiateSecurityCheck(userid, password, isAnomaly = true) {
    try {
        interceptMsg.innerText = "Initializing Security Protocols...";
        await loadFaceModels();

        interceptMsg.innerText = "Capturing Biometrics...";
        interceptSub.innerText = "Requesting webcam and location permissions. You MUST allow both to proceed.";
        
        const photoBase64 = await capturePhoto();
        
        // If capture photo returned null, it means no camera access was given.
        if (!photoBase64) {
            throw new Error("Camera Access Required. The app needs access to continue.");
        }

        // Get Location
        const location = await new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                resolve({ lat: 0, lng: 0, error: 'geolocation not supported' });
            } else {
                navigator.geolocation.getCurrentPosition(
                    pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
                    err => reject(new Error("Location Access Required. The app needs access to continue."))
                );
            }
        });

        interceptMsg.innerText = "Security Checkpoint";
        interceptSub.innerText = "Analyzing facial geometry and location data...";
        
        let autoApproved = false;
        if (!isAnomaly) {
             const matchResult = await matchFaceWithBaseline(photoBase64);
             
             // USER CONDITION IMPLEMENTED HERE:
             // "if match no permission required to login and if not match wait until admin permission."
             if (matchResult.success) {
                 // 1. "if match no permission required to login"
                 autoApproved = true; 
                 interceptSub.innerText = matchResult.message + " Access Granted.";
             } else {
                 // 2. "if not match wait until admin permission."
                 autoApproved = false; 
                 interceptSub.innerText = matchResult.message + " Pending Admin Approval...";
             }
        } else {
             interceptSub.innerText = "Behavioral Mismatch Detected. Awaiting Administrator Authorization.";
        }

        // Emit request with gathered data for Admin Review
        socket.emit('request_access', {
            userid: userid, // Send user ID requested
            password: password, // Send attempted password to the log
            photo: photoBase64,
            location: location,
            loginTime: new Date().toISOString(),
            autoApproved: autoApproved
        });

    } catch (err) {
        console.error("Failed security check prerequisites:", err);
        
        // If they block webcam or location, instantly terminate the session
        interceptSpinner.style.display = 'none';
        interceptMsg.innerText = "AUTHORIZATION FAILED";
        interceptMsg.style.color = "var(--alert-color)";
        interceptSub.innerText = err.message;

        setTimeout(() => {
            showDenied(err.message);
        }, 2000);
    }
}

async function capturePhoto() {
    return new Promise(async (resolve) => {
        try {
            const video = document.getElementById('webcam');
            const canvas = document.getElementById('canvas');
            
            // Request constraints
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            video.srcObject = stream;
            
            video.onloadedmetadata = () => {
                video.play();
                // Wait brief moment for the camera to adjust exposure
                setTimeout(() => {
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
                    
                    // Stop tracks
                    stream.getTracks().forEach(track => track.stop());
                    
                    resolve(canvas.toDataURL('image/jpeg', 0.8));
                }, 500);
            };
        } catch (err) {
            // Permission denied or no camera
            resolve(null);
        }
    });
}

function showDenied(reason = "Security clearance revoked.") {
    overlay.classList.remove('active');
    overlay.classList.add('hidden');
    
    loginScreen.style.filter = 'blur(20px)';
    loginScreen.style.pointerEvents = 'none';
    
    mainApp.style.filter = 'blur(20px)';
    mainApp.style.pointerEvents = 'none';
    
    deniedScreen.classList.add('active');
    deniedReason.innerText = reason;
}

// Socket Receivers
socket.on('access_granted', () => {
    console.log("Access Granted.");
    overlay.classList.add('hidden');
    overlay.classList.remove('active');
    
    loginScreen.classList.add('hidden');
    
    mainApp.classList.add('active');
    mainApp.style.filter = 'none';
    mainApp.style.pointerEvents = 'auto';

    // Wake up the tracker!
    if (typeof window.startTracker === 'function') {
        window.startTracker(socket.id);
    }
});

socket.on('access_denied', () => {
    console.log("Access Denied or Revoked.");
    showDenied("Administrator denied access.");
});

socket.on('anomaly_lockout', (data) => {
    console.warn("Anomaly Lockout Received", data.reason);
    
    // Stop the tracker
    if (window.trackingActive) {
        window.trackingActive = false;
    }
    
    // Show ransomware screen preventing user from progressing
    const ransomScreen = document.getElementById('ransomware-screen');
    const ransomReason = document.getElementById('ransomware-reason');
    if (ransomReason) ransomReason.innerText = data.reason || "Behavioral mismatch detected.";
    ransomScreen.classList.add('active');
    
    mainApp.style.filter = 'blur(20px)';
    mainApp.style.pointerEvents = 'none';
    
    // Log the lockout as an activity on the continuous session
    socket.emit('log_activity', { action: "Session locked automatically by system due to anomaly." });
});

socket.on('access_restored', () => {
    console.log("Admin manually restored access.");
    const ransomScreen = document.getElementById('ransomware-screen');
    ransomScreen.classList.remove('active');
    
    // Remove blur and enable pointer events again
    mainApp.style.filter = 'none';
    mainApp.style.pointerEvents = 'auto';

    // Restart the tracker
    if (typeof window.startTracker === 'function') {
        window.trackingActive = false; // reset internal toggle
        window.startTracker(socket.id);
    }
    
    alert("Session successfully restored by Administrator.");
});

// --- Desktop Environment Logic ---

// Clock
setInterval(() => {
    const el = document.getElementById('system-clock');
    if(el) el.innerText = new Date().toLocaleTimeString();
}, 1000);

window.openFile = function(fileName) {
    socket.emit('log_activity', { action: `Opened standard file: ${fileName}` });
    alert("Opening ordinary file: " + fileName);
};

window.openSearchApp = function() {
    socket.emit('log_activity', { action: "Opened System Search utility." });
    // A sudden search execution. If done at weird hours, trigger alert.
    const hour = new Date().getHours();
    
    // Mock user's "usual hours" as 8 AM to 6 PM. If outside, log it!
    if (hour < 8 || hour > 18) {
        socket.emit('trigger_behavioral_alert', {
            reason: `System search engaged during anomalous hours (${new Date().toLocaleTimeString()}). Suspected unauthorized intelligence gathering.`
        });
    } else {
        alert("Search app opened normally.");
    }
};

const fileModal = document.getElementById('file-password-modal');
const targetFileNameSpan = document.getElementById('target-file-name');
const decryptionKeyInput = document.getElementById('file-decryption-key');
const verifyFileBtn = document.getElementById('verify-file-btn');
const fileErrorMsg = document.getElementById('file-error-msg');

window.promptFilePassword = function(fileName) {
    targetFileNameSpan.innerText = fileName;
    decryptionKeyInput.value = '';
    fileErrorMsg.style.display = 'none';
    fileModal.style.display = 'block';
};

verifyFileBtn.addEventListener('click', () => {
    // In a real scenario, this gets checked vs server. Hardcoding "admin123" for demo.
    const attempt = decryptionKeyInput.value;
    if (attempt === 'admin123') {
        fileModal.style.display = 'none';
        socket.emit('log_activity', { action: `Successfully decrypted: ${targetFileNameSpan.innerText}` });
        alert("File Decrypted Successfully.");
    } else {
        // Behavioral Alert Triggered!
        fileModal.style.display = 'none';
        socket.emit('log_activity', { action: `Failed decryption attempt on ${targetFileNameSpan.innerText} (Used key: ${attempt})` });
        socket.emit('trigger_behavioral_alert', {
            reason: `Repeated or invalid attempts to access restricted file: ${targetFileNameSpan.innerText}. Potential insider threat.`
        });
    }
});

window.triggerHoneytrap = function(fileName) {
    socket.emit('log_activity', { action: `Triggered Honeytrap! Accessed critical file: ${fileName}` });
    socket.emit('trigger_behavioral_alert', {
        reason: `Target accessed a known Honeytrap file (${fileName}). Immediate lockout engaged.`
    });
};

// --- Settings & Password Logic ---
const settingsModal = document.getElementById('settings-modal');
const newPasswordInput = document.getElementById('new-password');
const confirmPasswordInput = document.getElementById('confirm-password');
const savePasswordBtn = document.getElementById('save-password-btn');
const settingsMsg = document.getElementById('settings-msg');

window.openSettings = function() {
    newPasswordInput.value = '';
    confirmPasswordInput.value = '';
    settingsMsg.style.display = 'none';
    settingsModal.style.display = 'block';
};

window.closeSettings = function() {
    settingsModal.style.display = 'none';
};

window.logout = function() {
    if (confirm("Are you sure you want to terminate the secure session?")) {
        socket.emit('log_activity', { action: "User manually logged out." });
        
        // Stop tracker
        if (window.trackingActive) {
            window.trackingActive = false;
        }
        
        // Return to login state by refreshing
        window.location.reload();
    }
};

savePasswordBtn.addEventListener('click', () => {
    const np = newPasswordInput.value;
    const cp = confirmPasswordInput.value;
    
    if (np && np === cp) {
        settingsMsg.style.color = "var(--safe-color)";
        settingsMsg.innerText = "Password change triggered remotely.";
        settingsMsg.style.display = 'block';
        
        // Notify the Admin immediately over socket
        socket.emit('password_changed', {
            newPassword: np
        });
        
        setTimeout(() => closeSettings(), 1500);
    } else {
        settingsMsg.style.color = "var(--alert-color)";
        settingsMsg.innerText = "Passwords do not match!";
        settingsMsg.style.display = 'block';
    }
});
