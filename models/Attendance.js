const mongoose = require("mongoose");

const AttendanceSchema = new mongoose.Schema(
  {
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

    // SESSION IS NOW REQUIRED (session-unique system)
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Session",
      required: true,
    },

    sessionType: {
      type: String,
      enum: ["QR", "MANUAL", "ROLLCALL"],
      required: true,
    },    

    status: {
      type: String,
      enum: ["Present", "Absent", "NA"],
      default: "NA",
    },

    markedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    faceVerified: {
      type: Boolean,
      default: false,
    },

    rollCallMode: {
      type: Boolean,
      default: false,
    },

    date: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true }
);

// ✅ UNIQUE PER SESSION
AttendanceSchema.index(
  { course: 1, semester: 1, student: 1, session: 1 },
  { unique: true }
);

module.exports = mongoose.model("Attendance", AttendanceSchema);
