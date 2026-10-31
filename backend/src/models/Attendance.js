import mongoose from 'mongoose';
const attendanceSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  studentId: { type: String, required: true },
  date: { type: String, required: true },
  status: { type: String, enum: ['Present', 'Late', 'Absent'], required: true },
  markedAt: { type: Date, default: Date.now }
}, { timestamps: true });
attendanceSchema.index({ student: 1, date: 1 }, { unique: true });
export default mongoose.model('Attendance', attendanceSchema);
