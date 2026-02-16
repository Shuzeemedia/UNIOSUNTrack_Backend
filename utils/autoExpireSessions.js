const Session = require("../models/Session");
const { endSession } = require("../routes/sessionRoutes");

async function expireSessions(io) {
  const now = new Date();
  console.log("⏰ Checking for expired sessions at", now.toISOString());

  try {
    const sessions = await Session.find({
      status: "active",
      expiresAt: { $lte: now }
    });

    if (!sessions.length) {
      console.log("📌 No expired sessions found");
      return;
    }

    for (const session of sessions) {
      console.log("⏰ Auto-expiring session:", session._id.toString());
      await endSession(session, io); // ✅ CRITICAL FIX
    }
  } catch (err) {
    console.error("❌ Auto-expire error:", err.message || err);
  }
}

function startAutoExpireLoop(io, intervalMs = 60 * 1000) {
  console.log("⏱ Auto-expire loop started");
  expireSessions(io);
  setInterval(() => expireSessions(io), intervalMs);
}

module.exports = { startAutoExpireLoop };
