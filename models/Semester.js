const mongoose = require("mongoose");

const semesterSchema = new mongoose.Schema({
  name: { type: String, required: true }, // e.g., "Harmattan 2025/2026"
  season: { type: String, enum: ["Harmattan", "Rain"], required: true },
  startDate: { type: Date },
  endDate: { type: Date },
  active: { type: Boolean, default: false },
});

module.exports = mongoose.model("Semester", semesterSchema);
