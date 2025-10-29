const express = require("express");
const Department = require("../models/Department");
const { auth, roleCheck } = require("../middleware/authMiddleware");

const router = express.Router();

// Admin creates department
router.post("/", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const { name, levels } = req.body;
        const dept = new Department({ name, levels });
        await dept.save();
        res.json(dept);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Public: get all departments
router.get("/", async (req, res) => {
    try {
        const depts = await Department.find();
        res.json(depts);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin updates department
router.put("/:id", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        const dept = await Department.findByIdAndUpdate(req.params.id, req.body, {
            new: true,
        });
        res.json(dept);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin deletes department
router.delete("/:id", auth, roleCheck(["admin"]), async (req, res) => {
    try {
        await Department.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// Get all departments
router.get("/", auth, async (req, res) => {
    try {
        const departments = await Department.find().sort("name");
        res.json(departments);   // just array
    } catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});

// Get levels for a department
router.get("/:id/levels", auth, async (req, res) => {
    try {
        const dept = await Department.findById(req.params.id.trim());
        if (!dept) {
            return res.status(404).json({ message: "Department not found" });
        }
        res.json(dept.levels || []);
    } catch (err) {
        console.error("❌ Error fetching levels:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});


module.exports = router;
