/**
 * PayTrust WebSocket Server
 * Real-time multi-user Socket.IO server for the PayTrust UPI payment system.
 *
 * Supports:
 *   - Multi-device/multi-tab user connections
 *   - Real-time payment event broadcasting
 *   - Fraud alert broadcasting
 *   - Connection state tracking
 *
 * Run: node ws-server.js
 * Server listens on port 3001 (0.0.0.0 for cross-device access)
 */

const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"] }));
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: false,
  },
  // Allow both polling (initial handshake) and websocket upgrade
  transports: ["polling", "websocket"],
  pingTimeout: 60000,
  pingInterval: 25000,
  // Required for cross-origin polling to work
  allowEIO3: true,
});

/* ══════════════════════════════════════════════════════════════════
   CONNECTION STATE
   Maps userNumber (string) → Set of socket.id strings.
   One user can have multiple active connections (multiple tabs/devices).
══════════════════════════════════════════════════════════════════ */
const userSocketMap = new Map(); // userNumber → Set<socketId>

/* ══════════════════════════════════════════════════════════════════
   LOGGING UTILITIES
══════════════════════════════════════════════════════════════════ */
const LOG_EVENTS = true;  // FIX: enabled — shows all events in terminal for debugging
function log(...args) {
  if (LOG_EVENTS) {
    console.log(`[${new Date().toISOString()}]`, ...args);
  }
}

function logFormatted(event, socketId, data) {
  console.log(
    `[${new Date().toISOString()}] [${event.padEnd(18)}] [${socketId.slice(0, 8)}] ${data}`
  );
}

/* ══════════════════════════════════════════════════════════════════
   HELPER: Get all socket IDs for a user
══════════════════════════════════════════════════════════════════ */
function getUserSockets(userNumber) {
  return userSocketMap.get(userNumber.toString()) || new Set();
}

/* ══════════════════════════════════════════════════════════════════
   HELPER: Broadcast to all sockets of a specific user
══════════════════════════════════════════════════════════════════ */
function emitToUserSockets(userNumber, event, payload) {
  const sockets = getUserSockets(userNumber);
  sockets.forEach((sid) => {
    io.to(sid).emit(event, payload);
  });
}

/* ══════════════════════════════════════════════════════════════════
   REST ENDPOINTS
══════════════════════════════════════════════════════════════════ */

// Quick connectivity test — open in browser: http://<IP>:3001/ping
app.get("/ping", (_req, res) => {
  res.json({ ok: true, server: "PayTrust WS", port: PORT, time: new Date().toISOString() });
});

// Live user map — open in browser: http://<IP>:3001/status
app.get("/status", (_req, res) => {
  const users = [];
  userSocketMap.forEach((sockets, userNumber) => {
    users.push({ userNumber, connections: sockets.size });
  });
  res.json({ status: "ok", timestamp: new Date().toISOString(), users });
});

/* ══════════════════════════════════════════════════════════════════
   SOCKET.IO CONNECTION HANDLING
══════════════════════════════════════════════════════════════════ */
io.on("connection", (socket) => {
  logFormatted("CONNECT", socket.id, "New connection established");

  /* ── user_register ─────────────────────────────────────────────
     Fired by client AFTER successful login.
     Maps socket.id → userNumber so we know who is connected.
  ───────────────────────────────────────────────────────────────── */
  socket.on("user_register", (userNumber, callback) => {
    if (!userNumber) {
      logFormatted("REGISTER_FAIL", socket.id, "No userNumber provided");
      if (callback) callback({ success: false, error: "userNumber required" });
      return;
    }

    const uNum = userNumber.toString();

    // Add socket to this user's set
    if (!userSocketMap.has(uNum)) {
      userSocketMap.set(uNum, new Set());
    }
    userSocketMap.get(uNum).add(socket.id);

    // Store userNumber on the socket for cleanup
    socket.data.userNumber = uNum;

    logFormatted("REGISTER", socket.id, `User ${uNum} registered (${getUserSockets(uNum).size} active connection(s))`);

    /* ── PRESENCE: emit user_online only on FIRST socket for this user ──
       If the user already has other tabs open, they are already "online".
       socket.broadcast excludes the sender's own socket.
    ─────────────────────────────────────────────────────────────────── */
    if (getUserSockets(uNum).size === 1) {
      socket.broadcast.emit("user_online", { userNumber: uNum });
      logFormatted("PRESENCE", socket.id, `user_online → broadcast for ${uNum}`);
    }

    if (callback) callback({ success: true, connections: getUserSockets(uNum).size });
  });

  /* ── send_payment ──────────────────────────────────────────────
     Fired by sender client AFTER a successful payment is completed.
     The server broadcasts a "receive_payment" event to the recipient.
     This is the REAL-TIME counterpart to the local React state update.
  ───────────────────────────────────────────────────────────────── */
  socket.on("send_payment", (paymentData, callback) => {
    const { fromNumber, toNumber, amount, txId, timestamp, note } = paymentData;

    if (!fromNumber || !toNumber) {
      logFormatted("SEND_PAYMENT_FAIL", socket.id, "Missing fromNumber or toNumber");
      if (callback) callback({ success: false, error: "Missing required fields" });
      return;
    }

    logFormatted(
      "SEND_PAYMENT",
      socket.id,
      `₹${amount} from ${fromNumber} → ${toNumber} (txId: ${txId})`
    );

    // Broadcast "receive_payment" to ALL recipient's connected sockets
    const recipientSockets = getUserSockets(toNumber.toString());
    if (recipientSockets.size > 0) {
      const notificationPayload = {
        fromNumber,
        amount,
        txId,
        timestamp: timestamp || new Date().toISOString(),
        note: note || "Payment received",
        status: "credited",
      };

      emitToUserSockets(toNumber.toString(), "receive_payment", notificationPayload);
      logFormatted(
        "BROADCAST_RECV",
        socket.id,
        `Delivered to ${toNumber} (${recipientSockets.size} socket(s))`
      );
    } else {
      logFormatted(
        "BROADCAST_RECV",
        socket.id,
        `Recipient ${toNumber} not online — skipping real-time push`
      );
    }

    if (callback) callback({ success: true, delivered: recipientSockets.size > 0 });
  });

  /* ── fraud_alert ───────────────────────────────────────────────
     Fired when a payment is blocked/rejected due to high fraud risk
     (risk score > 85 on the sender's side).
     Broadcasts a "fraud_warning" to ALL the sender's connected sockets
     and optionally to the recipient if applicable.
  ───────────────────────────────────────────────────────────────── */
  socket.on("fraud_alert", (alertData, callback) => {
    const { userNumber, riskScore, amount, recipientNumber, reason } = alertData;

    if (!userNumber) {
      logFormatted("FRAUD_ALERT_FAIL", socket.id, "Missing userNumber in fraud_alert");
      if (callback) callback({ success: false });
      return;
    }

    logFormatted(
      "FRAUD_ALERT",
      socket.id,
      `User ${userNumber} — riskScore: ${riskScore}, amount: ₹${amount}, reason: ${reason}`
    );

    // Broadcast fraud warning to ALL sender's connected sockets
    const warningPayload = {
      riskScore,
      amount,
      recipientNumber: recipientNumber || null,
      reason: reason || "Suspicious transaction blocked",
      timestamp: new Date().toISOString(),
    };

    emitToUserSockets(userNumber.toString(), "fraud_warning", warningPayload);

    // If the recipient is known and online, also notify them
    // (for example, if the payment was blocked before the recipient received funds)
    if (recipientNumber) {
      const recSockets = getUserSockets(recipientNumber.toString());
      if (recSockets.size > 0) {
        emitToUserSockets(recipientNumber.toString(), "fraud_warning", {
          ...warningPayload,
          reason: `Blocked payment to ${recipientNumber}: ${reason}`,
          isRecipientWarning: true,
        });
      }
    }

    if (callback) callback({ success: true });
  });

  /* ── get_online_users ──────────────────────────────────────────
     Returns list of userNumbers currently connected (for UI indicators).
  ───────────────────────────────────────────────────────────────── */
  socket.on("get_online_users", (_data, callback) => {
    const onlineUsers = Array.from(userSocketMap.keys()).filter(
      (u) => getUserSockets(u).size > 0
    );
    if (callback) callback({ success: true, users: onlineUsers });
  });

  /* ── user_leave ─────────────────────────────────────────────
     Fired by client on explicit logout.
     Removes the socket from the user's socket set.
  ───────────────────────────────────────────────────────────────── */
  socket.on("user_leave", (userNumber, callback) => {
    if (!userNumber) {
      if (callback) callback({ success: false });
      return;
    }
    const uNum = userNumber.toString();
    if (userSocketMap.has(uNum)) {
      userSocketMap.get(uNum).delete(socket.id);
      if (userSocketMap.get(uNum).size === 0) {
        userSocketMap.delete(uNum);
        /* ── PRESENCE: all sockets closed → user is offline ── */
        socket.broadcast.emit("user_offline", { userNumber: uNum });
        logFormatted("PRESENCE", socket.id, `user_offline → broadcast for ${uNum} (explicit leave)`);
      }
    }
    socket.data.userNumber = null;
    logFormatted("USER_LEAVE", socket.id, `User ${uNum} explicitly left`);
    if (callback) callback({ success: true });
  });

  /* ── disconnect ──────────────────────────────────────────────── */
  socket.on("disconnect", (reason) => {
    const userNumber = socket.data.userNumber;

    if (userNumber && userSocketMap.has(userNumber)) {
      const sockets = userSocketMap.get(userNumber);
      sockets.delete(socket.id);

      if (sockets.size === 0) {
        userSocketMap.delete(userNumber);
        /* ── PRESENCE: all sockets gone → user is offline ── */
        socket.broadcast.emit("user_offline", { userNumber });
        logFormatted("PRESENCE", socket.id, `user_offline → broadcast for ${userNumber} (disconnect)`);
        logFormatted("DISCONNECT", socket.id, `User ${userNumber} — last connection closed`);
      } else {
        logFormatted(
          "DISCONNECT",
          socket.id,
          `User ${userNumber} — ${sockets.size} connection(s) remaining`
        );
      }
    } else {
      logFormatted("DISCONNECT", socket.id, `Unregistered socket — reason: ${reason}`);
    }
  });

  /* ── ping test ──────────────────────────────────────────────── */
  socket.on("ping_test", (data, callback) => {
    if (callback) callback({ pong: true, serverTime: new Date().toISOString() });
  });
});

/* ══════════════════════════════════════════════════════════════════
   SERVER BOOT
══════════════════════════════════════════════════════════════════ */
const PORT = process.env.PORT || 3001;
const HOST = "0.0.0.0";

// Auto-detect local network IP for the startup message
const os = require("os");
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return "127.0.0.1";
}

httpServer.listen(PORT, HOST, () => {
  const localIP = getLocalIP();
  console.log(`╔══════════════════════════════════════════════════╗`);
  console.log(`║      PayTrust WebSocket Server v2.0             ║`);
  console.log(`╠══════════════════════════════════════════════════╣`);
  console.log(`║  Status  : ONLINE                               ║`);
  console.log(`║  Port    : ${PORT}                                 ║`);
  console.log(`╠══════════════════════════════════════════════════╣`);
  console.log(`║  Same machine : http://127.0.0.1:${PORT}           ║`);
  console.log(`║  Other devices: http://${localIP}:${PORT}       ║`);
  console.log(`╠══════════════════════════════════════════════════╣`);
  console.log(`║  Test in browser: http://${localIP}:${PORT}/ping ║`);
  console.log(`╚══════════════════════════════════════════════════╝`);
  console.log(`\n  Waiting for connections...\n`);
});

/* ══════════════════════════════════════════════════════════════════
   GRACEFUL SHUTDOWN
══════════════════════════════════════════════════════════════════ */
process.on("SIGINT", () => {
  console.log("\n[Server] Shutting down gracefully...");
  io.close(() => {
    console.log("[Server] Socket.IO connections closed.");
    httpServer.close(() => {
      console.log("[Server] HTTP server closed. Bye!");
      process.exit(0);
    });
  });
});
