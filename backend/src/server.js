import "dotenv/config";
import express from "express";
import http from "http";
import cors from "cors";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import cron from "node-cron";
import { Server } from "socket.io";
import Student from "./models/Student.js";
import Attendance from "./models/Attendance.js";
import authRoutes from "./routes/auth.js";
import attendanceRoutes from "./routes/attendance.js";
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CLIENT_URL || "http://localhost:5173" },
});
app.set("io", io);
app.use(cors({ origin: process.env.CLIENT_URL || "http://localhost:5173" }));
app.use(express.json({ limit: "1mb" }));
app.get("/api/health", (_, res) => res.json({ status: "ok" }));
app.use("/api/auth", authRoutes);
app.use("/api/attendance", attendanceRoutes);
async function seedAdmin() {
  const email = (process.env.ADMIN_EMAIL || "admin@gmail.com").toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "123456";
  const existingByEmail = await Student.findOne({ email });
  const existingAdmin =
    existingByEmail || (await Student.findOne({ role: "admin" }));

  if (existingAdmin) {
    const passwordHash = await bcrypt.hash(password, 12);
    await Student.findByIdAndUpdate(
      existingAdmin._id,
      {
        name: "Administrator",
        email,
        studentId: "ADMIN001",
        course: "Administration",
        role: "admin",
        passwordHash,
      },
      { new: true },
    );
    return;
  }

  await Student.create({
    name: "Administrator",
    email,
    studentId: "ADMIN001",
    course: "Administration",
    passwordHash: await bcrypt.hash(password, 12),
    role: "admin",
  });
}
async function seedDemoStudent() {
  const email = (
    process.env.STUDENT_EMAIL || "student@gmail.com"
  ).toLowerCase();
  const password = process.env.STUDENT_PASSWORD || "123456";
  await Student.findOneAndUpdate(
    { email },
    {
      name: "Demo Student",
      email,
      studentId: "STU-DEMO-001",
      course: "Computer Science",
      passwordHash: await bcrypt.hash(password, 12),
      role: "student",
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
}
// Runs every day at 10:30 AM in the configured timezone. Unique student/date index prevents duplicates.
cron.schedule(
  "30 10 * * *",
  async () => {
    try {
      const date = new Intl.DateTimeFormat("en-CA", {
        timeZone: process.env.ATTENDANCE_TIMEZONE || "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      const students = await Student.find({ role: "student" }).select(
        "_id studentId",
      );
      const existing = await Attendance.find({ date }).distinct("student");
      const existingSet = new Set(existing.map(String));
      const absent = students
        .filter((s) => !existingSet.has(String(s._id)))
        .map((s) => ({
          student: s._id,
          studentId: s.studentId,
          date,
          status: "Absent",
        }));
      if (absent.length)
        await Attendance.insertMany(absent, { ordered: false });
      io.emit("attendance:absent-job", { date, count: absent.length });
    } catch (e) {
      console.error("Absent job failed:", e.message);
    }
  },
  { timezone: process.env.ATTENDANCE_TIMEZONE || "Asia/Kolkata" },
);
const port = process.env.PORT || 5000;
mongoose
  .connect(process.env.MONGO_URI)
  .then(async () => {
    await seedAdmin();
    await seedDemoStudent();
    server.listen(port, () =>
      console.log(`API running at http://localhost:${port}`),
    );
  })
  .catch((e) => {
    console.error("MongoDB connection failed:", e.message);
    process.exit(1);
  });
