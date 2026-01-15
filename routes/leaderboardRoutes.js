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
            const teacherCourses = await Course.find({ teacher: user._id }).select("_id department level");
            const teacherCourseIds = teacherCourses.map(c => c._id.toString());

            if (teacherCourseIds.length === 0) {
                return res.status(403).json({
                    success: false,
                    message: "You are not assigned to any course yet. Leaderboard disabled."
                });
            }

            if (courseId) {
                if (!teacherCourseIds.includes(courseId)) {
                    return res.status(403).json({
                        success: false,
                        message: "Not allowed to view this course leaderboard"
                    });
                }
                matchStage.course = courseObjectId;
            } else {
                matchStage.course = { $in: teacherCourseIds.map(id => mongoose.Types.ObjectId(id)) };
            }
        } else if (user.role === "student") {
            const enrollments = await mongoose.model("Enrollment").find({
                student: user._id
            }).select("course");

            const enrolledCourseIds = enrollments.map(e => e.course.toString());

            if (enrolledCourseIds.length === 0) {
                return res.status(403).json({
                    success: false,
                    message: "You are not enrolled in any course yet. Leaderboard disabled."
                });
            }

            if (!courseId) {
                return res.status(400).json({
                    success: false,
                    message: "Students must select a course they are enrolled in."
                });
            }

            if (!enrolledCourseIds.includes(courseId)) {
                return res.status(403).json({
                    success: false,
                    message: "You are not enrolled in this course."
                });
            }

            matchStage.course = courseObjectId;
        }
        else {
            if (courseId) matchStage.course = courseObjectId;
        }

        // ----------------------
        // PIPELINE
        // ----------------------
        const pipeline = [
            { $match: matchStage },
            {
                $group: {
                    _id: { student: "$student", course: "$course" },
                    totalPresent: { $sum: 1 },
                },
            },
            {
                $lookup: {
                    from: "users",
                    localField: "_id.student",
                    foreignField: "_id",
                    as: "student",
                },
            },
            { $unwind: { path: "$student", preserveNullAndEmptyArrays: false } },
            // ✅ Lookup student's department details
            {
                $lookup: {
                    from: "departments",
                    localField: "student.department",
                    foreignField: "_id",
                    as: "student.departmentDetails",
                },
            },
            { $unwind: { path: "$student.departmentDetails", preserveNullAndEmptyArrays: true } },
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

        if (department) {
            const deptObj = toObjectIdIfValid(department);
            pipeline.push({ $match: { "course.department": deptObj } });
        }

        if (level) {
            pipeline.push({ $match: { "course.level": parseInt(level, 10) } });
        }


        pipeline.push({
            $project: {
                _id: 0,
                matric: { $ifNull: ["$student.studentId", "N/A"] },
                studentId: { $ifNull: ["$student.studentId", "N/A"] },
                name: { $ifNull: ["$student.name", "N/A"] },
                email: { $ifNull: ["$student.email", "N/A"] },
                department: "$student.departmentDetails.name", // ✅ Student dept name
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

        const leaderboard = await Attendance.aggregate(pipeline);

        // ✅ FINAL SORT (percentage → present → name)
        leaderboard.sort((a, b) => {
            if (b.attendancePercentage !== a.attendancePercentage) {
                return b.attendancePercentage - a.attendancePercentage;
            }
            if (b.totalPresent !== a.totalPresent) {
                return b.totalPresent - a.totalPresent;
            }
            return a.name.localeCompare(b.name);
        });

        // TRUE RANKING WITH TIES
        let currentRank = 0;
        let lastScore = null;

        leaderboard.forEach((row, index) => {
            const scoreKey = `${row.attendancePercentage}-${row.totalPresent}`;

            if (scoreKey !== lastScore) {
                currentRank = index + 1;
                lastScore = scoreKey;
            }

            row.rank = currentRank;
            row.xp = (row.totalPresent || 0) * 10;
        });


        return res.json({ success: true, leaderboard });
    } catch (err) {
        console.error("Leaderboard route error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
    }
});

module.exports = router;