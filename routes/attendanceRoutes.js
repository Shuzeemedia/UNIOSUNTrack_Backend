const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");


const Attendance = require("../models/Attendance");
const Course = require("../models/Course");
const Enrollment = require("../models/Enrollment");
const User = require("../models/User");
const Session = require("../models/Session");

const { auth, roleCheck, studentOnly } = require("../middleware/authMiddleware");
const { emitAttendanceUpdate } = require("./sessionRoutes");
// adjust path if your folders differ


// ======================= HELPERS ======================= //

// Teacher access verification
async function verifyTeacherCourse(courseId, teacherId) {
  const course = await Course.findById(courseId);
  if (!course) throw { status: 404, msg: "Course not found" };
  if (course.teacher.toString() !== teacherId) throw { status: 403, msg: "Not authorized" };
  return course;
}

// Check student enrollment
async function checkEnrollment(courseId, studentId) {
  return await Enrollment.findOne({ course: courseId, student: studentId });
}

// Validate session belongs to course
async function validateSessionCourse(sessionId, courseId) {
  if (!sessionId) return;

  const session = await Session.findById(sessionId);
  if (!session) throw { status: 400, msg: "Invalid session" };
  if (session.course.toString() !== courseId) throw { status: 400, msg: "Session does not belong to this course" };
  if (session.status === "expired") throw { status: 400, msg: "Session has already ended" };

  return session;
}

// Build a date range filter for MongoDB
function buildDateRangeFilter({ date, range, filter }) {
  if (filter === "all") return null;

  if (filter === "today") {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(today);
    end.setHours(23, 59, 59, 999);
    return { $gte: today, $lte: end };
  }

  if (filter === "date" && date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const end = new Date(d);
    end.setHours(23, 59, 59, 999);
    return { $gte: d, $lte: end };
  }

  if (range === "week") {
    const today = new Date();
    const day = today.getDay(); // 0=Sun
    const diff = today.getDate() - day; // start of week (Sunday)
    const weekStart = new Date(today.setDate(diff));
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);
    return { $gte: weekStart, $lte: weekEnd };
  }

  if (range === "month") {
    const today = new Date();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    monthStart.setHours(0, 0, 0, 0);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    monthEnd.setHours(23, 59, 59, 999);
    return { $gte: monthStart, $lte: monthEnd };
  }

  return null;
}


// Fetch student attendance and summary
// ======================= STUDENT ATTENDANCE ======================= //

async function getStudentAttendance(
  courseId,
  studentId,
  { date, range, filter, sessionId } = {}
) {
  const course = await Course.findById(courseId);
  if (!course) throw { status: 404, msg: "Course not found" };

  /**
   * 1️⃣ STUDENT ATTENDANCE RECORDS
   */
  const enrollment = await Enrollment.findOne({
    course: courseId,
    student: studentId,
  });

  if (!enrollment) {
    throw { status: 400, msg: "Not enrolled in course" };
  }

  const attendanceFilter = {
    course: courseId,
    student: studentId,
    semester: enrollment.semester, // ✅ FIX
  };


  if (sessionId) {
    attendanceFilter.session = sessionId;
  } else {
    const dateRange = buildDateRangeFilter({ date, range, filter });
    if (dateRange) attendanceFilter.date = dateRange;
  }

  const records = await Attendance.find(attendanceFilter)
    .populate("student", "name email studentId profileImage department")
    .populate("session", "type mode createdAt")
    .sort({ date: -1 });

  const present = records.filter(r => r.status === "Present").length;
  const absent = records.filter(r => r.status === "Absent").length;

  /**
   * 2️⃣ CLASSES HELD (COURSE-WIDE, FILTERED)
   * ✅ SAME date filter
   * ✅ SAME source (Attendance)
   */
  const classFilter = { course: courseId };

  if (sessionId) {
    classFilter.session = sessionId;
  } else {
    const dateRange = buildDateRangeFilter({ date, range, filter });
    if (dateRange) classFilter.date = dateRange;
  }

  const classesHeld = present + absent;

  /**
   * 3️⃣ ATTENDANCE %
   */
  const attendancePercentage =
    classesHeld > 0 ? (present / classesHeld) * 100 : 0;

  /**
   * 4️⃣ XP SCORE (NO ROUNDING UP)
   * Example: 5 / 24 * 10 = 2.08 (NOT 2.10)
   */
  const totalPlanned = course.totalClasses || 0;
  const rawScore = totalPlanned > 0 ? (present / totalPlanned) * 10 : 0;
  const score = Math.floor(rawScore * 100) / 100;

  return {
    course,
    records,
    summary: {
      classesHeld,
      totalPlanned,
      present,
      absent,
      attendancePercentage,
      score,
    },
  };
}




// ======================= ROUTES ======================= //

// ---------- STUDENT ----------
router.get("/my-summary/:courseId", auth, studentOnly(), async (req, res) => {
  try {
    const { courseId } = req.params;
    const studentId = req.user.id;
    const { date, range, filter, sessionId } = req.query;

    const enrollment = await Enrollment.findOne({
      course: courseId,
      student: studentId,
    });

    if (!enrollment) {
      return res.status(400).json({ msg: "Not enrolled in this course" });
    }


    const { course, records, summary } = await getStudentAttendance(
      courseId,
      studentId,
      { date, range, filter, sessionId }
    );

    res.json({
      course: {
        id: course._id,
        name: course.name,
        code: course.code,
      },
      summary: {
        ...summary,
        attendancePercentage: Number(summary.attendancePercentage.toFixed(1)), // still round attendance %
        score: Number(summary.score.toFixed(2)), // round XP to 2 dp, no extra rounding
      },
      records,
    });

  } catch (err) {
    res.status(err.status || 500).json({
      msg: err.msg || "Server error",
      error: err.message,
    });
  }
}
);


// ---------- ADMIN ----------

// Admin: view all attendance
router.get("/", auth, roleCheck(["admin"]), async (req, res) => {
  try {
    const { courseId, studentId, teacherId, date, range, sessionId } = req.query;
    const filter = {};

    if (courseId) filter.course = courseId;
    if (studentId) filter.student = studentId;

    if (teacherId) {
      const teacherCourses = await Course.find({ teacher: teacherId }).select("_id");
      filter.course = { $in: teacherCourses.map(c => c._id) };
    }

    if (sessionId) filter.session = sessionId;
    else {
      const dateRange = buildDateRangeFilter({ date, range, filter });
      if (dateRange) filter.date = dateRange;
    }

    const records = await Attendance.find(filter)
      .populate("student", "name email studentId profileImage department")
      .populate("course", "name code totalClasses")
      .sort({ date: -1 });

    res.json({ records });
  } catch (err) {
    res.status(500).json({ msg: "Server error", error: err.message });
  }
});

// Admin: mark single
router.post("/", auth, roleCheck(["admin"]), async (req, res) => {
  try {
    const { studentId, courseId, status = "Present", date, sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ msg: "sessionId is required" });
    }

    const session = await validateSessionCourse(sessionId, courseId);

    const enrollment = await Enrollment.findOne({ course: courseId, student: studentId });
    if (!enrollment) return res.status(400).json({ msg: "Student not enrolled" });

    const attendance = await Attendance.findOneAndUpdate(
      {
        course: courseId,
        semester: enrollment.semester,
        student: studentId,
        session: sessionId,
      },
      {
        course: courseId,
        semester: enrollment.semester,
        student: studentId,
        session: sessionId,
        sessionType: session.type || "MANUAL",
        status,
        date: session.createdAt,
        markedBy: req.user.id,
      },
      { new: true, upsert: true }
    ).populate("student", "name studentId");

    const io = req.app.get("io");

    emitAttendanceUpdate(io, {
      courseId,
      sessionId,
      source: "admin-single"
    });


    res.json({ msg: "Attendance saved", attendance });
  } catch (err) {
    res.status(500).json({ msg: err.message || "Server error" });
  }
});


// Admin: bulk mark
router.post("/bulk-mark", auth, roleCheck(["admin"]), async (req, res) => {
  try {
    const { courseId, status = "Present", sessionId } = req.body;
    if (!courseId || !sessionId) {
      return res.status(400).json({ msg: "courseId and sessionId required" });
    }

    const session = await validateSessionCourse(sessionId, courseId);
    const enrollments = await Enrollment.find({ course: courseId });

    const records = [];
    for (const enr of enrollments) {
      const attendance = await Attendance.findOneAndUpdate(
        { course: courseId, student: enr.student, session: sessionId, semester: enr.semester },
        {
          course: courseId,
          student: enr.student,
          session: sessionId,
          semester: enr.semester,
          sessionType: session.type || "MANUAL",
          status,
          date: session.createdAt,
          markedBy: req.user.id,
        },
        { new: true, upsert: true }
      );
      records.push(attendance);
    }

    emitAttendanceUpdate(req.app.get("io"), { courseId, sessionId, source: "admin-bulk" });
    res.json({ msg: "Bulk attendance saved", records });

  } catch (err) {
    res.status(500).json({ msg: err.message || "Server error" });
  }
});



// Admin summary
router.get("/admin/summary/:courseId", auth, roleCheck(["admin"]), async (req, res) => {
  try {
    const { courseId } = req.params;
    const { date, range, filter } = req.query;

    const course = await Course.findById(courseId);
    if (!course) return res.status(404).json({ msg: "Course not found" });

    const match = { course: new mongoose.Types.ObjectId(courseId) };

    const dateRange = buildDateRangeFilter({ date, range, filter });
    if (dateRange) match.date = dateRange;

    const summary = await Attendance.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$student",
          totalPresent: { $sum: { $cond: [{ $eq: ["$status", "Present"] }, 1, 0] } },
          totalAbsent: { $sum: { $cond: [{ $eq: ["$status", "Absent"] }, 1, 0] } }
        }
      }
    ]);

    const classesHeld = await Attendance.distinct("session", match)
      .then(s => s.length);


    const populatedSummary = await Promise.all(
      summary.map(async s => {
        const student = await User.findById(s._id).select("name email studentId profileImage department");
        return {
          student: {
            _id: student._id,
            name: student.name,
            email: student.email,
            studentId: student.studentId,
            profileImage: student.profileImage || "",
            department: student.department
          },
          totalPresent: s.totalPresent,
          totalAbsent: s.totalAbsent,
          classesHeld,
          totalPlanned: course.totalClasses || 0
        };
      })
    );

    res.json({
      course: { id: course._id, name: course.name, code: course.code },
      summary: populatedSummary
    });
  } catch (err) {
    res.status(500).json({ msg: "Server error", error: err.message });
  }
});

// ---------- TEACHER ----------

// Teacher: mark single
router.post("/:courseId/mark/:studentId", auth, roleCheck(["teacher"]), async (req, res) => {
  try {
    const { courseId, studentId } = req.params;
    const { status = "Present", sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ msg: "sessionId is required" });
    }

    await verifyTeacherCourse(courseId, req.user.id);
    const session = await validateSessionCourse(sessionId, courseId);

    const enrollment = await Enrollment.findOne({ course: courseId, student: studentId });
    if (!enrollment) {
      return res.status(400).json({ msg: "Student not enrolled" });
    }

    const attendance = await Attendance.findOneAndUpdate(
      { course: courseId, student: studentId, session: sessionId, semester: enrollment.semester },
      {
        course: courseId,
        student: studentId,
        session: sessionId,
        semester: enrollment.semester,
        sessionType: session.type || "MANUAL",
        status,
        date: session.createdAt,
        markedBy: req.user.id,
      },
      { new: true, upsert: true }
    );

    emitAttendanceUpdate(req.app.get("io"), { courseId, sessionId, source: "teacher-single" });
    res.json({ msg: "Attendance saved", attendance });

  } catch (err) {
    res.status(500).json({ msg: err.message || "Server error" });
  }
});





// Teacher: bulk mark
router.post("/:courseId/mark", auth, roleCheck(["teacher"]), async (req, res) => {
  try {
    const { courseId } = req.params;
    const { records, sessionId } = req.body;

    if (!Array.isArray(records) || !sessionId) {
      return res.status(400).json({ msg: "Valid records array and sessionId required" });
    }

    await verifyTeacherCourse(courseId, req.user.id);
    const session = await validateSessionCourse(sessionId, courseId);

    const saved = [];
    for (const r of records) {
      const enrollment = await Enrollment.findOne({ course: courseId, student: r.studentId });
      if (!enrollment) continue;

      const attendance = await Attendance.findOneAndUpdate(
        { course: courseId, student: r.studentId, session: sessionId, semester: enrollment.semester },
        {
          course: courseId,
          student: r.studentId,
          session: sessionId,
          semester: enrollment.semester,
          sessionType: session.type || "MANUAL",
          status: r.status || "Present",
          date: session.createdAt,
          markedBy: req.user.id,
        },
        { new: true, upsert: true }
      );
      saved.push(attendance);
    }

    emitAttendanceUpdate(req.app.get("io"), { courseId, sessionId, source: "teacher-bulk" });
    res.json({ msg: "Bulk attendance saved", records: saved });

  } catch (err) {
    res.status(500).json({ msg: err.message || "Server error" });
  }
});





// Teacher summary (with attendancePct and score)
router.get("/:courseId/summary", auth, roleCheck(["teacher"]), async (req, res) => {
  try {
    const { courseId } = req.params;
    const { date, range, filter } = req.query;

    const course = await Course.findById(courseId);
    if (!course) return res.status(404).json({ msg: "Course not found" });

    const totalPlanned =
      typeof course.totalClasses === "number"
        ? course.totalClasses
        : 0;


    const match = { course: new mongoose.Types.ObjectId(courseId) };

    if (filter && filter !== "all") {
      const dateRange = buildDateRangeFilter({ date, range, filter });
      if (dateRange) match.date = dateRange;
    }

    const summary = await Attendance.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$student",
          present: { $sum: { $cond: [{ $eq: ["$status", "Present"] }, 1, 0] } },
          absent: { $sum: { $cond: [{ $eq: ["$status", "Absent"] }, 1, 0] } },
        }
      }
    ]);

    const classesHeld = await Attendance
      .distinct("session", match)
      .then(s => s.length);

    const populatedSummary = await Promise.all(
      summary.map(async s => {
        const student = await User.findById(s._id)
          .select("name email studentId profileImage department");

        const totalPresent = s.present;
        const totalAbsent = s.absent;
        const totalSessions = totalPresent + totalAbsent;

        const attendancePct =
          totalSessions > 0 ? (totalPresent / totalSessions) * 100 : 0;

        // ✅ FIXED HERE
        const totalPlanned = course.totalClasses || 0;
        const rawScore = totalPlanned > 0 ? (totalPresent / totalPlanned) * 10 : 0;
        const score = Math.floor(rawScore * 100) / 100;

        return {
          student: {
            _id: student._id,
            name: student.name,
            email: student.email,
            studentId: student.studentId,
            profileImage: student.profileImage || "",
            department: student.department,
          },
          present: totalPresent,
          absent: totalAbsent,
          classesHeld,
          totalPlanned,
          attendancePct: Number(attendancePct.toFixed(1)),
          score: Number(score.toFixed(2)),
        };
      })
    );

    res.json({
      course: {
        id: course._id,
        name: course.name,
        code: course.code
      },
      summary: populatedSummary
    });

  } catch (err) {
    res.status(500).json({
      msg: "Failed to fetch summary",
      error: err.message
    });
  }
});





// View single student attendance
router.get("/:courseId/student/:studentId", auth, roleCheck(["teacher"]), async (req, res) => {
  try {
    const { courseId, studentId } = req.params;
    const { date, range, filter } = req.query;

    const match = { course: courseId, student: studentId };
    const dateRange = buildDateRangeFilter({ date, range, filter });
    if (dateRange) match.date = dateRange;

    const records = await Attendance.find(match)
      .populate("session", "type")
      .sort({ createdAt: -1 });

    res.json({ records });
  } catch (err) {
    res.status(500).json({ msg: "Failed to fetch student history" });
  }
});

// View all attendance for a course (teacher)
router.get("/:courseId", auth, roleCheck(["teacher"]), async (req, res) => {
  try {
    const { courseId } = req.params;
    const { date, range, filter } = req.query;

    const match = { course: courseId };

    // ✅ Only apply date filter IF user explicitly selected one
    if (filter && filter !== "all") {
      const dateRange = buildDateRangeFilter({ date, range, filter });
      if (dateRange) match.date = dateRange;
    }

    const records = await Attendance.find(match)
      .populate("student", "name studentId")
      .populate("session", "type mode createdAt")
      .sort({ date: -1 });

    res.json({ records });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch attendance" });
  }
});


// View sessions for a course
router.get("/:courseId/sessions", auth, async (req, res) => {
  try {
    const { courseId } = req.params;

    const records = await Attendance.find({ course: courseId })
      .populate("student", "name studentId department level")
      .populate("session", "type mode createdAt")
      .sort({ date: -1 });

    res.json({ records });
  } catch (err) {
    res.status(500).json({ msg: "Failed to load session attendance" });
  }
});

module.exports = router;