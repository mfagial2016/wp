const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { makeWASocket, useMultiFileAuthState, delay, DisconnectReason, Browsers } = require("@whiskeysockets/baileys");
const multer = require('multer');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 5000;

// Global variables
let MznKing = null;
let messages = [];
let targets = [];
let intervalTime = null;
let haterName = null;
let currentInterval = null;
let stopKey = null;
let sendingActive = false;
let sentCount = 0;
let connectionStatus = 'initializing';
let qrCodeData = null;
let connectionStartTime = Date.now();

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

// Ensure auth_info directory exists
const ensureAuthDir = () => {
  const authDir = './auth_info';
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }
};

// Clear auth data and restart
const clearAuthAndRestart = async () => {
  try {
    console.log('🔄 Clearing auth data and restarting...');
    const authDir = './auth_info';
    if (fs.existsSync(authDir)) {
      fs.rmSync(authDir, { recursive: true, force: true });
      console.log('✅ Auth data cleared');
    }
    
    // Wait a bit before restarting
    await delay(2000);
    initializeWhatsApp();
  } catch (error) {
    console.log('❌ Error clearing auth:', error);
  }
};

// WhatsApp Connection - SIMPLIFIED AND FIXED
const initializeWhatsApp = async () => {
  try {
    console.log('🚀 STARTING WHATSAPP CONNECTION...');
    ensureAuthDir();
    connectionStatus = 'connecting';
    connectionStartTime = Date.now();
    
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
    
    console.log('📡 Creating WhatsApp socket...');
    
    MznKing = makeWASocket({
      logger: pino({ level: 'silent' }),
      printQRInTerminal: true,
      auth: state,
      version: [2, 2413, 1],
      browser: Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: true,
      syncFullHistory: false,
      generateHighQualityLinkPreview: true,
      connectTimeoutMs: 30000,
      keepAliveIntervalMs: 10000,
    });

    console.log('✅ WhatsApp socket created, setting up listeners...');

    // Connection update listener
    MznKing.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      console.log('🔔 CONNECTION UPDATE:', { 
        connection, 
        hasQR: !!qr,
        status: connectionStatus 
      });

      // Handle QR Code
      if (qr) {
        console.log('📱 QR CODE RECEIVED');
        connectionStatus = 'qr_waiting';
        qrCodeData = qr;
        
        // Generate QR code image
        try {
          const qrImageUrl = await QRCode.toDataURL(qr);
          qrCodeData = qrImageUrl;
          console.log('✅ QR Code generated successfully');
        } catch (qrError) {
          console.log('❌ QR Code generation failed:', qrError);
        }
      }
      
      // Handle Connecting
      if (connection === 'connecting') {
        console.log('🔄 CONNECTING TO WHATSAPP...');
        connectionStatus = 'connecting';
      }
      
      // Handle Connected
      if (connection === 'open') {
        console.log('🎉 WHATSAPP CONNECTED SUCCESSFULLY!');
        connectionStatus = 'connected';
        qrCodeData = null;
        
        // Get user info
        try {
          const user = MznKing.user;
          console.log('👤 USER INFO:', {
            id: user?.id,
            name: user?.name,
            phone: user?.phone
          });
        } catch (userError) {
          console.log('ℹ️ Could not get user info:', userError);
        }
      }
      
      // Handle Disconnection
      if (connection === 'close') {
        console.log('❌ WHATSAPP DISCONNECTED');
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        
        console.log('📊 Disconnect details:', {
          statusCode,
          error: lastDisconnect?.error?.message
        });

        // Check if logged out
        if (statusCode === DisconnectReason.loggedOut) {
          console.log('🚫 LOGGED OUT FROM WHATSAPP');
          connectionStatus = 'logged_out';
          setTimeout(() => clearAuthAndRestart(), 3000);
        } else {
          console.log('🔄 RECONNECTION REQUIRED');
          connectionStatus = 'reconnecting';
          setTimeout(() => initializeWhatsApp(), 5000);
        }
      }
    });

    // Credentials update listener
    MznKing.ev.on('creds.update', saveCreds);
    
    console.log('✅ WhatsApp initialization completed');
    
  } catch (error) {
    console.error('💥 WHATSAPP INITIALIZATION FAILED:', error);
    connectionStatus = 'error';
    
    // Retry after 10 seconds
    setTimeout(() => {
      console.log('🔄 Retrying WhatsApp initialization...');
      initializeWhatsApp();
    }, 10000);
  }
};

// Start WhatsApp immediately
console.log('🎬 STARTING WHATSAPP SERVER...');
initializeWhatsApp();

// Utility functions
function generateStopKey() {
  return 'STOP-' + Math.floor(100000 + Math.random() * 900000);
}

function formatPhoneNumber(phone) {
  let cleaned = phone.replace(/\D/g, '');
  
  if (cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1);
  }
  
  if (!cleaned.startsWith('91') && !cleaned.startsWith('1') && !cleaned.startsWith('44')) {
    cleaned = '91' + cleaned;
  }
  
  return cleaned;
}

// Routes
app.get('/', (req, res) => {
  const showStopKey = sendingActive && stopKey;
  
  // Status configuration
  let statusConfig = {
    connected: {
      status: '🟢 CONNECTED',
      color: '#1dd1a1',
      message: 'Ready to send messages!',
      showPairing: true
    },
    qr_waiting: {
      status: '🟠 SCAN QR CODE',
      color: '#ff9ff3', 
      message: 'Scan QR code with your WhatsApp',
      showPairing: false
    },
    connecting: {
      status: '🟡 CONNECTING...',
      color: '#feca57',
      message: 'Connecting to WhatsApp...',
      showPairing: false
    },
    reconnecting: {
      status: '🟠 RECONNECTING...',
      color: '#feca57',
      message: 'Reconnecting to WhatsApp...',
      showPairing: false
    },
    logged_out: {
      status: '🔴 LOGGED OUT',
      color: '#ff6b6b',
      message: 'Please scan QR code again',
      showPairing: false
    },
    error: {
      status: '🔴 ERROR',
      color: '#ff6b6b',
      message: 'Connection error, retrying...',
      showPairing: false
    },
    initializing: {
      status: '🟡 INITIALIZING...',
      color: '#feca57',
      message: 'Starting WhatsApp connection...',
      showPairing: false
    }
  };

  const config = statusConfig[connectionStatus] || statusConfig.initializing;
  const sendingStatus = sendingActive ? '🟢 ACTIVE' : '🔴 INACTIVE';

  res.send(`
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>WhatsApp Bulk Messenger</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap');
      
      * { margin: 0; padding: 0; box-sizing: border-box; }
      
      body {
        margin: 0;
        padding: 20px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        font-family: 'Poppins', sans-serif;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      
      .container {
        width: 95%;
        max-width: 500px;
        background: rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(20px);
        padding: 30px;
        border-radius: 20px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: white;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
        text-align: center;
      }
      
      h1 { 
        color: white; 
        margin-bottom: 20px;
        font-size: 24px;
      }
      
      .status-card {
        background: rgba(255, 255, 255, 0.15);
        padding: 20px;
        border-radius: 15px;
        margin: 15px 0;
        border: 1px solid rgba(255, 255, 255, 0.2);
      }
      
      .qr-section {
        background: rgba(255, 255, 255, 0.2);
        padding: 20px;
        border-radius: 15px;
        margin: 20px 0;
        border: 2px dashed rgba(255, 255, 255, 0.3);
      }
      
      .qr-code {
        background: white;
        padding: 15px;
        border-radius: 10px;
        display: inline-block;
        margin: 10px 0;
      }
      
      .qr-code img {
        max-width: 200px;
        height: auto;
        border-radius: 5px;
      }
      
      input, button, textarea {
        width: 100%;
        padding: 12px;
        margin: 8px 0;
        border-radius: 8px;
        border: 2px solid rgba(255, 255, 255, 0.3);
        background: rgba(255, 255, 255, 0.1);
        color: white;
        font-size: 16px;
        font-family: 'Poppins', sans-serif;
      }
      
      textarea {
        height: 100px;
        resize: vertical;
      }
      
      button {
        background: #ffcc00;
        color: black;
        font-weight: bold;
        border: none;
        cursor: pointer;
        transition: all 0.3s ease;
      }
      
      button:hover {
        transform: translateY(-2px);
        box-shadow: 0 5px 15px rgba(255, 204, 0, 0.4);
      }
      
      button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        transform: none;
      }
      
      .btn-pair {
        background: #48dbfb;
      }
      
      .btn-start {
        background: #1dd1a1;
      }
      
      .btn-stop {
        background: #ff6b6b;
        color: white;
      }
      
      .instructions {
        background: rgba(255, 255, 255, 0.1);
        padding: 15px;
        border-radius: 10px;
        margin: 15px 0;
        text-align: left;
        font-size: 14px;
      }
      
      .action-buttons {
        display: flex;
        gap: 10px;
        margin: 15px 0;
      }
      
      .action-buttons button {
        flex: 1;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>🚀 WhatsApp Bulk Messenger</h1>
      
      <div class="status-card">
        <div style="font-size: 18px; font-weight: bold; color: ${config.color};">
          ${config.status}
        </div>
        <div style="margin-top: 8px; font-size: 14px;">
          ${config.message}
        </div>
      </div>

      ${connectionStatus === 'qr_waiting' && qrCodeData ? `
      <div class="qr-section">
        <h3 style="margin-bottom: 15px;">
          <i class="fas fa-qrcode"></i> Scan QR Code
        </h3>
        <div class="qr-code">
          <img src="${qrCodeData}" alt="WhatsApp QR Code" />
        </div>
        <p style="margin-top: 15px; font-size: 14px;">
          <i class="fas fa-mobile-alt"></i> Open WhatsApp → Settings → Linked Devices → Scan QR Code
        </p>
      </div>
      ` : ''}

      ${config.showPairing ? `
      <div class="instructions">
        <strong>📞 Pair with Phone Number:</strong><br>
        Enter your phone number to get pairing code
      </div>

      <form action="/generate-pairing-code" method="post">
        <input type="text" name="phoneNumber" placeholder="91XXXXXXXXXX" required 
               pattern="[0-9]{10,12}" title="Enter 10-12 digit phone number" />
        <button type="submit" class="btn-pair">
          <i class="fas fa-link"></i> Get Pairing Code
        </button>
      </form>
      ` : ''}

      ${connectionStatus === 'connected' ? `
      <div class="instructions">
        <strong>💡 Ready to Send Messages!</strong><br>
        You can now use pairing code or proceed to message sending
      </div>

      <div class="action-buttons">
        <button onclick="showPairingForm()" class="btn-pair">
          <i class="fas fa-link"></i> Pair New Number
        </button>
        <button onclick="showMessageForm()" class="btn-start">
          <i class="fas fa-paper-plane"></i> Send Messages
        </button>
      </div>

      <div id="messageForm" style="display: none;">
        <form action="/send-messages" method="post" enctype="multipart/form-data">
          <input type="text" name="targetsInput" placeholder="Target numbers: 91XXXXXXXXXX, 91XXXXXXXXXX" required />
          
          <div style="text-align: left; margin: 10px 0;">
            <label style="display: block; margin-bottom: 5px;">
              <i class="fas fa-file-upload"></i> Message File (.txt)
            </label>
            <input type="file" name="messageFile" accept=".txt" required />
            <small style="color: rgba(255,255,255,0.7);">One message per line</small>
          </div>
          
          <input type="text" name="haterNameInput" placeholder="Sender name" required />
          <input type="number" name="delayTime" placeholder="Delay in seconds (min 5)" min="5" required />
          
          <button type="submit" class="btn-start">
            <i class="fas fa-play"></i> Start Sending
          </button>
        </form>
      </div>
      ` : ''}

      ${showStopKey ? `
      <div class="status-card" style="background: rgba(255,107,107,0.2);">
        <strong>🔑 Your Stop Key:</strong>
        <input type="text" value="${stopKey}" readonly 
               style="background: white; color: black; font-weight: bold; text-align: center;" />
        <form action="/stop" method="post" style="margin-top: 10px;">
          <input type="text" name="stopKeyInput" placeholder="Enter stop key" />
          <button type="submit" class="btn-stop">Stop Sending</button>
        </form>
      </div>
      ` : ''}

      <!-- Connection troubleshooting -->
      ${!config.showPairing && connectionStatus !== 'connected' ? `
      <div class="instructions" style="background: rgba(255,107,107,0.2);">
        <strong>🔧 Connection Tips:</strong><br>
        • Wait for QR code to appear<br>
        • Scan with WhatsApp within 20 seconds<br>
        • Keep phone with active internet<br>
        • Page auto-refreshes every 10 seconds
      </div>
      ` : ''}

      <script>
        // Show/hide forms
        function showPairingForm() {
          document.querySelector('form[action="/generate-pairing-code"]').style.display = 'block';
          document.getElementById('messageForm').style.display = 'none';
        }
        
        function showMessageForm() {
          document.querySelector('form[action="/generate-pairing-code"]').style.display = 'none';
          document.getElementById('messageForm').style.display = 'block';
        }
        
        // Format phone number input
        document.querySelector('input[name="phoneNumber"]')?.addEventListener('input', function(e) {
          this.value = this.value.replace(/\\D/g, '');
        });
        
        // Auto-refresh if not connected
        const currentStatus = '${connectionStatus}';
        if (currentStatus !== 'connected') {
          setTimeout(() => {
            console.log('🔄 Auto-refreshing page...');
            window.location.reload();
          }, 10000);
        }
        
        // Show message form by default if connected
        if (currentStatus === 'connected') {
          showMessageForm();
        }
      </script>
    </div>
  </body>
  </html>
  `);
});

app.post('/generate-pairing-code', async (req, res) => {
  try {
    const phoneNumber = req.body.phoneNumber;
    
    if (!phoneNumber) {
      throw new Error('Phone number is required');
    }

    // Check connection status
    if (connectionStatus !== 'connected') {
      throw new Error('WhatsApp is not connected. Please wait for connection or scan QR code first.');
    }

    if (!MznKing) {
      throw new Error('WhatsApp client not ready. Please wait a moment and try again.');
    }

    // Format phone number
    const formattedNumber = formatPhoneNumber(phoneNumber);
    console.log('📞 Requesting pairing code for:', formattedNumber);

    // Request pairing code
    const pairingCode = await MznKing.requestPairingCode(formattedNumber);
    
    console.log('✅ Pairing code generated:', pairingCode);

    res.send(`
      <div style="text-align:center;padding:50px;color:white;background:linear-gradient(135deg, #667eea 0%, #764ba2 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;">
        <div style="background:rgba(0,0,0,0.8);padding:40px;border-radius:25px;border:2px solid #1dd1a1;max-width:500px;width:90%;">
          <h2 style="color:#1dd1a1;margin-bottom:20px;">
            <i class="fas fa-check-circle"></i> Pairing Code Generated
          </h2>
          <div style="background:white;color:black;padding:30px;margin:25px 0;border-radius:15px;font-size:2rem;font-weight:bold;letter-spacing:5px;border:3px solid #1dd1a1;font-family: monospace;">
            ${pairingCode}
          </div>
          <div style="background:rgba(29,209,161,0.2);padding:15px;border-radius:10px;margin-bottom:20px;">
            <p><strong>📱 How to use:</strong></p>
            <ol style="text-align:left;padding-left:20px;">
              <li>Open WhatsApp on your phone</li>
              <li>Go to Settings → Linked Devices</li>
              <li>Tap "Link a Device"</li>
              <li>Enter the code above</li>
            </ol>
          </div>
          <a href="/" style="background:#1dd1a1;color:white;padding:12px 30px;text-decoration:none;border-radius:10px;font-weight:600;display:inline-block;">
            <i class="fas fa-arrow-left"></i> Back to Home
          </a>
        </div>
      </div>
    `);
  } catch (error) {
    console.error('❌ Pairing code error:', error);
    
    res.send(`
      <div style="text-align:center;padding:50px;color:white;background:linear-gradient(135deg, #667eea 0%, #764ba2 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;">
        <div style="background:rgba(0,0,0,0.8);padding:40px;border-radius:20px;border:2px solid #ff6b6b;">
          <h2 style="color:#ff6b6b;margin-bottom:20px;">
            <i class="fas fa-times-circle"></i> Pairing Failed
          </h2>
          <div style="background:rgba(255,107,107,0.2);padding:15px;border-radius:10px;margin-bottom:20px;">
            <p><strong>Error:</strong> ${error.message}</p>
          </div>
          <div style="background:rgba(254,202,87,0.2);padding:15px;border-radius:10px;margin-bottom:20px;">
            <p><strong>💡 Solution:</strong> Try scanning QR code instead - it's more reliable!</p>
          </div>
          <a href="/" style="background:#ff6b6b;color:white;padding:12px 30px;text-decoration:none;border-radius:10px;font-weight:600;">
            <i class="fas fa-arrow-left"></i> Back to Home
          </a>
        </div>
      </div>
    `);
  }
});

app.post('/send-messages', upload.single('messageFile'), async (req, res) => {
  try {
    const { targetsInput, delayTime, haterNameInput } = req.body;

    if (!req.file) {
      throw new Error('Please upload a message file');
    }

    if (!targetsInput || !delayTime || !haterNameInput) {
      throw new Error('All fields are required');
    }

    const delayValue = parseInt(delayTime);
    if (delayValue < 5) {
      throw new Error('Delay must be at least 5 seconds');
    }

    if (connectionStatus !== 'connected') {
      throw new Error('WhatsApp is not connected. Please connect first.');
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
    haterName = haterNameInput;
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

      const fullMessage = `${haterName} ${messages[msgIndex]}`;
      
      for (const target of targets) {
        try {
          const formattedTarget = formatPhoneNumber(target);
          const jid = formattedTarget.includes('@g.us') ? formattedTarget : formattedTarget + '@s.whatsapp.net';
          
          if (MznKing && connectionStatus === 'connected') {
            await MznKing.sendMessage(jid, { text: fullMessage });
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
        <div style="background:rgba(0,0,0,0.8);padding:40px;border-radius:20px;border:2px solid #ff6b6b;">
          <h2 style="color:#ff6b6b;margin-bottom:20px;">Error Starting Messages</h2>
          <p style="margin-bottom:30px;">${error.message}</p>
          <a href="/" style="background:#ff6b6b;color:white;padding:12px 30px;text-decoration:none;border-radius:10px;font-weight:600;">
            Back to Home
          </a>
        </div>
      </div>
    `);
  }
});

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
        <div style="background:rgba(0,0,0,0.8);padding:40px;border-radius:20px;border:2px solid #1dd1a1;">
          <h2 style="color:#1dd1a1;margin-bottom:20px;">Sending Stopped</h2>
          <p style="margin-bottom:30px;">All message sending has been cancelled</p>
          <a href="/" style="background:#1dd1a1;color:white;padding:12px 30px;text-decoration:none;border-radius:10px;font-weight:600;">
            Back to Home
          </a>
        </div>
      </div>
    `);
  } else {
    res.send(`
      <div style="text-align:center;padding:50px;color:white;background:linear-gradient(135deg, #667eea 0%, #764ba2 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;">
        <div style="background:rgba(0,0,0,0.8);padding:40px;border-radius:20px;border:2px solid #ff6b6b;">
          <h2 style="color:#ff6b6b;margin-bottom:20px;">Invalid Stop Key</h2>
          <p style="margin-bottom:30px;">Please enter the correct stop key</p>
          <a href="/" style="background:#ff6b6b;color:white;padding:12px 30px;text-decoration:none;border-radius:10px;font-weight:600;">
            Back to Home
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
    uptime: Math.floor((Date.now() - connectionStartTime) / 1000)
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`✅ Health: http://0.0.0.0:${PORT}/health`);
  console.log(`📱 Interface: http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Shutting down gracefully...');
  process.exit(0);
});
