import mongoose from 'mongoose';
const studentSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  studentId: { type: String, required: true, unique: true, trim: true },
  course: { type: String, required: true },
  passwordHash: { type: String, required: true },
  faceDescriptor: { type: [Number], default: [] },
  role: { type: String, enum: ['student', 'admin'], default: 'student' }
}, { timestamps: true });
export default mongoose.model('Student', studentSchema);
