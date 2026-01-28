// In models/User.js

const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    studentId: { type: String, unique: true, sparse: true },
    department: { type: mongoose.Schema.Types.ObjectId, ref: "Department" },
    level: { type: Number },
    graduated: {
      type: Boolean,
      default: false,
    },

    graduationDate: {
      type: Date,
    },

    graduationVerified: {
      type: Boolean,
      default: false,
    },


    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: {
      type: String,
      enum: ["student", "teacher", "admin"],
      default: "student",
    },
    googleId: { type: String },
    profileImage: { type: String },

    // Email verification
    isVerified: { type: Boolean, default: false },
    verificationToken: { type: String },

    // Forgot password reset
    resetPasswordToken: { type: String },
    resetPasswordExpires: { type: Date },

    gpsAllowed: { type: Boolean, default: false },
    faceImage: { type: String }, // path to stored face image
    faceDescriptor: { type: [Number], default: [] },

    authenticator: {
      credID: { type: String },       // Credential ID (base64)
      publicKey: { type: String },    // Public key
      counter: { type: Number },      // Signature counter
    },

  },
  { timestamps: true }
);

module.exports = mongoose.model("User", UserSchema);
