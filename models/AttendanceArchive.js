const mongoose = require("mongoose");

const AttendanceArchiveSchema = new mongoose.Schema({
  course: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Course",
    required: true,
  },

  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },

  semester: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Semester",
    required: true,
  },

  // class session (QR / rollcall session)
  session: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Session",
    required: true,
  },

  // academic session (2023/2024, 2024/2025)
  academicSession: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "SessionX",
    required: true,
  },

  sessionType: String,
  status: String,

  markedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },

  faceVerified: Boolean,
  rollCallMode: Boolean,

  date: Date,

  archivedAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("AttendanceArchive", AttendanceArchiveSchema);
