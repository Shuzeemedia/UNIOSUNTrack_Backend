const express = require("express");
const { ObjectId } = require("mongodb");
const Session = require("../models/Session");
const Attendance = require("../models/Attendance");
const Course = require("../models/Course");
const Enrollment = require("../models/Enrollment");
const User = require("../models/User");
const { auth, roleCheck } = require("../middleware/authMiddleware");
const { getLocalDayKey } = require("../utils/dayKey");
const QRCode = require("qrcode");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");


const router = express.Router();

// ======================= HELPERS ======================= //

function emitAttendanceUpdate(io, payload = {}) {
  if (!io || !payload.courseId) return;

  io.to(payload.courseId).emit("attendance-updated", {
    courseId: payload.courseId,
    sessionId: payload.sessionId,
    source: payload.source || "manual"
  });
}



function getDistanceInMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = x => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function markAbsenteesForSession(session) {
  console.log("[DEBUG] markAbsenteesForSession called for session:", session._id);

  const enrollments = await Enrollment.find({ course: session.course }).select("student");
  console.log("[DEBUG] Enrolled students:", enrollments.map(e => e.student));

  const presentIds = await Attendance.find({
    session: session._id,
    status: "Present"
  }).distinct("student");
  console.log("[DEBUG] Present student IDs:", presentIds);

  const enrolledIds = enrollments.map(e => e.student.toString());
  const presentSet = new Set(presentIds.map(id => id.toString()));
  const absentees = enrolledIds.filter(id => !presentSet.has(id));

  console.log("[DEBUG] Absentees to mark:", absentees);

  if (!absentees.length) return;

  const absenteesToMark = absentees.map(studentId => ({
    course: session.course,
    student: studentId,
    semester: session.semester,
    session: session._id,
    status: "Absent",
    sessionType: session.type, // <- required field
    dayKey: getLocalDayKey(session.createdAt || new Date()),
    date: session.createdAt || new Date()
  }));


  try {
    const result = await Attendance.insertMany(absenteesToMark);
    console.log("[DEBUG] Absentees inserted:", result);
  } catch (err) {
    console.error("[ERROR] Failed to mark absentees:", err);
  }

}


async function endSession(session, io) {
  if (!session || session.status === "expired") return;

  console.log("[DEBUG] Ending session:", session._id);

  session.status = "expired";
  session.expiresAt = new Date();
  await session.save();

  await markAbsenteesForSession(session);

  // 🔥 Emit live update
  emitAttendanceUpdate(io, {
    courseId: session.course.toString(),
    sessionId: session._id.toString(),
    source: "auto-expire"
  });

}



async function validateStudentForSession(studentId, session, location) {
  const enrollment = await Enrollment.findOne({ course: session.course._id, student: studentId });
  if (!enrollment) throw { status: 403, msg: "You are not enrolled in this course" };

  const course = await Course.findById(session.course._id);
  if (course.location?.lat && course.location?.lng) {
    if (!location) throw { status: 400, msg: "Location is required" };
    if (location.accuracy && location.accuracy > 150) throw { status: 400, msg: "Location accuracy too low" };
    const distance = getDistanceInMeters(location.lat, location.lng, course.location.lat, course.location.lng);
    if (distance > course.location.radius) throw { status: 403, msg: "You are not within lecture location" };
  }
  return course;
}

async function rotateQrToken(session) {
  const newToken = crypto.randomBytes(12).toString("hex");
  session.validTokens = [{ token: newToken, expiresAt: new Date(Date.now() + 10 * 1000) }];
  await session.save();
  return newToken;
}

// Auto-expire active sessions
async function expireSessions(io) {
  const now = new Date();
  const sessions = await Session.find({
    status: "active",
    expiresAt: { $lte: now }
  });

  for (const session of sessions) {
    console.log("Auto-expiring session:", session._id);
    await endSession(session, io);
  }
}

// Pass io from index.js
const io = require("../index").io; // or however you export it
setInterval(() => expireSessions(io), 60 * 1000);
expireSessions(io);


// ======================= ROUTES ======================= //

// Student checks if already marked
router.get("/check", auth, roleCheck(["student"]), async (req, res) => {
  const { sessionId } = req.query;
  const studentId = req.user.id;
  const exists = await Attendance.findOne({ session: sessionId, student: studentId });
  res.json({ alreadyMarked: !!exists });
});

// Get active session for course
router.get("/active/:courseId", auth, async (req, res) => {
  const session = await Session.findOne({ course: req.params.courseId, status: "active", expiresAt: { $gt: new Date() } }).populate("course", "name code");
  if (!session) return res.json({ active: false });
  res.json({ active: true, session });
});

// Student scans QR
router.post("/scan/:token", auth, roleCheck(["student"]), async (req, res) => {
  try {
    const { token } = req.params;
    const studentId = req.user.id;
    const { location } = req.body;

    const session = await Session.findOne({
      status: "active",
      $or: [
        { token },
        { validTokens: { $elemMatch: { token, expiresAt: { $gt: new Date() } } } }
      ]
    }).populate("course");
    if (!session) return res.status(404).json({ msg: "Invalid or expired QR code" });
    if (new Date() > session.expiresAt) return res.status(400).json({ msg: "Session expired" });

    await validateStudentForSession(studentId, session, location);

    const alreadyMarked = await Attendance.findOne({ session: session._id, student: studentId });
    if (alreadyMarked) return res.status(409).json({ alreadyMarked: true, msg: "Already marked for this session" });

    const dayKey = getLocalDayKey(new Date());
    const attendance = await Attendance.create({
      course: session.course._id,
      student: studentId,
      semester: session.semester,
      session: session._id,
      sessionType: "QR",
      status: "Present",
      dayKey,
      date: new Date(),
      faceVerified: true,
      gpsLocation: location ? { lat: location.lat, lng: location.lng, accuracy: location.accuracy } : undefined
    });

    const io = req.app.get("io");

    emitAttendanceUpdate(io, {
      courseId: session.course._id.toString(),
      sessionId: session._id.toString(),
      source: "qr"
    });


    if (session.token === token) await rotateQrToken(session);

    res.status(201).json({ alreadyMarked: false, attendanceId: attendance._id, msg: "Attendance recorded" });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ msg: err.msg || "Server error" });
  }
});

// ======================= CREATE SESSIONS ======================= //

// Teacher creates any session (QR/manual/rollcall)
router.post("/:courseId/create", auth, roleCheck(["teacher"]), async (req, res) => {
  const { courseId } = req.params;
  const { type } = req.body; // "QR" | "manual" | "rollcall"

  // ✅ normalize & protect session type
  const safeType = ["QR", "MANUAL", "ROLLCALL"].includes(type?.toUpperCase())
    ? type.toUpperCase()
    : "MANUAL";


  const course = await Course.findById(courseId);
  if (!course) return res.status(404).json({ msg: "Course not found" });
  if (course.teacher.toString() !== req.user.id) return res.status(403).json({ msg: "Not authorized" });

  console.log("Creating session for course:", courseId, "semester:", course.semester, "type:", type);


  // Expire previous sessions
  const activeSessions = await Session.find({
    course: courseId,
    status: "active"
  });

  for (const s of activeSessions) {
    await endSession(s); // ✅ marks absentees properly
  }


  const token = uuidv4(); // always generate

  // ✅ ALL session types expire in 10 minutes
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);


  const session = await Session.create({
    course: courseId,
    teacher: req.user.id,
    semester: course.semester,
    token,
    expiresAt,
    status: "active",
    validTokens: [],
    type: safeType
  });

  let qrImage = null;
  if (type === "QR") {
    const qrData = `${process.env.FRONTEND_URL}/student/scan/${token}`;
    qrImage = await QRCode.toDataURL(qrData);
  }

  res.json({ msg: "Session created", token, qrImage, expiresAt, sessionId: session._id, type });
});

// Teacher refresh QR
router.post("/:sessionId/refresh", auth, roleCheck(["teacher"]), async (req, res) => {
  const session = await Session.findById(req.params.sessionId);
  if (!session) return res.status(404).json({ msg: "Session not found" });
  if (session.status === "expired") return res.status(400).json({ msg: "Session expired" });

  if (session.type !== "QR") return res.status(400).json({ msg: "Only QR sessions can refresh token" });

  const newToken = await rotateQrToken(session);
  const qrData = `${process.env.FRONTEND_URL}/student/scan/${newToken}`;
  const qrImage = await QRCode.toDataURL(qrData);

  res.json({ msg: "QR refreshed", token: newToken, qrImage });
});

// Teacher manually end session
router.post("/:sessionId/end", auth, roleCheck(["teacher"]), async (req, res) => {
  const session = await Session.findById(req.params.sessionId);
  if (!session) return res.status(404).json({ msg: "Session not found" });
  if (session.teacher.toString() !== req.user.id) return res.status(403).json({ msg: "Not authorized" });

  const io = req.app.get("io"); // ✅ get socket instance
  await endSession(session, io);

  res.json({ msg: "Session ended manually. Absentees marked." });
});


// ======================= STUDENT FACE DESCRIPTOR =======================

router.get("/:token/student", auth, roleCheck(["student"]), async (req, res) => {
  const session = await Session.findOne({
    $or: [
      { token: req.params.token },
      { validTokens: { $elemMatch: { token: req.params.token, expiresAt: { $gt: new Date() } } } }
    ]
  });

  if (!session) return res.status(404).json({ msg: "Session not found" });

  const student = await User.findById(req.user.id);
  if (!student?.faceDescriptor?.length) return res.status(400).json({ msg: "Face descriptor missing" });

  res.json({ sessionId: session._id, studentFaceDescriptor: student.faceDescriptor });
});

// ======================= GET SESSION BY TOKEN (generic) =======================
router.get("/:token", auth, async (req, res) => {
  try {
    const session = await Session.findOne({
      $or: [
        { token: req.params.token },
        { validTokens: { $elemMatch: { token: req.params.token, expiresAt: { $gt: new Date() } } } }
      ]
    }).populate({
      path: "course",
      populate: { path: "teacher", select: "name email role location radius" }
    });

    if (!session) return res.status(404).json({ msg: "Session not found" });

    res.json({ session });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Server error" });
  }
});

module.exports = router;
module.exports.markAbsenteesForSession = markAbsenteesForSession;
module.exports.endSession = endSession;
module.exports.emitAttendanceUpdate = emitAttendanceUpdate;

