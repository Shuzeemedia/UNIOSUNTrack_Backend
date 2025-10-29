const express = require("express");
const router = express.Router();
const multer = require("multer");
const cloudinary = require("../config/cloudinary");
const User = require("../models/User");
const { auth } = require("../middleware/authMiddleware");

const upload = multer({ storage: multer.memoryStorage() });

// GET current user info
router.get("/me", auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).populate("department");
        res.json(user);
    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
});

// UPDATE user info (name, email, level, department)
router.put("/me", auth, async (req, res) => {
    try {
        const updateData = {};
        if (req.body.name) updateData.name = req.body.name;
        if (req.body.email) updateData.email = req.body.email;
        if (req.body.level) updateData.level = req.body.level;
        if (req.body.department) updateData.department = req.body.department;

        const updated = await User.findByIdAndUpdate(
            req.user.id,
            { $set: updateData },
            { new: true }
        ).populate("department");

        res.json(updated);
    } catch (err) {
        console.error(err); // 👈 log the actual error
        res.status(500).json({ msg: err.message });
    }
});


// UPLOAD profile picture
router.post("/me/profile-pic", auth, upload.single("image"), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ msg: "No file uploaded" });

        const streamifier = require("streamifier");

        const streamUpload = (req) => {
            return new Promise((resolve, reject) => {
                const stream = cloudinary.uploader.upload_stream(
                    { folder: "profilePics" },
                    (error, result) => {
                        if (result) resolve(result);
                        else reject(error);
                    }
                );
                streamifier.createReadStream(req.file.buffer).pipe(stream);
            });
        };

        const result = await streamUpload(req);
        const user = await User.findByIdAndUpdate(req.user.id, { profileImage: result.secure_url }, { new: true });

        res.json({ url: result.secure_url, user });
    } catch (err) {
    console.error("🔥 Upload error:", err);
    res.status(500).json({ msg: err.message });
}

});

module.exports = router;
