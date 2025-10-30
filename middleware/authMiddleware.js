// middleware/authMiddleware.js
const jwt = require("jsonwebtoken");
const User = require("../models/User");

// ======================= AUTH MIDDLEWARE ======================= //
async function auth(req, res, next) {
  try {
    let token;

    // 1️⃣ Check Authorization header
    const authHeader = req.header("Authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
      console.log("🔹 Token found in Authorization header");
    }

    // 2️⃣ Fallback: check HttpOnly cookie
    if (!token && req.cookies?.token) {
      token = req.cookies.token;
      console.log("🔹 Token found in cookie");
    }

    // 3️⃣ No token provided
    if (!token) {
      console.warn("⚠️ No token provided in header or cookie");
      return res.status(401).json({ msg: "No token provided" });
    }

    // 4️⃣ Verify JWT
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      console.error("❌ JWT verification failed:", err.message);
      return res.status(401).json({ msg: "Invalid or expired token" });
    }

    // 5️⃣ Fetch user
    const user = await User.findById(decoded.id).select("-password");
    if (!user) {
      console.warn("⚠️ User not found for token");
      return res.status(404).json({ msg: "User not found" });
    }

    // 6️⃣ Normalize role and attach to request
    user.role = (user.role || "").toLowerCase();
    req.user = user;

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
