// routes/session.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

const SessionX = require("../models/SessionX");
const Semester = require("../models/Semester");
const User = require("../models/User");
const Course = require("../models/Course");
const Attendance = require("../models/Attendance");
const Enrollment = require("../models/Enrollment");


// ARCHIVE MODELS
const AttendanceArchive = require("../models/AttendanceArchive");
const CourseArchive = require("../models/CourseArchive");
const LeaderboardArchive = require("../models/LeaderboardArchive");

// ===========================================================
// GET ALL SESSIONS
// ===========================================================
router.get("/", async (req, res) => {
    try {
        const sessions = await SessionX.find().sort({ startDate: -1 });
        res.json(sessions);
    } catch (err) {
        res.status(500).json({ msg: "Failed to fetch sessions" });
    }
});

// ===========================================================
// CREATE NEW SESSION (ARCHIVE → RESET → PROMOTE)
// ===========================================================
router.post("/create", async (req, res) => {
    const { name, startDate, endDate } = req.body;

    try {
        // 1️⃣ Get active session
        const oldSession = await SessionX.findOne({ active: true });
        const sessionName = oldSession ? oldSession.name : "Unknown Session";

        // 2️⃣ Deactivate old sessions
        await SessionX.updateMany({}, { active: false });

        // 3️⃣ Create new session
        const newSession = await SessionX.create({
            name,
            startDate,
            endDate,
            active: true
        });

        // 4️⃣ Ensure active semester exists
        const activeSemester = await Semester.findOne({ active: true });
        if (!activeSemester) throw new Error("No active semester found");

        // 5️⃣ Fetch students
        const students = await User.find({
            role: "student",
            graduated: { $ne: true }
        }).populate("department");

        const studentIds = students.map(s => s._id);

        // ===========================================================
        // 📦 ARCHIVE ATTENDANCE (NO TRANSACTIONS)
        // ===========================================================
        const allAttendance = await Attendance.find();

        if (allAttendance.length > 0 && oldSession) {
            const formattedAttendance = allAttendance.map(a => ({
                course: a.course,
                student: a.student,
                semester: a.semester,
                session: a.session,
                academicSession: oldSession._id,
                sessionType: a.sessionType,
                status: a.status,
                markedBy: a.markedBy,
                faceVerified: a.faceVerified,
                rollCallMode: a.rollCallMode,
                date: a.date
            }));

            await AttendanceArchive.insertMany(formattedAttendance);
        }

        await Attendance.deleteMany({});

        // ===========================================================
        // 📦 ARCHIVE COURSES (NO TRANSACTIONS)
        // ===========================================================
        const allCourses = await Course.find();

        if (allCourses.length > 0 && oldSession) {
            const formattedCourses = allCourses.map(c => ({
                session: oldSession._id, // ✅ IMPORTANT FIX
                courseId: c._id,
                courseCode: c.code,
                courseTitle: c.name,
                teacher: c.teacher,
                students: c.students,
                totalClasses: c.totalClasses,
                unit: c.unit,
                semester: c.semester,
                createdAt: new Date()
            }));

            await CourseArchive.insertMany(formattedCourses);
        }

        // ===========================================================
        // 📦 ARCHIVE LEADERBOARD
        // ===========================================================
        if (oldSession) {
            const leaderboardData = students.map(s => ({
                session: sessionName,
                academicSession: oldSession._id, // tie leaderboard to old session
                student: s._id,
                totalPresent: s.totalPresent || 0,
                totalAbsent: s.totalAbsent || 0,
                percentage: s.attendancePercentage || 0
            }));

            await LeaderboardArchive.insertMany(leaderboardData);
        }

        // ===========================================================
        // 🧹 CLEAR CURRENT SESSION DATA
        // ===========================================================
        await Course.updateMany(
            { students: { $in: studentIds } },
            { $pull: { students: { $in: studentIds } } }
        );

        await User.updateMany(
            { role: "student" },
            {
                $set: {
                    totalPresent: 0,
                    totalAbsent: 0,
                    attendancePercentage: 0,
                    courses: []
                }
            }
        );

        // ===========================================================
        // 🧹 CLEAR ENROLLMENTS (IMPORTANT: removes old courses from dashboard)
        // ===========================================================
        await Enrollment.deleteMany({
            student: { $in: studentIds },
        });


        // ===========================================================
        // 🎓 PROMOTE STUDENTS AND GRADUATE FINAL-YEAR
        // ===========================================================
        for (const student of students) {
            if (!student.department?.levels?.length) continue;

            const maxLevel = Math.max(...student.department.levels);

            if (student.level >= maxLevel) {
                // 🎓 Graduate student
                student.graduated = true;
                student.graduationDate = new Date();
                student.level = maxLevel;
            } else {
                // ⬆️ Promote student
                student.level += 100;
            }

            // Reset per-session stats
            student.courses = [];
            student.totalPresent = 0;
            student.totalAbsent = 0;
            student.attendancePercentage = 0;

            await student.save();
        }


        // ===========================================================
        // DONE
        // ===========================================================
        res.json({
            msg: "New session started successfully. Old data archived, students promoted, and system reset.",
            session: newSession
        });

    } catch (err) {
        console.error("Start new session error:", err);
        res.status(500).json({
            msg: "Failed to start new session",
            error: err.message
        });
    }
});

// ===========================================================
// DELETE SESSION
// ===========================================================
router.delete("/:id", async (req, res) => {
    try {
        await SessionX.findByIdAndDelete(req.params.id);
        res.json({ msg: "Session deleted" });
    } catch (err) {
        res.status(500).json({ msg: "Failed to delete session" });
    }
});

// ===========================================================
// UPDATE SESSION
// ===========================================================
router.put("/:id", async (req, res) => {
    try {
        const updated = await SessionX.findByIdAndUpdate(req.params.id, req.body, { new: true });
        res.json({ msg: "Session updated", session: updated });
    } catch (err) {
        res.status(500).json({ msg: "Failed to update session" });
    }
});

// ===========================================================
// ACTIVATE SESSION
// ===========================================================
router.patch("/:id/activate", async (req, res) => {
    try {
        await SessionX.updateMany({}, { active: false });
        const session = await SessionX.findByIdAndUpdate(
            req.params.id,
            { active: true },
            { new: true }
        );
        res.json({ msg: "Session activated", session });
    } catch (err) {
        res.status(500).json({ msg: "Failed to activate session" });
    }
});

module.exports = router;
