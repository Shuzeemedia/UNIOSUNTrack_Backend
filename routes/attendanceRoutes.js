const mongoose = require("mongoose");
const express = require("express");
const router = express.Router();

const Attendance = require("../models/Attendance");
const Course = require("../models/Course");
const User = require("../models/User");
const Department = require("../models/Department");

const { auth, roleCheck } = require("../middleware/authMiddleware");
const { getLocalDayKey } = require("../utils/dayKey");
const { getWeekDayKeys } = require("../utils/weekKeys");
const { getMonthDayKeys } = require("../utils/monthKeys");

// ======================= HELPER ======================= //
function buildDayKeyFilter(date, range) {
  if (date) return getLocalDayKey(new Date(date));
  if (range === "week") return { $in: getWeekDayKeys(new Date()) };
  if (range === "month") {
    const now = new Date();
    return { $in: getMonthDayKeys(now.getFullYear(), now.getMonth()) };
  }
  return null;
}


/* ----------------------------------------------------
   ✅ STUDENT check if attendance already marked
---------------------------------------------------- */
router.get("/check/course/:courseId", auth, roleCheck(["student"]), async (req, res) => {
  try {
    const studentId = req.user.id;
    const { courseId } = req.params;

    // find active session for this course
    const session = await Session.findOne({
      course: courseId,
      status: "active",
      expiresAt: { $gt: new Date() }
    });

    if (!session) return res.json({ alreadyMarked: false });

    const dayKey = getLocalDayKey(session.createdAt);

    const attendance = await Attendance.findOne({
      course: courseId,
      student: studentId,
      dayKey
    });

    if (attendance) {
      return res.json({
        alreadyMarked: true,
        attendanceId: attendance._id,
        sessionId: session._id,
        status: attendance.status
      });
    }

    res.json({ alreadyMarked: false, sessionId: session._id });
  } catch (err) {
    console.error("CHECK ATT ERROR:", err);
    res.status(500).json({ msg: "Server error" });
  }
});

// ======================= TEACHER ROUTES ======================= //

// Mark attendance for a single student
router.post("/:courseId/mark/:studentId", auth, roleCheck(["teacher"]), async (req, res) => {
  try {
    const { courseId, studentId } = req.params;
    const { status, date } = req.body;

    const course = await Course.findById(courseId).populate("students", "_id");
    if (!course) return res.status(404).json({ msg: "Course not found" });
    if (course.teacher.toString() !== req.user.id) return res.status(403).json({ msg: "Not authorized" });

    const isEnrolled = course.students.some(s => s._id.toString() === studentId);
    if (!isEnrolled) return res.status(400).json({ msg: "Student not enrolled in this course" });

    const dayKey = date ? getLocalDayKey(new Date(date)) : getLocalDayKey();
    const attendance = await Attendance.findOneAndUpdate(
      { course: courseId, student: studentId, dayKey },
      { status: status || "Present", dayKey, date: new Date() },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    await attendance.populate("student", "name email studentId profileImage department");
    res.json({ msg: "Attendance marked", attendance });
  } catch (err) {
    res.status(500).json({ msg: "Server error", error: err.message });
  }
});

// Bulk mark attendance
router.post("/:courseId/mark", auth, roleCheck(["teacher"]), async (req, res) => {
  try {
    const { courseId } = req.params;
    const { records, date } = req.body;
    if (!records || !Array.isArray(records)) return res.status(400).json({ msg: "Attendance records are required" });

    const course = await Course.findById(courseId).populate("students", "_id");
    if (!course) return res.status(404).json({ msg: "Course not found" });
    if (course.teacher.toString() !== req.user.id) return res.status(403).json({ msg: "Not authorized" });

    const dayKey = date ? getLocalDayKey(new Date(date)) : getLocalDayKey();
    const attendanceDate = date ? new Date(date) : new Date();
    attendanceDate.setHours(0, 0, 0, 0);

    const saved = [];
    for (const rec of records) {
      const isEnrolled = course.students.some(s => s._id.toString() === rec.studentId);
      if (!isEnrolled) continue;

      const attendance = await Attendance.findOneAndUpdate(
        { course: courseId, student: rec.studentId, dayKey },
        { status: rec.status || "Present", dayKey, date: attendanceDate },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
      await attendance.populate("student", "name email studentId profileImage department");
      saved.push(attendance);
    }

    res.json({ msg: "Bulk attendance saved", records: saved });
  } catch (err) {
    console.error("Bulk mark error:", err);
    res.status(500).json({ msg: "Server error", error: err.message });
  }
});

// View all attendance for a course
router.get("/:courseId", auth, roleCheck(["teacher"]), async (req, res) => {
  try {
    const { courseId } = req.params;
    const { date, range } = req.query;

    const filter = { course: courseId };
    const dayKeyFilter = buildDayKeyFilter(date, range);
    if (dayKeyFilter) filter.dayKey = dayKeyFilter;

    const records = await Attendance.find(filter)
      .populate("student", "name email studentId profileImage department")
      .sort({ date: -1 });
    res.json({ records });
  } catch (err) {
    res.status(500).json({ msg: "Server error", error: err.message });
  }
});

// View a single student's attendance
router.get("/:courseId/student/:studentId", auth, roleCheck(["teacher"]), async (req, res) => {
  try {
    const { courseId, studentId } = req.params;
    const { date, range } = req.query;

    const course = await Course.findById(courseId);
    if (!course) return res.status(404).json({ msg: "Course not found" });
    if (course.teacher.toString() !== req.user.id) return res.status(403).json({ msg: "Not authorized" });

    const filter = { course: courseId, student: studentId };
    const dayKeyFilter = buildDayKeyFilter(date, range);
    if (dayKeyFilter) filter.dayKey = dayKeyFilter;

    const records = await Attendance.find(filter)
      .populate("student", "name email studentId profileImage department")
      .sort({ date: -1 });
    res.json({ records });
  } catch (err) {
    res.status(500).json({ msg: "Server error", error: err.message });
  }
});

// Teacher summary
router.get("/:courseId/summary", auth, roleCheck(["teacher"]), async (req, res) => {
  try {
    const { courseId } = req.params;
    const { date, range } = req.query;

    const course = await Course.findById(courseId);
    if (!course) return res.status(404).json({ msg: "Course not found" });
    if (course.teacher.toString() !== req.user.id) return res.status(403).json({ msg: "Not authorized" });

    const match = { course: course._id };
    const dayKeyFilter = buildDayKeyFilter(date, range);
    if (dayKeyFilter) match.dayKey = dayKeyFilter;

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

    const classesHeld = (await Attendance.distinct("dayKey", match)).length;

    const populatedSummary = await Promise.all(summary.map(async s => {
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
    }));

    res.json({ course: courseId, summary: populatedSummary });
  } catch (err) {
    res.status(500).json({ msg: "Server error", error: err.message });
  }
});

// ======================= STUDENT ROUTES ======================= //

// Student views own attendance
router.get("/my-records/:courseId", auth, roleCheck(["student"]), async (req, res) => {
  try {
    const { courseId } = req.params;
    const { date, range } = req.query;

    const filter = { course: courseId, student: req.user.id };
    const dayKeyFilter = buildDayKeyFilter(date, range);
    if (dayKeyFilter) filter.dayKey = dayKeyFilter;

    const records = await Attendance.find(filter)
      .populate("student", "name email studentId profileImage department")
      .sort({ date: -1 });
    res.json({ records });
  } catch (err) {
    res.status(500).json({ msg: "Server error", error: err.message });
  }
});

// Student marks own attendance
router.post("/:courseId/mark", auth, roleCheck(["student"]), async (req, res) => {
  try {
    const { courseId } = req.params;
    const userId = req.user.id;

    const course = await Course.findById(courseId).populate("students", "_id");
    if (!course) return res.status(404).json({ msg: "Course not found" });

    const isEnrolled = course.students.some(s => s._id.toString() === userId);
    if (!isEnrolled) return res.status(400).json({ msg: "You are not enrolled in this course" });

    const dayKey = getLocalDayKey();
    const alreadyMarked = await Attendance.findOne({ course: courseId, student: userId, dayKey });
    if (alreadyMarked) return res.status(400).json({ msg: "Attendance already marked for this session" });

    const attendance = new Attendance({ course: courseId, student: userId, status: "Present", dayKey, date: new Date() });
    await attendance.save();
    await attendance.populate("student", "name email studentId profileImage department");

    res.json({ msg: "Attendance marked successfully", attendance });
  } catch (err) {
    res.status(500).json({ msg: "Server error", error: err.message });
  }
});

// ======================= ADMIN ROUTES ======================= //

// Admin view all attendance
router.get("/", auth, roleCheck(["admin"]), async (req, res) => {
  try {
    const { courseId, studentId, teacherId, date, range } = req.query;
    const filter = {};
    if (courseId) filter.course = courseId;
    if (studentId) filter.student = studentId;
    if (teacherId) {
      const teacherCourses = await Course.find({ teacher: teacherId }).select("_id");
      filter.course = { $in: teacherCourses.map(c => c._id) };
    }
    const dayKeyFilter = buildDayKeyFilter(date, range);
    if (dayKeyFilter) filter.dayKey = dayKeyFilter;

    const records = await Attendance.find(filter)
      .populate("student", "name email studentId profileImage department")
      .populate("course", "name code totalClasses")
      .sort({ date: -1 });
    res.json({ records });
  } catch (err) {
    res.status(500).json({ msg: "Server error", error: err.message });
  }
});

// Admin add attendance
router.post("/", auth, roleCheck(["admin"]), async (req, res) => {
  try {
    let { studentId, courseId, student, course, status, date } = req.body;

    let foundStudent = studentId ? await User.findById(studentId) :
      student ? await User.findOne({ $or: [{ email: student }, { studentId: student }, { name: student }] }) : null;
    if (!foundStudent) return res.status(404).json({ msg: "Student not found" });

    let foundCourse = courseId ? await Course.findById(courseId) :
      course ? await Course.findOne({ $or: [{ code: course }, { name: course }] }) : null;
    if (!foundCourse) return res.status(404).json({ msg: "Course not found" });

    const newRecord = new Attendance({
      student: foundStudent._id,
      course: foundCourse._id,
      status,
      date: date || new Date()
    });
    const saved = await newRecord.save();

    const populated = await Attendance.findById(saved._id)
      .populate("student", "name email studentId profileImage department")
      .populate("course", "name code");
    res.json({ msg: "Attendance recorded", attendance: populated });
  } catch (err) {
    res.status(500).json({ msg: "Server error", error: err.message });
  }
});

// Admin update attendance
router.put("/:id", auth, roleCheck(["admin"]), async (req, res) => {
  try {
    const { id } = req.params;
    const { status, date } = req.body;
    const updated = await Attendance.findByIdAndUpdate(id, { status, date }, { new: true })
      .populate("student", "name email studentId profileImage department")
      .populate("course", "name code");
    if (!updated) return res.status(404).json({ msg: "Record not found" });
    res.json({ msg: "Attendance updated", attendance: updated });
  } catch (err) {
    res.status(500).json({ msg: "Server error", error: err.message });
  }
});

// Admin delete attendance
router.delete("/:id", auth, roleCheck(["admin"]), async (req, res) => {
  try {
    const deleted = await Attendance.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ msg: "Attendance not found" });
    res.json({ msg: "Attendance deleted" });
  } catch (err) {
    res.status(500).json({ msg: "Server error", error: err.message });
  }
});

// Admin bulk mark
router.post("/bulk-mark", auth, roleCheck(["admin"]), async (req, res) => {
  try {
    const { courseId, date, status } = req.body;
    if (!courseId || !status) return res.status(400).json({ msg: "courseId and status are required" });

    const course = await Course.findById(courseId).populate("students", "_id");
    if (!course) return res.status(404).json({ msg: "Course not found" });

    const attendanceDate = date ? new Date(date) : new Date();
    attendanceDate.setHours(0, 0, 0, 0);

    const saved = [];
    for (const student of course.students) {
      const dayKey = date ? getLocalDayKey(new Date(date)) : getLocalDayKey();
      const attendance = await Attendance.findOneAndUpdate(
        { course: courseId, student: student._id, dayKey },
        { status, date: attendanceDate },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
      await attendance.populate("student", "name email studentId profileImage department");
      saved.push(attendance);
    }

    res.json({ msg: `Bulk attendance marked as '${status}' for course ${course.name}`, records: saved });
  } catch (err) {
    console.error("Admin bulk mark error:", err);
    res.status(500).json({ msg: "Server error", error: err.message });
  }
});

// Student summary
router.get("/my-summary/:courseId", auth, roleCheck(["student"]), async (req, res) => {
  try {
    const { courseId } = req.params;
    const { date, range } = req.query;
    const course = await Course.findById(courseId);
    if (!course) return res.status(404).json({ msg: "Course not found" });

    const match = { course: courseId, student: req.user.id };
    const dayKeyFilter = buildDayKeyFilter(date, range);
    if (dayKeyFilter) match.dayKey = dayKeyFilter;

    const records = await Attendance.find(match);
    const present = records.filter(r => r.status === "Present").length;
    const absent = records.filter(r => r.status === "Absent").length;
    const classesHeld = (await Attendance.distinct("dayKey", match)).length;
    const totalPlanned = course.totalClasses || 0;

    const attendancePercentage = classesHeld > 0 ? (present / classesHeld) * 100 : 0;
    const score = totalPlanned > 0 ? (present / totalPlanned) * 100 : 0;

    res.json({ course: courseId, summary: { classesHeld, totalPlanned, present, absent, attendancePercentage: Math.round(attendancePercentage * 10) / 10, score: Math.round(score * 10) / 10 } });
  } catch (err) {
    console.error("my-summary error:", err);
    res.status(500).json({ msg: "Server error", error: err.message });
  }
});

// Admin summary
router.get("/admin/summary/:courseId", auth, roleCheck(["admin"]), async (req, res) => {
  try {
    const { courseId } = req.params;
    const { date, range } = req.query;
    const course = await Course.findById(courseId);
    if (!course) return res.status(404).json({ msg: "Course not found" });

    const match = { course: course._id };
    const dayKeyFilter = buildDayKeyFilter(date, range);
    if (dayKeyFilter) match.dayKey = dayKeyFilter;

    const summary = await Attendance.aggregate([
      { $match: match },
      { $group: { _id: "$student", totalPresent: { $sum: { $cond: [{ $eq: ["$status", "Present"] }, 1, 0] } }, totalAbsent: { $sum: { $cond: [{ $eq: ["$status", "Absent"] }, 1, 0] } } } }
    ]);

    const classesHeld = (await Attendance.distinct("dayKey", match)).length;
    const populatedSummary = await Promise.all(summary.map(async s => {
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
    }));

    res.json({ course: { id: course._id, name: course.name, code: course.code }, summary: populatedSummary });
  } catch (err) {
    console.error("Admin summary error:", err);
    res.status(500).json({ msg: "Server error", error: err.message });
  }
});

// Attendance day/week/month helpers
router.get("/attendance/day", auth, async (req, res) => {
  try {
    const { courseId, date } = req.query;
    const dayKey = date ? getLocalDayKey(new Date(date)) : getLocalDayKey();
    const records = await Attendance.find({ course: courseId, dayKey }).populate("student", "name matricNo").sort({ student: 1 });
    res.json({ dayKey, records });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Server error" });
  }
});

router.get("/attendance/week", auth, async (req, res) => {
  try {
    const { courseId, date } = req.query;
    const weekKeys = getWeekDayKeys(date ? new Date(date) : new Date());
    const records = await Attendance.find({ course: courseId, dayKey: { $in: weekKeys } }).populate("student", "name matricNo").sort({ dayKey: 1 });
    res.json({ weekKeys, records });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Server error" });
  }
});

router.get("/attendance/month", auth, async (req, res) => {
  try {
    const { courseId, year, month } = req.query;
    const dayKeys = getMonthDayKeys(Number(year), Number(month));
    const records = await Attendance.find({ course: courseId, dayKey: { $in: dayKeys } }).populate("student", "name matricNo").sort({ dayKey: 1 });
    res.json({ dayKeys, records });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Server error" });
  }
});

module.exports = router;
