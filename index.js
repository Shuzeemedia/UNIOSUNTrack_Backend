const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");

// Route imports
const authRoutes = require("./routes/authRoutes");
const adminRoutes = require("./routes/adminRoutes");
const courseRoutes = require("./routes/courseRoutes");
const attendanceRoutes = require("./routes/attendanceRoutes"); // ✅ Attendance route
const sessionRoutes = require("./routes/sessionRoutes");
const departmentRoutes = require("./routes/departmentRoutes");
const profileRoutes = require("./routes/profile");

// Load environment variables
dotenv.config();

console.log(
  "🧩 ENV TEST:",
  process.env.EMAIL_USER,
  process.env.EMAIL_PASS ? "PASS_FOUND" : "NO_PASS"
);

// Initialize app
const app = express();

// Middleware: CORS for local & live deployments
const allowedOrigins = [process.env.FRONTEND_URL];
if (process.env.NODE_ENV !== "production") {
  allowedOrigins.push("http://localhost:3000");
}

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());

// Test route
app.get("/", (req, res) => {
  res.send("API is running...");
});

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/courses", courseRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/departments", departmentRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/leaderboard", require("./routes/leaderboardRoutes"));

// Error-handling middleware
app.use((err, req, res, next) => {
  console.error("🔥 Error middleware:", err.message || err);
  res.status(500).json({ msg: "Server error", error: err.message || err });
});

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
