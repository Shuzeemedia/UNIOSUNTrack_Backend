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
        if (!user)
            return res.status(400).json({ success: false, msg: "Invalid or expired verification link. Please sign up again." });

        user.isVerified = true;
        user.verificationToken = undefined;
        await user.save();

        return res.json({ success: true, msg: "Email verified successfully" });
    } catch (err) {
        console.error("ERROR /auth/verify-email:", err);
        return res.status(500).json({ success: false, msg: "Server error" });
    }
});


// ======================
// 🔐 Login Route (Fixed)
// ======================
router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        // 1️⃣ Validate input
        if (!email || !password) {
            return res.status(400).json({ msg: "Email and password are required" });
        }

        // 2️⃣ Find user (include isVerified explicitly)
        const user = await User.findOne({ email })
            .populate("department", "name levels")
            .select("+isVerified"); // ✅ ensure isVerified is fetched

        if (!user) {
            return res.status(400).json({
                field: "email",
                msg: "Email not found",
            });
        }

        // 3️⃣ Debug logging to verify user object
        console.log("Login attempt for user:", {
            email: user.email,
            isVerified: user.isVerified,
            role: user.role,
            studentId: user.studentId,
        });

        // 4️⃣ Check email verification
        if (!user.isVerified) {
            return res.status(403).json({
                msg: "Please verify your email before logging in.",
            });
        }

        // 5️⃣ Check password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({
                field: "password",
                msg: "Incorrect password",
            });
        }

        // 6️⃣ Generate JWT
        const token = jwt.sign(
            { id: user._id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: "1d" }
        );

        // 7️⃣ Send user data including face info
        return res.json({
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                studentId: user.studentId || null,
                level: user.level || null,
                department: user.department
                    ? {
                        id: user.department._id,
                        name: user.department.name,
                        levels: user.department.levels,
                    }
                    : null,
                profileImage: user.profileImage || null,
                faceImage: user.faceImage || null,
                faceDescriptor: Array.isArray(user.faceDescriptor)
                    ? user.faceDescriptor
                    : [],
            },
        });
    } catch (err) {
        console.error("ERROR /auth/login:", err);
        return res.status(500).json({
            msg: "Server error. Please try again later.",
        });
    }
});



// ======================
// 🧠 Enroll Face (Students Only) — FIXED
// ======================
router.post("/enroll-face", auth, async (req, res) => {
    try {
        const { faceImage, faceDescriptor } = req.body;

        // 1️⃣ Validate input
        if (!faceImage || !Array.isArray(faceDescriptor)) {
            return res.status(400).json({ msg: "Face image and descriptor are required" });
        }
        if (faceDescriptor.length !== 128) {
            return res.status(400).json({ msg: "Face descriptor must contain 128 values" });
        }

        // 2️⃣ Fetch current user
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ msg: "User not found" });
        if (user.role !== "student") return res.status(403).json({ msg: "Face enrollment is only allowed for students" });

        // 3️⃣ Fetch other enrolled users
        const otherUsers = await User.find({
            _id: { $ne: user._id },
            faceDescriptor: { $type: "array" },
        }).select("faceDescriptor");

        // 4️⃣ Distance function (Euclidean)
        const faceDistance = (a, b) =>
            Math.sqrt(a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0));

        // 5️⃣ Thresholds
        const DUPLICATE_THRESHOLD = 0.45; // Block if face is already used
        const UNCLEAR_THRESHOLD = 0.2;    // Optional: for re-enroll only

        // 6️⃣ Check duplicates only (422 only for same user if needed)
        for (const u of otherUsers) {
            if (!Array.isArray(u.faceDescriptor)) continue;
            if (u.faceDescriptor.length !== 128) continue;

            const distance = faceDistance(u.faceDescriptor, faceDescriptor.map(Number));

            if (distance < DUPLICATE_THRESHOLD) {
                return res.status(409).json({
                    msg: "This face is already enrolled by another user.",
                    distance,
                });
            }
        }

        // 7️⃣ Save face for current user
        user.faceDescriptor = faceDescriptor.map(Number);
        user.faceImage = faceImage;
        await user.save();

        return res.status(200).json({ msg: "Face enrolled successfully" });

    } catch (err) {
        console.error("Enroll face error:", err);
        return res.status(500).json({ msg: "Face enrollment failed. Try again." });
    }
});

router.post("/reenroll-face", auth, async (req, res) => {
    try {
        const { faceDescriptor, faceImage, oldFaceDescriptor } = req.body;

        if (
            !Array.isArray(faceDescriptor) ||
            faceDescriptor.length !== 128 ||
            !Array.isArray(oldFaceDescriptor) ||
            oldFaceDescriptor.length !== 128
        ) {
            return res.status(400).json({ msg: "Invalid face data" });
        }

        const user = await User.findById(req.user.id);
        if (!user || !Array.isArray(user.faceDescriptor)) {
            return res.status(400).json({ msg: "No existing face to re-enroll" });
        }

        // Step 1: Verify old face first
        const verifyDistance = Math.sqrt(
            user.faceDescriptor.reduce((sum, v, i) => sum + (v - oldFaceDescriptor[i]) ** 2, 0)
        );

        if (verifyDistance > 0.45) {
            return res.status(401).json({
                msg: "Old face verification failed",
                distance: verifyDistance,
            });
        }

        // Step 2: Distance function
        const distance = (a, b) =>
            Math.sqrt(a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0));

        // Step 3: Check if new face is same as old face
        const distanceToOld = distance(user.faceDescriptor, faceDescriptor);
        if (distanceToOld < 0.01) {
            user.faceDescriptor = faceDescriptor.map(Number);
            user.faceImage = faceImage;
            await user.save();
            return res.json({ msg: "Face re-enrolled successfully (same as old)" });
        }

        // Step 4: Check other users for duplicates, ignoring own old face
        const otherUsers = await User.find({
            _id: { $ne: user._id },
            faceDescriptor: { $type: "array" },
        });

        for (const u of otherUsers) {
            if (!Array.isArray(u.faceDescriptor) || u.faceDescriptor.length !== 128) continue;

            const dist = distance(u.faceDescriptor, faceDescriptor.map(Number));

            if (dist < 0.45) {
                return res.status(409).json({
                    msg: "This face is already used by another user",
                    distance: dist,
                });
            }
        }

        // Step 5: Update face
        user.faceDescriptor = faceDescriptor.map(Number);
        user.faceImage = faceImage;
        await user.save();

        return res.json({ msg: "Face re-enrolled successfully" });

    } catch (err) {
        console.error("Re-enroll face error:", err);
        res.status(500).json({ msg: "Face re-enrollment failed" });
    }
});




router.post("/verify-face", auth, async (req, res) => {
    try {
        const { faceDescriptor } = req.body;
        if (!Array.isArray(faceDescriptor) || faceDescriptor.length !== 128) {
            return res.status(400).json({ msg: "Invalid face data" });
        }

        const user = await User.findById(req.user.id);
        if (!user || !Array.isArray(user.faceDescriptor)) {
            return res.status(400).json({ msg: "Face not enrolled" });
        }

        const distance = Math.sqrt(
            user.faceDescriptor.reduce(
                (sum, v, i) => sum + (v - faceDescriptor[i]) ** 2,
                0
            )
        );

        // STRICT login threshold
        if (distance > 0.45) {
            return res.status(401).json({
                msg: "Face verification failed",
                distance,
            });
        }

        return res.json({ msg: "Face verified successfully" });
    } catch (err) {
        console.error("Verify face error:", err);
        res.status(500).json({ msg: "Face verification error" });
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
                level: user.level,

                department: user.department
                    ? {
                        id: user.department._id,
                        name: user.department.name,
                        levels: user.department.levels,
                    }
                    : null,

                profileImage: user.profileImage || null,
                faceImage: user.faceImage || null,

                // 🔥 THIS IS WHAT YOU WERE MISSING
                faceDescriptor: Array.isArray(user.faceDescriptor)
                    ? user.faceDescriptor
                    : [],

                graduated: user.graduated || false,
                graduationDate: user.graduationDate || null,

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
