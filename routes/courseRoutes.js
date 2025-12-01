const express = require("express");
const Course = require("../models/Course");
const Department = require("../models/Department");
const { auth, roleCheck } = require("../middleware/authMiddleware");
const mongoose = require("mongoose");

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
      ? {
          _id: c.department._id,
          name: c.department.name,
          levels: c.department.levels,
        }
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
            studentId: s.studentId || null,
            level: s.level,
            department: s.department
              ? { _id: s.department._id, name: s.department.name }
              : null,
            profileImage: s.profileImage || "", // include profileImage
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


/// ======================= STUDENT AVAILABLE COURSES ======================= ///
router.get("/available", auth, roleCheck(["student"]), async (req, res) => {
    try {
        const user = req.user;

        // Get all courses in student's department and level
        const courses = await Course.find({
            department: user.department._id || user.department,
            level: user.level,
            students: { $ne: user._id }, // ✅ exclude courses the student is already enrolled in
        })
            .populate("teacher", "name email")
            .populate("department", "name levels");

        // Format courses for frontend
        const formattedCourses = courses.map((c) => formatCourse(c));

        res.json(formattedCourses);
    } catch (err) {
        console.error("Available courses error:", err.message);
        res.status(500).json({ msg: "Server error" });
    }
});



/// ======================= STUDENT ENROLLED COURSES (for leaderboard dropdown) ======================= ///
router.get("/enrolled", auth, roleCheck(["student"]), async (req, res) => {
    try {
        const courses = await Course.find({ students: req.user._id })
            .populate("department", "name")
            .populate("teacher", "name email");

        // ✅ Return 200 with empty array instead of 403
        if (!courses.length) {
            return res.json([]); // empty list, not an error
        }

        res.json(
            courses.map((c) => ({
                _id: c._id,
                name: c.name,
                code: c.code,
                level: c.level,
                department: c.department,
                teacher: c.teacher,
            }))
        );
    } catch (err) {
        console.error("Error fetching enrolled courses:", err.message);
        res.status(500).json({ msg: "Server error" });
    }
});



/// ======================= LECTURER ASSIGNED COURSES (for leaderboard dropdown) ======================= ///
router.get("/assigned", auth, roleCheck(["teacher"]), async (req, res) => {
    try {
        const courses = await Course.find({ teacher: req.user._id })
            .populate("department", "name")
            .populate("students", "name email level department");

        if (!courses.length) {
            return res.json([]); // safe empty response
        }

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
        console.error("Error fetching assigned courses:", err.message);
        res.status(500).json({ msg: "Server error" });
    }


});


/// ======================= ADMIN FILTER COURSES ======================= ///
router.get("/admin-filter", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const courses = await Course.find()
            .populate("teacher", "name email")
            .populate("department", "name levels")
            .populate("students", "name email level department");

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
        const query = {
            students: { $ne: user._id }, // ✅ exclude already enrolled courses
        };

        // Filter by department if provided
        if (department) {
            if (!mongoose.Types.ObjectId.isValid(department)) {
                return res.status(400).json({ msg: "Invalid department ID" });
            }
            query.department = department;
        }

        // Filter by level if provided
        if (level) {
            const levelNum = Number(level);
            if (isNaN(levelNum)) return res.status(400).json({ msg: "Invalid level" });
            query.level = levelNum;
        }

        const courses = await Course.find(query)
            .populate("teacher", "name email")
            .populate("department", "name levels");

        const formattedCourses = courses.map((c) => formatCourse(c));

        res.json(formattedCourses);
    } catch (err) {
        console.error("Error filtering courses:", err.message);
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
                select: "name email department level studentId",
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


/// ======================= ADMIN UNENROLLS STUDENT ======================= ///
router.post("/:courseId/unenroll", auth, roleCheck(["admin"]), async (req, res) => {
    const { studentId } = req.body;

    if (!studentId) {
        return res.status(400).json({ msg: "studentId is required" });
    }

    try {
        const course = await Course.findById(req.params.courseId)
            .populate("teacher", "name email")
            .populate("department", "name levels")
            .populate("students", "_id name email studentId"); // include students for frontend

        if (!course) return res.status(404).json({ msg: "Course not found" });

        // Check if student is in the course
        const isEnrolled = course.students.some(
            (s) => s._id.toString() === studentId.toString()
        );
        if (!isEnrolled) {
            return res.status(400).json({ msg: "Student not enrolled in this course" });
        }

        // Remove student
        course.students = course.students.filter(
            (s) => s._id.toString() !== studentId.toString()
        );
        await course.save();

        res.json({
            msg: "Student unenrolled successfully",
            unenrolled: true,
            course: formatCourse(course, true), // include updated students list
        });
    } catch (err) {
        console.error("Unenroll error:", err.message);
        res.status(500).json({ msg: "Server error", error: err.message });
    }


});


/// ======================= ADMIN UNASSIGNS LECTURER ======================= ///
router.post("/:courseId/unassign-lecturer", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const { courseId } = req.params;

        const course = await Course.findById(courseId);
        if (!course) return res.status(404).json({ msg: "Course not found" });

        // ✅ Remove lecturer assignment
        course.teacher = null;
        await course.save();

        // ✅ Repopulate data for frontend
        const updatedCourse = await Course.findById(courseId)
            .populate("teacher", "name email")
            .populate("department", "name levels");

        res.json({
            msg: "Lecturer unassigned successfully",
            course: updatedCourse,
        });
    } catch (err) {
        console.error("❌ Unassign lecturer error:", err);
        res.status(500).json({
            msg: "Server error while unassigning lecturer",
            error: err.message,
        });
    }

});



/// ======================= STUDENT SELF ENROLL ======================= ///
router.post("/:courseId/self-enroll", auth, roleCheck(["student"]), async (req, res) => {
    try {
        const user = req.user;
        const course = await Course.findById(req.params.courseId).populate("department", "name");

        if (!course) return res.status(404).json({ msg: "Course not found" });

        // ✅ Only allow if same department & level match
        if (
            course.department._id.toString() !== user.department.toString() ||
            course.level !== user.level
        ) {
            return res.status(403).json({
                msg: "You can only enroll in courses from your department and level.",
            });
        }

        // ✅ Prevent duplicates
        if (course.students.includes(user.id)) {
            return res.status(400).json({ msg: "Already enrolled in this course." });
        }

        // ✅ Add student
        course.students.push(user.id);
        await course.save();

        const populated = await Course.findById(course._id)
            .populate("teacher", "name email")
            .populate("department", "name levels");

        res.json({
            msg: `Successfully enrolled in ${course.name}`,
            course: formatCourse(populated),
        });
    } catch (err) {
        console.error("Self-enroll error:", err.message);
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

module.exports = router;
