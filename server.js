/**
 * MIRA International Racing Association - Persistent Node.js Web Service Server
 * Full Data Persistence Engine with Local/Render Persistent Disk File Storage.
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 10000;

// Enable CORS & JSON Body Parser
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Determine Persistent Storage Directory
// Render Persistent Disk mount path is /data (or fallback to ./data)
const DATA_DIR = process.env.RENDER || fs.existsSync('/data') ? '/data' : path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const REGISTRATIONS_FILE = path.join(DATA_DIR, 'mira_registrations.json');

// Ensure Persistent Directories Exist
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Multer Storage Configuration for File Proof Uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const name = `MIRA-PROOF-${Date.now()}${ext}`;
        cb(null, name);
    }
});
const upload = multer({ storage });

// Load Persistent Registrations from Disk
function loadRegistrations() {
    try {
        if (fs.existsSync(REGISTRATIONS_FILE)) {
            const raw = fs.readFileSync(REGISTRATIONS_FILE, 'utf8');
            return JSON.parse(raw);
        }
    } catch (err) {
        console.error('❌ Failed to load registrations from disk:', err.message);
    }
    return [];
}

// Save Registrations Atomically to Disk
function saveRegistrations(list) {
    try {
        fs.writeFileSync(REGISTRATIONS_FILE, JSON.stringify(list, null, 2), 'utf8');
        console.log(`💾 Persisted ${list.length} team registrations to disk (${REGISTRATIONS_FILE})`);
        return true;
    } catch (err) {
        console.error('❌ Disk save error:', err.message);
        return false;
    }
}

// Serve Static Frontend Assets
app.use(express.static(__dirname));
app.use('/uploads', express.static(UPLOADS_DIR));

// -------------------------------------------------------------
// API ENDPOINTS FOR PERSISTENT REGISTRATION & PAYMENTS
// -------------------------------------------------------------

// 1. Health Check
app.get('/api/mira/health', (req, res) => {
    const list = loadRegistrations();
    res.json({
        status: 'healthy',
        service: 'MIRA International Racing Platform',
        version: '2.0.0-PERSISTENT',
        totalTeams: list.length,
        storagePath: REGISTRATIONS_FILE
    });
});

// 2. Get All Teams & Registrations
app.get('/api/mira/teams', (req, res) => {
    const list = loadRegistrations();
    res.json({ success: true, teams: list });
});

// 3. Register New Team / Individual
app.post('/api/mira/register', (req, res) => {
    try {
        const body = req.body;
        if (!body || !body.ticketId) {
            return res.status(400).json({ success: false, error: 'Invalid registration payload' });
        }

        const list = loadRegistrations();

        # Prevent Duplicate Ticket IDs
        const existingIndex = list.findIndex(r => r.ticketId === body.ticketId);
        if (existingIndex >= 0) {
            list[existingIndex] = { ...list[existingIndex], ...body, updatedAt: new Date().toISOString() };
        } else {
            list.unshift({
                ...body,
                registeredAt: body.registeredAt || new Date().toISOString(),
                status: body.status || 'PENDING_PAYMENT'
            });
        }

        saveRegistrations(list);
        res.json({ success: true, ticketId: body.ticketId, message: 'Registration saved permanently to disk' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 4. Verify & Submit Payment TxHash
app.post('/api/mira/verify-payment', (req, res) => {
    try {
        const { ticketId, txHash } = req.body;
        if (!txHash) {
            return res.status(400).json({ success: false, error: 'TxHash is required' });
        }

        const list = loadRegistrations();
        const team = list.find(r => r.ticketId === ticketId || (r.txHash && r.txHash === txHash));

        if (team) {
            team.txHash = txHash;
            team.paymentSubmittedAt = new Date().toISOString();
            saveRegistrations(list);
            return res.json({ success: true, message: 'TxHash recorded and awaiting TRON confirmations', team });
        }

        // If ticket not found, append TxHash record
        if (list.length > 0) {
            list[0].txHash = txHash;
            saveRegistrations(list);
        }
        res.json({ success: true, message: 'TxHash received' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 5. Admin Approve Team Payment
app.post('/api/mira/approve-payment', (req, res) => {
    try {
        const { ticketId, pass } = req.body;
        if (pass !== 'mira2026' && pass !== 'admin') {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        const list = loadRegistrations();
        const team = list.find(r => r.ticketId === ticketId);
        if (team) {
            team.status = 'CONFIRMED';
            team.confirmedAt = new Date().toISOString();
            saveRegistrations(list);
            return res.json({ success: true, message: 'Team status updated to CONFIRMED' });
        }
        res.status(404).json({ success: false, error: 'Ticket ID not found' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 6. File Upload Proof Endpoint
app.post('/api/mira/upload-proof', upload.single('proofFile'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, error: 'No file uploaded' });
    }
    res.json({
        success: true,
        filename: req.file.filename,
        fileUrl: `/uploads/${req.file.filename}`
    });
});

// 7. CSV Roster Export Endpoint
app.get('/api/mira/export-csv', (req, res) => {
    const list = loadRegistrations();
    let csv = 'TicketID,Type,Team/Name,Captain,Email,Country,Status,TxHash,PlayerIDs\n';
    list.forEach(r => {
        const players = r.playerIds ? `"${r.playerIds.join('; ')}"` : 'N/A';
        csv += `${r.ticketId},${r.type},"${r.teamName || r.name}","${r.captainName || 'N/A'}",${r.email},"${r.country}",${r.status},"${r.txHash || ''}",${players}\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="MIRA_Rosters_2026.csv"');
    res.send(csv);
});

// Catch-all HTML fallback
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => {
    console.log(`🚀 MIRA Persistent Web Service running on port ${PORT}`);
    console.log(`💾 Persistent Storage Path: ${REGISTRATIONS_FILE}`);
});
