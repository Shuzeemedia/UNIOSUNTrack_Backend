// routes/adminRoutes.js
const express = require("express");
const bcrypt = require("bcryptjs");

const { sendTeacherCredentialsEmail } = require("../utils/mailer");
const crypto = require("crypto");

const User = require("../models/User");
const Course = require("../models/Course");
const Attendance = require("../models/Attendance");
const Department = require("../models/Department"); // <-- important

const { auth, roleCheck } = require("../middleware/authMiddleware");

const router = express.Router();

/**
 * Admin creates teacher (protected)
 * POST /admin/create-teacher
 */
router.post("/create-teacher", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const { name, email, departmentId } = req.body;

        // ---------- VALIDATION ----------
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!name || !email || !departmentId) {
            return res.status(400).json({ msg: "Name, email and departmentId are required" });
        }
        if (!emailRegex.test(email))
            return res.status(400).json({ msg: "Invalid email format" });

        // Ensure email isn't used already
        const existing = await User.findOne({ email });
        if (existing) return res.status(400).json({ msg: "Email already in use" });

        // Ensure department exists
        const dept = await Department.findById(departmentId);
        if (!dept) return res.status(400).json({ msg: "Invalid department" });

        // ✅ Generate random password
        const plainPassword = crypto.randomBytes(6).toString("base64"); // ~8 chars
        const hashedPassword = await bcrypt.hash(plainPassword, 10);

        const teacher = new User({
            name,
            email,
            password: hashedPassword,
            role: "teacher",
            department: departmentId,
            isVerified: true, // teachers don’t need email verification
        });

        await teacher.save();

        // Populate department for response
        const populatedTeacher = await User.findById(teacher._id)
            .select("-password")
            .populate("department", "name");

        // ✅ Send email with credentials
        await sendTeacherCredentialsEmail(email, name, plainPassword);

        res.json({
            msg: "Teacher created successfully. Credentials sent to teacher's email.",
            user: populatedTeacher,
        });
    } catch (err) {
        console.error("Error creating teacher:", err);
        res.status(500).json({ error: err.message });
    }
});


/**
 * Admin: Get all users
 * GET /admin/users
 */
router.get("/users", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const users = await User.find().select("-password").populate("department", "name");
        res.json({ users });
    } catch (err) {
        console.error("Error fetching users:", err);
        res.status(500).json({ msg: "Server error", error: err.message });
    }
});

/**
 * Admin: Get all courses
 * GET /admin/courses
 */
router.get("/courses", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const courses = await Course.find().populate("teacher", "name email");
        res.json({ courses });
    } catch (err) {
        console.error("Error fetching courses:", err);
        res.status(500).json({ msg: "Server error", error: err.message });
    }
});

/**
 * Admin: Get attendance stats
 * GET /admin/attendance-stats
 */
router.get("/attendance-stats", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const totalRecords = await Attendance.countDocuments();
        const byCourse = await Attendance.aggregate([
            { $group: { _id: "$course", total: { $sum: 1 } } },
        ]);

        res.json({ totalRecords, byCourse });
    } catch (err) {
        console.error("Error fetching attendance-stats:", err);
        res.status(500).json({ msg: "Server error", error: err.message });
    }
});

/**
 * Admin Dashboard (users + courses + stats)
 * GET /admin/dashboard
 */
router.get("/dashboard", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const users = await User.find().select("-password").populate("department", "name");
        const courses = await Course.find().populate("teacher", "name email");
        const totalRecords = await Attendance.countDocuments();
        const byCourse = await Attendance.aggregate([{ $group: { _id: "$course", total: { $sum: 1 } } }]);

        res.json({
            users,
            courses,
            attendance: { totalRecords, byCourse },
        });
    } catch (err) {
        console.error("Error fetching dashboard:", err);
        res.status(500).json({ msg: "Server error", error: err.message });
    }
});

/**
 * Admin: Delete a user
 * DELETE /admin/users/:id
 */
router.delete("/users/:id", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const user = await User.findByIdAndDelete(req.params.id);
        if (!user) return res.status(404).json({ msg: "User not found" });
        res.json({ msg: "User deleted successfully" });
    } catch (err) {
        console.error("Error deleting user:", err);
        res.status(500).json({ msg: "Server error", error: err.message });
    }
});

/**
 * Get all students (populated department)
 * GET /admin/students
 */
router.get("/students", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const students = await User.find({ role: "student" }).select("-password").populate("department", "name");
        res.json({ users: students });
    } catch (err) {
        console.error("Error fetching students:", err);
        res.status(500).json({ msg: "Server error", error: err.message });
    }
});

/**
 * Get all teachers (populate department)
 * GET /admin/teachers
 */
router.get("/teachers", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const teachers = await User.find({ role: "teacher" }).select("-password").populate("department", "name");
        res.json({ users: teachers });
    } catch (err) {
        console.error("Error fetching teachers:", err);
        res.status(500).json({ msg: "Server error", error: err.message });
    }
});




/**
 * Admin dashboard analytics
 * GET /admin/dashboard-stats
 */
router.get("/dashboard-stats", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const totalStudents = await User.countDocuments({ role: "student" });
        const totalTeachers = await User.countDocuments({ role: "teacher" });
        const totalCourses = await Course.countDocuments();
        const totalAttendance = await Attendance.countDocuments();

        // students by department
        const studentsByDepartment = await User.aggregate([
            { $match: { role: "student" } },
            {
                $lookup: {
                    from: "departments",
                    localField: "department",
                    foreignField: "_id",
                    as: "departmentInfo",
                },
            },
            { $unwind: { path: "$departmentInfo", preserveNullAndEmptyArrays: true } },
            { $group: { _id: "$departmentInfo.name", count: { $sum: 1 } } },
            { $project: { department: "$_id", count: 1, _id: 0 } },
        ]);

        // students by level
        const studentsByLevel = await User.aggregate([
            { $match: { role: "student" } },
            { $group: { _id: "$level", count: { $sum: 1 } } },
            { $project: { level: "$_id", count: 1, _id: 0 } },
        ]);

        // attendance summary
        const attendanceSummary = await Attendance.aggregate([
            { $group: { _id: "$status", count: { $sum: 1 } } },
            { $project: { status: "$_id", count: 1, _id: 0 } },
        ]);

        // recent activity
        const recentUsers = await User.find()
            .sort({ createdAt: -1 })
            .limit(5)
            .select("name email role department level")
            .populate("department", "name");

        const recentAttendance = await Attendance.find()
            .sort({ date: -1 })
            .limit(5)
            .populate("student", "name email")
            .populate("course", "name code");

        res.json({
            totals: {
                students: totalStudents,
                teachers: totalTeachers,
                courses: totalCourses,
                attendanceRecords: totalAttendance,
            },
            studentsByDepartment,
            studentsByLevel,
            attendanceSummary,
            recentUsers,
            recentAttendance,
        });
    } catch (err) {
        console.error("Dashboard stats error:", err);
        res.status(500).json({ msg: "Server error", error: err.message });
    }
});

// Update teacher's department
router.put("/teachers/:id/department", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const { departmentId } = req.body;

        // Validate department
        const dept = await Department.findById(departmentId);
        if (!dept) return res.status(400).json({ msg: "Invalid department" });

        // Update teacher
        const updatedTeacher = await User.findByIdAndUpdate(
            req.params.id,
            { department: departmentId },
            { new: true }
        ).populate("department", "name");

        if (!updatedTeacher) return res.status(404).json({ msg: "Teacher not found" });

        res.json({ msg: "Department updated", user: updatedTeacher });
    } catch (err) {
        console.error("Error updating teacher department:", err);
        res.status(500).json({ error: err.message });
    }
});


// ======================================
// ADMIN PROMOTE STUDENTS (LEVEL UPDATE)
// ======================================
router.post("/promote-level", auth, roleCheck(["admin"]), async (req, res) => {
    const { departmentId } = req.body;
    // if departmentId is provided → promote only that dept
    // if not → promote all students in system

    try {
        // Fetch students
        const studentQuery = departmentId ? { department: departmentId } : {};
        const students = await User.find(studentQuery).populate("department");

        if (!students.length) {
            return res.status(404).json({ msg: "No students found" });
        }

        let updatedStudents = [];

        for (const student of students) {
            const dept = student.department;

            // department levels array, sorted e.g. [100, 200, 300, 400]
            const sortedLevels = dept.levels.sort((a, b) => a - b);
            const maxLevel = sortedLevels[sortedLevels.length - 1];

            if (student.level < maxLevel) {
                // promote
                student.level += 1;
                await student.save();

                // auto-unenroll from previous-level courses
                await Course.updateMany(
                    { students: student._id, level: { $ne: student.level } },
                    { $pull: { students: student._id } }
                );

                updatedStudents.push({
                    id: student._id,
                    name: student.name,
                    newLevel: student.level,
                    status: "promoted"
                });

            } else {
                // student is at final level → graduate
                student.isGraduated = true;
                await student.save();

                // remove from all courses
                await Course.updateMany(
                    { students: student._id },
                    { $pull: { students: student._id } }
                );

                updatedStudents.push({
                    id: student._id,
                    name: student.name,
                    newLevel: student.level,
                    status: "graduated"
                });
            }
        }

        res.json({
            msg: "Level promotion complete",
            count: updatedStudents.length,
            students: updatedStudents
        });

    } catch (err) {
        console.error("Level promotion error:", err);
        res.status(500).json({ msg: "Server error", error: err.message });
    }
});


// POST /admin/seed-admin  -- DO NOT KEEP IN PRODUCTION
// router.post("/seed-admin", async (req, res) => {
//     try {
//         const { name, email, password } = req.body;
//         const existing = await User.findOne({ email });
//         if (existing) return res.status(400).json({ msg: "Already exists" });
//         const hashed = await bcrypt.hash(password, 10);
//         const user = new User({ name, email, password: hashed, role: "admin", isVerified: true });
//         await user.save();
//         res.json({ msg: "Admin created", email });
//     } catch (err) {
//         res.status(500).json({ error: err.message });
//     }
// });



module.exports = router;
