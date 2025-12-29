const dotenv = require("dotenv");
dotenv.config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

// Route imports
const authRoutes = require("./routes/authRoutes");
const adminRoutes = require("./routes/adminRoutes");
const courseRoutes = require("./routes/courseRoutes");
const attendanceRoutes = require("./routes/attendanceRoutes"); // ✅ Attendance route
const sessionRoutes = require("./routes/sessionRoutes");
const departmentRoutes = require("./routes/departmentRoutes");
const profileRoutes = require("./routes/profile");
const semestersRouter = require("./routes/semesters");
const sessionX = require("./routes/session");
const settingsRoutes = require("./routes/settings");





// Load environment variables
console.log("🧩 ENV TEST:", process.env.EMAIL_USER, process.env.EMAIL_PASS ? "PASS_FOUND" : "NO_PASS");


// Initialize app
const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));


// Test route
app.get("/", (req, res) => {
  res.send("API is running...");
});

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/courses", courseRoutes);
app.use("/api/attendance", attendanceRoutes); // ✅ Ensure attendance route is available
app.use("/api/sessions", sessionRoutes);
app.use("/api/departments", departmentRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/leaderboard", require("./routes/leaderboardRoutes"));
app.use("/api/semesters", semestersRouter);
// existing API prefix
app.use("/api/session", sessionX);
app.use("/api/settings", settingsRoutes);




// Database connection & server start
const PORT = process.env.PORT || 5000;

mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    console.log("✅ MongoDB Connected");
    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
  })
  .catch((err) => console.error("❌ DB Connection Error:", err));
