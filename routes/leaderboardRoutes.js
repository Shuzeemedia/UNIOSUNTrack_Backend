const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const Attendance = require("../models/Attendance");
const Course = require("../models/Course");
const User = require("../models/User");

const { auth } = require("../middleware/authMiddleware");

// Helper: safe ObjectId conversion
function toObjectIdIfValid(id) {
    if (!id) return null;
    if (mongoose.Types.ObjectId.isValid(id)) return new mongoose.Types.ObjectId(id);
    return null;
}

/**
 * GET /api/leaderboard
 * Query params: department (id), level (number), courseId (id)
 */
router.get("/", auth, async (req, res) => {
    try {
        const { department, level, courseId } = req.query;
        const user = req.user;

        const matchStage = { status: "Present" };
        const courseObjectId = toObjectIdIfValid(courseId);

        // ----------------------
        // ROLE-BASED SCOPING
        // ----------------------
        if (user.role === "teacher") {
            const teacherCourses = await Course.find({ teacher: user._id }).select("_id");
            const teacherCourseIds = teacherCourses.map(c => c._id.toString());

            if (teacherCourseIds.length === 0) {
                return res.json({ success: true, leaderboard: [] }); // ✅ no courses yet
            }

            if (courseId) {
                if (!teacherCourseIds.includes(courseId)) {
                    return res
                        .status(403)
                        .json({ success: false, message: "Not allowed to view this course leaderboard" });
                }
                matchStage.course = courseObjectId;
            } else {
                matchStage.course = { $in: teacherCourseIds.map(id => mongoose.Types.ObjectId(id)) };
            }
        } else if (user.role === "student") {
            if (!courseId) {
                return res
                    .status(400)
                    .json({ success: false, message: "Students must select a course" });
            }

            const course = await Course.findById(courseId).select("students department level");
            if (!course)
                return res.status(404).json({ success: false, message: "Course not found" });

            // ✅ Ensure student is in the course
            const isInCourse = course.students.some(
                (s) => s.toString() === user._id.toString()
            );
            if (!isInCourse) {
                return res
                    .status(403)
                    .json({ success: false, message: "You are not enrolled in this course" });
            }

            // ✅ No need to cross-check department/level — remove the strict check
            matchStage.course = courseObjectId;
        }

        else {
            // admin
            if (courseId) matchStage.course = courseObjectId;
        }

        // ----------------------
        // PIPELINE
        // ----------------------
        const pipeline = [
            { $match: matchStage },

            // group by student+course
            {
                $group: {
                    _id: { student: "$student", course: "$course" },
                    totalPresent: { $sum: 1 },
                },
            },

            // join student
            {
                $lookup: {
                    from: "users",
                    localField: "_id.student",
                    foreignField: "_id",
                    as: "student",
                },
            },
            { $unwind: { path: "$student", preserveNullAndEmptyArrays: false } },

            // join course
            {
                $lookup: {
                    from: "courses",
                    localField: "_id.course",
                    foreignField: "_id",
                    as: "course",
                },
            },
            { $unwind: { path: "$course", preserveNullAndEmptyArrays: false } },
        ];

        // ----------------------
        // OPTIONAL FILTERS
        // ----------------------
        if (department) {
            const deptObj = toObjectIdIfValid(department);
            pipeline.push({ $match: { "student.department": deptObj || department } });
        }

        if (level) {
            pipeline.push({ $match: { "student.level": parseInt(level, 10) } });
        }

        // ----------------------
        // FINAL PROJECTION
        // ----------------------
        pipeline.push({
            $project: {
                _id: 0,
                matric: { $ifNull: ["$student.studentId", "N/A"] },
                studentId: { $ifNull: ["$student.studentId", "N/A"] },
                name: { $ifNull: ["$student.name", "N/A"] },
                email: { $ifNull: ["$student.email", "N/A"] },
                department: "$student.department",
                level: "$student.level",
                courseId: "$course._id",
                courseCode: "$course.code",
                courseName: "$course.name",
                totalPresent: 1,
                totalClasses: { $ifNull: ["$course.totalClasses", 0] },
                attendancePercentage: {
                    $cond: [
                        { $gt: ["$course.totalClasses", 0] },
                        { $multiply: [{ $divide: ["$totalPresent", "$course.totalClasses"] }, 100] },
                        0,
                    ],
                },
            },
        });

        // sort
        pipeline.push({ $sort: { attendancePercentage: -1, totalPresent: -1 } });

        const leaderboard = await Attendance.aggregate(pipeline);

        // ----------------------
        // RANK + XP
        // ----------------------
        leaderboard.forEach((row, idx) => {
            row.rank = idx + 1;
            row.xp = (row.totalPresent || 0) * 10;
        });

        return res.json({ success: true, leaderboard });
    } catch (err) {
        console.error("❌ Leaderboard route error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
    }
});

module.exports = router;
