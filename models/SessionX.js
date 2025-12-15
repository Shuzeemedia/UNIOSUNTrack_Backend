// models/Session.js
const mongoose = require("mongoose");

const sessionSchema = new mongoose.Schema({
  name: { type: String, required: true }, // e.g., "2025/2026"
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  active: { type: Boolean, default: false }, // only one session active at a time
}, { timestamps: true });

module.exports = mongoose.model("SessionX", sessionSchema);
