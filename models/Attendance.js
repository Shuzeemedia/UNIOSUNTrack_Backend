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

  // NEW: reference to Semester
  semester: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Semester",
    required: true,
  },

  session: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "SessionX",
    required: true,
  },  

  status: {
    type: String,
    enum: ["Present", "Absent", "NA"],
    default: "NA",
  },

  gpsLocation: {
    lat: Number,
    lng: Number,
    accuracy: Number,
  },

  faceVerified: {
    type: Boolean,
    default: false,
  },

  markedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },

  rollCallMode: {
    type: Boolean,
    default: false,
  },

  date: {
    type: Date,
    required: true,
  },

  dayKey: {
    type: String,
    required: true,
  },  
  
});

// Prevent duplicate attendance per student per day
AttendanceSchema.index(
  { course: 1, student: 1, dayKey: 1 },
  { unique: true }
);


module.exports = mongoose.model("Attendance", AttendanceSchema);
