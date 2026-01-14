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
const alumniRoutes = require("./routes/alumni");
const adminGraduation = require("./routes/adminGraduation");


// store socket instance so routes can use it


const { startAutoExpireLoop } = require("./utils/autoExpireSessions");



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
app.use("/api/alumni", alumniRoutes);
app.use("/api/admin", adminGraduation);





// === ADD SOCKET + HTTP SERVER HERE ===
const httpServer = require("http").createServer(app);
const io = require("socket.io")(httpServer, {
  cors: { origin: "*" }
});

// store socket instance so routes can use it
app.set("io", io);
// =====================================



// === GLOBAL SAFETY GUARDS (prevents server crash) ===
process.on("uncaughtException", (err) => {
  console.error("💥 Uncaught Exception:", err.message);
});

process.on("unhandledRejection", (err) => {
  console.error("⚠️ Unhandled Rejection:", err.message);
});

// === MONGOOSE CONNECTION GUARDS (auto reconnect) ===
mongoose.connection.on("disconnected", () => {
  console.log("🔴 MongoDB disconnected! Trying to reconnect...");
  setTimeout(() => {
    mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    }).catch(e => console.log("♻️ Reconnect failed:", e.message));
  }, 3000);
});

mongoose.connection.on("error", (err) => {
  console.log("🟠 MongoDB Error (caught):", err.message);
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

    //DELETE this line if you see it: app.listen(PORT, ...)

    // Add this instead:
    httpServer.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

    io.on("connection", (socket) => {
      console.log("🔌 Client connected:", socket.id);

      socket.on("join-course", (courseId) => {
        if (!courseId) return;
        socket.join(courseId);
        console.log(`📌 Socket ${socket.id} joined course ${courseId}`);
      });

      socket.on("leave-course", (courseId) => {
        if (!courseId) return;
        socket.leave(courseId);
        console.log(`📤 Socket ${socket.id} left course ${courseId}`);
      });

      socket.on("disconnect", () => {
        console.log("❌ Socket disconnected:", socket.id);
      });
    });

  })

  .catch((err) => console.error("❌ DB Connection Error:", err));

startAutoExpireLoop();

