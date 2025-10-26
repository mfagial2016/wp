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

// Multer configuration for file upload
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept text files only
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
  return 'MRPRINCE-' + Math.floor(1000000 + Math.random() * 9000000);
}

// Routes
app.get('/', (req, res) => {
  const showStopKey = sendingActive && stopKey;
  const whatsappStatus = MznKing ? '✅ Connected' : '🔄 Connecting...';

  res.send(`
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>WhatsApp Server</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        margin: 0;
        padding: 20px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        font-family: 'Arial', sans-serif;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .container {
        width: 90%;
        max-width: 500px;
        background: rgba(0, 0, 0, 0.9);
        padding: 30px;
        border-radius: 20px;
        border: 3px solid #ffcc00;
        color: white;
        box-shadow: 0 0 30px rgba(255,255,255,0.3);
        text-align: center;
      }
      h1 { 
        color: #ffcc00; 
        margin-bottom: 20px;
        font-size: 24px;
      }
      .status {
        background: rgba(0,204,102,0.2);
        padding: 10px;
        border-radius: 10px;
        margin: 15px 0;
        border: 2px solid #00cc66;
      }
      input, button {
        width: 100%;
        padding: 12px;
        margin: 8px 0;
        border-radius: 8px;
        border: 2px solid #ffcc00;
        background: rgba(255,255,255,0.1);
        color: white;
        font-size: 16px;
      }
      input[type="file"] {
        padding: 8px;
      }
      button {
        background: #ffcc00;
        color: black;
        font-weight: bold;
        cursor: pointer;
        border: none;
      }
      button:hover {
        opacity: 0.9;
        transform: translateY(-2px);
      }
      .stop-section {
        background: rgba(255,68,68,0.2);
        padding: 15px;
        border-radius: 10px;
        margin-top: 20px;
        border: 2px solid #ff4444;
      }
      .instructions {
        background: rgba(255,204,0,0.2);
        padding: 10px;
        border-radius: 8px;
        margin: 10px 0;
        text-align: left;
        font-size: 14px;
      }
      .file-info {
        background: rgba(255,255,255,0.1);
        padding: 8px;
        border-radius: 5px;
        margin: 5px 0;
        font-size: 12px;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>🚀 WhatsApp Server</h1>
      
      <div class="status">
        <strong>Server:</strong> ✅ RUNNING<br>
        <strong>WhatsApp:</strong> ${whatsappStatus}<br>
        <strong>Port:</strong> ${PORT}
      </div>

      <div class="instructions">
        <strong>📝 Instructions:</strong><br>
        1. Pair your number first<br>
        2. Upload .txt file (one message per line)<br>
        3. Set delay (min 5 seconds)<br>
        4. Save your stop key!
      </div>

      <form action="/generate-pairing-code" method="post">
        <input type="text" name="phoneNumber" placeholder="91XXXXXXXXXX" required />
        <button type="submit">🔗 Pair Device</button>
      </form>

      <form action="/send-messages" method="post" enctype="multipart/form-data">
        <input type="text" name="targetsInput" placeholder="Target numbers (comma separated)" required />
        
        <div class="file-info">
          <label for="messageFile">📄 Upload Message File (.txt):</label>
          <input type="file" id="messageFile" name="messageFile" accept=".txt" required />
          <small>One message per line, max 10MB</small>
        </div>
        
        <input type="text" name="haterNameInput" placeholder="Hater name" required />
        <input type="number" name="delayTime" placeholder="Delay seconds (min 5)" min="5" required />
        <button type="submit">🚀 Start Sending</button>
      </form>

      <div class="stop-section">
        <form action="/stop" method="post">
          <input type="text" name="stopKeyInput" placeholder="Enter stop key"/>
          <button type="submit" style="background:#ff4444;color:white;">🛑 Stop Sending</button>
        </form>
        ${showStopKey ? `
        <div style="margin-top:10px;">
          <input type="text" value="${stopKey}" readonly style="background:white;color:black;font-weight:bold;text-align:center;"/>
          <small>🔑 Save this stop key to cancel sending</small>
        </div>` : ''}
      </div>
    </div>
  </body>
  </html>
  `);
});

app.post('/generate-pairing-code', async (req, res) => {
  try {
    const phoneNumber = req.body.phoneNumber;
    
    if (!MznKing) {
      return res.send(`
        <div style="text-align:center;padding:50px;color:white;">
          <h2 style="color:#ff4444;">❌ WhatsApp Not Ready</h2>
          <p>Please wait for WhatsApp to initialize...</p>
          <a href="/" style="color:#ffcc00;text-decoration:none;">← Back to Home</a>
        </div>
      `);
    }

    const pairCode = await MznKing.requestPairingCode(phoneNumber.replace(/\s+/g, ''));
    
    res.send(`
      <div style="text-align:center;padding:50px;color:white;background:rgba(0,0,0,0.8);min-height:100vh;">
        <h2 style="color:#00cc66;">✅ Pairing Code Generated</h2>
        <div style="background:white;color:black;padding:25px;margin:25px;border-radius:15px;font-size:28px;font-weight:bold;letter-spacing:2px;">
          ${pairCode}
        </div>
        <p>📱 Go to WhatsApp → Linked Devices → Link a Device</p>
        <p>Enter this code to pair your device</p>
        <br>
        <a href="/" style="color:#ffcc00;text-decoration:none;font-size:18px;padding:10px 20px;border:2px solid #ffcc00;border-radius:8px;">← Back to Home</a>
      </div>
    `);
  } catch (error) {
    res.send(`
      <div style="text-align:center;padding:50px;color:white;">
        <h2 style="color:#ff4444;">❌ Pairing Failed</h2>
        <p>${error.message}</p>
        <a href="/" style="color:#ffcc00;">Back to Home</a>
      </div>
    `);
  }
});

app.post('/send-messages', upload.single('messageFile'), async (req, res) => {
  try {
    const { targetsInput, delayTime, haterNameInput } = req.body;

    // Basic validation
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
            console.log(`✅ Sent to ${target}: ${fullMessage.substring(0, 30)}...`);
          }
        } catch (err) {
          console.log(`❌ Failed to send to ${target}: ${err.message}`);
        }
        await delay(1000); // 1 second delay between targets
      }

      msgIndex++;
      console.log(`📊 Progress: ${msgIndex}/${messages.length} messages sent`);
      
    }, intervalTime * 1000);

    res.redirect('/');

  } catch (error) {
    console.error('Send messages error:', error);
    res.send(`
      <div style="text-align:center;padding:50px;color:white;">
        <h2 style="color:#ff4444;">❌ Error Starting Messages</h2>
        <p>${error.message}</p>
        <a href="/" style="color:#ffcc00;">Back to Home</a>
      </div>
    `);
  }
});

// Error handling for file upload
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.send(`
        <div style="text-align:center;padding:50px;color:white;">
          <h2 style="color:#ff4444;">❌ File Too Large</h2>
          <p>File size must be less than 10MB</p>
          <a href="/" style="color:#ffcc00;">Back to Home</a>
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
      <div style="text-align:center;padding:50px;color:white;">
        <h2 style="color:#00cc66;">✅ Sending Stopped Successfully</h2>
        <p>All message sending has been cancelled</p>
        <a href="/" style="color:#ffcc00;text-decoration:none;font-size:18px;">← Back to Home</a>
      </div>
    `);
  } else {
    res.send(`
      <div style="text-align:center;padding:50px;color:white;">
        <h2 style="color:#ff4444;">❌ Invalid Stop Key</h2>
        <p>Please enter the correct stop key</p>
        <a href="/" style="color:#ffcc00;text-decoration:none;font-size:18px;">← Back to Home</a>
      </div>
    `);
  }
});

// Health check endpoint (IMPORTANT for Render)
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'WhatsApp Server',
    whatsappConnected: !!MznKing,
    port: PORT
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`✅ Health check: http://0.0.0.0:${PORT}/health`);
  console.log(`📱 Main interface: http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Shutting down gracefully...');
  sendingActive = false;
  if (currentInterval) clearInterval(currentInterval);
  process.exit(0);
});
