import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Student from '../models/Student.js';
const router = Router();
const tokenFor = user => jwt.sign({ id: user._id, role: user.role, studentId: user.studentId }, process.env.JWT_SECRET, { expiresIn: '1d' });
router.post('/register', async (req, res) => {
  try {
    const { name, email, studentId, course, password, faceDescriptor } = req.body;
    if (!name || !email || !studentId || !course || !password) return res.status(400).json({ message: 'All fields are required' });
    if (!Array.isArray(faceDescriptor) || faceDescriptor.length !== 128) return res.status(400).json({ message: 'Please register your face first (128-number descriptor required)' });
    const passwordHash = await bcrypt.hash(password, 12);
    const student = await Student.create({ name, email, studentId, course, passwordHash, faceDescriptor });
    res.status(201).json({ message: 'Registration successful', token: tokenFor(student), user: { id: student._id, name, email, studentId, course, role: student.role } });
  } catch (e) { res.status(400).json({ message: e.code === 11000 ? 'Email or Student ID already registered' : e.message }); }
});
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await Student.findOne({ email: email?.toLowerCase() });
  if (!user || !(await bcrypt.compare(password || '', user.passwordHash))) return res.status(401).json({ message: 'Invalid email or password' });
  res.json({ token: tokenFor(user), user: { id: user._id, name: user.name, email: user.email, studentId: user.studentId, course: user.course, role: user.role } });
});
export default router;
