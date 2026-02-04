const express = require("express");
const { ObjectId } = require("mongodb");
const Session = require("../models/Session");
const Attendance = require("../models/Attendance");
const Course = require("../models/Course");
const Enrollment = require("../models/Enrollment");
const User = require("../models/User");
const { auth, roleCheck, studentOnly } = require("../middleware/authMiddleware");


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

// unchanged
async function markAbsenteesForSession(session) {
  // 1️⃣ Get all enrolled students
  const enrollments = await Enrollment.find({ course: session.course })
    .select("student semester");

  // 2️⃣ Get students already marked (Present or Absent)
  const alreadyMarked = await Attendance.find({
    session: session._id
  }).select("student");

  const markedStudentIds = new Set(
    alreadyMarked.map(a => a.student.toString())
  );

  // 3️⃣ Build absent records ONLY for unmarked students
  const absentees = enrollments
    .filter(e => !markedStudentIds.has(e.student.toString()))
    .map(e => ({
      course: session.course,
      student: e.student,
      semester: e.semester,
      session: session._id,
      sessionType: session.type,
      status: "Absent",
      date: session.createdAt,
    }));

  // 4️⃣ Insert absentees
  if (absentees.length > 0) {
    await Attendance.insertMany(absentees);
  }
}





async function endSession(session, io) {
  console.log("[END SESSION START]", {
    sessionId: session._id.toString(),
    status: session.status,
    time: new Date().toISOString(),
    caller: new Error().stack.split("\n")[2].trim()
  });

  const fresh = await Session.findById(session._id);
  if (!fresh || fresh.status === "expired") {
    console.log("[END SESSION ABORTED] Already expired", session._id.toString());
    return;
  }

  fresh.status = "expired";
  fresh.expiresAt = new Date();
  await fresh.save();

  await markAbsenteesForSession(fresh);

  emitAttendanceUpdate(io, {
    courseId: fresh.course.toString(),
    sessionId: fresh._id.toString(),
    source: "auto-expire"
  });

  console.log("[END SESSION DONE]", session._id.toString());
}

async function cancelSession(session, io, reason = "") {
  console.log("[CANCEL SESSION START]", {
    sessionId: session._id.toString(),
    status: session.status,
    time: new Date().toISOString()
  });

  const fresh = await Session.findById(session._id);
  if (!fresh || fresh.status !== "active") {
    console.log("[CANCEL SESSION ABORTED] Not active");
    return;
  }

  // 1️⃣ Mark session as cancelled
  fresh.status = "cancelled";
  fresh.cancelledAt = new Date();
  if (reason) fresh.cancelReason = reason;
  fresh.expiresAt = new Date();

  await fresh.save();

  // 2️⃣ Remove any attendance already recorded
  await Attendance.deleteMany({ session: fresh._id });

  // 3️⃣ Notify via socket
  emitAttendanceUpdate(io, {
    courseId: fresh.course.toString(),
    sessionId: fresh._id.toString(),
    source: "session-cancelled"
  });

  console.log("[CANCEL SESSION DONE]", fresh._id.toString());
}



async function validateStudentForSession(studentId, session, location) {
  // 1️⃣ Check enrollment
  const enrollment = await Enrollment.findOne({
    course: session.course._id,
    student: studentId
  });

  if (!enrollment) {
    throw { status: 403, msg: "You are not enrolled in this course" };
  }

  // 2️⃣ If session has GPS restriction
  if (session.location?.lat && session.location?.lng) {

    // Location must be sent
    if (!location) {
      throw { status: 400, msg: "Location is required" };
    }


    // 🔵 Normalize STUDENT GPS
    const studentLat = Number(location.lat);
    const studentLng = Number(location.lng);

    const accuracy = Number(location.accuracy);

    // Block fake GPS / IP-based spoofing
    if (!Number.isFinite(accuracy)) {
      throw { status: 400, msg: "GPS accuracy missing" };
    }

    // Reject network / VPN / IP geolocation
    if (accuracy > 300) {
      throw {
        status: 403,
        msg: "GPS signal too weak. Enable precise location and move outdoors."
      };
    }


    if (!Number.isFinite(studentLat) || !Number.isFinite(studentLng)) {
      throw { status: 400, msg: "Invalid GPS coordinates" };
    }

    // 🔵 Normalize SESSION GPS
    const sessionLat = Number(session.location.lat);
    const sessionLng = Number(session.location.lng);
    const sessionRadius = Number(session.location.radius) || 60;

    if (!Number.isFinite(sessionLat) || !Number.isFinite(sessionLng)) {
      throw { status: 500, msg: "Session location corrupted" };
    }


    // const studentAccuracy = accuracy;
    // const sessionAccuracy = Number(session.location.accuracy) || 50;


    // 3️⃣ Calculate distance
    const dist = getDistanceInMeters(
      studentLat,
      studentLng,
      sessionLat,
      sessionLng
    );

    // Block fake zero-distance scans
    if (dist < 5 && accuracy > 30) {
      throw {
        status: 403,
        msg: "Fake GPS detected. Move physically closer to the lecture."
      };
    }

    // 🔵 Accuracy-aware geofence
    const allowedDistance =
      session.location.radius +
      Math.max(
        accuracy, // student accuracy
        Number(session.location.accuracy) || 50 // lecturer accuracy
      );

    // 4️⃣ Enforce geofence
    if (dist > allowedDistance) {
      throw {
        status: 403,
        msg: "Outside attendance zone (GPS accuracy considered)",
        dist: Math.round(dist),
        allowedDistance: Math.round(allowedDistance)
      };
    }


    // Save normalized values back
    location.lat = studentLat;
    location.lng = studentLng;
    location.accuracy = accuracy;

  }

  return true;
}




async function rotateQrToken(session) {
  const newToken = crypto.randomBytes(12).toString("hex");
  session.validTokens = [{ token: newToken, expiresAt: new Date(Date.now() + 10 * 1000) }];
  await session.save();
  return newToken;
}


// ======================= SET INTERVAL ======================= //

router.post("/:sessionId/location", auth, roleCheck(["teacher"]), async (req, res) => {
  const { lat, lng, accuracy } = req.body;

  // Validate coordinates
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ msg: "Invalid GPS coordinates" });
  }

  const lecturerAccuracy = Number(accuracy);
  if (!Number.isFinite(lecturerAccuracy)) {
    return res.status(400).json({ msg: "GPS accuracy missing" });
  }

  // Reject extremely weak GPS (network/IP-based)
  if (lecturerAccuracy > 500) {
    return res.status(400).json({
      msg: "GPS signal too weak. Enable precise location."
    });
  }

  const session = await Session.findById(req.params.sessionId);
  if (!session || session.status !== "active") {
    return res.status(404).json({ msg: "Session not active" });
  }

  // Normalize accuracy (IMPORTANT)
  const normalizedAccuracy = Math.min(
    Math.max(lecturerAccuracy, 10),
    120
  );

  if (!session.location) session.location = {};
  session.location.lat = Number(lat);
  session.location.lng = Number(lng);
  session.location.accuracy = normalizedAccuracy;


  await session.save();

  res.json({ msg: "Session location updated" });
});




// ======================= ROUTES ======================= //

// Student checks if already marked
router.get("/check", auth, studentOnly(), async (req, res) => {
  const { sessionId } = req.query;
  const studentId = req.user.id;
  const exists = await Attendance.findOne({ session: sessionId, student: studentId });
  res.json({ alreadyMarked: !!exists });
});

// Get active session for course
router.get("/active/:courseId", auth, async (req, res) => {
  const session = await Session.findOne({
    course: req.params.courseId,
    status: "active",
    expiresAt: { $gt: new Date() }
  }).populate("course", "name code");

  if (!session) {
    return res.json({ active: false });
  }

  res.json({ active: true, session });
});



// Student scans QR
router.post("/scan/:token", auth, studentOnly(), async (req, res) => {
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

    if (session.status !== "active") {
      return res.status(400).json({
        msg: "This session is no longer active"
      });
    }
    

    if (session.type !== "QR") {
      return res.status(400).json({
        msg: "This session does not support QR attendance"
      });
    }

    if (new Date() > session.expiresAt) return res.status(400).json({ msg: "Session expired" });

    await validateStudentForSession(studentId, session, location);

    const alreadyMarked = await Attendance.findOne({ session: session._id, student: studentId });
    if (alreadyMarked) return res.status(409).json({ alreadyMarked: true, msg: "Already marked for this session" });


    const attendance = await Attendance.create({
      course: session.course._id,
      student: studentId,
      semester: session.semester,
      session: session._id,
      sessionType: "QR",
      status: "Present",
      date: session.createdAt,
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
    console.error("[SCAN ERROR]", {
      msg: err.msg,
      status: err.status,
      err
    });

    res.status(err.status || 500).json({
      msg: err.msg || "Server error",
      debug: err
    });
  }

});

// ======================= CREATE SESSIONS ======================= //

// Teacher creates any session (QR/manual/rollcall)
// ======================= CREATE SESSIONS ======================= //

router.post("/:courseId/create", auth, roleCheck(["teacher"]), async (req, res) => {
  try {
    const { courseId } = req.params;
    const { type, location, duration } = req.body;

    const safeType = ["QR", "MANUAL", "ROLLCALL"].includes(type?.toUpperCase())
      ? type.toUpperCase()
      : "MANUAL";

    const course = await Course.findById(courseId);
    if (!course) return res.status(404).json({ msg: "Course not found" });
    if (course.teacher.toString() !== req.user.id) return res.status(403).json({ msg: "Not authorized" });

    const io = req.app.get("io");

    // Expire previous sessions
    const activeSessions = await Session.find({ course: courseId, status: "active" });
    for (const s of activeSessions) {
      await endSession(s, io);
    }

    const token = uuidv4();
    const safeDuration = Math.min(Math.max(Number(duration) || 10, 1), 180);
    const expiresAt = new Date(Date.now() + safeDuration * 60 * 1000);

    let sessionData = {
      course: courseId,
      teacher: req.user.id,
      semester: course.semester,
      token,
      expiresAt,
      status: "active",
      validTokens: [],
      type: safeType,
    };

    // ✅ Only attach location if session is QR
    if (safeType === "QR") {
      if (!location || !Number.isFinite(Number(location.lat)) || !Number.isFinite(Number(location.lng))) {
        return res.status(400).json({
          msg: "Lecture location is required for QR sessions"
        });
      }

      const lecturerAccuracy = Number(location.accuracy);

      if (!Number.isFinite(lecturerAccuracy)) {
        return res.status(400).json({ msg: "Invalid GPS data received" });
      }

      const normalizedAccuracy = Math.min(
        Math.max(lecturerAccuracy, 10),
        120
      );



      const radius = Math.min(
        Math.max(Number(location.radius) || 60, 10),
        300
      );

      sessionData.location = {
        lat: Number(location.lat),
        lng: Number(location.lng),
        radius,
        accuracy: normalizedAccuracy,
      };

    }


    const session = await Session.create(sessionData);

    // Generate QR only for QR sessions
    let qrImage = null;
    if (safeType === "QR") {
      const qrData = `${process.env.FRONTEND_URL}/student/scan/${token}`;
      qrImage = await QRCode.toDataURL(qrData);
    }

    emitAttendanceUpdate(io, {
      courseId: courseId.toString(),
      sessionId: session._id.toString(),
      source: "session-created"
    });

    res.json({
      msg: "Session created",
      token,
      qrImage,
      expiresAt,
      sessionId: session._id,
      type: safeType
    });

  } catch (err) {
    console.error("[CREATE SESSION ERROR]", err.message, err);
    res.status(500).json({
      msg: err.message || "Server error",
      error: err
    });
  }
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
  if (!session.teacher || session.teacher.toString() !== req.user.id) {
    return res.status(403).json({ msg: "Not authorized" });
  }
  

  const io = req.app.get("io"); // ✅ get socket instance
  await endSession(session, io);

  res.json({ msg: "Session ended manually. Absentees marked." });
});


// Teacher cancels a session (NO attendance recorded)
router.post("/:sessionId/cancel", auth, roleCheck(["teacher"]), async (req, res) => {
  try {
    const session = await Session.findById(req.params.sessionId);

    if (!session) {
      return res.status(404).json({ msg: "Session not found" });
    }

    if (session.constructor.modelName !== "Session") {
      throw new Error("Invalid model used in attendance cancel");
    }
    

    if (session.teacher.toString() !== req.user.id) {
      return res.status(403).json({ msg: "Not authorized" });
    }

    if (session.status !== "active") {
      return res.status(400).json({
        msg: "Only active sessions can be cancelled"
      });
    }

    const io = req.app.get("io");

    // Optional reason from frontend
    const { reason } = req.body;

    await cancelSession(session, io, reason);

    res.json({
      msg: "Session cancelled successfully. No attendance was recorded."
    });
  } catch (err) {
    console.error("[CANCEL SESSION ERROR]", err);
    res.status(500).json({ msg: "Server error" });
  }
});


// ======================= STUDENT FACE DESCRIPTOR =======================

router.get("/:token/student", auth, studentOnly(), async (req, res) => {
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
module.exports.cancelSession = cancelSession;
module.exports.emitAttendanceUpdate = emitAttendanceUpdate;