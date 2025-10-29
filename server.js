const express = require('express');
const fs = require('fs');
const path = require('path');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const { 
    makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    DisconnectReason,
    Browsers,
    makeCacheableSignalKeyStore,
    fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 5000;

// Global variables
let sock = null;
let messages = [];
let targets = [];
let intervalTime = null;
let senderName = null;
let currentInterval = null;
let stopKey = null;
let sendingActive = false;
let sentCount = 0;
let connectionStatus = 'disconnected';
let retryCount = 0;
const MAX_RETRIES = 3;

// Multer configuration
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'text/plain' || file.originalname.endsWith('.txt')) {
            cb(null, true);
        } else {
            cb(new Error('Only .txt files are allowed'), false);
        }
    }
});

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

// Ensure auth directory exists
const ensureAuthDir = () => {
    const authDir = './auth_info_baileys';
    if (!fs.existsSync(authDir)) {
        fs.mkdirSync(authDir, { recursive: true });
    }
    return authDir;
};

// Clear auth data
const clearAuthData = () => {
    try {
        const authDir = './auth_info_baileys';
        if (fs.existsSync(authDir)) {
            fs.rmSync(authDir, { recursive: true, force: true });
            console.log('🗑️ Auth data cleared');
        }
    } catch (error) {
        console.log('Error clearing auth:', error);
    }
};

// WhatsApp Connection Function
const connectToWhatsApp = async () => {
    try {
        console.log('🔧 INITIALIZING WHATSAPP CONNECTION...');
        connectionStatus = 'connecting';
        
        const authDir = ensureAuthDir();
        const { state, saveCreds } = await useMultiFileAuthState(authDir);
        
        // Fetch latest version
        const { version } = await fetchLatestBaileysVersion();
        console.log('📦 Using Baileys version:', version);

        // Create socket with better configuration
        sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false, // Disable QR in terminal since we're using pairing codes
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'error' })),
            },
            browser: Browsers.ubuntu('Chrome'),
            markOnlineOnConnect: true,
            generateHighQualityLinkPreview: true,
            syncFullHistory: false,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 10000,
            retryRequestDelayMs: 2000,
            maxMsgRetryCount: 3,
            emitOwnEvents: true,
            defaultQueryTimeoutMs: 60000,
            transactionOpts: {
                maxCommitRetries: 3,
                delayBeforeRetry: 3000
            }
        });

        console.log('✅ WhatsApp socket created successfully');

        // Setup event handlers
        sock.ev.on('connection.update', handleConnectionUpdate);
        sock.ev.on('creds.update', saveCreds);
        sock.ev.on('messages.upsert', () => {});

        return sock;

    } catch (error) {
        console.error('💥 INITIALIZATION FAILED:', error);
        connectionStatus = 'error';
        throw error;
    }
};

// Handle connection updates
const handleConnectionUpdate = async (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    console.log('🔔 CONNECTION UPDATE:', { 
        connection
    });

    try {
        if (connection === 'connecting') {
            console.log('🔄 CONNECTING TO WHATSAPP...');
            connectionStatus = 'connecting';
        }

        if (connection === 'open') {
            console.log('🎉 WHATSAPP CONNECTED SUCCESSFULLY!');
            connectionStatus = 'connected';
            retryCount = 0;
            
            // Display user info
            if (sock.user) {
                console.log('👤 LOGGED IN AS:', sock.user.name || 'Unknown');
                console.log('📞 PHONE:', sock.user.id.replace(/:\d+@/, ''));
            }
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log('❌ CONNECTION CLOSED, Status:', statusCode);

            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            
            if (shouldReconnect) {
                retryCount++;
                console.log(`🔄 RECONNECTION ATTEMPT ${retryCount}/${MAX_RETRIES}`);
                
                if (retryCount <= MAX_RETRIES) {
                    connectionStatus = 'reconnecting';
                    setTimeout(() => {
                        console.log('🔄 ATTEMPTING RECONNECTION...');
                        connectToWhatsApp();
                    }, 5000);
                } else {
                    console.log('🚫 MAX RECONNECTION ATTEMPTS REACHED - CLEARING DATA');
                    connectionStatus = 'disconnected';
                    clearAuthData();
                    setTimeout(() => {
                        retryCount = 0;
                        connectToWhatsApp();
                    }, 10000);
                }
            } else {
                console.log('🚫 LOGGED OUT FROM WHATSAPP');
                connectionStatus = 'logged_out';
                clearAuthData();
                setTimeout(() => {
                    retryCount = 0;
                    connectToWhatsApp();
                }, 3000);
            }
        }
    } catch (error) {
        console.error('Error in connection update:', error);
    }
};

// IMPROVED Pairing Code Function - FIXED VERSION
const generatePairingCode = async (phoneNumber) => {
    try {
        console.log('📞 Attempting to generate pairing code for:', phoneNumber);
        
        if (!sock) {
            throw new Error('WhatsApp is not initialized. Please wait for connection.');
        }

        // Format phone number properly
        const formattedNumber = phoneNumber.replace(/\D/g, '');
        if (!formattedNumber) {
            throw new Error('Invalid phone number format');
        }

        console.log('🔐 Requesting pairing code...');
        
        // Add timeout to prevent hanging
        const pairingCodePromise = sock.requestPairingCode(formattedNumber);
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Pairing code request timeout. Please try again.')), 30000);
        });

        const pairingCode = await Promise.race([pairingCodePromise, timeoutPromise]);
        
        if (!pairingCode) {
            throw new Error('Failed to generate pairing code');
        }

        console.log('✅ Pairing code generated successfully:', pairingCode);
        return pairingCode;

    } catch (error) {
        console.error('❌ Pairing code generation failed:', error);
        
        // Enhanced error messages
        let errorMessage = error.message;
        if (error.message.includes('not connected')) {
            errorMessage = 'WhatsApp is not connected. Please try again.';
        } else if (error.message.includes('timeout')) {
            errorMessage = 'Request timed out. Please check your phone number and try again.';
        } else if (error.message.includes('invalid') || error.message.includes('number')) {
            errorMessage = 'Invalid phone number format. Please use format: 91XXXXXXXXXX';
        } else if (error.message.includes('logged out')) {
            errorMessage = 'WhatsApp session expired. Please try pairing again.';
        }

        throw new Error(errorMessage);
    }
};

// Start WhatsApp connection
console.log('🚀 STARTING WHATSAPP BULK MESSENGER...');
connectToWhatsApp().catch(error => {
    console.error('Failed to start WhatsApp:', error);
    setTimeout(() => connectToWhatsApp(), 5000);
});

// Utility functions
function generateStopKey() {
    return 'STOP-' + Math.floor(100000 + Math.random() * 900000);
}

function formatPhoneNumber(phone) {
    let cleaned = phone.replace(/\D/g, '');
    
    // Remove leading 0
    if (cleaned.startsWith('0')) {
        cleaned = cleaned.substring(1);
    }
    
    // Add country code if missing
    if (!cleaned.startsWith('91') && !cleaned.startsWith('1') && !cleaned.startsWith('44')) {
        cleaned = '91' + cleaned;
    }
    
    return cleaned;
}

// Routes
app.get('/', (req, res) => {
    const showStopKey = sendingActive && stopKey;
    
    // Status configuration
    const statusConfig = {
        connected: {
            status: '🟢 CONNECTED & READY',
            color: '#00ff00',
            message: 'WhatsApp is connected and ready to use!',
            showPairing: true,
            showMessages: true
        },
        connecting: {
            status: '🔄 CONNECTING...',
            color: '#ffff00',
            message: 'Connecting to WhatsApp servers...',
            showPairing: false,
            showMessages: false
        },
        reconnecting: {
            status: '🔄 RECONNECTING...',
            color: '#ffff00', 
            message: `Reconnecting... (Attempt ${retryCount}/${MAX_RETRIES})`,
            showPairing: false,
            showMessages: false
        },
        logged_out: {
            status: '🔴 LOGGED OUT',
            color: '#ff0000',
            message: 'Please use pairing code to reconnect',
            showPairing: true,
            showMessages: false
        },
        disconnected: {
            status: '🔴 DISCONNECTED',
            color: '#ff0000',
            message: 'Starting connection...',
            showPairing: true,
            showMessages: false
        },
        error: {
            status: '🔴 ERROR',
            color: '#ff0000',
            message: 'Connection error, retrying...',
            showPairing: true,
            showMessages: false
        }
    };

    const config = statusConfig[connectionStatus] || statusConfig.disconnected;
    const sendingStatus = sendingActive ? '🟢 ACTIVE' : '🔴 INACTIVE';

    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>WhatsApp Bulk Messenger Pro</title>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
            
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }
            
            body {
                font-family: 'Inter', sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                padding: 20px;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            .container {
                background: rgba(255, 255, 255, 0.1);
                backdrop-filter: blur(20px);
                border: 1px solid rgba(255, 255, 255, 0.2);
                border-radius: 20px;
                padding: 30px;
                max-width: 500px;
                width: 100%;
                color: white;
                box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
            }
            
            .header {
                text-align: center;
                margin-bottom: 30px;
            }
            
            .header h1 {
                font-size: 28px;
                font-weight: 700;
                margin-bottom: 10px;
                background: linear-gradient(45deg, #fff, #e0e0e0);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }
            
            .status-card {
                background: rgba(255, 255, 255, 0.15);
                border-radius: 15px;
                padding: 20px;
                margin-bottom: 20px;
                border: 1px solid rgba(255, 255, 255, 0.2);
                text-align: center;
            }
            
            .status-main {
                font-size: 20px;
                font-weight: 600;
                color: ${config.color};
                margin-bottom: 8px;
            }
            
            .status-message {
                font-size: 14px;
                opacity: 0.9;
            }
            
            .form-section {
                background: rgba(255, 255, 255, 0.1);
                border-radius: 15px;
                padding: 20px;
                margin: 20px 0;
            }
            
            .form-group {
                margin-bottom: 20px;
            }
            
            label {
                display: block;
                margin-bottom: 8px;
                font-weight: 500;
                font-size: 14px;
            }
            
            input, textarea, button, select {
                width: 100%;
                padding: 12px 15px;
                border-radius: 10px;
                border: 2px solid rgba(255, 255, 255, 0.3);
                background: rgba(255, 255, 255, 0.1);
                color: white;
                font-size: 14px;
                font-family: 'Inter', sans-serif;
                transition: all 0.3s ease;
            }
            
            textarea {
                height: 100px;
                resize: vertical;
            }
            
            input::placeholder, textarea::placeholder {
                color: rgba(255, 255, 255, 0.6);
            }
            
            input:focus, textarea:focus {
                outline: none;
                border-color: #00ff00;
                background: rgba(255, 255, 255, 0.15);
            }
            
            button {
                background: linear-gradient(45deg, #00ff00, #00cc00);
                color: black;
                font-weight: 600;
                border: none;
                cursor: pointer;
                transition: all 0.3s ease;
            }
            
            button:hover {
                transform: translateY(-2px);
                box-shadow: 0 8px 20px rgba(0, 255, 0, 0.3);
            }
            
            button:disabled {
                opacity: 0.5;
                cursor: not-allowed;
                transform: none;
            }
            
            .btn-pair {
                background: linear-gradient(45deg, #ff9900, #ff6600);
            }
            
            .btn-stop {
                background: linear-gradient(45deg, #ff0000, #cc0000);
                color: white;
            }
            
            .instructions {
                background: rgba(255, 255, 255, 0.1);
                border-radius: 10px;
                padding: 15px;
                margin: 15px 0;
                font-size: 13px;
            }
            
            .stats {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 10px;
                margin-top: 15px;
            }
            
            .stat-item {
                background: rgba(255, 255, 255, 0.1);
                padding: 10px;
                border-radius: 8px;
                text-align: center;
                font-size: 12px;
            }
            
            .success-box {
                background: rgba(0, 255, 0, 0.2);
                border: 2px solid #00ff00;
                border-radius: 15px;
                padding: 25px;
                margin: 20px 0;
                text-align: center;
            }
            
            .pairing-code-display {
                background: white;
                color: black;
                padding: 20px;
                margin: 20px 0;
                border-radius: 10px;
                font-size: 28px;
                font-weight: bold;
                letter-spacing: 5px;
                text-align: center;
                border: 3px solid #00ff00;
                font-family: monospace;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1><i class="fab fa-whatsapp"></i> WhatsApp Bulk Messenger</h1>
                <p>Send bulk messages easily with WhatsApp</p>
            </div>
            
            <div class="status-card">
                <div class="status-main">${config.status}</div>
                <div class="status-message">${config.message}</div>
            </div>

            ${config.showPairing ? `
            <div class="form-section">
                <div class="instructions">
                    <strong><i class="fas fa-info-circle"></i> Connect WhatsApp</strong><br>
                    Enter your phone number to get pairing code and connect your WhatsApp account
                </div>
                
                <form action="/generate-pairing-code" method="post">
                    <div class="form-group">
                        <label for="phoneNumber"><i class="fas fa-phone"></i> Phone Number</label>
                        <input type="text" id="phoneNumber" name="phoneNumber" 
                               placeholder="91XXXXXXXXXX" required 
                               pattern="[0-9]{10,12}" 
                               title="Enter 10-12 digit phone number">
                    </div>
                    <button type="submit" class="btn-pair">
                        <i class="fas fa-link"></i> Generate Pairing Code
                    </button>
                </form>
            </div>
            ` : ''}

            ${config.showMessages ? `
            <div class="form-section">
                <form action="/send-messages" method="post" enctype="multipart/form-data">
                    <div class="form-group">
                        <label for="targetsInput"><i class="fas fa-bullseye"></i> Target Numbers</label>
                        <input type="text" id="targetsInput" name="targetsInput" 
                               placeholder="91XXXXXXXXXX, 91XXXXXXXXXX" required>
                    </div>
                    
                    <div class="form-group">
                        <label for="messageFile"><i class="fas fa-file-upload"></i> Message File</label>
                        <input type="file" id="messageFile" name="messageFile" 
                               accept=".txt" required>
                        <small style="color: rgba(255,255,255,0.7);">Upload .txt file with one message per line</small>
                    </div>
                    
                    <div class="form-group">
                        <label for="senderName"><i class="fas fa-user"></i> Sender Name</label>
                        <input type="text" id="senderName" name="senderName" 
                               placeholder="Your name" required>
                    </div>
                    
                    <div class="form-group">
                        <label for="delayTime"><i class="fas fa-clock"></i> Delay (Seconds)</label>
                        <input type="number" id="delayTime" name="delayTime" 
                               min="5" max="60" value="5" required>
                    </div>
                    
                    <button type="submit" class="btn-start">
                        <i class="fas fa-play"></i> Start Sending Messages
                    </button>
                </form>
            </div>
            ` : ''}

            ${showStopKey ? `
            <div class="form-section" style="background: rgba(255,0,0,0.2); border-color: #ff0000;">
                <div class="form-group">
                    <label style="color: #ff9900;">
                        <i class="fas fa-key"></i> Stop Key (SAVE THIS)
                    </label>
                    <input type="text" value="${stopKey}" readonly 
                           style="background: white; color: black; font-weight: bold; text-align: center;">
                </div>
                <form action="/stop" method="post">
                    <input type="text" name="stopKeyInput" placeholder="Enter stop key to cancel">
                    <button type="submit" class="btn-stop">
                        <i class="fas fa-stop"></i> Stop Sending
                    </button>
                </form>
            </div>
            ` : ''}

            ${sendingActive ? `
            <div class="stats">
                <div class="stat-item">Targets: ${targets.length}</div>
                <div class="stat-item">Messages: ${messages.length}</div>
                <div class="stat-item">Sent: ${sentCount}</div>
                <div class="stat-item">Status: ${sendingStatus}</div>
            </div>
            ` : ''}

            <script>
                // Format phone number input
                document.getElementById('phoneNumber')?.addEventListener('input', function(e) {
                    this.value = this.value.replace(/\\D/g, '');
                });
                
                // Auto-refresh if not connected
                const currentStatus = '${connectionStatus}';
                if (currentStatus !== 'connected') {
                    setTimeout(() => {
                        console.log('🔄 Auto-refreshing for connection status...');
                        window.location.reload();
                    }, 5000);
                }
            </script>
        </div>
    </body>
    </html>
    `);
});

// FIXED Generate Pairing Code Route
app.post('/generate-pairing-code', async (req, res) => {
    try {
        const phoneNumber = req.body.phoneNumber;
        
        if (!phoneNumber) {
            throw new Error('Phone number is required');
        }

        console.log('📞 Processing pairing code request for:', phoneNumber);

        // Generate pairing code using the improved function
        const pairingCode = await generatePairingCode(phoneNumber);
        
        console.log('✅ Pairing code generated successfully');

        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Pairing Code Generated</title>
                <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    body {
                        font-family: 'Inter', sans-serif;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        min-height: 100vh;
                        padding: 20px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    }
                    .container {
                        background: rgba(0,0,0,0.9);
                        padding: 40px;
                        border-radius: 25px;
                        border: 3px solid #00ff00;
                        max-width: 500px;
                        width: 90%;
                        color: white;
                        text-align: center;
                    }
                    .success-icon {
                        font-size: 60px;
                        color: #00ff00;
                        margin-bottom: 20px;
                    }
                    .pairing-code {
                        background: white;
                        color: black;
                        padding: 30px;
                        margin: 25px 0;
                        border-radius: 15px;
                        font-size: 32px;
                        font-weight: bold;
                        letter-spacing: 8px;
                        border: 3px solid #00ff00;
                        font-family: monospace;
                    }
                    .instructions {
                        background: rgba(0,255,0,0.2);
                        padding: 20px;
                        border-radius: 10px;
                        margin-bottom: 25px;
                        text-align: left;
                    }
                    .btn-back {
                        background: #00ff00;
                        color: black;
                        padding: 15px 40px;
                        text-decoration: none;
                        border-radius: 12px;
                        font-weight: 600;
                        font-size: 16px;
                        display: inline-block;
                        margin-top: 15px;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="success-icon">
                        <i class="fas fa-check-circle"></i>
                    </div>
                    <h2 style="color:#00ff00;margin-bottom:25px;font-size:28px;">
                        Pairing Code Generated!
                    </h2>
                    <div class="pairing-code">
                        ${pairingCode}
                    </div>
                    <div class="instructions">
                        <p style="font-size:18px;margin-bottom:15px;"><strong>📱 How to Use:</strong></p>
                        <ol style="padding-left:25px;font-size:16px;">
                            <li>Open WhatsApp on your phone</li>
                            <li>Go to <strong>Settings → Linked Devices</strong></li>
                            <li>Tap on <strong>"Link a Device"</strong></li>
                            <li>Enter the code shown above</li>
                            <li>Wait for confirmation</li>
                        </ol>
                    </div>
                    <a href="/" class="btn-back">
                        <i class="fas fa-arrow-left"></i> Back to Dashboard
                    </a>
                </div>
            </body>
            </html>
        `);

    } catch (error) {
        console.error('❌ Pairing code error:', error);
        
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Pairing Failed</title>
                <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    body {
                        font-family: 'Inter', sans-serif;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        min-height: 100vh;
                        padding: 20px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    }
                    .container {
                        background: rgba(0,0,0,0.9);
                        padding: 40px;
                        border-radius: 25px;
                        border: 3px solid #ff0000;
                        max-width: 500px;
                        width: 90%;
                        color: white;
                        text-align: center;
                    }
                    .error-icon {
                        font-size: 60px;
                        color: #ff0000;
                        margin-bottom: 20px;
                    }
                    .btn-back {
                        background: #ff0000;
                        color: white;
                        padding: 15px 40px;
                        text-decoration: none;
                        border-radius: 12px;
                        font-weight: 600;
                        font-size: 16px;
                        display: inline-block;
                        margin-top: 15px;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="error-icon">
                        <i class="fas fa-times-circle"></i>
                    </div>
                    <h2 style="color:#ff0000;margin-bottom:25px;font-size:28px;">
                        Pairing Failed
                    </h2>
                    <div style="background:rgba(255,0,0,0.2);padding:20px;border-radius:10px;margin-bottom:25px;">
                        <p style="font-size:18px;margin-bottom:10px;"><strong>Error:</strong></p>
                        <p style="font-size:16px;">${error.message}</p>
                    </div>
                    <a href="/" class="btn-back">
                        <i class="fas fa-arrow-left"></i> Try Again
                    </a>
                </div>
            </body>
            </html>
        `);
    }
});

// Send Messages Route
app.post('/send-messages', upload.single('messageFile'), async (req, res) => {
    try {
        const { targetsInput, delayTime, senderName: nameInput } = req.body;

        if (!req.file) {
            throw new Error('Please upload a message file');
        }

        if (!targetsInput || !delayTime || !nameInput) {
            throw new Error('All fields are required');
        }

        const delayValue = parseInt(delayTime);
        if (delayValue < 5) {
            throw new Error('Delay must be at least 5 seconds');
        }

        if (connectionStatus !== 'connected') {
            throw new Error('WhatsApp is not connected. Please connect first using pairing code.');
        }

        // Process file content
        const fileContent = req.file.buffer.toString('utf-8');
        messages = fileContent.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);

        targets = targetsInput.split(',').map(t => t.trim());

        if (messages.length === 0) {
            throw new Error('No messages found in the file');
        }

        if (targets.length === 0) {
            throw new Error('No targets found');
        }

        // Setup sending
        senderName = nameInput;
        intervalTime = delayValue;
        stopKey = generateStopKey();
        sendingActive = true;
        sentCount = 0;

        // Clear existing interval
        if (currentInterval) {
            clearInterval(currentInterval);
        }

        let msgIndex = 0;
        console.log(`🚀 Starting message sending to ${targets.length} targets`);

        currentInterval = setInterval(async () => {
            if (!sendingActive || msgIndex >= messages.length) {
                if (currentInterval) {
                    clearInterval(currentInterval);
                    currentInterval = null;
                }
                sendingActive = false;
                console.log('✅ Message sending completed/stopped');
                return;
            }

            const fullMessage = `${senderName} ${messages[msgIndex]}`;
            
            for (const target of targets) {
                try {
                    const formattedTarget = formatPhoneNumber(target);
                    const jid = formattedTarget.includes('@g.us') ? formattedTarget : formattedTarget + '@s.whatsapp.net';
                    
                    if (sock && connectionStatus === 'connected') {
                        await sock.sendMessage(jid, { text: fullMessage });
                        sentCount++;
                        console.log(`✅ Sent to ${formattedTarget}`);
                    } else {
                        console.log(`❌ WhatsApp not connected, stopping...`);
                        sendingActive = false;
                        return;
                    }
                } catch (err) {
                    console.log(`❌ Failed to send to ${target}: ${err.message}`);
                }
                await delay(1000);
            }

            msgIndex++;
            console.log(`📊 Progress: ${msgIndex}/${messages.length} messages sent`);
            
        }, intervalTime * 1000);

        res.redirect('/');

    } catch (error) {
        console.error('Send messages error:', error);
        res.send(`
            <div style="text-align:center;padding:50px;color:white;background:linear-gradient(135deg, #667eea 0%, #764ba2 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;">
                <div style="background:rgba(0,0,0,0.9);padding:40px;border-radius:25px;border:3px solid #ff0000;">
                    <h2 style="color:#ff0000;margin-bottom:20px;">Error Starting Messages</h2>
                    <p style="margin-bottom:30px;font-size:18px;">${error.message}</p>
                    <a href="/" style="background:#ff0000;color:white;padding:12px 30px;text-decoration:none;border-radius:10px;font-weight:600;font-size:16px;">
                        Back to Dashboard
                    </a>
                </div>
            </div>
        `);
    }
});

// Stop Route
app.post('/stop', (req, res) => {
    const userKey = req.body.stopKeyInput;
    if (userKey === stopKey) {
        sendingActive = false;
        if (currentInterval) {
            clearInterval(currentInterval);
            currentInterval = null;
        }
        stopKey = null;
        res.send(`
            <div style="text-align:center;padding:50px;color:white;background:linear-gradient(135deg, #667eea 0%, #764ba2 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;">
                <div style="background:rgba(0,0,0,0.9);padding:40px;border-radius:25px;border:3px solid #00ff00;">
                    <h2 style="color:#00ff00;margin-bottom:20px;">Sending Stopped</h2>
                    <p style="margin-bottom:30px;font-size:18px;">All message sending has been cancelled successfully</p>
                    <a href="/" style="background:#00ff00;color:black;padding:12px 30px;text-decoration:none;border-radius:10px;font-weight:600;font-size:16px;">
                        Back to Dashboard
                    </a>
                </div>
            </div>
        `);
    } else {
        res.send(`
            <div style="text-align:center;padding:50px;color:white;background:linear-gradient(135deg, #667eea 0%, #764ba2 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;">
                <div style="background:rgba(0,0,0,0.9);padding:40px;border-radius:25px;border:3px solid #ff0000;">
                    <h2 style="color:#ff0000;margin-bottom:20px;">Invalid Stop Key</h2>
                    <p style="margin-bottom:30px;font-size:18px;">Please enter the correct stop key</p>
                    <a href="/" style="background:#ff0000;color:white;padding:12px 30px;text-decoration:none;border-radius:10px;font-weight:600;font-size:16px;">
                        Back to Dashboard
                    </a>
                </div>
            </div>
        `);
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        whatsappStatus: connectionStatus,
        whatsappConnected: connectionStatus === 'connected',
        sendingActive: sendingActive,
        retryCount: retryCount
    });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 WhatsApp Bulk Messenger Pro running on port ${PORT}`);
    console.log(`✅ Health check: http://0.0.0.0:${PORT}/health`);
    console.log(`📱 Dashboard: http://0.0.0.0:${PORT}`);
    console.log(`🎯 Server started at: ${new Date().toLocaleString()}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 Shutting down gracefully...');
    sendingActive = false;
    if (currentInterval) clearInterval(currentInterval);
    process.exit(0);
});
