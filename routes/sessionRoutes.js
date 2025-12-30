const express = require("express");
const Session = require("../models/Session");
const Attendance = require("../models/Attendance");
const Course = require("../models/Course");
const User = require("../models/User");
const { auth, roleCheck } = require("../middleware/authMiddleware");
const { getLocalDayKey } = require("../utils/dayKey");
const QRCode = require("qrcode");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");

const router = express.Router();



// console.log("✅ sessionRoutes loaded");

/* ----------------------------------------------------
   🧠 Helper — Distance calculation
---------------------------------------------------- */
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

/* ----------------------------------------------------
   🧠 Helper — Mark absentees safely
---------------------------------------------------- */
async function markAbsenteesForSession(session) {
  const course = await Course.findById(session.course._id)
    .populate("students", "_id")
    .populate("semester");

  const allStudents = course.students.map(s => s._id.toString());
  const dayKey = getLocalDayKey(session.createdAt);

  const presentStudents = await Attendance.find({
    course: course._id,
    dayKey,
    status: "Present"
  }).distinct("student");

  const absentees = allStudents.filter(s => !presentStudents.includes(s));
  if (!absentees.length) return;

  const records = absentees.map(sid => ({
    course: course._id,
    student: sid,
    session: session._id,
    semester: course.semester,
    status: "Absent",
    dayKey,
    date: new Date(session.createdAt)
  }));

  await Attendance.insertMany(records, { ordered: false });
  console.log(`✅ Absentees marked for ${dayKey}: ${records.length}`);
}

/* ----------------------------------------------------
   🧠 Helper — End session (manual or auto)
---------------------------------------------------- */
async function endSession(session) {
  if (!session || session.status === "expired") return;
  session.status = "expired";
  session.expiresAt = new Date();
  await session.save();
  await markAbsenteesForSession(session);
}

/* ----------------------------------------------------
   🧠 Helper — Validate student before marking
---------------------------------------------------- */
async function validateStudentForSession(studentId, session, location) {
  const course = await Course.findById(session.course._id).populate("students", "_id");

  if (!course.students.some(s => s._id.toString() === studentId)) {
    throw { status: 403, msg: "You are not enrolled in this course" };
  }

  if (course.location?.lat && course.location?.lng) {
    if (!location) throw { status: 400, msg: "Location is required" };
    if (location.accuracy && location.accuracy > 50) throw { status: 400, msg: "Location accuracy too low" };
    const distance = getDistanceInMeters(location.lat, location.lng, course.location.lat, course.location.lng);
    if (distance > course.location.radius) throw { status: 403, msg: "You are not within lecture location" };
  }

  return course;
}

/* ----------------------------------------------------
   🧠 Helper — Rotate QR token
---------------------------------------------------- */
async function rotateQrToken(session) {
  const newToken = crypto.randomBytes(12).toString("hex");
  session.validTokens = [{ token: newToken, expiresAt: new Date(Date.now() + 10 * 1000) }];
  await session.save();
  return newToken;
}

/* ----------------------------------------------------
   🧠 Helper — Auto-expire sessions (persistent)
---------------------------------------------------- */
async function expireSessions() {
  try {
    const now = new Date();
    const sessions = await Session.find({ status: "active", expiresAt: { $lte: now } });

    for (const session of sessions) {
      await endSession(session);
      console.log(`⏰ Auto-expired session ${session._id}`);
    }
  } catch (err) {
    console.error("Auto-expire error:", err.message);
  }
}

// Run every minute
setInterval(expireSessions, 60 * 1000);
expireSessions(); // run immediately on server start


/* ----------------------------------------------------
   ✅ GET active session
---------------------------------------------------- */
router.get("/active/:courseId", auth, async (req, res) => {
  try {
    const session = await Session.findOne({
      course: req.params.courseId,
      status: "active",
      expiresAt: { $gt: new Date() }
    }).populate("course", "name code");

    if (!session) return res.json({ active: false });

    res.json({
      active: true,
      session: {
        _id: session._id,
        token: session.token,
        course: session.course,
        expiresAt: session.expiresAt,
        status: session.status
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ active: false, msg: "Server error" });
  }
});

/* ----------------------------------------------------
   ✅ STUDENT scan (mark attendance)
---------------------------------------------------- */
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
    if (new Date() > new Date(session.expiresAt)) return res.status(400).json({ msg: "Session expired" });

    const course = await validateStudentForSession(studentId, session, location);

    const dayKey = getLocalDayKey();
    const alreadyMarked = await Attendance.findOne({ course: course._id, student: studentId, dayKey });
    if (alreadyMarked) return res.status(200).json({ alreadyMarked: true, msg: "Attendance already marked", attendanceId: alreadyMarked._id });

    const attendance = await Attendance.create({
      course: course._id,
      student: studentId,
      session: session._id,
      semester: course.semester,
      status: "Present",
      dayKey,
      date: new Date(),
      faceVerified: true,
      gpsLocation: location ? { lat: location.lat, lng: location.lng, accuracy: location.accuracy } : undefined
    });

    if (session.token === token) await rotateQrToken(session);

    res.status(201).json({ alreadyMarked: false, msg: "Attendance recorded", attendanceId: attendance._id, sessionId: session._id, studentId });
  } catch (err) {
    console.error("SCAN ERROR:", err);
    res.status(err.status || 500).json({ msg: err.msg || "Server error" });
  }
});

/* ----------------------------------------------------
   ✅ TEACHER creates session
---------------------------------------------------- */
router.post("/:courseId/create", auth, roleCheck(["teacher"]), async (req, res) => {
  try {
    const { courseId } = req.params;
    const course = await Course.findById(courseId);
    if (!course) return res.status(404).json({ msg: "Course not found" });
    if (course.teacher.toString() !== req.user.id) return res.status(403).json({ msg: "Not authorized" });

    await Session.updateMany({ course: courseId, expiresAt: { $gt: new Date() } }, { expiresAt: new Date(), status: "expired" });

    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const session = await Session.create({ course: courseId, teacher: req.user.id, token, expiresAt, status: "active", validTokens: [] });

    const qrData = `${process.env.FRONTEND_URL}/student/scan/${token}`;
    const qrImage = await QRCode.toDataURL(qrData);

    res.json({ msg: "Session created", token, qrImage, expiresAt, sessionId: session._id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Server error" });
  }
});

/* ----------------------------------------------------
   🔁 TEACHER refresh QR
---------------------------------------------------- */
router.post("/:sessionId/refresh", auth, roleCheck(["teacher"]), async (req, res) => {
  try {
    const session = await Session.findById(req.params.sessionId);
    if (!session) return res.status(404).json({ msg: "Session not found" });
    if (session.status === "expired" || new Date() > new Date(session.expiresAt)) return res.status(400).json({ msg: "Session expired" });

    const newToken = await rotateQrToken(session);
    const qrData = `${process.env.FRONTEND_URL}/student/scan/${newToken}`;
    const qrImage = await QRCode.toDataURL(qrData);

    res.json({ msg: "QR refreshed", token: newToken, qrImage });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Server error" });
  }
});

/* ----------------------------------------------------
   ✅ TEACHER manually end session
---------------------------------------------------- */
router.post("/:sessionId/end", auth, roleCheck(["teacher"]), async (req, res) => {
  try {
    const session = await Session.findById(req.params.sessionId).populate("course");
    if (!session) return res.status(404).json({ msg: "Session not found" });
    if (session.teacher.toString() !== req.user.id) return res.status(403).json({ msg: "Not authorized" });
    if (session.status === "expired") return res.status(400).json({ msg: "Session already ended" });

    await endSession(session);
    res.json({ msg: "Session ended manually. Absentees marked." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Server error" });
  }
});


/* ----------------------------------------------------
   ✅ STUDENT get face descriptor
---------------------------------------------------- */
router.get("/:token/student", auth, async (req, res) => {
  try {
    const session = await Session.findOne({ token: req.params.token });
    if (!session) return res.status(404).json({ msg: "Session not found" });

    const student = await User.findById(req.user.id);
    if (!student?.faceDescriptor?.length) return res.status(400).json({ msg: "Face descriptor missing" });

    res.json({ sessionId: session._id, studentFaceDescriptor: student.faceDescriptor });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Server error" });
  }
});



/* ----------------------------------------------------
   ✅ LECTURER view session
---------------------------------------------------- */
router.get("/:token", auth, async (req, res) => {
  try {
    const session = await Session.findOne({ token: req.params.token }).populate({
      path: "course",
      populate: { path: "teacher", select: "name email role" }
    });

    if (!session) return res.status(404).json({ msg: "Session not found" });

    res.json({ session });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Server error" });
  }
});





/* ----------------------------------------------------
   🔹 Export
---------------------------------------------------- */
module.exports = router;
module.exports.markAbsenteesForSession = markAbsenteesForSession;
module.exports.endSession = endSession;
