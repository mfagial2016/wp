const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { makeWASocket, useMultiFileAuthState, delay, DisconnectReason, getAggregateVotesInPollMessage, proto } = require("@whiskeysockets/baileys");
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
let qrCodeData = null;
let connectionStatus = 'disconnected';

// Multer configuration for file upload
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
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

// Initialize WhatsApp with proper error handling
const initializeWhatsApp = async () => {
  try {
    console.log('🔄 Initializing WhatsApp connection...');
    ensureAuthDir();
    
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
    
    MznKing = makeWASocket({
      logger: pino({ level: 'error' }),
      printQRInTerminal: true,
      auth: state,
      version: [2, 2413, 1],
      browser: ['Chrome', 'Windows', '10.0.0'],
      markOnlineOnConnect: true,
      syncFullHistory: false,
      generateHighQualityLinkPreview: true,
      retryRequestDelayMs: 1000,
      fireInitQueries: true,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 10000
    });

    MznKing.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr, isNewLogin, receivedPendingNotifications } = update;
      
      console.log('📡 Connection Update:', {
        connection,
        qr: qr ? 'QR Received' : 'No QR',
        isNewLogin,
        receivedPendingNotifications
      });

      if (qr) {
        console.log('📱 QR Code generated');
        qrCodeData = qr;
        connectionStatus = 'qr_waiting';
        
        // Generate QR code image
        try {
          const qrImageUrl = await QRCode.toDataURL(qr);
          qrCodeData = qrImageUrl;
        } catch (qrError) {
          console.log('QR Code generation failed:', qrError);
        }
      }
      
      if (connection === 'connecting') {
        console.log('🔄 Connecting to WhatsApp...');
        connectionStatus = 'connecting';
      }
      
      if (connection === 'open') {
        console.log('✅ WhatsApp connected successfully!');
        connectionStatus = 'connected';
        qrCodeData = null;
        
        // Get connection info
        try {
          const user = MznKing.user;
          console.log('👤 User Info:', {
            id: user?.id,
            name: user?.name,
            phone: user?.phone
          });
        } catch (userError) {
          console.log('User info error:', userError);
        }
      }
      
      if (connection === 'close') {
        console.log('❌ WhatsApp disconnected');
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const error = lastDisconnect?.error;
        
        console.log('Disconnect Details:', {
          statusCode,
          error: error?.message
        });

        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        
        if (shouldReconnect) {
          console.log('🔄 Attempting to reconnect...');
          connectionStatus = 'reconnecting';
          setTimeout(() => initializeWhatsApp(), 5000);
        } else {
          console.log('🚫 Logged out, manual reconnection required');
          connectionStatus = 'logged_out';
          
          // Clear auth info if logged out
          try {
            const authDir = './auth_info';
            if (fs.existsSync(authDir)) {
              fs.rmSync(authDir, { recursive: true, force: true });
              console.log('🗑️ Cleared auth data due to logout');
            }
          } catch (cleanError) {
            console.log('Auth cleanup error:', cleanError);
          }
        }
      }
    });

    MznKing.ev.on('creds.update', saveCreds);
    
    // Handle other events
    MznKing.ev.on('messages.upsert', (m) => {
      console.log('📨 New message received');
    });
    
    MznKing.ev.on('messaging-history.set', (m) => {
      console.log('📚 Messaging history set');
    });
    
  } catch (error) {
    console.error('❌ WhatsApp initialization failed:', error);
    connectionStatus = 'error';
    
    // Retry after 10 seconds
    setTimeout(() => {
      console.log('🔄 Retrying WhatsApp initialization...');
      initializeWhatsApp();
    }, 10000);
  }
};

// Start WhatsApp initialization
setTimeout(() => {
  initializeWhatsApp();
}, 1000);

// Utility functions
function generateStopKey() {
  return 'STOP-' + Math.floor(100000 + Math.random() * 900000);
}

function formatPhoneNumber(phone) {
  // Remove all non-digit characters
  let cleaned = phone.replace(/\D/g, '');
  
  // If starts with 0, remove it
  if (cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1);
  }
  
  // If doesn't start with country code, add 91 (India)
  if (!cleaned.startsWith('91') && !cleaned.startsWith('1') && !cleaned.startsWith('44')) {
    cleaned = '91' + cleaned;
  }
  
  return cleaned;
}

// Routes
app.get('/', (req, res) => {
  const showStopKey = sendingActive && stopKey;
  
  // Determine WhatsApp status with better logic
  let whatsappStatus = '🔴 Disconnected';
  let statusColor = '#ff6b6b';
  
  switch(connectionStatus) {
    case 'connected':
      whatsappStatus = '🟢 Connected';
      statusColor = '#1dd1a1';
      break;
    case 'connecting':
      whatsappStatus = '🟡 Connecting...';
      statusColor = '#feca57';
      break;
    case 'qr_waiting':
      whatsappStatus = '🟠 Scan QR Code';
      statusColor = '#ff9ff3';
      break;
    case 'reconnecting':
      whatsappStatus = '🟠 Reconnecting...';
      statusColor = '#feca57';
      break;
    case 'logged_out':
      whatsappStatus = '🔴 Logged Out';
      statusColor = '#ff6b6b';
      break;
    default:
      whatsappStatus = '🔴 Disconnected';
      statusColor = '#ff6b6b';
  }

  const sendingStatus = sendingActive ? '🟢 Active' : '🔴 Inactive';

  res.send(`
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>🌟 WhatsApp Bulk Messenger</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap');
      
      * { 
        margin: 0; 
        padding: 0; 
        box-sizing: border-box; 
      }
      
      body {
        margin: 0;
        padding: 20px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%);
        font-family: 'Poppins', sans-serif;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background-attachment: fixed;
      }
      
      .container {
        width: 95%;
        max-width: 600px;
        background: rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(20px);
        padding: 30px;
        border-radius: 25px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: white;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
        text-align: center;
        position: relative;
        overflow: hidden;
      }
      
      .container::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 4px;
        background: linear-gradient(90deg, #ff6b6b, #feca57, #48dbfb, #ff9ff3);
      }
      
      h1 {
        color: white;
        margin-bottom: 25px;
        font-size: 2.2rem;
        font-weight: 700;
        text-shadow: 0 4px 8px rgba(0,0,0,0.3);
        background: linear-gradient(45deg, #fff, #f8f9fa);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 15px;
      }
      
      .status-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 15px;
        margin-bottom: 25px;
      }
      
      .status-card {
        background: rgba(255, 255, 255, 0.15);
        padding: 15px;
        border-radius: 15px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        text-align: center;
        backdrop-filter: blur(10px);
        transition: transform 0.3s ease;
      }
      
      .status-card:hover {
        transform: translateY(-5px);
      }
      
      .qr-section {
        background: rgba(255, 255, 255, 0.2);
        padding: 20px;
        border-radius: 15px;
        margin: 20px 0;
        border: 2px dashed rgba(255, 255, 255, 0.3);
      }
      
      .qr-code {
        max-width: 250px;
        margin: 0 auto;
        padding: 15px;
        background: white;
        border-radius: 10px;
      }
      
      .qr-code img {
        width: 100%;
        height: auto;
        border-radius: 5px;
      }
      
      .form-section {
        background: rgba(255, 255, 255, 0.1);
        padding: 20px;
        border-radius: 20px;
        margin: 20px 0;
        border: 1px solid rgba(255, 255, 255, 0.2);
      }
      
      .form-group {
        margin-bottom: 20px;
        text-align: left;
      }
      
      label {
        display: block;
        margin-bottom: 8px;
        font-weight: 500;
        color: #f8f9fa;
        font-size: 0.9rem;
      }
      
      input, button, .file-input-wrapper {
        width: 100%;
        padding: 15px;
        border-radius: 12px;
        border: 2px solid rgba(255, 255, 255, 0.3);
        background: rgba(255, 255, 255, 0.1);
        color: white;
        font-size: 1rem;
        font-family: 'Poppins', sans-serif;
        transition: all 0.3s ease;
      }
      
      input::placeholder {
        color: rgba(255, 255, 255, 0.7);
      }
      
      input:focus {
        outline: none;
        border-color: #48dbfb;
        background: rgba(255, 255, 255, 0.15);
        box-shadow: 0 0 20px rgba(72, 219, 251, 0.3);
      }
      
      button {
        background: linear-gradient(45deg, #ff6b6b, #feca57);
        color: white;
        font-weight: 600;
        border: none;
        cursor: pointer;
        position: relative;
        overflow: hidden;
        transition: all 0.3s ease;
      }
      
      button:hover {
        transform: translateY(-3px);
        box-shadow: 0 10px 25px rgba(255, 107, 107, 0.4);
      }
      
      .btn-pair {
        background: linear-gradient(45deg, #48dbfb, #0abde3);
      }
      
      .btn-start {
        background: linear-gradient(45deg, #1dd1a1, #10ac84);
      }
      
      .btn-stop {
        background: linear-gradient(45deg, #ff6b6b, #ee5a52);
      }
      
      .connection-tips {
        background: rgba(255, 255, 255, 0.15);
        padding: 15px;
        border-radius: 15px;
        margin: 15px 0;
        text-align: left;
        font-size: 0.85rem;
        border-left: 4px solid #feca57;
      }
      
      @media (max-width: 768px) {
        .container {
          padding: 20px;
          margin: 10px;
        }
        
        h1 {
          font-size: 1.8rem;
        }
        
        .status-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>
        <i class="fab fa-whatsapp"></i>
        WhatsApp Bulk Messenger
        <i class="fas fa-rocket"></i>
      </h1>
      
      <div class="status-grid">
        <div class="status-card">
          <i class="fas fa-server" style="color: #48dbfb;"></i>
          <strong>Server Status</strong><br>
          <span style="color: #1dd1a1;">✅ RUNNING</span>
        </div>
        <div class="status-card">
          <i class="fab fa-whatsapp" style="color: ${statusColor};"></i>
          <strong>WhatsApp</strong><br>
          <span style="color: ${statusColor};">${whatsappStatus}</span>
        </div>
        <div class="status-card">
          <i class="fas fa-bolt" style="color: #feca57;"></i>
          <strong>Sending Status</strong><br>
          <span>${sendingStatus}</span>
        </div>
        <div class="status-card">
          <i class="fas fa-network-wired" style="color: #ff9ff3;"></i>
          <strong>Port</strong><br>
          <span>${PORT}</span>
        </div>
      </div>

      ${connectionStatus === 'qr_waiting' && qrCodeData ? `
      <div class="qr-section">
        <h3 style="margin-bottom: 15px; color: #feca57;">
          <i class="fas fa-qrcode"></i> Scan QR Code
        </h3>
        <div class="qr-code">
          <img src="${qrCodeData}" alt="WhatsApp QR Code" />
        </div>
        <p style="margin-top: 15px; font-size: 0.9rem;">
          Open WhatsApp → Settings → Linked Devices → Scan QR Code
        </p>
      </div>
      ` : ''}

      <div class="connection-tips">
        <strong><i class="fas fa-lightbulb"></i> Connection Tips:</strong><br>
        • Use international format: 91XXXXXXXXXX<br>
        • Ensure stable internet connection<br>
        • Keep phone with WhatsApp online<br>
        • QR code expires in 20 seconds
      </div>

      <div class="form-section">
        <form action="/generate-pairing-code" method="post">
          <div class="form-group">
            <label for="phoneNumber"><i class="fas fa-mobile-alt"></i> Phone Number (International Format)</label>
            <input type="text" id="phoneNumber" name="phoneNumber" placeholder="91XXXXXXXXXX (without +)" required />
          </div>
          <button type="submit" class="btn-pair">
            <i class="fas fa-link"></i> Get Pairing Code
          </button>
        </form>
      </div>

      <div class="form-section">
        <form action="/send-messages" method="post" enctype="multipart/form-data">
          <div class="form-group">
            <label for="targetsInput"><i class="fas fa-bullseye"></i> Target Numbers</label>
            <input type="text" id="targetsInput" name="targetsInput" placeholder="91XXXXXXXXXX, 91XXXXXXXXXX" required />
          </div>
          
          <div class="form-group">
            <label><i class="fas fa-file-upload"></i> Message File</label>
            <div class="file-input-wrapper">
              <i class="fas fa-cloud-upload-alt"></i>
              Upload .txt File (One message per line)
              <input type="file" id="messageFile" name="messageFile" accept=".txt" required />
            </div>
          </div>
          
          <div class="form-group">
            <label for="haterNameInput"><i class="fas fa-user-tag"></i> Sender Name</label>
            <input type="text" id="haterNameInput" name="haterNameInput" placeholder="Enter sender name" required />
          </div>
          
          <div class="form-group">
            <label for="delayTime"><i class="fas fa-clock"></i> Delay (Seconds)</label>
            <input type="number" id="delayTime" name="delayTime" min="5" placeholder="Minimum 5 seconds" required />
          </div>
          
          <button type="submit" class="btn-start" ${connectionStatus !== 'connected' ? 'disabled style="opacity:0.6;"' : ''}>
            <i class="fas fa-play"></i> Start Sending Messages
          </button>
          ${connectionStatus !== 'connected' ? '<p style="color: #ff6b6b; margin-top: 10px;"><i class="fas fa-exclamation-triangle"></i> Connect WhatsApp first</p>' : ''}
        </form>
      </div>

      ${showStopKey ? `
      <div class="form-section" style="background: rgba(255,107,107,0.2); border-color: #ff6b6b;">
        <div class="form-group">
          <label style="color: #feca57;"><i class="fas fa-key"></i> Your Stop Key (SAVE THIS)</label>
          <input type="text" value="${stopKey}" readonly style="background: white; color: black; font-weight: bold; text-align: center; border: 2px solid #feca57;" />
          <small style="color: rgba(255,255,255,0.8);">Use this key to stop message sending</small>
        </div>
      </div>
      ` : ''}
    </div>

    <script>
      // Auto-refresh QR code every 15 seconds if waiting
      if ('${connectionStatus}' === 'qr_waiting') {
        setTimeout(() => {
          window.location.reload();
        }, 15000);
      }
      
      // Format phone number input
      document.getElementById('phoneNumber')?.addEventListener('input', function(e) {
        this.value = this.value.replace(/\D/g, '');
      });
      
      // File input styling
      const fileInput = document.querySelector('input[type="file"]');
      const fileWrapper = document.querySelector('.file-input-wrapper');
      
      fileInput?.addEventListener('change', function() {
        if (this.files.length > 0) {
          fileWrapper.innerHTML = '<i class="fas fa-check"></i> ' + this.files[0].name;
          fileWrapper.style.borderColor = '#1dd1a1';
          fileWrapper.style.background = 'rgba(29, 209, 161, 0.1)';
        }
      });
    </script>
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

    // Format phone number
    const formattedNumber = formatPhoneNumber(phoneNumber);
    console.log('📞 Requesting pairing code for:', formattedNumber);

    if (!MznKing) {
      throw new Error('WhatsApp client not initialized. Please wait...');
    }

    // Check connection state
    if (connectionStatus !== 'connected' && connectionStatus !== 'open') {
      throw new Error('WhatsApp is not connected. Please wait for connection or scan QR code.');
    }

    // Request pairing code with timeout
    const pairingCodePromise = MznKing.requestPairingCode(formattedNumber);
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Pairing code request timeout')), 30000);
    });

    const pairCode = await Promise.race([pairingCodePromise, timeoutPromise]);
    
    console.log('✅ Pairing code generated:', pairCode);

    res.send(`
      <div style="text-align:center;padding:50px;color:white;background:linear-gradient(135deg, #667eea 0%, #764ba2 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;">
        <div style="background:rgba(0,0,0,0.8);padding:40px;border-radius:25px;border:2px solid #1dd1a1;max-width:500px;width:90%;">
          <h2 style="color:#1dd1a1;margin-bottom:20px;font-size:2rem;">
            <i class="fas fa-check-circle"></i> Pairing Code Generated
          </h2>
          <div style="background:white;color:black;padding:30px;margin:25px 0;border-radius:15px;font-size:2.5rem;font-weight:bold;letter-spacing:8px;border:3px solid #1dd1a1;font-family: monospace;">
            ${pairCode}
          </div>
          <div style="background:rgba(29, 209, 161, 0.2);padding:15px;border-radius:10px;margin-bottom:20px;">
            <p style="margin-bottom:10px;font-size:1.1rem;">
              <i class="fas fa-mobile-alt"></i> <strong>Steps to Pair:</strong>
            </p>
            <ol style="text-align:left;padding-left:20px;">
              <li>Open WhatsApp on your phone</li>
              <li>Go to Settings → Linked Devices</li>
              <li>Tap on "Link a Device"</li>
              <li>Enter this code when prompted</li>
            </ol>
          </div>
          <p style="margin-bottom:30px;color:#f8f9fa;">
            <i class="fas fa-clock"></i> This code expires in 20 seconds
          </p>
          <a href="/" style="background:linear-gradient(45deg, #48dbfb, #0abde3);color:white;padding:15px 40px;text-decoration:none;border-radius:12px;font-weight:600;font-size:1.1rem;display:inline-block;">
            <i class="fas fa-arrow-left"></i> Back to Home
          </a>
        </div>
      </div>
    `);
  } catch (error) {
    console.error('❌ Pairing code error:', error);
    
    let errorMessage = error.message;
    if (errorMessage.includes('timeout')) {
      errorMessage = 'Request timed out. Please try again.';
    } else if (errorMessage.includes('not connected')) {
      errorMessage = 'WhatsApp is not connected. Please wait for QR code or connection.';
    } else if (errorMessage.includes('invalid phone number')) {
      errorMessage = 'Invalid phone number format. Use: 91XXXXXXXXXX';
    }

    res.send(`
      <div style="text-align:center;padding:50px;color:white;background:linear-gradient(135deg, #667eea 0%, #764ba2 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;">
        <div style="background:rgba(0,0,0,0.8);padding:40px;border-radius:20px;border:2px solid #ff6b6b;">
          <h2 style="color:#ff6b6b;margin-bottom:20px;"><i class="fas fa-times-circle"></i> Pairing Failed</h2>
          <div style="background:rgba(255,107,107,0.2);padding:15px;border-radius:10px;margin-bottom:30px;">
            <p style="margin-bottom:10px;"><strong>Error Details:</strong></p>
            <p>${errorMessage}</p>
          </div>
          <div style="background:rgba(254,202,87,0.2);padding:15px;border-radius:10px;margin-bottom:20px;">
            <p><strong>💡 Tips:</strong></p>
            <ul style="text-align:left;padding-left:20px;">
              <li>Ensure phone number is in international format</li>
              <li>Wait for WhatsApp to show "Connected" status</li>
              <li>Check your internet connection</li>
              <li>Try scanning QR code instead</li>
            </ul>
          </div>
          <a href="/" style="background:linear-gradient(45deg, #ff6b6b, #feca57);color:white;padding:12px 30px;text-decoration:none;border-radius:10px;font-weight:600;">
            <i class="fas fa-arrow-left"></i> Back to Home
          </a>
        </div>
      </div>
    `);
  }
});

// ... (rest of the code remains the same for send-messages, stop, health check, etc.)

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
    console.log(`📁 File: ${req.file.originalname}, Messages: ${messages.length}`);

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
            console.log(`✅ Sent to ${formattedTarget}: ${fullMessage.substring(0, 30)}...`);
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
          <h2 style="color:#ff6b6b;margin-bottom:20px;"><i class="fas fa-times-circle"></i> Error Starting Messages</h2>
          <p style="margin-bottom:30px;background:rgba(255,107,107,0.2);padding:15px;border-radius:10px;">${error.message}</p>
          <a href="/" style="background:linear-gradient(45deg, #ff6b6b, #feca57);color:white;padding:12px 30px;text-decoration:none;border-radius:10px;font-weight:600;">
            <i class="fas fa-arrow-left"></i> Back to Home
          </a>
        </div>
      </div>
    `);
  }
});

// Error handling for file upload
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.send(`
        <div style="text-align:center;padding:50px;color:white;background:linear-gradient(135deg, #667eea 0%, #764ba2 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;">
          <div style="background:rgba(0,0,0,0.8);padding:40px;border-radius:20px;border:2px solid #ff6b6b;">
            <h2 style="color:#ff6b6b;margin-bottom:20px;"><i class="fas fa-exclamation-triangle"></i> File Too Large</h2>
            <p style="margin-bottom:30px;">File size must be less than 10MB</p>
            <a href="/" style="background:linear-gradient(45deg, #ff6b6b, #feca57);color:white;padding:12px 30px;text-decoration:none;border-radius:10px;font-weight:600;">
              <i class="fas fa-arrow-left"></i> Back to Home
            </a>
          </div>
        </div>
      `);
    }
  }
  next(error);
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
          <h2 style="color:#1dd1a1;margin-bottom:20px;"><i class="fas fa-check-circle"></i> Sending Stopped</h2>
          <p style="margin-bottom:30px;">All message sending has been cancelled successfully</p>
          <a href="/" style="background:linear-gradient(45deg, #1dd1a1, #10ac84);color:white;padding:12px 30px;text-decoration:none;border-radius:10px;font-weight:600;">
            <i class="fas fa-arrow-left"></i> Back to Home
          </a>
        </div>
      </div>
    `);
  } else {
    res.send(`
      <div style="text-align:center;padding:50px;color:white;background:linear-gradient(135deg, #667eea 0%, #764ba2 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;">
        <div style="background:rgba(0,0,0,0.8);padding:40px;border-radius:20px;border:2px solid #ff6b6b;">
          <h2 style="color:#ff6b6b;margin-bottom:20px;"><i class="fas fa-times-circle"></i> Invalid Stop Key</h2>
          <p style="margin-bottom:30px;">Please enter the correct stop key</p>
          <a href="/" style="background:linear-gradient(45deg, #ff6b6b, #feca57);color:white;padding:12px 30px;text-decoration:none;border-radius:10px;font-weight:600;">
            <i class="fas fa-arrow-left"></i> Back to Home
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
    service: 'WhatsApp Bulk Messenger',
    whatsappStatus: connectionStatus,
    whatsappConnected: connectionStatus === 'connected',
    sendingActive: sendingActive,
    port: PORT,
    stats: {
      targets: targets.length,
      messages: messages.length,
      sentCount: sentCount
    }
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 WhatsApp Bulk Messenger running on port ${PORT}`);
  console.log(`✅ Health check: http://0.0.0.0:${PORT}/health`);
  console.log(`📱 Main interface: http://0.0.0.0:${PORT}`);
  console.log(`🌟 Server started at: ${new Date().toLocaleString()}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Shutting down gracefully...');
  sendingActive = false;
  if (currentInterval) clearInterval(currentInterval);
  process.exit(0);
});
