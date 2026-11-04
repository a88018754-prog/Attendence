import { Router } from 'express';
import ipRangeCheck from 'ip-range-check';
import Student from '../models/Student.js';
import Attendance from '../models/Attendance.js';
import { auth, adminOnly } from '../middleware/auth.js';
const router = Router();
const dateKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: process.env.ATTENDANCE_TIMEZONE || 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const timeParts = () => new Intl.DateTimeFormat('en-GB', { timeZone: process.env.ATTENDANCE_TIMEZONE || 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()).split(':').map(Number);
const clientIpFor = req => req.ip?.replace(/^::ffff:/, '');
router.post('/mark', auth, async (req, res) => {
  try {
    const clientIp = clientIpFor(req);
    const allowedRanges = (process.env.ALLOWED_IP_RANGE || '')
      .split(',')
      .map(range => range.trim())
      .filter(Boolean);
    if (allowedRanges.length && (!clientIp || !ipRangeCheck(clientIp, allowedRanges))) {
      return res.status(403).json({
        message: 'Attendance is only allowed when connected to institute WiFi',
        clientIp,
      });
    }
    const student = await Student.findById(req.user.id);
    const { descriptor } = req.body;
    if (!student || !Array.isArray(descriptor) || descriptor.length !== 128 || student.faceDescriptor.length !== 128) return res.status(400).json({ message: 'Face data unavailable. Register your face first.' });
    const distance = Math.sqrt(descriptor.reduce((sum, v, i) => sum + (v - student.faceDescriptor[i]) ** 2, 0));
    if (distance > 0.48) return res.status(401).json({ message: 'Face not recognized. Please try again.' });
    const [hour, minute] = timeParts(); const minutes = hour * 60 + minute;
    const status = minutes < 570 ? 'Present' : 'Late';
    const date = dateKey();
    let record = await Attendance.findOneAndUpdate(
      { student: student._id, date, status: 'Absent' },
      { $set: { status, clientIp, markedAt: new Date() } },
      { new: true },
    );
    if (!record) {
      const existing = await Attendance.findOneAndUpdate(
        { student: student._id, date },
        { $set: { clientIp } },
        { new: true },
      );
      if (existing) {
        return res.status(409).json({
          message: 'Attendance already recorded for today',
          attendance: existing,
        });
      }
      record = await Attendance.create({ student: student._id, studentId: student.studentId, date, status, clientIp });
    }
    req.app.get('io').emit('attendance:marked', { studentName: student.name, studentId: student.studentId, status, date: record.date, markedAt: record.markedAt });
    res.status(201).json({ message: `Face detected. Attendance marked successfully as ${status}.`, attendance: record });
  } catch (e) {
    if (e.code === 11000) {
      const clientIp = clientIpFor(req);
      const attendance = await Attendance.findOneAndUpdate(
        { student: req.user.id, date: dateKey() },
        { $set: { clientIp } },
        { new: true },
      );
      return res.status(409).json({
        message: 'Attendance already recorded for today',
        ...(attendance && { attendance }),
      });
    }
    res.status(409).json({ message: e.message });
  }
});
router.get('/mine', auth, async (req, res) => {
  const records = await Attendance.find({ student: req.user.id }).sort({ date: -1 }).lean();
  res.json(records);
});
router.get('/my-ip', auth, (req, res) => {
  const clientIp = clientIpFor(req);
  if (!clientIp) {
    return res.status(503).json({ message: 'Could not determine your connection IP address.' });
  }
  res.json({ ip: clientIp });
});
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
  const csv = ['Student ID,Name,Email,Course,Date,Status,Marked At,IP Address', ...rows.map(r => [r.studentId, r.student?.name, r.student?.email, r.student?.course, r.date, r.status, r.markedAt.toISOString(), r.clientIp].map(v => `"${String(v ?? '').replaceAll('"','""')}"`).join(','))].join('\n');
  res.header('Content-Type', 'text/csv').attachment(`attendance-${date}.csv`).send(csv);
});
export default router;
