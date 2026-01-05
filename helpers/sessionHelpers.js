// helpers/sessionHelpers.js
const Attendance = require("../models/Attendance");
const Course = require("../models/Course");
const { getLocalDayKey } = require("../utils/dayKey");

async function markAbsenteesForSession(session) {
  let course;
  if (session.course.name) {
    course = session.course;
  } else {
    course = await Course.findById(session.course)
      .populate("students", "_id")
      .populate("semester");
  }

  if (!course || !course.students?.length) return;

  const allStudents = course.students.map(s => s._id.toString());
  const dayKey = getLocalDayKey(session.createdAt || session.expiresAt || new Date());

  const presentStudents = await Attendance.find({
    session: session._id,
    status: "Present"
  }).distinct("student");

  const absentees = allStudents.filter(s => !presentStudents.includes(s));
  if (!absentees.length) return;

  const records = absentees.map(sid => ({
    course: course._id,
    student: sid,
    session: session._id,
    semester: course.semester,
    status: "Absent",
    dayKey,
    date: session.createdAt || new Date(),
  }));

  try {
    await Attendance.insertMany(records, { ordered: false });
    console.log(`✅ Absentees marked for session ${session._id}: ${records.length}`);
  } catch (err) {
    console.error("Error marking absentees:", err.message);
  }
}

async function endSession(session) {
  if (!session) return;
  if (session.status !== "expired") {
    session.status = "expired";
    session.expiresAt = new Date();
    await session.save();
  }
  await markAbsenteesForSession(session);
  console.log(`✅ Session ${session._id} ended and absentees marked.`);
}

module.exports = { markAbsenteesForSession, endSession };
