const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const User = require("../models/User");
const Department = require("../models/Department");
const { auth, roleCheck } = require("../middleware/authMiddleware");
const { Resend } = require("resend"); // ✅ Using Resend globally

const resend = new Resend(process.env.RESEND_API_KEY);
const router = express.Router();

// Helper function for sending emails via Resend
async function sendEmail(to, subject, html) {
    try {
        await resend.emails.send({
            from: "UNIOSUNTrack <Onboarding@uniosuntrack.site>",
            to,
            subject,
            html,
        });
    } catch (error) {
        console.error("Email send error:", error);
        throw new Error("Email sending failed");
    }
}

// ======================
// 🧍 Student Signup
// ======================
router.post("/signup", async (req, res) => {
    try {
        const { name, studentId, email, password, departmentId, level } = req.body;
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
        const studentIdRegex = /^\d{4}\/\d{5}$/;

        if (!emailRegex.test(email))
            return res.status(400).json({ msg: "Invalid email format" });
        if (!passwordRegex.test(password))
            return res.status(400).json({
                msg: "Password must be at least 8 chars, include uppercase, lowercase, and number",
            });
        if (!studentIdRegex.test(studentId))
            return res.status(400).json({ msg: "Student ID must follow e.g. 2022/42047" });

        const existingUser = await User.findOne({ $or: [{ email }, { studentId }] });
        if (existingUser)
            return res.status(400).json({ msg: "Email or Student ID already exists" });

        const dept = await Department.findById(departmentId);
        if (!dept) return res.status(400).json({ msg: "Invalid department" });
        if (!dept.levels.includes(level))
            return res.status(400).json({
                msg: `Level ${level} is not valid for ${dept.name}`,
            });

        const hashedPassword = await bcrypt.hash(password, 10);
        const verificationToken = crypto.randomBytes(32).toString("hex");

        const newUser = new User({
            name,
            studentId,
            department: departmentId,
            level,
            email,
            password: hashedPassword,
            role: "student",
            verificationToken,
        });

        await newUser.save();

        const verifyUrl = `${process.env.FRONTEND_URL}/verify-email/${verificationToken}`;
        const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.6;">
        <h2>Welcome to UniosunTrack 🎓</h2>
        <p>Hello ${name},</p>
        <p>Click the button below to verify your email and activate your account:</p>
        <a href="${verifyUrl}" style="display:inline-block;padding:10px 15px;background:#4caf50;color:#fff;text-decoration:none;border-radius:5px;">Verify Email</a>
        <p>If you didn’t create an account, you can ignore this email.</p>
      </div>
    `;

        await sendEmail(email, "Verify your UniosunTrack account", html);

        res.json({ msg: "Signup successful! Please verify your email." });
    } catch (err) {
        console.error("ERROR /auth/signup:", err);
        res.status(500).json({ error: err.message });
    }
});

// ======================
// ✅ Verify Email
// ======================
router.get("/verify-email/:token", async (req, res) => {
    try {
        const user = await User.findOne({ verificationToken: req.params.token });
        if (!user) return res.status(400).send("Invalid or expired verification token");

        user.isVerified = true;
        user.verificationToken = undefined;
        await user.save();

        return res.redirect(`${process.env.FRONTEND_URL}/login`);
    } catch (err) {
        console.error("ERROR /auth/verify-email:", err);
        return res.status(500).send("Server error");
    }
});

// ======================
// 🔐 Login
// ======================
router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email })
            .populate("department", "name levels")
            .select("-__v");

        if (!user) return res.status(400).json({ msg: "Invalid email or password" });
        if (!user.isVerified)
            return res.status(403).json({ msg: "Please verify your email before logging in." });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ msg: "Invalid email or password" });

        const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
            expiresIn: "1d",
        });

        res.json({
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                studentId: user.studentId,
                department: user.department
                    ? {
                        id: user.department._id,
                        name: user.department.name,
                        levels: user.department.levels,
                    }
                    : null,
                level: user.level,
                profileImage: user.profileImage || null,
            },
        });
    } catch (err) {
        console.error("ERROR /auth/login:", err);
        res.status(500).json({ error: err.message });
    }
});

// ======================
// 🧩 Forgot Password (Resend)
// ======================
router.post("/forgot-password", async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ msg: "Email is required" });

        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ msg: "No account found with that email." });

        const resetToken = crypto.randomBytes(32).toString("hex");
        user.resetPasswordToken = resetToken;
        user.resetPasswordExpires = Date.now() + 30 * 60 * 1000;
        await user.save();

        const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;
        const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.6;">
        <h2>Password Reset Request</h2>
        <p>Hello ${user.name || "User"},</p>
        <p>You requested to reset your password. Click below to proceed:</p>
        <a href="${resetUrl}" style="display:inline-block;padding:10px 15px;background:#4caf50;color:#fff;text-decoration:none;border-radius:5px;">Reset Password</a>
        <p>This link expires in 30 minutes.</p>
      </div>
    `;

        await sendEmail(email, "Password Reset Request", html);
        res.json({ msg: "Password reset email sent!" });
    } catch (err) {
        console.error("ERROR /auth/forgot-password:", err);
        res.status(500).json({ error: err.message });
    }
});

// ======================
// 🔑 Reset Password
// ======================
router.post("/reset-password/:token", async (req, res) => {
    try {
        const { password } = req.body;
        if (!password) return res.status(400).json({ msg: "Password is required" });

        const user = await User.findOne({
            resetPasswordToken: req.params.token,
            resetPasswordExpires: { $gt: Date.now() },
        });

        if (!user) return res.status(400).json({ msg: "Invalid or expired reset token" });

        user.password = await bcrypt.hash(password, 10);
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        await user.save();

        res.json({ msg: "Password reset successful! You can now log in." });
    } catch (err) {
        console.error("ERROR /auth/reset-password:", err);
        res.status(500).json({ error: err.message });
    }
});

// ======================
// 👤 Get Current User
// ======================
router.get("/me", auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id)
            .populate("department", "name levels")
            .select("-password -__v");
        if (!user) return res.status(404).json({ msg: "User not found" });

        res.json({
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                studentId: user.studentId,
                department: user.department
                    ? {
                        id: user.department._id,
                        name: user.department.name,
                        levels: user.department.levels,
                    }
                    : null,
                level: user.level,
                profileImage: user.profileImage || null,
            },
        });
    } catch (err) {
        console.error("ERROR /auth/me:", err);
        res.status(500).json({ error: err.message });
    }
});

// ======================
// 🔒 Role-based test routes
// ======================
router.get("/admin-only", auth, roleCheck(["admin"]), (req, res) =>
    res.json({ msg: "Welcome Admin!" })
);
router.get("/teacher-only", auth, roleCheck(["teacher"]), (req, res) =>
    res.json({ msg: "Welcome Teacher!" })
);

module.exports = router;
