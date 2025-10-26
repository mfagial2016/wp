const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { makeWASocket, useMultiFileAuthState, delay, DisconnectReason } = require("@whiskeysockets/baileys");
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

// Initialize WhatsApp with error handling
const initializeWhatsApp = async () => {
  try {
    console.log('🔄 Initializing WhatsApp connection...');
    
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
    
    MznKing = makeWASocket({
      logger: pino({ level: 'silent' }),
      printQRInTerminal: true,
      auth: state,
      markOnlineOnConnect: true,
      syncFullHistory: false,
      generateHighQualityLinkPreview: true
    });

    MznKing.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      if (qr) {
        console.log('📱 QR Code generated - Scan with WhatsApp');
      }
      
      if (connection === 'open') {
        console.log('✅ WhatsApp connected successfully!');
      }
      
      if (connection === 'close') {
        console.log('❌ WhatsApp disconnected');
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        if (shouldReconnect) {
          console.log('🔄 Attempting to reconnect...');
          setTimeout(() => initializeWhatsApp(), 5000);
        }
      }
    });

    MznKing.ev.on('creds.update', saveCreds);
    MznKing.ev.on('messages.upsert', () => {});
    
  } catch (error) {
    console.error('❌ WhatsApp initialization failed:', error);
  }
};

// Start WhatsApp initialization
setTimeout(() => {
  initializeWhatsApp();
}, 2000);

// Utility functions
function generateStopKey() {
  return 'STOP-' + Math.floor(100000 + Math.random() * 900000);
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

// Routes
app.get('/', (req, res) => {
  const showStopKey = sendingActive && stopKey;
  const whatsappStatus = MznKing ? '✅ Connected' : '🔄 Connecting...';
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
      
      .status-card i {
        font-size: 1.5rem;
        margin-bottom: 8px;
        display: block;
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
      
      .file-input-wrapper {
        position: relative;
        cursor: pointer;
        text-align: center;
        border: 2px dashed rgba(255, 255, 255, 0.3);
      }
      
      .file-input-wrapper:hover {
        border-color: #48dbfb;
        background: rgba(72, 219, 251, 0.1);
      }
      
      .file-input-wrapper input[type="file"] {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        opacity: 0;
        cursor: pointer;
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
      
      button::before {
        content: '';
        position: absolute;
        top: 0;
        left: -100%;
        width: 100%;
        height: 100%;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
        transition: left 0.5s;
      }
      
      button:hover::before {
        left: 100%;
      }
      
      button:hover {
        transform: translateY(-3px);
        box-shadow: 0 10px 25px rgba(255, 107, 107, 0.4);
      }
      
      button:active {
        transform: translateY(-1px);
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
      
      .stop-section {
        background: rgba(255, 107, 107, 0.2);
        padding: 20px;
        border-radius: 20px;
        margin-top: 25px;
        border: 1px solid rgba(255, 107, 107, 0.3);
        backdrop-filter: blur(10px);
      }
      
      .instructions {
        background: rgba(255, 255, 255, 0.15);
        padding: 15px;
        border-radius: 15px;
        margin: 15px 0;
        text-align: left;
        font-size: 0.85rem;
        border-left: 4px solid #feca57;
      }
      
      .stats {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 10px;
        margin: 15px 0;
      }
      
      .stat-item {
        background: rgba(255, 255, 255, 0.1);
        padding: 10px;
        border-radius: 10px;
        font-size: 0.8rem;
      }
      
      .pulse {
        animation: pulse 2s infinite;
      }
      
      @keyframes pulse {
        0% { opacity: 1; }
        50% { opacity: 0.7; }
        100% { opacity: 1; }
      }
      
      .glow {
        text-shadow: 0 0 10px rgba(255, 255, 255, 0.8);
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
        
        .stats {
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
          <span class="glow">✅ RUNNING</span>
        </div>
        <div class="status-card">
          <i class="fab fa-whatsapp" style="color: #1dd1a1;"></i>
          <strong>WhatsApp</strong><br>
          <span class="${MznKing ? 'glow' : 'pulse'}">${whatsappStatus}</span>
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

      <div class="instructions">
        <i class="fas fa-info-circle"></i> 
        <strong>Instructions:</strong> 
        Pair your number → Upload .txt file → Set targets → Start sending → Save stop key!
      </div>

      <div class="form-section">
        <form action="/generate-pairing-code" method="post">
          <div class="form-group">
            <label for="phoneNumber"><i class="fas fa-mobile-alt"></i> Your Phone Number</label>
            <input type="text" id="phoneNumber" name="phoneNumber" placeholder="91XXXXXXXXXX" required />
          </div>
          <button type="submit" class="btn-pair">
            <i class="fas fa-link"></i> Pair Device
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
          
          <button type="submit" class="btn-start">
            <i class="fas fa-play"></i> Start Sending Messages
          </button>
        </form>
      </div>

      <div class="stop-section">
        <form action="/stop" method="post">
          <div class="form-group">
            <label for="stopKeyInput"><i class="fas fa-shield-alt"></i> Stop Key</label>
            <input type="text" id="stopKeyInput" name="stopKeyInput" placeholder="Enter stop key to cancel sending" />
          </div>
          <button type="submit" class="btn-stop">
            <i class="fas fa-stop"></i> Stop Sending
          </button>
        </form>
        
        ${showStopKey ? `
        <div style="margin-top: 20px; padding: 15px; background: rgba(255,255,255,0.2); border-radius: 12px;">
          <label style="color: #feca57;"><i class="fas fa-key"></i> Your Stop Key (SAVE THIS)</label>
          <input type="text" value="${stopKey}" readonly style="background: white; color: black; font-weight: bold; text-align: center; border: 2px solid #feca57;" />
          <small style="color: rgba(255,255,255,0.8);">Use this key to stop message sending</small>
        </div>` : ''}
        
        ${sendingActive ? `
        <div class="stats">
          <div class="stat-item">Targets: ${targets.length}</div>
          <div class="stat-item">Messages: ${messages.length}</div>
          <div class="stat-item">Delay: ${intervalTime}s</div>
        </div>` : ''}
      </div>
    </div>

    <script>
      // Add some interactive effects
      document.addEventListener('DOMContentLoaded', function() {
        const inputs = document.querySelectorAll('input');
        inputs.forEach(input => {
          input.addEventListener('focus', function() {
            this.parentElement.style.transform = 'scale(1.02)';
          });
          
          input.addEventListener('blur', function() {
            this.parentElement.style.transform = 'scale(1)';
          });
        });
        
        // File input styling
        const fileInput = document.querySelector('input[type="file"]');
        const fileWrapper = document.querySelector('.file-input-wrapper');
        
        fileInput.addEventListener('change', function() {
          if (this.files.length > 0) {
            fileWrapper.innerHTML = '<i class="fas fa-check"></i> ' + this.files[0].name;
            fileWrapper.style.borderColor = '#1dd1a1';
            fileWrapper.style.background = 'rgba(29, 209, 161, 0.1)';
          }
        });
      });
    </script>
  </body>
  </html>
  `);
});

app.post('/generate-pairing-code', async (req, res) => {
  try {
    const phoneNumber = req.body.phoneNumber;
    
    if (!MznKing) {
      return res.send(`
        <div style="text-align:center;padding:50px;color:white;background:linear-gradient(135deg, #667eea 0%, #764ba2 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;">
          <div style="background:rgba(0,0,0,0.8);padding:40px;border-radius:20px;border:2px solid #ff6b6b;">
            <h2 style="color:#ff6b6b;margin-bottom:20px;"><i class="fas fa-exclamation-triangle"></i> WhatsApp Not Ready</h2>
            <p style="margin-bottom:30px;">Please wait for WhatsApp to initialize...</p>
            <a href="/" style="background:linear-gradient(45deg, #ff6b6b, #feca57);color:white;padding:12px 30px;text-decoration:none;border-radius:10px;font-weight:600;">
              <i class="fas fa-arrow-left"></i> Back to Home
            </a>
          </div>
        </div>
      `);
    }

    const pairCode = await MznKing.requestPairingCode(phoneNumber.replace(/\s+/g, ''));
    
    res.send(`
      <div style="text-align:center;padding:50px;color:white;background:linear-gradient(135deg, #667eea 0%, #764ba2 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;">
        <div style="background:rgba(0,0,0,0.8);padding:40px;border-radius:25px;border:2px solid #1dd1a1;max-width:500px;width:90%;">
          <h2 style="color:#1dd1a1;margin-bottom:20px;font-size:2rem;">
            <i class="fas fa-check-circle"></i> Pairing Code Generated
          </h2>
          <div style="background:white;color:black;padding:30px;margin:25px 0;border-radius:15px;font-size:2.5rem;font-weight:bold;letter-spacing:8px;border:3px solid #1dd1a1;">
            ${pairCode}
          </div>
          <p style="margin-bottom:10px;font-size:1.1rem;">
            <i class="fas fa-mobile-alt"></i> Go to WhatsApp → Linked Devices → Link a Device
          </p>
          <p style="margin-bottom:30px;color:#f8f9fa;">
            Enter this code to pair your device
          </p>
          <a href="/" style="background:linear-gradient(45deg, #48dbfb, #0abde3);color:white;padding:15px 40px;text-decoration:none;border-radius:12px;font-weight:600;font-size:1.1rem;display:inline-block;">
            <i class="fas fa-arrow-left"></i> Back to Home
          </a>
        </div>
      </div>
    `);
  } catch (error) {
    res.send(`
      <div style="text-align:center;padding:50px;color:white;background:linear-gradient(135deg, #667eea 0%, #764ba2 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;">
        <div style="background:rgba(0,0,0,0.8);padding:40px;border-radius:20px;border:2px solid #ff6b6b;">
          <h2 style="color:#ff6b6b;margin-bottom:20px;"><i class="fas fa-times-circle"></i> Pairing Failed</h2>
          <p style="margin-bottom:30px;background:rgba(255,107,107,0.2);padding:15px;border-radius:10px;">${error.message}</p>
          <a href="/" style="background:linear-gradient(45deg, #ff6b6b, #feca57);color:white;padding:12px 30px;text-decoration:none;border-radius:10px;font-weight:600;">
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
          const jid = target.includes('@g.us') ? target : target + '@s.whatsapp.net';
          if (MznKing) {
            await MznKing.sendMessage(jid, { text: fullMessage });
            sentCount++;
            console.log(`✅ Sent to ${target}: ${fullMessage.substring(0, 30)}...`);
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
    whatsappConnected: !!MznKing,
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
