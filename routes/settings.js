// routes/settings.js
const express = require("express");
const router = express.Router();
const SessionX = require("../models/SessionX");
const Semester = require("../models/Semester");

// GET active session & semester
router.get("/active-session-semester", async (req, res) => {
  try {
    const activeSession = await SessionX.findOne({ active: true });
    const activeSemester = await Semester.findOne({ active: true });

    if (!activeSession || !activeSemester) {
      return res.status(404).json({ msg: "Active session or semester not found" });
    }

    res.json({
      session: activeSession.name,
      semester: activeSemester.season, // or name if you prefer
    });
  } catch (err) {
    console.error("Fetch active session & semester error:", err);
    res.status(500).json({ msg: "Server error" });
  }
});

module.exports = router;
