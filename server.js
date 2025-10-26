const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { makeWASocket, useMultiFileAuthState, delay, DisconnectReason, Browsers } = require("@whiskeysockets/baileys");
const multer = require('multer');

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
let connectionStatus = 'disconnected';
let qrCode = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

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

// WhatsApp Connection with Better Error Handling
const initializeWhatsApp = async () => {
  try {
    console.log('🔄 Initializing WhatsApp connection...');
    ensureAuthDir();
    connectionStatus = 'connecting';
    
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
    
    MznKing = makeWASocket({
      logger: pino({ level: 'silent' }),
      printQRInTerminal: true,
      auth: state,
      version: [2, 2413, 1],
      browser: Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: true,
      syncFullHistory: false,
      generateHighQualityLinkPreview: true,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 10000,
      retryRequestDelayMs: 1000,
      fireInitQueries: true,
      emitOwnEvents: true,
      defaultQueryTimeoutMs: 60000
    });

    MznKing.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr, isNewLogin } = update;
      
      console.log('📡 Connection Update:', {
        connection,
        qr: qr ? 'QR Received' : 'No QR',
        isNewLogin
      });

      if (qr) {
        console.log('📱 QR Code received - Scan to connect');
        qrCode = qr;
        connectionStatus = 'qr_waiting';
        reconnectAttempts = 0; // Reset on QR receive
      }
      
      if (connection === 'connecting') {
        console.log('🔄 Connecting to WhatsApp...');
        connectionStatus = 'connecting';
      }
      
      if (connection === 'open') {
        console.log('✅ WhatsApp connected successfully!');
        connectionStatus = 'connected';
        qrCode = null;
        reconnectAttempts = 0;
        
        // Get user info
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

        // Check if logged out
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        
        if (shouldReconnect) {
          reconnectAttempts++;
          console.log(`🔄 Reconnection attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);
          
          if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
            connectionStatus = 'reconnecting';
            setTimeout(() => {
              console.log('🔄 Attempting reconnection...');
              initializeWhatsApp();
            }, 5000);
          } else {
            console.log('🚫 Max reconnection attempts reached');
            connectionStatus = 'disconnected';
            
            // Clear auth data after max attempts
            try {
              const authDir = './auth_info';
              if (fs.existsSync(authDir)) {
                fs.rmSync(authDir, { recursive: true, force: true });
                console.log('🗑️ Cleared auth data');
              }
            } catch (cleanError) {
              console.log('Auth cleanup error:', cleanError);
            }
            
            // Restart initialization after clearing data
            setTimeout(() => {
              reconnectAttempts = 0;
              initializeWhatsApp();
            }, 10000);
          }
        } else {
          console.log('🚫 Logged out from WhatsApp');
          connectionStatus = 'logged_out';
          qrCode = null;
          
          // Clear auth info
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
    
    // Handle connection errors
    MznKing.ev.on('connection.ready', () => {
      console.log('🎉 Connection ready!');
    });
    
    MznKing.ev.on('connection.failed', (error) => {
      console.log('❌ Connection failed:', error);
      connectionStatus = 'error';
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
console.log('🚀 Starting WhatsApp server...');
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
  
  let whatsappStatus = '🔴 Disconnected';
  let statusColor = '#ff6b6b';
  let statusMessage = 'Waiting for connection...';

  switch(connectionStatus) {
    case 'connected':
      whatsappStatus = '🟢 Connected';
      statusColor = '#1dd1a1';
      statusMessage = 'Ready to send messages!';
      break;
    case 'connecting':
      whatsappStatus = '🟡 Connecting...';
      statusColor = '#feca57';
      statusMessage = 'Connecting to WhatsApp...';
      break;
    case 'qr_waiting':
      whatsappStatus = '🟠 Scan QR Code';
      statusColor = '#ff9ff3';
      statusMessage = 'Scan QR code with your phone';
      break;
    case 'reconnecting':
      whatsappStatus = '🟠 Reconnecting...';
      statusColor = '#feca57';
      statusMessage = `Reconnecting... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`;
      break;
    case 'logged_out':
      whatsappStatus = '🔴 Logged Out';
      statusColor = '#ff6b6b';
      statusMessage = 'Please scan QR code again';
      break;
    default:
      whatsappStatus = '🔴 Disconnected';
      statusColor = '#ff6b6b';
      statusMessage = 'Initializing...';
  }

  const sendingStatus = sendingActive ? '🟢 Active' : '🔴 Inactive';

  res.send(`
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>WhatsApp Bulk Messenger</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js"></script>
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
        padding: 20px;
        border-radius: 10px;
        display: inline-block;
        margin: 10px 0;
      }
      
      input, button {
        width: 100%;
        padding: 12px;
        margin: 8px 0;
        border-radius: 8px;
        border: 2px solid rgba(255, 255, 255, 0.3);
        background: rgba(255, 255, 255, 0.1);
        color: white;
        font-size: 16px;
      }
      
      button {
        background: #ffcc00;
        color: black;
        font-weight: bold;
        border: none;
        cursor: pointer;
      }
      
      button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      
      .instructions {
        background: rgba(255, 255, 255, 0.1);
        padding: 15px;
        border-radius: 10px;
        margin: 15px 0;
        text-align: left;
        font-size: 14px;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>🚀 WhatsApp Bulk Messenger</h1>
      
      <div class="status-card">
        <strong>WhatsApp Status:</strong><br>
        <span style="color: ${statusColor}; font-weight: bold;">${whatsappStatus}</span><br>
        <small>${statusMessage}</small>
      </div>

      ${connectionStatus === 'qr_waiting' && qrCode ? `
      <div class="qr-section">
        <h3>📱 Scan QR Code</h3>
        <div class="qr-code" id="qrcode"></div>
        <p>Open WhatsApp → Settings → Linked Devices → Scan QR Code</p>
        <script>
          // Generate QR code
          const qr = qrcode(0, 'M');
          qr.addData('${qrCode}');
          qr.make();
          document.getElementById('qrcode').innerHTML = qr.createImgTag(4);
        </script>
      </div>
      ` : ''}

      <div class="instructions">
        <strong>💡 Connection Guide:</strong><br>
        1. Wait for QR code to appear<br>
        2. Scan with your WhatsApp<br>
        3. Wait for "Connected" status<br>
        4. Then use pairing code if needed
      </div>

      <form action="/generate-pairing-code" method="post">
        <input type="text" name="phoneNumber" placeholder="91XXXXXXXXXX" required />
        <button type="submit" ${connectionStatus !== 'connected' ? 'disabled' : ''}>
          🔗 Get Pairing Code
        </button>
        ${connectionStatus !== 'connected' ? '<p style="color: #ff6b6b; margin-top: 10px;">Connect WhatsApp first</p>' : ''}
      </form>

      <!-- Auto-refresh script -->
      <script>
        // Auto-refresh every 5 seconds if not connected
        if ('${connectionStatus}' !== 'connected') {
          setTimeout(() => {
            window.location.reload();
          }, 5000);
        }
        
        // Format phone number input
        document.querySelector('input[name="phoneNumber"]')?.addEventListener('input', function(e) {
          this.value = this.value.replace(/\D/g, '');
        });
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
      throw new Error('WhatsApp is not connected. Please wait for QR code scanning and connection establishment.');
    }

    if (!MznKing) {
      throw new Error('WhatsApp client not ready. Please wait...');
    }

    // Format phone number
    const formattedNumber = formatPhoneNumber(phoneNumber);
    console.log('📞 Requesting pairing code for:', formattedNumber);

    // Request pairing code with timeout
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
          <p style="margin-bottom:30px;">
            Enter this code in WhatsApp Linked Devices section
          </p>
          <a href="/" style="background:#1dd1a1;color:white;padding:12px 30px;text-decoration:none;border-radius:10px;font-weight:600;">
            ← Back to Home
          </a>
        </div>
      </div>
    `);
  } catch (error) {
    console.error('❌ Pairing code error:', error);
    
    let errorMessage = error.message;
    let solution = '';
    
    if (errorMessage.includes('not connected')) {
      solution = 'Please wait for WhatsApp to connect via QR code first.';
    } else if (errorMessage.includes('timeout')) {
      solution = 'Request timed out. Please try again.';
    } else if (errorMessage.includes('invalid phone number')) {
      solution = 'Please use correct format: 91XXXXXXXXXX';
    } else {
      solution = 'Try scanning QR code instead.';
    }

    res.send(`
      <div style="text-align:center;padding:50px;color:white;background:linear-gradient(135deg, #667eea 0%, #764ba2 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;">
        <div style="background:rgba(0,0,0,0.8);padding:40px;border-radius:20px;border:2px solid #ff6b6b;">
          <h2 style="color:#ff6b6b;margin-bottom:20px;">
            <i class="fas fa-times-circle"></i> Pairing Failed
          </h2>
          <div style="background:rgba(255,107,107,0.2);padding:15px;border-radius:10px;margin-bottom:20px;">
            <p><strong>Error:</strong> ${errorMessage}</p>
            <p><strong>Solution:</strong> ${solution}</p>
          </div>
          <div style="background:rgba(254,202,87,0.2);padding:15px;border-radius:10px;margin-bottom:20px;">
            <p><strong>Alternative:</strong> Use QR code scanning instead of pairing code</p>
          </div>
          <a href="/" style="background:#ff6b6b;color:white;padding:12px 30px;text-decoration:none;border-radius:10px;font-weight:600;">
            ← Back to Home
          </a>
        </div>
      </div>
    `);
  }
});

// ... (rest of the routes remain similar)

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    whatsappStatus: connectionStatus,
    whatsappConnected: connectionStatus === 'connected',
    sendingActive: sendingActive,
    reconnectAttempts: reconnectAttempts
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`✅ Health: http://0.0.0.0:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Shutting down...');
  process.exit(0);
});
