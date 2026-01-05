const Session = require("../models/Session");
const { endSession } = require("../helpers/sessionHelpers");

async function expireSessions() {
    const now = new Date();
    console.log("⏰ Checking for expired sessions at", now.toISOString());

    try {
        // 1️⃣ Find active sessions that should expire
        const sessions = await Session.find({
            status: "active",
            expiresAt: { $lte: now }
        }).populate({
            path: "course",
            populate: { path: "students", select: "_id name email" }
        });

        if (!sessions.length) {
            console.log("📌 No expired sessions found at this check.");
            return;
        }

        console.log("📌 Expired sessions found:", sessions.map(s => s._id));

        // 2️⃣ End each session safely
        for (const session of sessions) {
            try {
                await endSession(session); // our safe endSession from earlier
            } catch (err) {
                console.error(`❌ Failed to end session ${session._id}:`, err.message || err);
            }
        }
    } catch (err) {
        console.error("❌ Failed to check for expired sessions:", err.message || err);
    }
}

function startAutoExpireLoop(intervalMs = 60 * 1000) {
    expireSessions(); // run immediately
    setInterval(expireSessions, intervalMs);
}

module.exports = { startAutoExpireLoop };
