const mongoose = require("mongoose");

const AttendanceArchiveSchema = new mongoose.Schema({
  session: String,
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: "Course" },
  date: Date,
  status: String, // "present" or "absent"
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("AttendanceArchive", AttendanceArchiveSchema);
