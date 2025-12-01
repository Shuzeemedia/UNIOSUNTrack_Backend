const mongoose = require("mongoose");

const AttendanceSchema = new mongoose.Schema({
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

  // Harmattan or Rain
  semester: {
    type: String,
    enum: ["Harmattan", "Rain"],
    required: true,
  },

  // Present | Absent | NA
  status: {
    type: String,
    enum: ["Present", "Absent", "NA"],
    default: "NA",
  },

  // Store GPS location
  gpsLocation: {
    lat: Number,
    lng: Number,
    accuracy: Number,
  },

  // Optional face verification (true/false)
  faceVerified: {
    type: Boolean,
    default: false,
  },

  // Lecturer that marked this attendance
  markedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },

  // If attendance was taken using Roll-Call Mode
  rollCallMode: {
    type: Boolean,
    default: false,
  },

  date: {
    type: Date,
    default: Date.now,
  },
});

// Prevent duplicate attendance per student per day
AttendanceSchema.index({ course: 1, student: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("Attendance", AttendanceSchema);
