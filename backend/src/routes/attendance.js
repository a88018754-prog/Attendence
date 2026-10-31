import { Router } from 'express';
import ipRangeCheck from 'ip-range-check';
import requestIp from 'request-ip';
import Student from '../models/Student.js';
import Attendance from '../models/Attendance.js';
import { auth, adminOnly } from '../middleware/auth.js';
const router = Router();
const dateKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: process.env.ATTENDANCE_TIMEZONE || 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const timeParts = () => new Intl.DateTimeFormat('en-GB', { timeZone: process.env.ATTENDANCE_TIMEZONE || 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()).split(':').map(Number);
router.post('/mark', auth, async (req, res) => {
  try {
    const clientIp = requestIp.getClientIp(req)?.replace('::ffff:', '');
    const allowedRange = process.env.ALLOWED_IP_RANGE;
    if (!allowedRange || !ipRangeCheck(clientIp, allowedRange)) return res.status(403).json({ message: 'Attendance is only allowed when connected to institute Wi-Fi', clientIp });
    const student = await Student.findById(req.user.id);
    const { descriptor } = req.body;
    if (!student || !Array.isArray(descriptor) || descriptor.length !== 128 || student.faceDescriptor.length !== 128) return res.status(400).json({ message: 'Face data unavailable. Register your face first.' });
    const distance = Math.sqrt(descriptor.reduce((sum, v, i) => sum + (v - student.faceDescriptor[i]) ** 2, 0));
    if (distance > 0.48) return res.status(401).json({ message: 'Face not recognized. Please try again.' });
    const [hour, minute] = timeParts(); const minutes = hour * 60 + minute;
    if (minutes >= 600) return res.status(403).json({ message: 'Attendance is closed after 10:00 AM' });
    const status = minutes < 570 ? 'Present' : 'Late';
    const record = await Attendance.create({ student: student._id, studentId: student.studentId, date: dateKey(), status });
    req.app.get('io').emit('attendance:marked', { studentName: student.name, studentId: student.studentId, status, date: record.date, markedAt: record.markedAt });
    res.status(201).json({ message: `Face detected. Attendance marked successfully as ${status}.`, attendance: record });
  } catch (e) { res.status(409).json({ message: e.code === 11000 ? 'Attendance already recorded for today' : e.message }); }
});
router.get('/mine', auth, async (req, res) => res.json(await Attendance.find({ student: req.user.id }).sort({ date: -1 })));
router.get('/admin/summary', auth, adminOnly, async (req, res) => {
  const date = req.query.date || dateKey();
  const students = await Student.countDocuments({ role: 'student' });
  const records = await Attendance.find({ date });
  const present = records.filter(x => x.status === 'Present').length;
  const late = records.filter(x => x.status === 'Late').length;
  res.json({ date, totalStudents: students, present, late, absent: Math.max(0, students - present - late), records });
});
router.get('/admin/students', auth, adminOnly, async (req, res) => res.json(await Student.find({ role: 'student' }).select('-passwordHash -faceDescriptor').sort({ name: 1 })));
router.get('/admin/export', auth, adminOnly, async (req, res) => {
  const date = req.query.date || dateKey();
  const rows = await Attendance.find({ date }).populate('student', 'name email course');
  const csv = ['Student ID,Name,Email,Course,Date,Status,Marked At', ...rows.map(r => [r.studentId, r.student?.name, r.student?.email, r.student?.course, r.date, r.status, r.markedAt.toISOString()].map(v => `"${String(v ?? '').replaceAll('"','""')}"`).join(','))].join('\n');
  res.header('Content-Type', 'text/csv').attachment(`attendance-${date}.csv`).send(csv);
});
export default router;
