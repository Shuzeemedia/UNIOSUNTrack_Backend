const express = require("express");
const Course = require("../models/Course");
const Department = require("../models/Department");
const Semester = require("../models/Semester");
const Enrollment = require("../models/Enrollment");
const { auth, roleCheck, studentOnly } = require("../middleware/authMiddleware");


const router = express.Router();

/// ======================= HELPERS ======================= ///
async function getActiveSemesterDoc() {
    const activeSem = await Semester.findOne({ active: true });
    if (!activeSem) throw new Error("No active semester found");
    return activeSem;
}

function formatCourse(course, enrolledCount = 0) {
    return {
        _id: course._id,
        name: course.name,
        description: course.description,
        code: course.code,
        level: course.level,
        unit: course.unit,
        totalClasses: course.totalClasses || 0,

        semesterId: course.semester?._id,
        semester: course.semester?.season,
        semesterName: course.semester?.name,

        department: {
            _id: course.department?._id,
            name: course.department?.name,
        },

        teacher: course.teacher
            ? {
                _id: course.teacher._id,
                name: course.teacher.name,
                email: course.teacher.email,
            }
            : null,

        enrolledCount,
    };
}

/// ======================= CREATE COURSE ======================= ///
router.post("/create", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const { name, description, code, teacherId, department, level, unit, semester, totalClasses } = req.body;

        const sem = await Semester.findById(semester);
        if (!sem) return res.status(400).json({ msg: "Invalid semester" });

        const dept = await Department.findById(department);
        if (!dept) return res.status(400).json({ msg: "Invalid department" });

        const exists = await Course.findOne({ code });
        if (exists) return res.status(400).json({ msg: "Course code exists" });

        const course = await Course.create({
            name,
            description,
            code,
            teacher: teacherId || null,
            department,
            level,
            unit,
            semester,
            totalClasses: totalClasses || 0,
        });

        const populated = await Course.findById(course._id)
            .populate("teacher", "name email")
            .populate("department", "name")
            .populate("semester", "name season");

        res.json({ msg: "Course created successfully", course: formatCourse(populated, 0) });
    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
});

/// ======================= STUDENT REGISTER / SELF-ENROLL ======================= ///
router.post("/:courseId/register", auth, studentOnly(), async (req, res) => {
    try {
        const activeSem = await getActiveSemesterDoc();

        await Enrollment.findOneAndUpdate(
            { student: req.user.id, course: req.params.courseId, semester: activeSem._id },
            {},
            { upsert: true, new: true }
        );

        res.json({ msg: "Successfully registered for course" });
    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
});

router.post("/:courseId/self-enroll", auth, studentOnly(), async (req, res) => {
    try {
        const activeSem = await getActiveSemesterDoc();
        const course = await Course.findById(req.params.courseId);

        if (!course) return res.status(404).json({ msg: "Course not found" });
        if (course.semester.toString() !== activeSem._id.toString())
            return res.status(400).json({ msg: "Cannot enroll: course is not in active semester" });

        const existing = await Enrollment.findOne({
            student: req.user.id,
            course: req.params.courseId,
            semester: activeSem._id,
        });

        if (existing) return res.status(400).json({ msg: "Already enrolled in this course" });

        await Enrollment.create({
            student: req.user.id,
            course: req.params.courseId,
            semester: activeSem._id,
        });

        res.json({ msg: "Successfully enrolled in course" });
    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
});

/// ======================= STUDENT ENROLLED & AVAILABLE COURSES ======================= ///
router.get("/enrolled", auth, studentOnly(), async (req, res) => {
    try {
        const activeSem = await getActiveSemesterDoc();
        const enrollments = await Enrollment.find({ student: req.user.id, semester: activeSem._id })
            .populate({
                path: "course",
                populate: [
                    { path: "teacher", select: "name email" },
                    { path: "department", select: "name" },
                    { path: "semester", select: "name season" },
                ],
            });

        const courses = enrollments.map((e) => formatCourse(e.course, 1));
        res.json(courses);
    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
});

router.get("/available", auth, studentOnly(), async (req, res) => {
    try {
        const activeSem = await getActiveSemesterDoc();

        const enrolled = await Enrollment.find({ student: req.user.id, semester: activeSem._id }).distinct("course");

        const courses = await Course.find({
            department: req.user.department,
            level: req.user.level,
            semester: activeSem._id,
            _id: { $nin: enrolled },
        })
            .populate("teacher", "name email")
            .populate("department", "name")
            .populate("semester", "name season");

        res.json(courses.map((c) => formatCourse(c, 0)));
    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
});

/// ======================= TEACHER COURSES ======================= ///
router.get("/my-courses", auth, roleCheck(["teacher"]), async (req, res) => {
    try {
        const activeSem = await getActiveSemesterDoc();

        const courses = await Course.find({ teacher: req.user.id, semester: activeSem._id })
            .populate("teacher", "name email")
            .populate("department", "name")
            .populate("semester", "name season");

        const results = [];
        for (const c of courses) {
            const count = await Enrollment.countDocuments({ course: c._id, semester: activeSem._id });
            results.push(formatCourse(c, count));
        }

        res.json(results);
    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
});

/// ======================= TEACHER VIEW STUDENTS ======================= ///
router.get("/:courseId/students", auth, roleCheck(["teacher"]), async (req, res) => {
    try {
        const activeSem = await getActiveSemesterDoc();

        const enrollments = await Enrollment.find({ course: req.params.courseId, semester: activeSem._id })
            .populate({
                path: "student",
                select: "name email department level studentId profileImage",
                populate: { path: "department", select: "name" } // <--- ensures department.name exists
            });

        res.json({ students: enrollments.map((e) => e.student) });

    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
});

/// ======================= ADMIN ENROLL / UNENROLL STUDENT ======================= ///
router.post("/:courseId/enroll", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const { studentId } = req.body;
        if (!studentId) return res.status(400).json({ msg: "studentId required" });

        const activeSem = await getActiveSemesterDoc();

        const existing = await Enrollment.findOne({
            student: studentId,
            course: req.params.courseId,
            semester: activeSem._id,
        });

        if (!existing) {
            await Enrollment.create({
                student: studentId,
                course: req.params.courseId,
                semester: activeSem._id,
            });
        }

        res.json({ msg: "Student enrolled successfully" });
    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
});

router.post("/:courseId/unenroll", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const { studentId } = req.body;
        if (!studentId) return res.status(400).json({ msg: "studentId required" });

        const activeSem = await getActiveSemesterDoc();

        await Enrollment.findOneAndDelete({
            student: studentId,
            course: req.params.courseId,
            semester: activeSem._id,
        });

        res.json({ msg: "Student unenrolled successfully" });
    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
});


/// ======================= UPDATE COURSE ======================= ///
router.put("/:id", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const { name, description, code, teacherId, department, level, unit, semester, totalClasses } = req.body;

        if (department) {
            const dept = await Department.findById(department);
            if (!dept) return res.status(400).json({ msg: "Invalid department" });
        }

        if (semester) {
            const sem = await Semester.findById(semester);
            if (!sem) return res.status(400).json({ msg: "Invalid semester" });
        }

        const course = await Course.findByIdAndUpdate(
            req.params.id,
            {
                ...(name && { name }),
                ...(description && { description }),
                ...(code && { code }),
                ...(teacherId !== undefined ? { teacher: teacherId } : {}),
                ...(department && { department }),
                ...(level && { level }),
                ...(unit && { unit }),
                ...(totalClasses !== undefined ? { totalClasses } : {}),
                ...(semester && { semester }),
            },
            { new: true }
        )
            .populate("teacher", "name email")
            .populate("department", "name")
            .populate("semester", "name season");

        if (!course) return res.status(404).json({ msg: "Course not found" });

        res.json({ msg: "Course updated successfully", course: formatCourse(course, 0) });
    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
});

/// ======================= DELETE COURSE ======================= ///
router.delete("/:id", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        // Remove all enrollments for this course first
        await Enrollment.deleteMany({ course: req.params.id });
        const deleted = await Course.findByIdAndDelete(req.params.id);
        if (!deleted) return res.status(404).json({ msg: "Course not found" });

        res.json({ msg: "Course deleted successfully" });
    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
});



/// ======================= ADMIN UNASSIGN LECTURER ======================= ///
router.post("/:courseId/unassign-lecturer", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const course = await Course.findById(req.params.courseId);
        if (!course) return res.status(404).json({ msg: "Course not found" });

        course.teacher = null;
        await course.save();

        const populated = await Course.findById(course._id)
            .populate("teacher", "name email")
            .populate("department", "name");

        res.json({ msg: "Lecturer unassigned successfully", course: formatCourse(populated, 0) });
    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
});

/// ======================= ADMIN FILTER COURSES ======================= ///
router.get("/admin-filter", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const courses = await Course.find()
            .populate("teacher", "name email")
            .populate("department", "name");

        // Count enrolled students per course
        const results = [];
        for (const c of courses) {
            const count = await Enrollment.countDocuments({ course: c._id });
            results.push({
                _id: c._id,
                name: c.name,
                code: c.code,
                level: c.level,
                department: c.department,
                enrolledCount: count,
            });
        }

        res.json({ courses: results });
    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
});


// GET ALL COURSES (for admin)
router.get("/", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const courses = await Course.find()
            .populate("teacher", "name email")
            .populate("department", "name")
            .populate("semester", "name season");

        // Count enrolled students per course
        const results = [];
        for (const c of courses) {
            const count = await Enrollment.countDocuments({ course: c._id });
            results.push({
                _id: c._id,
                name: c.name,
                description: c.description,
                code: c.code,
                level: c.level,
                unit: c.unit,
                totalClasses: c.totalClasses,
                semesterId: c.semester?._id,
                semester: c.semester?.season,
                semesterName: c.semester?.name,
                department: c.department,
                teacher: c.teacher,
                enrolledCount: count,
            });
        }

        res.json(results);
    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
});


/// ======================= SINGLE COURSE ======================= ///
router.get("/:courseId", auth, async (req, res) => {
    try {
        const course = await Course.findById(req.params.courseId)
            .populate("teacher", "name email")
            .populate("department", "name")
            .populate("semester", "name season");

        if (!course) return res.status(404).json({ msg: "Course not found" });

        const activeSem = await Semester.findOne({ active: true });

        const enrolledCount = await Enrollment.countDocuments({
            course: course._id,
            semester: activeSem._id,
        });

        const enrollments = await Enrollment.find({
            course: course._id,
            semester: activeSem._id,
        }).populate("student", "name studentId email department level");

        const students = enrollments.map(e => e.student);

        // ✅ KEEP ORIGINAL RESPONSE SHAPE
        res.json({
            ...formatCourse(course, enrolledCount),
            students, // ← ADD students without nesting
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: err.message });
    }
});



module.exports = router;
