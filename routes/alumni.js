const express = require("express");
const router = express.Router();

const { auth } = require("../middleware/authMiddleware");
const CourseArchive = require("../models/CourseArchive");
const LeaderboardArchive = require("../models/LeaderboardArchive");
const User = require("../models/User");

const PDFDocument = require("pdfkit");
const path = require("path");


// =====================================================
// 🎓 GET GRADUATE TRANSCRIPT
// =====================================================
router.get("/transcript", auth, async (req, res) => {
  try {
    const user = req.user;

    // 🔐 Only graduated students can access transcript
    if (user.role !== "student" || !user.graduated) {
      return res.status(403).json({
        msg: "Transcript available only for graduated students",
      });
    }

    // Populate department name
    await user.populate("department", "name");

    // =========================
    // 🧑 Student Info
    // =========================
    const studentInfo = {
      name: user.name,
      studentId: user.studentId,
      department: user.department?.name,
      graduationDate: user.graduationDate,
      graduationVerified: user.graduationVerified,
    };

    // =========================
    // 📦 Archived Courses
    // =========================
    const archivedCourses = await CourseArchive.find({
      students: user._id,
    }).lean();

    // =========================
    // 📊 Attendance Summary (OFFICIAL)
    // =========================
    const leaderboard = await LeaderboardArchive.findOne({
      student: user._id,
    }).lean();

    if (!leaderboard) {
      return res.status(404).json({
        msg: "Attendance summary not found for this graduate",
      });
    }

    // =========================
    // 📄 Transcript Rows
    // =========================
    const transcript = archivedCourses.map((course) => ({
      session: course.session,
      courseCode: course.courseCode,
      courseTitle: course.courseTitle,
      status: "Completed",
    }));

    // =========================
    // ✅ FINAL RESPONSE
    // =========================
    res.json({
      student: studentInfo,
      academicSummary: {
        totalPresent: leaderboard.totalPresent,
        totalAbsent: leaderboard.totalAbsent,
        attendancePercentage: leaderboard.percentage,
      },
      transcript,
    });
  } catch (err) {
    console.error("Transcript fetch error:", err);
    res.status(500).json({ msg: "Failed to fetch transcript" });
  }
});

// =======================================================
// 📄 GET CLEARANCE LETTER
// =======================================================
router.get("/clearance-letter", auth, async (req, res) => {
  try {
    const user = req.user;

    if (!user.graduated) {
      return res.status(403).json({
        msg: "Clearance letter available only after graduation",
      });
    }

    await user.populate("department", "name");

    res.json({
      studentName: user.name,
      matricNumber: user.studentId,
      department: user.department?.name,
      graduationDate: user.graduationDate,
      issuedAt: new Date(),
      message:
        "This is to certify that the above-named student has fulfilled all academic requirements and is hereby cleared.",
    });
  } catch (err) {
    console.error("Clearance letter error:", err);
    res.status(500).json({ msg: "Failed to generate clearance letter" });
  }
});

// =======================================================
// 🎓 DOWNLOAD TRANSCRIPT AS PDF
// =======================================================
router.get("/transcript/pdf", auth, async (req, res) => {
  try {
    const userId = req.user._id;

    // 1️⃣ Fetch graduate
    const user = await User.findById(userId).populate("department", "name");

    if (!user || !user.graduated) {
      return res.status(403).json({ msg: "Transcript available only after graduation" });
    }

    // 2️⃣ Fetch archived courses
    const archivedCourses = await CourseArchive.find({
      students: userId,
    }).lean();

    // 3️⃣ Fetch leaderboard attendance summary
    const leaderboard = await LeaderboardArchive.findOne({
      student: userId,
    }).lean();

    if (!leaderboard) {
      return res.status(404).json({ msg: "Attendance record not found" });
    }

    console.log({
      present: leaderboard?.totalPresent,
      absent: leaderboard?.totalAbsent,
      percent: leaderboard?.percentage
    });


    // ===============================
    // CREATE PDF
    // ===============================
    const doc = new PDFDocument({ size: "A4", margin: 50 });

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=Transcript_${user.studentId}.pdf`
    );
    res.setHeader("Content-Type", "application/pdf");

    doc.pipe(res);

    /* ============================
       HEADER WITH LOGO
    ============================ */

    const logoPath = path.join(__dirname, "../public/uniosunlogo.png");
    doc.image(logoPath, 50, 40, { width: 70 });

    doc
      .fontSize(18)
      .text("OSUN STATE UNIVERSITY", 130, 50)
      .fontSize(12)
      .text("Office of Academic Affairs", 130, 75)
      .text("Official Academic Transcript", 130, 95);

    doc
      .moveTo(50, 120)
      .lineTo(550, 120)
      .stroke();

    /* ============================
       STUDENT INFORMATION BOX
    ============================ */

    const infoTop = 140;

    doc
      .rect(50, infoTop, 500, 110)
      .stroke();

    doc.fontSize(11);

    doc.text(`Name: ${user.name}`, 60, infoTop + 15);
    doc.text(`Matric No: ${user.studentId}`, 60, infoTop + 35);
    doc.text(`Department: ${user.department?.name}`, 60, infoTop + 55);
    doc.text(
      `Graduation Date: ${user.graduationDate
        ? new Date(user.graduationDate).toLocaleDateString()
        : "N/A"
      }`,
      60,
      infoTop + 75
    );

    /* ============================
       ATTENDANCE SUMMARY
    ============================ */

    const totalPresent = parseInt(leaderboard.totalPresent) || 0;
    const totalAbsent = parseInt(leaderboard.totalAbsent) || 0;

    let percent = leaderboard.percentage || 0;
    if (typeof percent === "string") percent = percent.replace("%", "");
    percent = parseFloat(percent) || 0;

    doc
      .fontSize(11)
      .text("Attendance Summary", 360, infoTop + 15, { underline: true })
      .text(`Present: ${totalPresent}`, 360, infoTop + 40)
      .text(`Absent: ${totalAbsent}`, 360, infoTop + 60)
      .text(`Attendance: ${percent}%`, 360, infoTop + 80);

    /* ============================
       TABLE HEADER
    ============================ */

    let tableTop = infoTop + 140;

    doc
      .fontSize(11)
      .text("Session", 60, tableTop)
      .text("Course Code", 150, tableTop)
      .text("Course Title", 260, tableTop)
      .text("Status", 500, tableTop);

    doc
      .moveTo(50, tableTop + 15)
      .lineTo(550, tableTop + 15)
      .stroke();

    /* ============================
       TABLE ROWS
    ============================ */

    let y = tableTop + 30;

    archivedCourses.forEach((course) => {
      if (y > 750) {
        doc.addPage();
        y = 80;
      }

      doc
        .fontSize(10)
        .text(course.session || "-", 60, y)
        .text(course.courseCode || "-", 150, y)
        .text(course.courseTitle || "-", 260, y, { width: 220 })
        .text("Completed", 500, y);

      y += 22;
    });

    /* ============================
       FOOTER
    ============================ */

    const footerY = 780;

    doc.fontSize(9);

    doc.text(
      "This transcript is computer generated and does not require a physical signature.",
      50,
      footerY,
      { align: "center", width: 500 }
    );

    doc.text(
      `Issued on: ${new Date().toLocaleDateString()}`,
      50,
      footerY + 14,   // space between the two lines
      { align: "center", width: 500 }
    );

    doc.end();

  } catch (err) {
    console.error("Transcript PDF error:", err);
    res.status(500).json({ msg: "Failed to generate transcript PDF" });
  }
});


// =======================================================
// 📄 DOWNLOAD CLEARANCE LETTER AS PDF
// =======================================================
router.get("/clearance-letter/pdf", auth, async (req, res) => {
  try {
    const userId = req.user._id;

    const user = await User.findById(userId).populate("department", "name");

    if (!user || !user.graduated) {
      return res
        .status(403)
        .json({ msg: "Clearance letter available only after graduation" });
    }

    const doc = new PDFDocument({ size: "A4", margin: 50 });

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=Clearance_${user.studentId}.pdf`
    );
    res.setHeader("Content-Type", "application/pdf");

    doc.pipe(res);

    /* ============================
       HEADER WITH LOGO
    ============================ */

    const logoPath = path.join(__dirname, "../public/uniosunlogo.png");
    doc.image(logoPath, 50, 40, { width: 70 });

    doc
      .fontSize(18)
      .text("OSUN STATE UNIVERSITY", 130, 50)
      .fontSize(12)
      .text("Office of Academic Affairs", 130, 75)
      .text("Official Clearance Letter", 130, 95);

    doc.moveTo(50, 120).lineTo(550, 120).stroke();

    /* ============================
       STUDENT DETAILS
    ============================ */

    doc.moveDown(3);
    doc.fontSize(11);

    doc.text(`Name: ${user.name}`);
    doc.text(`Matric Number: ${user.studentId}`);
    doc.text(`Department: ${user.department?.name}`);
    doc.text(
      `Graduation Date: ${user.graduationDate
        ? new Date(user.graduationDate).toLocaleDateString()
        : "N/A"
      }`
    );

    /* ============================
       LETTER BODY
    ============================ */

    doc.moveDown(3);
    doc.fontSize(12);

    doc.text(
      `This is to certify that ${user.name}, with Matric Number ${user.studentId}, has successfully completed all academic requirements in the Department of ${user.department?.name} at Osun State University and is hereby officially cleared.`,
      {
        align: "justify",
        lineGap: 6,
      }
    );

    doc.moveDown(2);

    doc.text(
      "This clearance letter is issued for all official and academic purposes.",
      { align: "justify" }
    );

    /* ============================
       SIGNATURE AREA
    ============================ */

    doc.moveDown(4);

    doc.text("______________________________");
    doc.text("Registrar");
    doc.text("Osun State University");

    /* ============================
       FOOTER
    ============================ */

    const footerY = 770;

    doc.fontSize(9);

    doc.text(
      "This clearance letter is computer generated and does not require a physical signature.",
      50,
      footerY,
      { align: "center", width: 500 }
    );

    doc.text(
      `Issued on: ${new Date().toLocaleDateString()}`,
      50,
      footerY + 14,
      { align: "center", width: 500 }
    );

    // ✅ FINALIZE
    doc.end();
  } catch (err) {
    console.error("Clearance PDF error:", err);
    res.status(500).json({ msg: "Failed to generate clearance letter PDF" });
  }
});



module.exports = router;
