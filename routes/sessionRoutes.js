const express = require("express");
const Session = require("../models/Session");
const Attendance = require("../models/Attendance");
const Course = require("../models/Course");
const User = require("../models/User");
const { auth, roleCheck } = require("../middleware/authMiddleware");
const QRCode = require("qrcode");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");

const router = express.Router();

/* ----------------------------------------------------
   🧠 Helper — Mark absentees safely (no duplicates)
---------------------------------------------------- */
const markAbsenteesForSession = async (session) => {
  const course = await Course.findById(session.course._id)
    .populate("students", "_id")
    .populate("semester");
  const allStudents = course.students.map((s) => s._id.toString());
  const presentStudents = await Attendance.find({ session: session._id }).distinct("student");
  const absentees = allStudents.filter((s) => !presentStudents.includes(s));

  if (absentees.length > 0) {
    const absentRecords = [];

    for (const sid of absentees) {
      const exists = await Attendance.findOne({
        course: session.course._id,
        student: sid,
        session: session._id,
      });
      if (!exists) {
        absentRecords.push({
          course: session.course._id,
          student: sid,
          session: session._id,
          semester: course.semester,
          status: "Absent",
        });
      }
    }

    if (!course.semester) {
      console.error("Semester missing for course:", course._id);
      return;
    }

    if (absentRecords.length > 0) {
      await Attendance.insertMany(absentRecords);
    }

    console.log(`✅ Absentees marked for session ${session._id}: ${absentRecords.length} entries`);
  }
};

function getDistanceInMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
    Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}


/* ----------------------------------------------------
   🕒 Helper — End Session Automatically (on expiry)
---------------------------------------------------- */
const endSessionAndMarkAbsentees = async (sessionId) => {
  try {
    const session = await Session.findById(sessionId).populate("course");
    if (!session) return;
    if (new Date() < new Date(session.expiresAt)) return;
    if (session.status === "expired") return;

    session.status = "expired";
    await session.save();

    await markAbsenteesForSession(session);

    console.log(`✅ Auto-expired session ${sessionId} — absentees marked.`);
  } catch (err) {
    console.error("Auto expiry error:", err.message);
  }
};

/* ----------------------------------------------------
   ✅ FIXED — GET active session (restore on refresh)
---------------------------------------------------- */
router.get("/active/:courseId", auth, async (req, res) => {
  try {
    const { courseId } = req.params;
    const session = await Session.findOne({
      course: courseId,
      status: "active",
      expiresAt: { $gt: new Date() },
    }).populate("course", "name code");

    if (!session) {
      return res.json({ active: false });
    }

    res.json({
      active: true,
      session: {
        _id: session._id,
        token: session.token,
        course: session.course,
        expiresAt: session.expiresAt,
        status: session.status,

      },
    });
  } catch (err) {
    console.error("Error restoring active session:", err.message);
    res.status(500).json({ active: false, msg: "Server error" });
  }
});



/**
 * STUDENT SCAN (requires auth)
 */
router.get("/:token/student", auth, async (req, res) => {
  try {
    const session = await Session.findOne({ token: req.params.token });
    if (!session) {
      return res.status(404).json({ msg: "Session not found" });
    }

    const student = await User.findById(req.user.id);
    if (!student || !student.faceDescriptor?.length) {
      return res.status(400).json({ msg: "Face descriptor missing" });
    }

    res.json({
      sessionId: session._id,
      studentFaceDescriptor: student.faceDescriptor,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Server error" });
  }
});

/**
 * LECTURER VIEW (NO auth)
 */
router.get("/:token", auth, async (req, res) => {
  try {
    const session = await Session.findOne({ token: req.params.token })
      .populate({
        path: "course",
        populate: {
          path: "teacher",
          select: "name email role",
        },
      });

    if (!session) {
      return res.status(404).json({ msg: "Session not found" });
    }

    res.json({
      session,
    });
  } catch (err) {
    console.error("Session fetch error:", err);
    res.status(500).json({ msg: "Server error" });
  }
});


/* ----------------------------------------------------
   ✅ TEACHER creates new QR session (10 min)
---------------------------------------------------- */
router.post("/:courseId/create", auth, roleCheck(["teacher"]), async (req, res) => {
  try {
    const { courseId } = req.params;
    const course = await Course.findById(courseId);
    if (!course) return res.status(404).json({ msg: "Course not found" });
    if (course.teacher.toString() !== req.user.id)
      return res.status(403).json({ msg: "Not authorized" });

    // End any previous active session
    await Session.updateMany(
      { course: courseId, expiresAt: { $gt: new Date() } },
      { expiresAt: new Date(), status: "expired" }
    );

    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const session = new Session({
      course: courseId,
      teacher: req.user.id,
      token,
      expiresAt,
      status: "active",
      validTokens: [],
    });
    await session.save();

    const qrData = `${process.env.FRONTEND_URL}/student/scan/${token}`;
    const qrImage = await QRCode.toDataURL(qrData);

    // Auto-end session after 10 min
    const delay = expiresAt.getTime() - Date.now();
    setTimeout(() => endSessionAndMarkAbsentees(session._id), delay);

    res.json({ msg: "Session created", token, qrImage, expiresAt, sessionId: session._id });
  } catch (err) {
    console.error("POST /:courseId/create error:", err.message);
    res.status(500).json({ msg: "Server error", error: err.message });
  }
});

/* ----------------------------------------------------
   🔁 REFRESH rotating QR token (overwrite previous)
---------------------------------------------------- */
router.post("/:sessionId/refresh", auth, roleCheck(["teacher"]), async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await Session.findById(sessionId);
    if (!session) return res.status(404).json({ msg: "Session not found" });
    if (session.status === "expired" || new Date() > new Date(session.expiresAt))
      return res.status(400).json({ msg: "Session expired" });

    // Only one valid token at a time
    const newToken = crypto.randomBytes(12).toString("hex");
    session.validTokens = [{ token: newToken, expiresAt: new Date(Date.now() + 10 * 1000) }];
    await session.save();

    const qrData = `${process.env.FRONTEND_URL}/student/scan/${newToken}`;
    const qrImage = await QRCode.toDataURL(qrData);

    res.json({ msg: "QR refreshed", token: newToken, qrImage });
  } catch (err) {
    console.error("POST /:sessionId/refresh error:", err.message);
    res.status(500).json({ msg: "Server error", error: err.message });
  }
});

router.post("/scan/:token", auth, roleCheck(["student"]), async (req, res) => {
  try {
    const { token } = req.params;
    const userId = req.user.id;
    const { location } = req.body;

    // --- Find active session by original or rotated token ---
    const session = await Session.findOne({
      status: "active",
      $or: [
        { token: token },                // original token
        { "validTokens.token": token }   // rotated token
      ]
    }).populate("course");

    if (!session) return res.status(404).json({ msg: "Invalid or expired QR" });

    // --- Check session expiry ---
    if (new Date() > new Date(session.expiresAt)) {
      return res.status(400).json({ msg: "Session expired" });
    }

    // --- Check student enrollment ---
    const course = await Course.findById(session.course._id).populate("students", "_id");
    const isEnrolled = course.students.some((s) => s._id.toString() === userId);
    if (!isEnrolled) return res.status(403).json({ msg: "You are not enrolled in this course" });

    // --- GPS location validation ---
    if (session.course.location?.lat && session.course.location?.lng) {
      if (!location || location.lat == null || location.lng == null) {
        return res.status(400).json({ msg: "Location is required to mark attendance" });
      }

      if (location.accuracy && location.accuracy > 50) {
        return res.status(400).json({ msg: "Location accuracy too low. Move to open space." });
      }

      const distance = getDistanceInMeters(
        parseFloat(location.lat),
        parseFloat(location.lng),
        parseFloat(session.course.location.lat),
        parseFloat(session.course.location.lng)
      );

      if (distance > session.course.location.radius) {
        return res.status(403).json({ msg: "You are not within the lecture location" });
      }
    }

    // --- Prevent duplicate attendance ---
    const alreadyMarked = await Attendance.findOne({
      course: session.course._id,
      student: userId,
      session: session._id,
    });
    if (alreadyMarked) return res.status(400).json({ msg: "Attendance already marked" });

    // --- Record attendance ---
    const attendance = new Attendance({
      course: session.course._id,
      student: userId,
      session: session._id,
      semester: session.course.semester,
      status: "Present",
      date: new Date(),
      faceVerifiedAt: new Date(), // optional: logs that face was verified
      location: location ? { lat: location.lat, lng: location.lng } : undefined,
    });

    await attendance.save();

    // --- Rotate QR token if original token was used ---
    if (session.token === token) {
      const newToken = crypto.randomBytes(12).toString("hex");
      session.validTokens = [{ token: newToken, expiresAt: new Date(Date.now() + 10 * 1000) }];
      await session.save();
    }

    res.json({
      msg: "Attendance recorded successfully",
      sessionId: session._id,
      studentId: userId,
      attendanceId: attendance._id,
    });

  } catch (err) {
    console.error("POST /sessions/scan/:token error:", err.message);
    res.status(500).json({ msg: "Server error", error: err.message });
  }
});



/* ----------------------------------------------------
   ✅ TEACHER manually ends session (marks absentees)
---------------------------------------------------- */
router.post("/:sessionId/end", auth, roleCheck(["teacher"]), async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await Session.findById(sessionId).populate("course");
    if (!session) return res.status(404).json({ msg: "Session not found" });
    if (session.teacher.toString() !== req.user.id)
      return res.status(403).json({ msg: "Not authorized" });

    if (session.status === "expired")
      return res.status(400).json({ msg: "Session already ended" });

    session.status = "expired";
    session.expiresAt = new Date();
    await session.save();

    await markAbsenteesForSession(session);

    res.json({ msg: "Session ended manually. Absentees marked." });
  } catch (err) {
    console.error("POST /sessions/:sessionId/end error:", err.message);
    res.status(500).json({ msg: "Server error", error: err.message });
  }
});

module.exports = router;