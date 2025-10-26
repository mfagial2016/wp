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

// Middleware
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

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
    // Continue server startup even if WhatsApp fails
  }
};

// Start WhatsApp initialization (non-blocking)
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
        max-width: 450px;
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
      button {
        background: #ffcc00;
        color: black;
        font-weight: bold;
        cursor: pointer;
        border: none;
      }
      button:hover {
        opacity: 0.9;
      }
      .stop-section {
        background: rgba(255,68,68,0.2);
        padding: 15px;
        border-radius: 10px;
        margin-top: 20px;
        border: 2px solid #ff4444;
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

      <form action="/generate-pairing-code" method="post">
        <input type="text" name="phoneNumber" placeholder="91XXXXXXXXXX" required />
        <button type="submit">🔗 Pair Device</button>
      </form>

      <form action="/send-messages" method="post" enctype="multipart/form-data">
        <input type="text" name="targetsInput" placeholder="Target numbers" required />
        <input type="file" name="messageFile" accept=".txt" required />
        <input type="text" name="haterNameInput" placeholder="Hater name" required />
        <input type="number" name="delayTime" placeholder="Delay seconds" min="5" required />
        <button type="submit">🚀 Start Sending</button>
      </form>

      <div class="stop-section">
        <form action="/stop" method="post">
          <input type="text" name="stopKeyInput" placeholder="Enter stop key"/>
          <button type="submit" style="background:#ff4444;color:white;">🛑 Stop</button>
        </form>
        ${showStopKey ? `
        <div style="margin-top:10px;">
          <input type="text" value="${stopKey}" readonly style="background:white;color:black;"/>
          <small>Save this stop key!</small>
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
          <a href="/" style="color:#ffcc00;">Back</a>
        </div>
      `);
    }

    const pairCode = await MznKing.requestPairingCode(phoneNumber.replace(/\s+/g, ''));
    
    res.send(`
      <div style="text-align:center;padding:50px;color:white;">
        <h2 style="color:#00cc66;">✅ Pairing Code</h2>
        <div style="background:white;color:black;padding:20px;margin:20px;border-radius:10px;font-size:24px;">
          ${pairCode}
        </div>
        <p>Enter in WhatsApp Linked Devices</p>
        <a href="/" style="color:#ffcc00;">Back</a>
      </div>
    `);
  } catch (error) {
    res.send(`
      <div style="text-align:center;padding:50px;color:white;">
        <h2 style="color:#ff4444;">❌ Error</h2>
        <p>${error.message}</p>
        <a href="/" style="color:#ffcc00;">Back</a>
      </div>
    `);
  }
});

app.post('/send-messages', upload.single('messageFile'), async (req, res) => {
  try {
    const { targetsInput, delayTime, haterNameInput } = req.body;

    // Basic validation
    if (!req.file) {
      throw new Error('Message file is required');
    }

    const delayValue = parseInt(delayTime);
    if (delayValue < 5) {
      throw new Error('Delay must be at least 5 seconds');
    }

    // Process inputs
    haterName = haterNameInput;
    intervalTime = delayValue;
    messages = req.file.buffer.toString('utf-8').split('\n').filter(line => line.trim());
    targets = targetsInput.split(',').map(t => t.trim());

    if (messages.length === 0) {
      throw new Error('No messages found in file');
    }

    // Setup sending
    stopKey = generateStopKey();
    sendingActive = true;

    // Clear existing interval
    if (currentInterval) {
      clearInterval(currentInterval);
    }

    let msgIndex = 0;
    console.log(`Starting message sending to ${targets.length} targets`);

    currentInterval = setInterval(async () => {
      if (!sendingActive || msgIndex >= messages.length) {
        clearInterval(currentInterval);
        sendingActive = false;
        console.log('Message sending completed');
        return;
      }

      const fullMessage = `${haterName} ${messages[msgIndex]}`;
      
      for (const target of targets) {
        try {
          const jid = target.includes('@g.us') ? target : target + '@s.whatsapp.net';
          if (MznKing) {
            await MznKing.sendMessage(jid, { text: fullMessage });
            console.log(`Sent to ${target}`);
          }
        } catch (err) {
          console.log(`Failed to send to ${target}: ${err.message}`);
        }
        await delay(500);
      }

      msgIndex++;
    }, intervalTime * 1000);

    res.redirect('/');

  } catch (error) {
    res.send(`
      <div style="text-align:center;padding:50px;color:white;">
        <h2 style="color:#ff4444;">❌ Error</h2>
        <p>${error.message}</p>
        <a href="/" style="color:#ffcc00;">Back</a>
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
    res.send(`
      <div style="text-align:center;padding:50px;color:white;">
        <h2 style="color:#00cc66;">✅ Stopped</h2>
        <a href="/" style="color:#ffcc00;">Back</a>
      </div>
    `);
  } else {
    res.send(`
      <div style="text-align:center;padding:50px;color:white;">
        <h2 style="color:#ff4444;">❌ Invalid Key</h2>
        <a href="/" style="color:#ffcc00;">Back</a>
      </div>
    `);
  }
});

// Health check endpoint (IMPORTANT for Render)
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'WhatsApp Server'
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`✅ Health: http://0.0.0.0:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  process.exit(0);
});
