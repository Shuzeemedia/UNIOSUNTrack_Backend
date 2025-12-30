const Session = require("../models/Session");
const { markAbsenteesForSession } = require("../routes/sessionRoutes"); // reuse helper

/**
 * Auto-expire sessions that have passed their expiry time
 */
async function expireSessions() {
  try {
    const now = new Date();

    // Find active sessions that have expired
    const sessions = await Session.find({ status: "active", expiresAt: { $lte: now } });

    for (const session of sessions) {
      // Mark session as expired
      session.status = "expired";
      session.expiresAt = now;
      await session.save();

      // Mark absentees
      await markAbsenteesForSession(session);

      console.log(`⏰ Auto-expired session ${session._id}`);
    }
  } catch (err) {
    console.error("Auto-expire error:", err.message);
  }
}

/**
 * Start the auto-expiry loop
 */
function startAutoExpireLoop(intervalMs = 60 * 1000) {
  // Run immediately on server start
  expireSessions();

  // Repeat every interval
  setInterval(expireSessions, intervalMs);
}

module.exports = { startAutoExpireLoop };
