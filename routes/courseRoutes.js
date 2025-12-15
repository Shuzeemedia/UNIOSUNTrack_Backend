const express = require("express");
const mongoose = require("mongoose");
const Course = require("../models/Course");
const Department = require("../models/Department");
const Semester = require("../models/Semester");
const { auth, roleCheck } = require("../middleware/authMiddleware");

const router = express.Router();

/// ======================= HELPERS ======================= ///
async function getActiveSemesterDoc() {
    const activeSem = await Semester.findOne({ active: true });
    if (!activeSem) throw new Error("No active semester found");
    return activeSem;
}

function formatCourse(c, withStudents = false) {
    return {
        _id: c._id,
        name: c.name,
        description: c.description,
        code: c.code,
        level: c.level,
        unit: c.unit,
        totalClasses: c.totalClasses || 0,

        // FIXED SEMESTER FIELD
        semesterId: c.semester?._id || "",
        semester: c.semester?.season || "Unknown",
        semesterName: c.semester?.name || "Unknown",

        department: {
            _id: c.department?._id || "",
            name: c.department?.name || "Unknown Dept",
        },
        teacher: c.teacher
            ? { _id: c.teacher._id, name: c.teacher.name, email: c.teacher.email }
            : null,
        ...(withStudents && {
            students: c.students?.map((s) => ({
                _id: s._id,
                name: s.name,
                email: s.email,
                level: s.level,
                studentId: s.studentId || null,
                profileImage: s.profileImage,
                department: {
                    _id: s.department?._id || "",
                    name: s.department?.name || "Unknown Dept",
                },
            })) || [],
        }),
        enrolledCount: c.students?.length || 0,
    };
}



/// ======================= CREATE COURSE ======================= ///
router.post("/create", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const { name, description, code, teacherId, totalClasses, department, level, unit, semester } = req.body;

        const semesterDoc = await Semester.findById(semester);
        if (!semesterDoc) return res.status(400).json({ msg: "Invalid semester selected" });

        const exists = await Course.findOne({ code });
        if (exists) return res.status(400).json({ msg: "Course code already exists" });

        const deptExists = await Department.findById(department);
        if (!deptExists) return res.status(400).json({ msg: "Invalid department" });

        const course = new Course({
            name,
            description,
            code,
            teacher: teacherId || null,
            department,
            level,
            unit,
            totalClasses: totalClasses || 0,
            semester,
        });

        await course.save();

        const populated = await Course.findById(course._id)
            .populate("teacher", "name email")
            .populate("department", "name levels")
            .populate("semester", "name season startDate endDate active");

        res.json({ msg: "Course created successfully", course: formatCourse(populated) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: "Server error", error: err.message });
    }
});

/// ======================= STUDENT REGISTER ======================= ///
router.post("/:courseId/register", auth, roleCheck(["student"]), async (req, res) => {
    try {
        const course = await Course.findById(req.params.courseId);
        if (!course) return res.status(404).json({ msg: "Course not found" });

        const activeSem = await getActiveSemesterDoc();
        if (course.semester.toString() !== activeSem._id.toString())
            return res.status(400).json({ msg: "Cannot register: course is not in active semester" });

        if (course.students.includes(req.user.id)) return res.status(400).json({ msg: "Already registered" });

        course.students.push(req.user.id);
        await course.save();

        const populated = await Course.findById(course._id)
            .populate("teacher", "name email")
            .populate("department", "name levels");

        res.json({ msg: "Successfully registered for course", course: formatCourse(populated) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: "Server error", error: err.message });
    }
});

/// ======================= TEACHER COURSES ======================= ///
router.get("/my-courses", auth, roleCheck(["teacher"]), async (req, res) => {
    try {
        const activeSem = await getActiveSemesterDoc();

        const courses = await Course.find({ teacher: req.user.id, semester: activeSem._id })
            .populate("teacher", "name email")
            .populate("department", "name levels")
            .populate("students", "name email studentId")
            .populate("semester", "name season");


        res.json(courses.map((c) => formatCourse(c)));
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: "Server error", error: err.message });
    }
});

/// ======================= STUDENT COURSES ======================= ///
router.get("/my-courses/student", auth, roleCheck(["student"]), async (req, res) => {
    try {
        const activeSem = await getActiveSemesterDoc();

        const courses = await Course.find({ students: req.user.id, semester: activeSem._id })
            .populate("teacher", "name email")
            .populate("department", "name levels");

        res.json(courses.map((c) => formatCourse(c)));
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: "Server error", error: err.message });
    }
});

/// ======================= STUDENT AVAILABLE COURSES ======================= ///
router.get("/available", auth, roleCheck(["student"]), async (req, res) => {
    try {
        const user = req.user;
        const activeSem = await getActiveSemesterDoc();

        const courses = await Course.find({
            department: user.department._id || user.department,
            level: user.level,
            semester: activeSem._id,
            students: { $ne: user._id },
        })
            .populate("teacher", "name email")
            .populate("department", "name levels")
            .populate("semester", "name season"); // ← populate semester

        res.json(courses.map((c) => formatCourse(c)));
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: "Server error" });
    }
});


/// ======================= STUDENT ENROLLED COURSES ======================= ///
router.get("/enrolled", auth, roleCheck(["student"]), async (req, res) => {
    try {
        const user = req.user;
        const activeSem = await getActiveSemesterDoc();

        const courses = await Course.find({ students: user._id, semester: activeSem._id })
            .populate("department", "name")
            .populate("teacher", "name email")
            .populate("semester", "name season");


        res.json(courses.map((c) => formatCourse(c)));
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: "Server error" });
    }
});

/// ======================= TEACHER ASSIGNED COURSES ======================= ///
router.get("/assigned", auth, roleCheck(["teacher"]), async (req, res) => {
    try {
        const activeSem = await getActiveSemesterDoc();

        const courses = await Course.find({ teacher: req.user._id, semester: activeSem._id })
            .populate("department", "name")
            .populate("students", "name email level department");

        if (!courses.length) return res.json({ courses: [], departments: [] });

        const deptMap = new Map();
        courses.forEach((course) => {
            const deptId = course.department._id.toString();
            if (!deptMap.has(deptId)) deptMap.set(deptId, { _id: deptId, name: course.department.name, levels: new Set() });
            deptMap.get(deptId).levels.add(course.level);
        });

        const departments = Array.from(deptMap.values()).map((d) => ({
            _id: d._id,
            name: d.name,
            levels: Array.from(d.levels).sort((a, b) => a - b),
        }));

        res.json({
            courses: courses.map((c) => formatCourse(c)),
            departments,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: "Server error" });
    }
});

/// ======================= ADMIN FILTER COURSES ======================= ///
router.get("/admin-filter", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const courses = await Course.find()
            .populate("teacher", "name email")
            .populate("department", "name levels")
            .populate("students", "name email level department")
            .populate("semester", "name season");


        if (!courses.length) return res.status(404).json({ msg: "No courses found" });

        // Build unique dept & level lists
        const deptMap = new Map(); // deptId => { _id, name, levels: Set }
        courses.forEach(course => {
            const deptId = course.department._id.toString();
            if (!deptMap.has(deptId)) {
                deptMap.set(deptId, { _id: deptId, name: course.department.name, levels: new Set() });
            }
            deptMap.get(deptId).levels.add(course.level);
        });

        const departments = Array.from(deptMap.values()).map(d => ({
            _id: d._id,
            name: d.name,
            levels: Array.from(d.levels).sort((a, b) => a - b)
        }));

        res.json({
            courses: courses.map(c => ({
                _id: c._id,
                name: c.name,
                code: c.code,
                level: c.level,
                department: c.department,
                enrolledCount: c.students.length
            })),
            departments
        });
    } catch (err) {
        console.error("Error fetching admin courses:", err.message);
        res.status(500).json({ msg: "Failed to fetch courses", error: err.message });
    }
});

/// ======================= TEACHER VIEW STUDENTS ======================= ///
router.get(
    "/:courseId/students",
    auth,
    roleCheck(["teacher"]),
    async (req, res) => {
        try {
            const course = await Course.findById(req.params.courseId)
                .populate(
                    "students",
                    "name email department level studentId profileImage"
                )
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
    }
);

/// ======================= FILTER COURSES BY DEPT / LEVEL ======================= ///
router.get("/filter", auth, roleCheck(["student"]), async (req, res) => {
    try {
        const { department, level } = req.query;
        const user = req.user;
        const activeSem = await getActiveSemesterDoc();

        const query = { students: { $ne: user._id }, semester: activeSem._id };

        if (department) query.department = department;
        if (level) query.level = Number(level);

        const courses = await Course.find(query)
            .populate("teacher", "name email")
            .populate("department", "name levels");

        res.json(courses.map((c) => formatCourse(c)));
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: "Server error" });
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
                select: "name email department level studentId profileImage",
                populate: { path: "department", select: "name levels" },
            })
            .populate("semester", "_id name season")



        if (!course) return res.status(404).json({ msg: "Course not found" });

        res.json(formatCourse(course, true));
    } catch (err) {
        console.error(err);
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
        console.error(err);
        res.status(500).json({ msg: "Server error", error: err.message });
    }
});

/// ======================= ADMIN ENROLL / UNENROLL STUDENT ======================= ///
router.post("/:courseId/enroll", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const { studentId } = req.body;
        if (!studentId) return res.status(400).json({ msg: "studentId required" });

        const course = await Course.findById(req.params.courseId);
        if (!course) return res.status(404).json({ msg: "Course not found" });

        const activeSem = await getActiveSemesterDoc();
        if (course.semester.toString() !== activeSem._id.toString())
            return res.status(400).json({ msg: "Cannot enroll: course is not in active semester" });

        if (!course.students.includes(studentId)) course.students.push(studentId);
        await course.save();

        const populated = await Course.findById(course._id)
            .populate("teacher", "name email")
            .populate("department", "name levels");

        res.json({ msg: "Student enrolled successfully", course: formatCourse(populated) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: "Server error", error: err.message });
    }
});

router.post("/:courseId/unenroll", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const { studentId } = req.body;
        if (!studentId) return res.status(400).json({ msg: "studentId required" });

        const course = await Course.findById(req.params.courseId);
        if (!course) return res.status(404).json({ msg: "Course not found" });

        // Remove student safely whether students array has ObjectIds or full objects
        course.students = course.students.filter(
            (s) => s.toString() !== studentId.toString()
        );

        await course.save();

        const populated = await Course.findById(course._id)
            .populate("students", "_id name email studentId")
            .populate("teacher", "name email")
            .populate("department", "name levels");

        res.json({ msg: "Student unenrolled successfully", course: formatCourse(populated, true) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: "Server error", error: err.message });
    }
});


/// ======================= ADMIN UNASSIGN LECTURER ======================= ///
router.post("/:courseId/unassign-lecturer", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const course = await Course.findById(req.params.courseId);
        if (!course) return res.status(404).json({ msg: "Course not found" });

        course.teacher = null;
        await course.save();

        const updatedCourse = await Course.findById(req.params.courseId)
            .populate("teacher", "name email")
            .populate("department", "name levels");

        res.json({ msg: "Lecturer unassigned successfully", course: updatedCourse });
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: "Server error while unassigning lecturer", error: err.message });
    }
});

/// ======================= STUDENT SELF ENROLL ======================= ///
router.post("/:courseId/self-enroll", auth, roleCheck(["student"]), async (req, res) => {
    try {
        const user = req.user;
        const course = await Course.findById(req.params.courseId).populate("department", "name");

        if (!course) return res.status(404).json({ msg: "Course not found" });
        if (course.department._id.toString() !== user.department.toString() || course.level !== user.level)
            return res.status(403).json({ msg: "You can only enroll in courses from your department and level." });

        if (course.students.includes(user.id)) return res.status(400).json({ msg: "Already enrolled in this course." });

        course.students.push(user.id);
        await course.save();

        const populated = await Course.findById(course._id)
            .populate("teacher", "name email")
            .populate("department", "name levels");

        res.json({ msg: `Successfully enrolled in ${course.name}`, course: formatCourse(populated) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: "Server error", error: err.message });
    }
});

/// ======================= GET ALL COURSES ======================= ///
router.get("/", async (req, res) => {
    try {
        const activeSem = await getActiveSemesterDoc();
        const courses = await Course.find({ semester: activeSem._id })
            .populate("teacher", "name email")
            .populate("department", "name levels")
            .populate("semester", "_id name season")



        res.json(courses.map((c) => formatCourse(c)));
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: "Failed to fetch courses", error: err.message });
    }
});

/// ======================= UPDATE COURSE ======================= ///
router.put("/:id", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const { name, description, code, teacherId, totalClasses, department, level, unit, semester } = req.body;

        if (department) {
            const deptExists = await Department.findById(department);
            if (!deptExists) return res.status(400).json({ msg: "Invalid department" });
        }

        if (semester) {
            const semExists = await Semester.findById(semester);
            if (!semExists) return res.status(400).json({ msg: "Invalid semester selected" });
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
            .populate("department", "name levels")
            .populate("semester", "name season");


        if (!course) return res.status(404).json({ msg: "Course not found" });

        res.json({ msg: "Course updated successfully", course: formatCourse(course) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: "Server error", error: err.message });
    }
});

module.exports = router;
