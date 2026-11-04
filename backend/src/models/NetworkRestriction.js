import mongoose from 'mongoose';

const networkRestrictionSchema = new mongoose.Schema({
  _id: { type: String, default: 'qleap-authorized-network' },
  ranges: { type: [String], required: true, default: [] },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
}, { timestamps: true });

export default mongoose.model('NetworkRestriction', networkRestrictionSchema);
