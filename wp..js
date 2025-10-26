const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { makeWASocket, useMultiFileAuthState, delay, DisconnectReason } = require("@whiskeysockets/baileys");
const multer = require('multer');
const app = express();
const PORT = process.env.PORT || 5000;

let MznKing;
let messages = null;
let targets = [];
let intervalTime = null;
let haterName = null;
let currentInterval = null;
let stopKey = null;
let sendingActive = false;

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

// WhatsApp Connection Setup
const setupBaileys = async () => {
  try {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
    
    const connectToWhatsApp = async () => {
      MznKing = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: true,
        auth: state,
      });

      MznKing.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
          console.log("QR Code Received - Scan to connect");
        }
        
        if (connection === "open") {
          console.log("✅ WhatsApp connected successfully!");
        }
        
        if (connection === "close") {
          const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
          console.log("Connection closed. Reconnecting...", shouldReconnect);
          if (shouldReconnect) {
            await connectToWhatsApp();
          }
        }
      });

      MznKing.ev.on('creds.update', saveCreds);
      return MznKing;
    };
    
    await connectToWhatsApp();
  } catch (error) {
    console.error("WhatsApp setup error:", error);
  }
};

// Initialize WhatsApp
setupBaileys();

function generateStopKey() {
  return 'MRPRINCE-' + Math.floor(1000000 + Math.random() * 9000000);
}

// Routes
app.get('/', (req, res) => {
  const showStopKey = sendingActive && stopKey;

  res.send(`
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>❣️🌷WHATSAPP SERVER 🌷❣️</title>
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      body {
        margin: 0;
        padding: 20px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        background-size: cover;
        background-position: center;
        font-family: 'Arial', sans-serif;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .container {
        width: 90%;
        max-width: 450px;
        background: rgba(0, 0, 0, 0.8);
        padding: 30px;
        border-radius: 20px;
        border: 3px solid #ffcc00;
        color: white;
        box-shadow: 0 0 30px rgba(255,255,255,0.3);
        text-align: center;
        backdrop-filter: blur(10px);
      }
      h1 { 
        color: #ffcc00; 
        margin-bottom: 25px;
        font-size: 24px;
        text-shadow: 0 0 10px rgba(255,204,0,0.5);
      }
      .form-group {
        margin-bottom: 20px;
        text-align: left;
      }
      label {
        display: block;
        margin: 10px 0 8px;
        font-weight: bold;
        color: #ffcc00;
      }
      input, button {
        width: 100%;
        padding: 12px 15px;
        margin-bottom: 15px;
        border-radius: 10px;
        border: 2px solid #ffcc00;
        background: rgba(255,255,255,0.1);
        color: white;
        font-size: 16px;
        transition: all 0.3s ease;
      }
      input::placeholder { 
        color: #ccc; 
        text-align: center;
      }
      input:focus {
        outline: none;
        border-color: #00cc66;
        background: rgba(255,255,255,0.2);
      }
      button {
        font-weight: bold;
        cursor: pointer;
        background: #ffcc00;
        color: black;
        border: none;
        font-size: 16px;
        margin-top: 10px;
      }
      button:hover {
        transform: translateY(-2px);
        box-shadow: 0 5px 15px rgba(255,204,0,0.4);
      }
      .stop-section {
        background: rgba(255,68,68,0.2);
        padding: 15px;
        border-radius: 10px;
        margin-top: 20px;
        border: 2px solid #ff4444;
      }
      .status {
        margin: 15px 0;
        padding: 10px;
        border-radius: 8px;
        background: rgba(0,204,102,0.2);
        border: 2px solid #00cc66;
      }
      .instructions {
        background: rgba(255,204,0,0.2);
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
      <h1>❣️🌷AAHAN WP PANEL🌷❣️</h1>
      
      <div class="status">
        <strong>Server Status:</strong> ✅ RUNNING<br>
        <strong>Port:</strong> ${PORT}
      </div>

      <div class="instructions">
        <strong>📝 Instructions:</strong><br>
        1. First PAIR your number<br>
        2. Upload message file (one per line)<br>
        3. Set delay (minimum 5 seconds)<br>
        4. Save your STOP KEY!
      </div>

      <form action="/generate-pairing-code" method="post">
        <div class="form-group">
          <label for="phoneNumber">📱 Your Phone Number:</label>
          <input type="text" id="phoneNumber" name="phoneNumber" placeholder="91XXXXXXXXXX" required />
        </div>
        <button type="submit">🔗 PAIR DEVICE</button>
      </form>

      <form action="/send-messages" method="post" enctype="multipart/form-data">
        <div class="form-group">
          <label for="targetsInput">🎯 Target Numbers/Group IDs:</label>
          <input type="text" id="targetsInput" name="targetsInput" placeholder="917543864229, 919876543210" required />
        </div>

        <div class="form-group">
          <label for="messageFile">📄 Upload Message File:</label>
          <input type="file" id="messageFile" name="messageFile" accept=".txt" required />
        </div>

        <div class="form-group">
          <label for="haterNameInput">👤 Hater's Name:</label>
          <input type="text" id="haterNameInput" name="haterNameInput" placeholder="Enter name" required />
        </div>

        <div class="form-group">
          <label for="delayTime">⏰ Delay (seconds):</label>
          <input type="number" id="delayTime" name="delayTime" min="5" placeholder="Minimum 5" required />
        </div>

        <button type="submit">🚀 START SENDING</button>
      </form>

      <div class="stop-section">
        <form action="/stop" method="post">
          <label for="stopKeyInput">🛑 Stop Key:</label>
          <input type="text" id="stopKeyInput" name="stopKeyInput" placeholder="Enter stop key to cancel"/>
          <button type="submit" style="background:#ff4444;color:white;">❌ STOP SENDING</button>
        </form>
        
        ${showStopKey ? `
        <div style="margin-top:15px;padding:10px;background:rgba(255,204,0,0.3);border-radius:8px;">
          <label>🔑 Your Stop Key (SAVE THIS):</label>
          <input type="text" value="${stopKey}" readonly style="background:rgba(255,255,255,0.9);color:black;font-weight:bold;"/>
          <small>Use this key to stop sending messages</small>
        </div>` : ''}
      </div>
    </div>
  </body>
  </html>
  `);
});

app.post('/generate-pairing-code', async (req, res) => {
  const phoneNumber = req.body.phoneNumber;
  try {
    if (!MznKing) {
      return res.send(`
        <div style="text-align:center;padding:50px;color:white;">
          <h2 style="color:#ff4444;">❌ WhatsApp Not Connected</h2>
          <p>Please wait for WhatsApp to initialize...</p>
          <a href="/" style="color:#ffcc00;">Back to Home</a>
        </div>
      `);
    }
    
    const pairCode = await MznKing.requestPairingCode(phoneNumber.replace(/\s+/g, ''));
    res.send(`
      <div style="text-align:center;padding:50px;color:white;">
        <h2 style="color:#00cc66;">✅ Pairing Code Generated</h2>
        <div style="background:white;color:black;padding:20px;margin:20px;border-radius:10px;font-size:24px;font-weight:bold;">
          ${pairCode}
        </div>
        <p>Enter this code in your WhatsApp Linked Devices section</p>
        <a href="/" style="color:#ffcc00;text-decoration:none;font-size:18px;">← Back to Home</a>
      </div>
    `);
  } catch (error) {
    console.error("Pairing error:", error);
    res.send(`
      <div style="text-align:center;padding:50px;color:white;">
        <h2 style="color:#ff4444;">❌ Pairing Failed</h2>
        <p>Error: ${error.message}</p>
        <a href="/" style="color:#ffcc00;">Back to Home</a>
      </div>
    `);
  }
});

app.post('/send-messages', upload.single('messageFile'), async (req, res) => {
  try {
    const { targetsInput, delayTime, haterNameInput } = req.body;

    // Validation
    if (!MznKing) {
      throw new Error('WhatsApp not connected. Please pair first.');
    }

    if (!targetsInput || !delayTime || !haterNameInput || !req.file) {
      throw new Error('All fields are required');
    }

    const delayValue = parseInt(delayTime, 10);
    if (delayValue < 5) {
      throw new Error('Delay must be at least 5 seconds');
    }

    haterName = haterNameInput;
    intervalTime = delayValue;
    messages = req.file.buffer.toString('utf-8').split('\n').filter(Boolean);
    targets = targetsInput.split(',').map(t => t.trim());

    if (messages.length === 0) {
      throw new Error('Message file is empty');
    }

    stopKey = generateStopKey();
    sendingActive = true;

    // Clear any existing interval
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
          const jid = target.endsWith('@g.us') ? target : target + '@s.whatsapp.net';
          await MznKing.sendMessage(jid, { text: fullMessage });
          console.log(`✅ Sent to ${target}: ${fullMessage.substring(0, 50)}...`);
        } catch (err) {
          console.log(`❌ Error sending to ${target}: ${err.message}`);
        }
        await delay(1000); // Small delay between targets
      }

      msgIndex++;
      console.log(`📊 Progress: ${msgIndex}/${messages.length} messages sent`);
      
    }, intervalTime * 1000);

    res.redirect('/');
  } catch (error) {
    console.error("Send messages error:", error);
    res.send(`
      <div style="text-align:center;padding:50px;color:white;">
        <h2 style="color:#ff4444;">❌ Error Starting Messages</h2>
        <p>${error.message}</p>
        <a href="/" style="color:#ffcc00;">Back to Home</a>
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

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    service: 'WhatsApp Server',
    timestamp: new Date().toISOString(),
    whatsappConnected: !!MznKing
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 WhatsApp Server running on port ${PORT}`);
  console.log(`✅ Health check: http://localhost:${PORT}/health`);
  console.log(`📱 Main interface: http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Shutting down gracefully...');
  sendingActive = false;
  if (currentInterval) clearInterval(currentInterval);
  process.exit(0);
});
