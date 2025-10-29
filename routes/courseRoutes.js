const express = require("express");
const Course = require("../models/Course");
const Department = require("../models/Department");
const { auth, roleCheck } = require("../middleware/authMiddleware");

const router = express.Router();

/// ======================= FORMATTER ======================= ///
const formatCourse = (c, withStudents = false) => {
    return {
        _id: c._id,
        name: c.name,
        description: c.description,
        code: c.code,
        level: c.level,
        unit: c.unit, // ✅ Added course unit
        totalClasses: c.totalClasses || 0,
        department: c.department
            ? { _id: c.department._id, name: c.department.name, levels: c.department.levels }
            : null,
        teacher: c.teacher
            ? { _id: c.teacher._id, name: c.teacher.name, email: c.teacher.email }
            : null,
        ...(withStudents && {
            students: c.students
                ? c.students.map((s) => ({
                    _id: s._id,
                    name: s.name,
                    email: s.email,
                    studentId: s.studentId || null, // ✅ include studentId
                    level: s.level,
                    department: s.department
                        ? { _id: s.department._id, name: s.department.name }
                        : null,
                }))
                : [],
        }),
        enrolledCount: c.students ? c.students.length : undefined,
    };
};


/// ======================= CREATE COURSE ======================= ///
router.post("/create", auth, roleCheck(["admin"]), async (req, res) => {
    const { name, description, code, teacherId, totalClasses, department, level, unit } = req.body;

    try {
        const exists = await Course.findOne({ code });
        if (exists) return res.status(400).json({ msg: "Course code already exists" });

        const deptExists = await Department.findById(department);
        if (!deptExists) return res.status(400).json({ msg: "Invalid department" });

        const course = new Course({
            name,
            description,
            code,
            teacher: teacherId,
            department,
            level,
            unit,
            totalClasses: totalClasses || 0,
        });

        await course.save();

        const populated = await Course.findById(course._id)
            .populate("teacher", "name email")
            .populate("department", "name levels");

        res.json({ msg: "Course created successfully", course: formatCourse(populated) });
    } catch (err) {
        res.status(500).json({ msg: "Server error", error: err.message });
    }
});


/// ======================= STUDENT REGISTER ======================= ///
router.post("/:courseId/register", auth, roleCheck(["student"]), async (req, res) => {
    try {
        const course = await Course.findById(req.params.courseId);
        if (!course) return res.status(404).json({ msg: "Course not found" });

        if (course.students.includes(req.user.id)) {
            return res.status(400).json({ msg: "Already registered" });
        }

        course.students.push(req.user.id);
        await course.save();

        const populated = await Course.findById(course._id)
            .populate("teacher", "name email")
            .populate("department", "name levels");

        res.json({ msg: "Successfully registered for course", course: formatCourse(populated) });
    } catch (err) {
        res.status(500).json({ msg: "Server error", error: err.message });
    }
});


/// ======================= TEACHER VIEW STUDENTS ======================= ///
router.get("/:courseId/students", auth, roleCheck(["teacher"]), async (req, res) => {
    try {
        const course = await Course.findById(req.params.courseId)
            .populate("students", "name email department level studentId") // ✅ Added studentId
            .populate("department", "name levels")
            .populate("teacher", "name email");

        if (!course) return res.status(404).json({ msg: "Course not found" });

        if (course.teacher._id.toString() !== req.user.id) {
            return res.status(403).json({ msg: "Not authorized" });
        }

        res.json({ students: formatCourse(course, true).students });
    } catch (err) {
        res.status(500).json({ msg: "Server error", error: err.message });
    }
});


/// ======================= TEACHER'S COURSES ======================= ///
router.get("/my-courses", auth, roleCheck(["teacher"]), async (req, res) => {
    try {
        const courses = await Course.find({ teacher: req.user.id })
            .populate("teacher", "name email")
            .populate("department", "name levels")
            .populate("students", "name email studentId"); // ✅ Added studentId

        res.json(courses.map((c) => formatCourse(c)));
    } catch (err) {
        res.status(500).json({ msg: "Server error", error: err.message });
    }
});


/// ======================= STUDENT'S COURSES ======================= ///
router.get("/my-courses/student", auth, roleCheck(["student"]), async (req, res) => {
    try {
        const courses = await Course.find({ students: req.user.id })
            .populate("teacher", "name email")
            .populate("department", "name levels");

        res.json(courses.map((c) => formatCourse(c)));
    } catch (err) {
        res.status(500).json({ msg: "Server error", error: err.message });
    }
});


/// ======================= SINGLE COURSE ======================= ///
router.get("/:id", auth, async (req, res) => {
    try {
        const course = await Course.findById(req.params.id)
            .populate("teacher", "name email")
            .populate("department", "name levels")
            .populate({
                path: "students",
                select: "name email department level studentId", // ✅ Added studentId here
                populate: { path: "department", select: "name levels" },
            });

        if (!course) return res.status(404).json({ msg: "Course not found" });

        res.json(formatCourse(course, true));
    } catch (err) {
        res.status(500).json({ msg: "Server error", error: err.message });
    }
});


/// ======================= DELETE COURSE ======================= ///
router.delete("/:id", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const deleted = await Course.findByIdAndDelete(req.params.id);
        if (!deleted) return res.status(404).json({ msg: "Course not found" });
        res.json({ msg: "Course deleted successfully" });
    } catch (err) {
        res.status(500).json({ msg: "Server error", error: err.message });
    }
});


/// ======================= ADMIN ENROLLS STUDENT ======================= ///
router.post("/:courseId/enroll", auth, roleCheck(["admin"]), async (req, res) => {
    const { studentId } = req.body;
    try {
        const course = await Course.findById(req.params.courseId);
        if (!course) return res.status(404).json({ msg: "Course not found" });

        if (course.students.includes(studentId)) {
            return res.status(400).json({ msg: "Student already enrolled" });
        }

        course.students.push(studentId);
        await course.save();

        const populated = await Course.findById(course._id)
            .populate("teacher", "name email")
            .populate("department", "name levels");

        res.json({ msg: "Student enrolled successfully", course: formatCourse(populated) });
    } catch (err) {
        res.status(500).json({ msg: "Server error", error: err.message });
    }
});


/// ======================= GET ALL COURSES ======================= ///
router.get("/", async (req, res) => {
    try {
        const courses = await Course.find()
            .populate("teacher", "name email")
            .populate("department", "name levels");

        res.json(courses.map((c) => formatCourse(c)));
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch courses" });
    }
});


/// ======================= UPDATE COURSE ======================= ///
router.put("/:id", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const { name, description, code, teacherId, totalClasses, department, level, unit } = req.body;

        if (department) {
            const deptExists = await Department.findById(department);
            if (!deptExists) return res.status(400).json({ msg: "Invalid department" });
        }

        const course = await Course.findByIdAndUpdate(
            req.params.id,
            {
                ...(name && { name }),
                ...(description && { description }),
                ...(code && { code }),
                ...(teacherId && { teacher: teacherId }),
                ...(department && { department }),
                ...(level && { level }),
                ...(unit && { unit }),
                ...(totalClasses !== undefined && { totalClasses }),
            },
            { new: true }
        )
            .populate("teacher", "name email")
            .populate("department", "name levels");

        if (!course) return res.status(404).json({ msg: "Course not found" });

        res.json({ msg: "Course updated successfully", course: formatCourse(course) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: "Server error" });
    }
});


/// ======================= FILTER COURSES BY DEPT / LEVEL ======================= ///
router.get("/filter", auth, async (req, res) => {
    try {
        const { department, level } = req.query;
        let query = {};

        if (department) query.department = department;
        if (level) query.level = level;

        const courses = await Course.find(query)
            .populate("teacher", "name email")
            .sort("code");

        res.json(courses);
    } catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});

module.exports = router;
