// routes/session.js
const express = require("express");
const router = express.Router();

const SessionX = require("../models/SessionX");
const Semester = require("../models/Semester");
const User = require("../models/User");
const Course = require("../models/Course");
const Department = require("../models/Department");
const Attendance = require("../models/Attendance");

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
        // 1️⃣ Get the currently active session before deactivation (for archiving)
        const oldSession = await SessionX.findOne({ active: true });
        const sessionName = oldSession ? oldSession.name : "Unknown Session";

        // 2️⃣ Deactivate all previous sessions
        await SessionX.updateMany({}, { active: false });

        // 3️⃣ Create new session
        const newSession = await SessionX.create({
            name,
            startDate,
            endDate,
            active: true
        });

        // 4️⃣ Ensure an active semester exists
        const activeSemester = await Semester.findOne({ active: true });
        if (!activeSemester) throw new Error("No active semester found");

        // 5️⃣ Fetch students
        const students = await User.find({ role: "student" }).populate("department");
        const studentIds = students.map(s => s._id);



        // ===========================================================
        // 📦 ARCHIVE ATTENDANCE (for each attendance record)
        // ===========================================================
        try {
            const allAttendance = await Attendance.find();

            if (allAttendance.length > 0) {
                const formatted = allAttendance.map(a => ({
                    session: sessionName,
                    studentId: a.studentId,
                    courseId: a.courseId,
                    date: a.date,
                    status: a.status // present or absent
                }));

                await AttendanceArchive.insertMany(formatted);
            }
        } catch (err) {
            console.error("Attendance archive error:", err);
        }



        // ===========================================================
        // 📦 ARCHIVE COURSE INFO (code, title, teacher, students, analytics)
        // ===========================================================
        try {
            const allCourses = await Course.find();

            const formatted = allCourses.map(c => ({
                session: sessionName,
                courseId: c._id,
                courseCode: c.courseCode,
                courseTitle: c.courseTitle,
                teacher: c.teacher,
                students: c.students,
                attendanceSummary: c.attendanceSummary,
                totalAttendanceCount: c.attendanceCount
            }));

            await CourseArchive.insertMany(formatted);
        } catch (err) {
            console.error("Course archive error:", err);
        }



        // ===========================================================
        // 📦 ARCHIVE LEADERBOARD DATA
        // ===========================================================
        try {
            const leaderboardData = students.map(s => ({
                session: sessionName,
                student: s._id,
                totalPresent: s.totalPresent || 0,
                totalAbsent: s.totalAbsent || 0,
                percentage: s.attendancePercentage || 0
            }));

            await LeaderboardArchive.insertMany(leaderboardData);
        } catch (err) {
            console.error("Leaderboard archive error:", err);
        }



        // ===========================================================
        // 🧹 CLEAR CURRENT SESSION DATA
        // ===========================================================

        // Unenroll all students from courses
        await Course.updateMany(
            { students: { $in: studentIds } },
            { $pull: { students: { $in: studentIds } } }
        );

        // Recalculate student count
        const coursesAfterUpdate = await Course.find();
        for (let c of coursesAfterUpdate) {
            c.studentsCount = c.students.length;
            c.attendanceSummary = [];
            c.attendanceCount = 0;
            await c.save();
        }

        // Clear attendance table
        await Attendance.deleteMany({});

        // Reset student leaderboard fields
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
        // 🎓 PROMOTE STUDENTS
        // ===========================================================
        for (let student of students) {
            if (student.department?.levels?.length) {
                const maxLevel = Math.max(...student.department.levels);
                let newLevel = student.level + 100;

                if (newLevel > maxLevel) newLevel = maxLevel;

                student.level = newLevel;
            }

            student.courses = [];
            await student.save();
        }



        // ===========================================================
        // DONE
        // ===========================================================
        res.json({
            msg: "New session started successfully. Old data archived, students promoted, and system cleared.",
            session: newSession
        });

    } catch (err) {
        console.error("Start new session error:", err);
        res.status(500).json({ msg: "Failed to start new session", error: err.message });
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
        res.status(500).json({ msg: "Failed to delete session", error: err.message });
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
        res.status(500).json({ msg: "Failed to update session", error: err.message });
    }
});



// ===========================================================
// ACTIVATE SESSION
// ===========================================================
router.patch("/:id/activate", async (req, res) => {
    try {
        await SessionX.updateMany({}, { active: false });
        const session = await SessionX.findByIdAndUpdate(req.params.id, { active: true }, { new: true });
        res.json({ msg: "Session activated", session });
    } catch (err) {
        res.status(500).json({ msg: "Failed to activate session", error: err.message });
    }
});

module.exports = router;
