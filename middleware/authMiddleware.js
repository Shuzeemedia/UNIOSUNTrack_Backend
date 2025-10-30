// middleware/authMiddleware.js
const jwt = require("jsonwebtoken");
const User = require("../models/User");

// ======================= AUTH MIDDLEWARE ======================= //
async function auth(req, res, next) {
  try {
    const authHeader = req.header("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ msg: "Authorization header missing or invalid" });
    }

    const token = authHeader.split(" ")[1];
    if (!token) {
      return res.status(401).json({ msg: "No token provided" });
    }

    // Verify JWT
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      console.error("❌ JWT verification failed:", err.message);
      return res.status(401).json({ msg: "Invalid or expired token" });
    }

    // Fetch user
    const user = await User.findById(decoded.id).select("-password");
    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    // Normalize role
    user.role = (user.role || "").toLowerCase();

    // Attach user to request
    req.user = user;

    // Debug Log
    console.log(`✅ Authenticated: ${user.name || user.email} | Role: ${user.role} | ID: ${user._id}`);

    next();
  } catch (err) {
    console.error("❌ Auth middleware error:", err.message);
    res.status(500).json({ msg: "Server error during authentication" });
  }
}

// ======================= ROLE CHECK MIDDLEWARE ======================= //
function roleCheck(allowedRoles = []) {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({ msg: "User role not found or unauthorized" });
    }

    const userRole = req.user.role.toLowerCase();
    const isAllowed = allowedRoles.map(r => r.toLowerCase()).includes(userRole);

    if (!isAllowed) {
      console.warn(`🚫 Access denied for ${req.user.name || req.user.email} | Role: ${userRole}`);
      return res.status(403).json({ msg: "Access denied" });
    }

    next();
  };
}

module.exports = { auth, roleCheck };
