const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');
const behaviorRouter = require('./behavior');

process.on('uncaughtException', err => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', reason => {
    console.error('Unhandled Rejection:', reason);
});

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/baseline.jpg', (req, res) => {
    if (!app.locals.db) return res.sendFile(path.join(__dirname, '../public/baseline.jpg'));
    app.locals.db.get(`SELECT value FROM admin_settings WHERE key = 'baseline'`, [], (err, row) => {
        if (!err && row && row.value) {
            const imgBuffer = Buffer.from(row.value, 'base64');
            res.writeHead(200, {
                'Content-Type': 'image/jpeg',
                'Content-Length': imgBuffer.length
            });
            res.end(imgBuffer);
        } else {
            res.sendFile(path.join(__dirname, '../public/baseline.jpg'));
        }
    });
});

app.use(express.static(path.join(__dirname, '../public')));

// Initialize SQLite DB (Persistent to Disk)
const db = new sqlite3.Database(path.join(__dirname, 'logs.db'), (err) => {
    if (err) {
        console.error('Database connection error:', err.message);
    } else {
        console.log('Connected to the persistent SQLite database.');
        // Recreate the table with new columns for the requested features
        db.run(`CREATE TABLE IF NOT EXISTS access_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                socket_id TEXT,
                userid TEXT,
                password TEXT,
                photo TEXT,
                location TEXT,
                status TEXT,
                activity_log TEXT DEFAULT '[]',
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);
        db.run(`CREATE TABLE IF NOT EXISTS admin_settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )`);
    }
});

app.locals.db = db;
app.locals.io = io; // Share socket.io instance

app.use('/api', behaviorRouter);

const pendingRequests = {};

// Socket.io handling
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Admin synchronization
    socket.on('admin_sync', () => {
        Object.values(pendingRequests).forEach(payload => {
            socket.emit('new_access_request', payload);
        });
    });

    // Phase 1.5: Initial Login (Direct Access)
    socket.on('initial_login', (data) => {
        console.log(`Initial login from ${socket.id} (user: ${data.userid})`);
        db.run(`INSERT INTO access_logs (socket_id, userid, password, photo, location, status) VALUES (?, ?, ?, ?, ?, ?)`, 
            [socket.id, data.userid, data.password, null, null, 'GRANTED'], () => {
                // Inform admin dashboard
                db.all(`SELECT * FROM access_logs ORDER BY id DESC`, [], (err, rows) => {
                    if (!err) io.emit('logs_data', rows);
                });
            });
    });

    // Phase 2: Client Requesting Access
    socket.on('request_access', (data) => {
        console.log(`Access request received from ${socket.id}`);
        const status = data.autoApproved ? 'ALLOW' : 'PENDING';
        
        // Log to db
        db.run(`INSERT INTO access_logs (socket_id, userid, password, photo, location, status) VALUES (?, ?, ?, ?, ?, ?)`, 
            [socket.id, data.userid, data.password, data.photo, JSON.stringify(data.location), status], function() {
                db.all(`SELECT * FROM access_logs ORDER BY id DESC`, [], (err, rows) => {
                    if (!err) io.emit('logs_data', rows);
                });
            });
            
        if (data.autoApproved) {
            io.to(socket.id).emit('access_granted');
        } else {
            const payload = {
                id: socket.id,
                userid: data.userid,
                password: data.password,
                photo: data.photo,
                location: data.location,
                timestamp: data.loginTime || new Date().toISOString()
            };
            pendingRequests[socket.id] = payload;
            // Broadcast to admins
            io.emit('new_access_request', payload);
        }
    });

    // Phase 3: Admin decision
    socket.on('admin_decision', (data) => {
        const { targetSocketId, decision } = data;
        console.log(`Admin decision for ${targetSocketId}: ${decision}`);
        
        delete pendingRequests[targetSocketId];
        
        db.run(`UPDATE access_logs SET status = ? WHERE socket_id = ?`, [decision.toUpperCase(), targetSocketId], () => {
            // Re-fetch and broadcast logs to admins when updated
            db.all(`SELECT * FROM access_logs ORDER BY id DESC`, [], (err, rows) => {
                if (!err) io.emit('logs_data', rows);
            });
        });
        
        if (decision === 'Allow') {
            io.to(targetSocketId).emit('access_granted');
        } else {
            io.to(targetSocketId).emit('access_denied');
        }
    });

    // Handle Admin setting new default baseline photo
    socket.on('set_baseline', (data) => {
        console.log(`Setting new baseline.jpg from Admin portal...`);
        const base64Data = data.photo.replace(/^data:image\/\w+;base64,/, "");
        const fs = require('fs');
        fs.writeFile(path.join(__dirname, '../public/baseline.jpg'), base64Data, 'base64', (err) => {
            if (err) console.error("Error saving baseline:", err);
            else console.log("baseline.jpg saved successfully via admin portal.");
        });
        db.run(`INSERT OR REPLACE INTO admin_settings (key, value) VALUES (?, ?)`, ['baseline', base64Data]);
    });

    // Send access logs to admin
    socket.on('get_logs', () => {
        db.all(`SELECT * FROM access_logs ORDER BY id DESC`, [], (err, rows) => {
            if (err) return console.error(err);
            socket.emit('logs_data', rows);
        });
    });

    // Direct Behavioral Alerts from Client
    socket.on('trigger_behavioral_alert', (data) => {
        console.warn(`[Suspicious Activity Detected] socket: ${socket.id} -> ${data.reason}`);
        
        // Emit to admin dashboard
        io.emit('alert_high_risk', {
            id: socket.id,
            reason: data.reason,
            wpm: 0,
            clicks: 0
        });

        // Emit directly to the compromised client to trigger ransomware screen
        io.to(socket.id).emit('anomaly_lockout', { reason: data.reason });
        
        // Update DB
        db.run(`UPDATE access_logs SET status = ? WHERE socket_id = ?`, ['LOCKED', socket.id]);
        db.all(`SELECT * FROM access_logs ORDER BY id DESC`, [], (err, rows) => {
            if (!err) io.emit('logs_data', rows);
        });
    });

    // Phase 5: Admin dynamically revokes access
    socket.on('revoke_access', (targetSocketId) => {
        console.log(`Admin dynamically revoked access for ${targetSocketId}`);
        db.run(`UPDATE access_logs SET status = ? WHERE socket_id = ?`, ['REVOKED', targetSocketId]);
        
        io.to(targetSocketId).emit('access_denied');
    });

    // Admin restores access from a lockout
    socket.on('restore_access', (targetSocketId) => {
        console.log(`Admin restored access for ${targetSocketId}`);
        db.run(`UPDATE access_logs SET status = ? WHERE socket_id = ?`, ['RESTORED', targetSocketId]);
        
        io.to(targetSocketId).emit('access_restored');
    });

    // Handle generic activity logging from clients
    socket.on('log_activity', (data) => {
        // Fetch existing log
        db.get(`SELECT activity_log FROM access_logs WHERE socket_id = ?`, [socket.id], (err, row) => {
            if (err || !row) return;
            let currentLogs = [];
            try {
                currentLogs = JSON.parse(row.activity_log || '[]');
            } catch (e) {}
            
            currentLogs.push({
                action: data.action,
                time: data.time || new Date().toLocaleTimeString()
            });

            db.run(`UPDATE access_logs SET activity_log = ? WHERE socket_id = ?`, [JSON.stringify(currentLogs), socket.id], () => {
                 // Send updated logs to admin silently
                 db.all(`SELECT * FROM access_logs ORDER BY id DESC`, [], (e, rows) => {
                     if (!e) io.emit('logs_data', rows);
                 });
            });
        });
    });

    // Password change alert
    socket.on('password_changed', (data) => {
        console.log(`Password change detected from ${socket.id}`);
        
        // Log it as an activity first
        db.get(`SELECT activity_log FROM access_logs WHERE socket_id = ?`, [socket.id], (err, row) => {
            if (!err && row) {
                let currentLogs = [];
                try { currentLogs = JSON.parse(row.activity_log || '[]'); } catch(e){}
                currentLogs.push({ action: `Changed password to: ${data.newPassword}`, time: new Date().toLocaleTimeString() });
                db.run(`UPDATE access_logs SET activity_log = ? WHERE socket_id = ?`, [JSON.stringify(currentLogs), socket.id]);
            }
        });

        io.emit('admin_password_alert', {
            id: socket.id,
            newPassword: data.newPassword,
            time: new Date().toLocaleTimeString()
        });
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
    });
});

// --- REST APIs for Mobile/WhatsApp Integrations ---

// Direct Link Execution API (GET)
app.get('/api/direct-decision', (req, res) => {
    const { id, decision } = req.query;
    if (!id || !decision || !pendingRequests[id]) {
        return res.send(`<body style="background:#0B132B; color:white; font-family:monospace; text-align:center; padding:50px;">
            <h2 style="color:#FF3366">⚠️ Error</h2><p>Request not found or already processed.</p>
        </body>`);
    }

    const targetSocketId = id;
    const finalDecision = decision.toLowerCase() === 'allow' ? 'Allow' : 'Deny';

    console.log(`[Direct Link API] Admin decision for ${targetSocketId}: ${finalDecision}`);
    delete pendingRequests[targetSocketId];
    
    db.run(`UPDATE access_logs SET status = ? WHERE socket_id = ?`, [finalDecision.toUpperCase(), targetSocketId], () => {
        db.all(`SELECT * FROM access_logs ORDER BY id DESC`, [], (err, rows) => {
            if (!err) io.emit('logs_data', rows);
        });
    });
    
    if (finalDecision === 'Allow') {
        io.to(targetSocketId).emit('access_granted');
    } else {
        io.to(targetSocketId).emit('access_denied');
    }
    
    io.emit('remove_request_card', targetSocketId);
    
    const color = finalDecision === 'Allow' ? '#00FA9A' : '#FF3366';
    res.send(`<body style="background:#0B132B; color:white; font-family:monospace; text-align:center; padding:50px;">
        <h1 style="color:${color}">✅ Session Successfully ${finalDecision.toUpperCase()}ED</h1>
        <p>Target ID: ${targetSocketId}</p>
        <p>You may safely close this tab. The dashboard has been synchronized.</p>
    </body>`);
});

// Allow Mobile UI to fetch pending request details
app.get('/api/pending-request/:id', (req, res) => {
    const data = pendingRequests[req.params.id];
    if (data) res.json(data);
    else res.status(404).json({ error: 'Request not found or already processed.' });
});

// Allow Mobile UI to submit decisions
app.post('/api/admin-decision', (req, res) => {
    const { targetSocketId, decision } = req.body;
    if (!targetSocketId || !decision) return res.status(400).send('Missing params');
    
    console.log(`[Mobile API] Admin decision for ${targetSocketId}: ${decision}`);
    delete pendingRequests[targetSocketId];
    
    db.run(`UPDATE access_logs SET status = ? WHERE socket_id = ?`, [decision.toUpperCase(), targetSocketId], () => {
        db.all(`SELECT * FROM access_logs ORDER BY id DESC`, [], (err, rows) => {
            if (!err) io.emit('logs_data', rows);
        });
    });
    
    if (decision === 'Allow') {
        io.to(targetSocketId).emit('access_granted');
    } else {
        io.to(targetSocketId).emit('access_denied');
    }
    
    // Notify web socket admins to remove the card
    io.emit('remove_request_card', targetSocketId);
    
    res.json({ success: true });
});

// --- End of REST APIs ---

server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
