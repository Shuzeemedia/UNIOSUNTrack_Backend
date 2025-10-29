// models/Department.js
const mongoose = require("mongoose");

const DepartmentSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true }, // e.g. Software Engineering
  levels: [{ type: Number }], // e.g. [1, 2, 3, 4]
});

module.exports = mongoose.model("Department", DepartmentSchema);
