const mongoose = require("mongoose");

const sessionSchema = new mongoose.Schema({
  course: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Course",
    required: true,
  },



  // semester
  semester: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Semester",
    required: true,
  },

  teacher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },

  // The main session token (used for session reference)
  token: {
    type: String,
    required: function () { return this.type === "QR"; }, // ✅ required only for QR
    unique: true,
  },


  // When the session itself expires (10 mins after creation)
  expiresAt: {
    type: Date,
    required: true,
  },

  type: {
    type: String,
    enum: ["QR", "MANUAL", "ROLLCALL"],
    required: true,
    set: v => v.toUpperCase(),
  },


  status: {
    type: String,
    enum: ["active", "expired", "cancelled"],
    default: "active",
  },

  cancelledAt: {
    type: Date,
  },

  cancelReason: {
    type: String,
    trim: true,
  },


  location: {
    lat: {
      type: Number,
      required: function () {
        return this.type === "QR";
      },
    },
    lng: {
      type: Number,
      required: function () {
        return this.type === "QR";
      },
    },
    radius: {
      type: Number,
      default: 60,
    },
    accuracy: {
      type: Number,
      default: 50,
    },

  },

  locationLockedAt: {
    type: Date,
  },


  // Store the rotating QR tokens (each valid for ~10 seconds)
  validTokens: [
    {
      token: String,
      expiresAt: Date,
    },
  ],

},
  { timestamps: true }
);

// Clean expired QR tokens automatically
sessionSchema.methods.cleanExpiredTokens = function () {
  const now = new Date();
  this.validTokens = this.validTokens.filter(
    (t) => t.expiresAt > now
  );
  return this.save();
};

// Add a new rotating token
sessionSchema.methods.addNewToken = async function (token, durationMs = 10000) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationMs);
  this.validTokens.push({ token, expiresAt });
  await this.cleanExpiredTokens(); // Keep array fresh
  return this.save();
};

// Check if a provided token is currently valid
sessionSchema.methods.isTokenValid = function (token) {
  const now = new Date();
  return this.validTokens.some(
    (t) => t.token === token && t.expiresAt > now
  );
};

sessionSchema.pre("save", function (next) {
  if (this.type !== "QR") {
    this.location = undefined;
  }
  next();
});

sessionSchema.pre("save", function (next) {
  if (
    this.locationLockedAt &&
    !this.isNew &&
    (
      this.isModified("location.lat") ||
      this.isModified("location.lng") ||
      this.isModified("location.radius") ||
      this.isModified("location.accuracy")
    )
  ) {
    return next(new Error("Session location is immutable"));
  }
  next();
});




module.exports = mongoose.model("Session", sessionSchema);
