const mongoose = require("mongoose");

const CourseArchiveSchema = new mongoose.Schema({
  session: String,
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: "Course" },
  courseCode: String,
  courseTitle: String,
  teacher: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  students: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  attendanceSummary: Array,
  totalAttendanceCount: Number,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("CourseArchive", CourseArchiveSchema);
