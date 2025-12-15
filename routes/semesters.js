const express = require("express");
const router = express.Router();
const Semester = require("../models/Semester");

// GET all semesters
router.get("/", async (req, res) => {
    try {
        const semesters = await Semester.find().sort({ startDate: -1 });
        res.json(semesters);
    } catch (err) {
        res.status(500).json({ msg: "Failed to fetch semesters" });
    }
});

// CREATE a new semester
router.post("/create", async (req, res) => {
    const { name, season, startDate, endDate, active } = req.body;
    try {
        const newSemester = new Semester({ name, season, startDate, endDate, active });
        await newSemester.save();
        res.json({ msg: "Semester created successfully", semester: newSemester });
    } catch (err) {
        res.status(400).json({ msg: err.message });
    }
});

// UPDATE a semester
router.put("/:id", async (req, res) => {
    try {
        const updated = await Semester.findByIdAndUpdate(req.params.id, req.body, { new: true });
        res.json({ msg: "Semester updated", semester: updated });
    } catch (err) {
        res.status(400).json({ msg: err.message });
    }
});

// DELETE a semester
router.delete("/:id", async (req, res) => {
    try {
        await Semester.findByIdAndDelete(req.params.id);
        res.json({ msg: "Semester deleted" });
    } catch (err) {
        res.status(400).json({ msg: err.message });
    }
});


// GET semesters with pagination & search
router.get("/paged", async (req, res) => {
    try {
        let { page = 1, limit = 10, search = "" } = req.query;

        page = parseInt(page);
        limit = parseInt(limit);

        const query = search
            ? { name: { $regex: search, $options: "i" } }
            : {};

        const total = await Semester.countDocuments(query);
        const semesters = await Semester.find(query)
            .sort({ startDate: -1 })
            .skip((page - 1) * limit)
            .limit(limit);

        res.json({
            semesters,
            total,
            page,
            pages: Math.ceil(total / limit),
        });
    } catch (err) {
        res.status(500).json({ msg: "Error loading semesters" });
    }
});


router.put("/:id", async (req, res) => {
    try {
        const { active } = req.body;

        // If setting this semester to active, deactivate others
        if (active === true) {
            await Semester.updateMany({}, { $set: { active: false } });
        }

        const updated = await Semester.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true }
        );

        res.json({ msg: "Semester updated", semester: updated });
    } catch (err) {
        res.status(400).json({ msg: err.message });
    }
});


router.put("/activate/:id", async (req, res) => {
    try {
        await Semester.updateMany({}, { active: false });
        const semester = await Semester.findByIdAndUpdate(
            req.params.id,
            { active: true },
            { new: true }
        );

        res.json({ msg: "Semester activated", semester });
    } catch (err) {
        res.status(400).json({ msg: err.message });
    }
});


module.exports = router;
