const Session = require("../models/Session");
const { endSession } = require("../helpers/sessionHelpers");

async function expireSessions(io) {
    const now = new Date();
    console.log("⏰ Checking for expired sessions at", now.toISOString());

    try {
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

        for (const session of sessions) {
            try {
                await endSession(session);

                // 🔔 REALTIME UPDATE
                if (io && session.course?._id) {
                    io.to(session.course._id.toString()).emit("session-ended", {
                        sessionId: session._id,
                        courseId: session.course._id
                    });
                }

            } catch (err) {
                console.error(`❌ Failed to end session ${session._id}:`, err.message || err);
            }
        }
    } catch (err) {
        console.error("❌ Failed to check for expired sessions:", err.message || err);
    }
}

function startAutoExpireLoop(io, intervalMs = 60 * 1000) {
    expireSessions(io); // run immediately
    setInterval(() => expireSessions(io), intervalMs);
}

module.exports = { startAutoExpireLoop };
