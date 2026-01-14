const express = require("express");
const router = express.Router();

const { auth, roleCheck } = require("../middleware/authMiddleware");
const User = require("../models/User");

// ===================================================
// GET ALL GRADUATED STUDENTS
// ===================================================
router.get(
  "/graduates",
  auth,
  roleCheck(["admin"]),
  async (req, res) => {
    try {
      const graduates = await User.find({ graduated: true })
        .select("name studentId department graduationDate graduationVerified")
        .populate("department", "name");

      res.json(graduates);
    } catch (err) {
      res.status(500).json({ msg: "Failed to fetch graduates" });
    }
  }
);

// ===================================================
// VERIFY GRADUATE
// ===================================================
router.put(
  "/verify/:id",
  auth,
  roleCheck(["admin"]),
  async (req, res) => {
    try {
      const student = await User.findById(req.params.id);

      if (!student || !student.graduated) {
        return res.status(404).json({ msg: "Graduate not found" });
      }

      student.graduationVerified = true;
      await student.save();

      res.json({ msg: "Graduate verified successfully" });
    } catch (err) {
      res.status(500).json({ msg: "Verification failed" });
    }
  }
);

// ===================================================
// REVOKE VERIFICATION
// ===================================================
router.put(
  "/revoke/:id",
  auth,
  roleCheck(["admin"]),
  async (req, res) => {
    try {
      const student = await User.findById(req.params.id);

      if (!student) {
        return res.status(404).json({ msg: "Student not found" });
      }

      student.graduationVerified = false;
      await student.save();

      res.json({ msg: "Verification revoked" });
    } catch (err) {
      res.status(500).json({ msg: "Failed to revoke verification" });
    }
  }
);

module.exports = router;
