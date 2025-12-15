const mongoose = require("mongoose");
const dotenv = require("dotenv");
const User = require("../models/User");  // Adjust the path to your User model

dotenv.config();

const MONGO_URI = process.env.MONGO_URI; // your MongoDB connection string

async function revertMigration() {
  try {
    // Step 1: Connect to the database
    await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log("Connected to MongoDB");

    // Step 2: Find all users and clear the faceDescriptor
    const users = await User.find({ faceDescriptor: { $exists: true } });
    
    if (!users.length) {
      console.log("No users found with faceDescriptor field.");
      return;
    }

    // Step 3: Remove the faceDescriptor from all users
    for (let user of users) {
      user.faceDescriptor = [];  // Reset faceDescriptor
      user.faceImage = null;  // Optionally reset faceImage as well
      await user.save();
      console.log(`Cleared faceDescriptor for user: ${user.email}`);
    }

    console.log("Migration reverted! All face descriptors cleared.");
  } catch (err) {
    console.error("Error during migration revert:", err);
  } finally {
    // Step 4: Close the database connection
    mongoose.connection.close();
  }
}

revertMigration();
