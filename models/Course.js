const mongoose = require("mongoose");

const courseSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    description: { type: String, default: "" },
    code: { type: String, required: true, unique: true },
    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false, // ✅ Allow null / unassigned lecturer
      default: null,
    },

    students: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      required: true,
    },
    level: { type: Number, required: true },

    // NEW
    semester: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Semester",
      required: true,
    },

    totalClasses: { type: Number, default: 0 },

    // ✅ New field
    unit: {
      type: Number,
      required: true,
      min: 1,
      max: 6,
      default: 3,
    },

  },
  { timestamps: true }
);

module.exports = mongoose.model("Course", courseSchema);
