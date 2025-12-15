const mongoose = require("mongoose");

const LeaderboardArchiveSchema = new mongoose.Schema({
  session: String,
  student: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  totalPresent: Number,
  totalAbsent: Number,
  percentage: Number,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("LeaderboardArchive", LeaderboardArchiveSchema);
