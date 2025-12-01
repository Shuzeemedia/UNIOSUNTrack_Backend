const mongoose = require("mongoose");
const express = require("express");
const router = express.Router();

const Attendance = require("../models/Attendance");
const Course = require("../models/Course");
const User = require("../models/User");
const Department = require("../models/Department");

const { auth, roleCheck } = require("../middleware/authMiddleware");

// ======================= HELPER ======================= //
function buildDateFilter(date, range) {
  if (date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    return { $gte: start, $lte: end };
  }

  if (range === "week") {
    const now = new Date();
    const firstDayOfWeek = new Date(now);
    firstDayOfWeek.setDate(now.getDate() - now.getDay());
    firstDayOfWeek.setHours(0, 0, 0, 0);

    const lastDayOfWeek = new Date(firstDayOfWeek);
    lastDayOfWeek.setDate(firstDayOfWeek.getDate() + 6);
    lastDayOfWeek.setHours(23, 59, 59, 999);

    return { $gte: firstDayOfWeek, $lte: lastDayOfWeek };
  }

  if (range === "month") {
    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    firstDayOfMonth.setHours(0, 0, 0, 0);

    const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    lastDayOfMonth.setHours(23, 59, 59, 999);

    return { $gte: firstDayOfMonth, $lte: lastDayOfMonth };
  }

  return null;
}

// ======================= TEACHER ROUTES ======================= //

// Teacher marks attendance manually (one student)
router.post(
  "/:courseId/mark/:studentId",
  auth,
  roleCheck(["teacher"]),
  async (req, res) => {
    try {
      const { courseId, studentId } = req.params;
      const { status, date } = req.body;

      const course = await Course.findById(courseId).populate(
        "students",
        "_id"
      );
      if (!course) return res.status(404).json({ msg: "Course not found" });

      if (course.teacher.toString() !== req.user.id) {
        return res.status(403).json({ msg: "Not authorized" });
      }

      const isEnrolled = course.students.some(
        (s) => s._id.toString() === studentId
      );
      if (!isEnrolled) {
        return res
          .status(400)
          .json({ msg: "Student not enrolled in this course" });
      }

      const today = date ? new Date(date) : new Date();
      today.setHours(0, 0, 0, 0);

      const attendance = await Attendance.findOneAndUpdate(
        {
          course: courseId,
          student: studentId,
          date: { $gte: today },
        },
        {
          status: status || "Present",
          date: today,
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );

      // populate student for frontend
      await attendance.populate(
        "student",
        "name email studentId profileImage department"
      );

      res.json({ msg: "Attendance marked", attendance });
    } catch (err) {
      res.status(500).json({ msg: "Server error", error: err.message });
    }
  }
);

// Teacher marks attendance for multiple students (bulk)
router.post(
  "/:courseId/mark",
  auth,
  roleCheck(["teacher"]),
  async (req, res) => {
    try {
      const { courseId } = req.params;
      const { records, date } = req.body; // [{ studentId, status }, ...]

      if (!records || !Array.isArray(records)) {
        return res.status(400).json({ msg: "Attendance records are required" });
      }

      const course = await Course.findById(courseId).populate(
        "students",
        "_id"
      );
      if (!course) return res.status(404).json({ msg: "Course not found" });

      if (course.teacher.toString() !== req.user.id) {
        return res.status(403).json({ msg: "Not authorized" });
      }

      const attendanceDate = date ? new Date(date) : new Date();
      attendanceDate.setHours(0, 0, 0, 0);

      const saved = [];
      for (const rec of records) {
        const isEnrolled = course.students.some(
          (s) => s._id.toString() === rec.studentId
        );
        if (!isEnrolled) continue;

        const attendance = await Attendance.findOneAndUpdate(
          {
            course: courseId,
            student: rec.studentId,
            date: { $gte: attendanceDate },
          },
          { status: rec.status || "Present", date: attendanceDate },
          { new: true, upsert: true, setDefaultsOnInsert: true }
        );

        await attendance.populate(
          "student",
          "name email studentId profileImage department"
        );
        saved.push(attendance);
      }

      res.json({ msg: "Bulk attendance saved", records: saved });
    } catch (err) {
      console.error("Bulk mark error:", err);
      res.status(500).json({ msg: "Server error", error: err.message });
    }
  }
);

// Teacher views all attendance records for a course
router.get("/:courseId", auth, roleCheck(["teacher"]), async (req, res) => {
  try {
    const { courseId } = req.params;
    const { date, range } = req.query;

    const filter = { course: courseId };
    const dateFilter = buildDateFilter(date, range);
    if (dateFilter) filter.date = dateFilter;

    const records = await Attendance.find(filter)
      .populate("student", "name email studentId profileImage department")
      .sort({ date: -1 });

    res.json({ records });
  } catch (err) {
    res.status(500).json({ msg: "Server error", error: err.message });
  }
});

// Teacher views a student's attendance in a course
router.get(
  "/:courseId/student/:studentId",
  auth,
  roleCheck(["teacher"]),
  async (req, res) => {
    try {
      const { courseId, studentId } = req.params;
      const { date, range } = req.query;

      const course = await Course.findById(courseId);
      if (!course) return res.status(404).json({ msg: "Course not found" });
      if (course.teacher.toString() !== req.user.id) {
        return res.status(403).json({ msg: "Not authorized" });
      }

      const filter = { course: courseId, student: studentId };
      const dateFilter = buildDateFilter(date, range);
      if (dateFilter) filter.date = dateFilter;

      const records = await Attendance.find(filter)
        .sort({ date: -1 })
        .populate("student", "name email studentId profileImage department");

      res.json({ records });
    } catch (err) {
      res.status(500).json({ msg: "Server error", error: err.message });
    }
  }
);

// Teacher summary for a course
router.get(
  "/:courseId/summary",
  auth,
  roleCheck(["teacher"]),
  async (req, res) => {
    try {
      const { courseId } = req.params;
      const { date, range } = req.query;

      const course = await Course.findById(courseId);
      if (!course) return res.status(404).json({ msg: "Course not found" });
      if (course.teacher.toString() !== req.user.id) {
        return res.status(403).json({ msg: "Not authorized" });
      }

      const match = { course: course._id };
      const dateFilter = buildDateFilter(date, range);
      if (dateFilter) match.date = dateFilter;

      const summary = await Attendance.aggregate([
        { $match: match },
        {
          $group: {
            _id: "$student",
            totalPresent: {
              $sum: { $cond: [{ $eq: ["$status", "Present"] }, 1, 0] },
            },
            totalAbsent: {
              $sum: { $cond: [{ $eq: ["$status", "Absent"] }, 1, 0] },
            },
          },
        },
      ]);

      const classesHeld = await Attendance.distinct("date", match);
      const heldCount = classesHeld.length;

      const populatedSummary = await Promise.all(
        summary.map(async (s) => {
          const student = await User.findById(s._id).select(
            "name email studentId profileImage department"
          );
          return {
            student: {
              _id: student._id,
              name: student.name,
              email: student.email,
              studentId: student.studentId,
              profileImage: student.profileImage || "",
              department: student.department,
            },
            totalPresent: s.totalPresent,
            totalAbsent: s.totalAbsent,
            classesHeld: heldCount,
            totalPlanned: course.totalClasses || 0,
          };
        })
      );

      res.json({ course: courseId, summary: populatedSummary });
    } catch (err) {
      res.status(500).json({ msg: "Server error", error: err.message });
    }
  }
);

// ======================= STUDENT ROUTES ======================= //

// Student views their own attendance
router.get(
  "/my-records/:courseId",
  auth,
  roleCheck(["student"]),
  async (req, res) => {
    try {
      const { courseId } = req.params;
      const { date, range } = req.query;

      const filter = { course: courseId, student: req.user.id };
      const dateFilter = buildDateFilter(date, range);
      if (dateFilter) filter.date = dateFilter;

      const records = await Attendance.find(filter)
        .sort({ date: -1 })
        .populate("student", "name email studentId profileImage department");
      res.json({ records });
    } catch (err) {
      res.status(500).json({ msg: "Server error", error: err.message });
    }
  }
);

// Student marks their own attendance
router.post(
  "/:courseId/mark",
  auth,
  roleCheck(["student"]),
  async (req, res) => {
    try {
      const { courseId } = req.params;
      const userId = req.user.id;

      const course = await Course.findById(courseId).populate(
        "students",
        "_id"
      );
      if (!course) return res.status(404).json({ msg: "Course not found" });

      const isEnrolled = course.students.some(
        (s) => s._id.toString() === userId
      );
      if (!isEnrolled)
        return res
          .status(400)
          .json({ msg: "You are not enrolled in this course" });

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const alreadyMarked = await Attendance.findOne({
        course: courseId,
        student: userId,
        date: { $gte: today },
      });

      if (alreadyMarked)
        return res
          .status(400)
          .json({ msg: "Attendance already marked for this session" });

      const attendance = new Attendance({
        course: courseId,
        student: userId,
        status: "Present",
        date: new Date(),
      });
      await attendance.save();
      await attendance.populate(
        "student",
        "name email studentId profileImage department"
      );

      res.json({ msg: "Attendance marked successfully", attendance });
    } catch (err) {
      res.status(500).json({ msg: "Server error", error: err.message });
    }
  }
);

// ======================= ADMIN ROUTES ======================= //

// Admin views all attendance
router.get("/", auth, roleCheck(["admin"]), async (req, res) => {
  try {
    const { courseId, studentId, teacherId, date, range } = req.query;

    const filter = {};
    if (courseId) filter.course = courseId;
    if (studentId) filter.student = studentId;

    const dateFilter = buildDateFilter(date, range);
    if (dateFilter) filter.date = dateFilter;

    if (teacherId) {
      const teacherCourses = await Course.find({ teacher: teacherId }).select(
        "_id"
      );
      filter.course = { $in: teacherCourses.map((c) => c._id) };
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

// Admin manually adds attendance
router.post("/", auth, roleCheck(["admin"]), async (req, res) => {
  try {
    let { studentId, courseId, student, course, status, date } = req.body;

    let foundStudent = null;
    if (studentId) foundStudent = await User.findById(studentId);
    else if (student) {
      foundStudent = await User.findOne({
        $or: [{ email: student }, { studentId: student }, { name: student }],
      });
    }
    if (!foundStudent)
      return res.status(404).json({ msg: "Student not found" });

    let foundCourse = null;
    if (courseId) foundCourse = await Course.findById(courseId);
    else if (course) {
      foundCourse = await Course.findOne({
        $or: [{ code: course }, { name: course }],
      });
    }
    if (!foundCourse) return res.status(404).json({ msg: "Course not found" });

    const newRecord = new Attendance({
      student: foundStudent._id,
      course: foundCourse._id,
      status,
      date: date || new Date(),
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

// Admin updates an attendance record
router.put("/:id", auth, roleCheck(["admin"]), async (req, res) => {
  try {
    const { id } = req.params;
    const { status, date } = req.body;

    const updated = await Attendance.findByIdAndUpdate(
      id,
      { status, date },
      { new: true }
    )
      .populate("student", "name email studentId profileImage department")
      .populate("course", "name code");

    if (!updated) return res.status(404).json({ msg: "Record not found" });

    res.json({ msg: "Attendance updated", attendance: updated });
  } catch (err) {
    res.status(500).json({ msg: "Server error", error: err.message });
  }
});

// Admin deletes attendance record
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
    if (!courseId || !status)
      return res.status(400).json({ msg: "courseId and status are required" });

    const course = await Course.findById(courseId).populate("students", "_id");
    if (!course) return res.status(404).json({ msg: "Course not found" });

    const attendanceDate = date ? new Date(date) : new Date();
    attendanceDate.setHours(0, 0, 0, 0);

    const saved = [];
    for (const student of course.students) {
      const attendance = await Attendance.findOneAndUpdate(
        {
          course: courseId,
          student: student._id,
          date: { $gte: attendanceDate },
        },
        { status, date: attendanceDate },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
      await attendance.populate(
        "student",
        "name email studentId profileImage department"
      );
      saved.push(attendance);
    }

    res.json({
      msg: `Bulk attendance marked as '${status}' for course ${course.name}`,
      records: saved,
    });
  } catch (err) {
    console.error("Admin bulk mark error:", err);
    res.status(500).json({ msg: "Server error", error: err.message });
  }
});

// Student summary
router.get(
  "/my-summary/:courseId",
  auth,
  roleCheck(["student"]),
  async (req, res) => {
    try {
      const { courseId } = req.params;
      const course = await Course.findById(courseId);
      if (!course) return res.status(404).json({ msg: "Course not found" });

      const records = await Attendance.find({
        course: courseId,
        student: req.user.id,
      });
      const present = records.filter((r) => r.status === "Present").length;
      const absent = records.filter((r) => r.status === "Absent").length;

      const classesHeld = records.length;
      const totalPlanned = course.totalClasses || 0;
      const attendancePercentage =
        classesHeld > 0 ? (present / classesHeld) * 100 : 0;
      const score = totalPlanned > 0 ? (present / totalPlanned) * 100 : 0;

      res.json({
        course: courseId,
        summary: {
          classesHeld,
          totalPlanned,
          present,
          absent,
          attendancePercentage: Math.round(attendancePercentage * 10) / 10,
          score: Math.round(score * 10) / 10,
        },
      });
    } catch (err) {
      console.error("my-summary error:", err);
      res.status(500).json({ msg: "Server error", error: err.message });
    }
  }
);

// Admin summary
router.get(
  "/admin/summary/:courseId",
  auth,
  roleCheck(["admin"]),
  async (req, res) => {
    try {
      const { courseId } = req.params;
      const { date, range } = req.query;

      const course = await Course.findById(courseId);
      if (!course) return res.status(404).json({ msg: "Course not found" });

      const match = { course: course._id };
      const dateFilter = buildDateFilter(date, range);
      if (dateFilter) match.date = dateFilter;

      const summary = await Attendance.aggregate([
        { $match: match },
        {
          $group: {
            _id: "$student",
            totalPresent: {
              $sum: { $cond: [{ $eq: ["$status", "Present"] }, 1, 0] },
            },
            totalAbsent: {
              $sum: { $cond: [{ $eq: ["$status", "Absent"] }, 1, 0] },
            },
          },
        },
      ]);

      const classesHeld = await Attendance.distinct("date", match);
      const heldCount = classesHeld.length;

      const populatedSummary = await Promise.all(
        summary.map(async (s) => {
          const student = await User.findById(s._id).select(
            "name email studentId profileImage department"
          );
          return {
            student: {
              _id: student._id,
              name: student.name,
              email: student.email,
              studentId: student.studentId,
              profileImage: student.profileImage || "",
              department: student.department,
            },
            totalPresent: s.totalPresent,
            totalAbsent: s.totalAbsent,
            classesHeld: heldCount,
            totalPlanned: course.totalClasses || 0,
          };
        })
      );

      res.json({
        course: {
          id: course._id,
          name: course.name,
          code: course.code,
        },
        summary: populatedSummary,
      });
    } catch (err) {
      console.error("Admin summary error:", err);
      res.status(500).json({ msg: "Server error", error: err.message });
    }
  }
);

module.exports = router;
