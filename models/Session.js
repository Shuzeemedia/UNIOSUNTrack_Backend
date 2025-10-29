const mongoose = require("mongoose");

const sessionSchema = new mongoose.Schema({
  course: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Course",
    required: true,
  },
  teacher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },

  // The main session token (used for session reference)
  token: {
    type: String,
    required: true,
    unique: true,
  },

  // When the session itself expires (10 mins after creation)
  expiresAt: {
    type: Date,
    required: true,
  },

  status: {
    type: String,
    enum: ["active", "expired"],
    default: "active",
  },

  // Store the rotating QR tokens (each valid for ~10 seconds)
  validTokens: [
    {
      token: String,
      expiresAt: Date,
    },
  ],
});

// Auto-remove session after expiration (MongoDB TTL)
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Clean expired QR tokens automatically
sessionSchema.methods.cleanExpiredTokens = function () {
  const now = new Date();
  this.validTokens = this.validTokens.filter(
    (t) => t.expiresAt > now
  );
  return this.save();
};

// Add a new rotating token
sessionSchema.methods.addNewToken = async function (token, durationMs = 10000) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationMs);
  this.validTokens.push({ token, expiresAt });
  await this.cleanExpiredTokens(); // Keep array fresh
  return this.save();
};

// Check if a provided token is currently valid
sessionSchema.methods.isTokenValid = function (token) {
  const now = new Date();
  return this.validTokens.some(
    (t) => t.token === token && t.expiresAt > now
  );
};

module.exports = mongoose.model("Session", sessionSchema);
