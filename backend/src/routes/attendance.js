import { Router } from 'express';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import ipRangeCheck from 'ip-range-check';
import Student from '../models/Student.js';
import Attendance from '../models/Attendance.js';
import NetworkRestriction from '../models/NetworkRestriction.js';
import { auth, adminOnly } from '../middleware/auth.js';
import { getPublicClientIp } from '../utils/clientIp.js';
const router = Router();
const NETWORK_RESTRICTION_ID = 'qleap-authorized-network';
const dateKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: process.env.ATTENDANCE_TIMEZONE || 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const timeParts = () => new Intl.DateTimeFormat('en-GB', { timeZone: process.env.ATTENDANCE_TIMEZONE || 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()).split(':').map(Number);
const clientIpFor = req => getPublicClientIp(req).ip;
const IP_DETECTION_FAILURE_MESSAGE =
  'Unable to verify your network. Please try again or contact the administrator.';
function parseNetworkRanges(value) {
  if (!Array.isArray(value) || value.length > 20 || value.some(range => typeof range !== 'string')) {
    return null;
  }

  const ranges = [];
  for (const inputRange of value.map(range => range.trim()).filter(Boolean)) {
    const [address, prefix, ...extra] = inputRange.split('/');
    if (!isIP(address)) return null;
    let parsedAddress;
    try {
      parsedAddress = ipaddr.parse(address);
    } catch {
      return null;
    }

    if (extra.length > 0) return null;
    if (prefix !== undefined) {
      const maxPrefix = parsedAddress.kind() === 'ipv4' ? 32 : 128;
      if (!/^\d+$/.test(prefix) || Number(prefix) > maxPrefix) return null;
    }

    let normalizedPrefix = prefix === undefined ? undefined : Number(prefix);
    if (parsedAddress.kind() === 'ipv6' && parsedAddress.isIPv4MappedAddress()) {
      if (normalizedPrefix !== undefined && normalizedPrefix < 96) return null;
      parsedAddress = parsedAddress.toIPv4Address();
      if (normalizedPrefix !== undefined) normalizedPrefix -= 96;
    }
    if (parsedAddress.range() !== 'unicast') return null;

    const normalizedRange = `${parsedAddress.toString()}${normalizedPrefix === undefined ? '' : `/${normalizedPrefix}`}`;
    ranges.push(normalizedRange);
  }

  return [...new Set(ranges)];
}

function forwardedForCandidatesForDiagnostics(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor !== 'string') return [];

  return forwardedFor
    .slice(0, 2048)
    .split(',')
    .slice(0, 8)
    .map(address => address.trim())
    .filter(address => isIP(address))
    .map(address => ipaddr.process(address).toString());
}

router.get('/admin/network-restriction', auth, adminOnly, async (_req, res) => {
  try {
    const config = await NetworkRestriction.findById(NETWORK_RESTRICTION_ID).lean();
    const ranges = config?.ranges || [];
    res.json({
      ranges,
      configured: ranges.length > 0,
      updatedAt: config?.updatedAt || null,
    });
  } catch (error) {
    console.error('Failed to read authorized network configuration:', error.message);
    res.status(500).json({ message: 'Unable to load authorized network configuration.' });
  }
});

router.put('/admin/network-restriction', auth, adminOnly, async (req, res) => {
  try {
    const ranges = parseNetworkRanges(req.body?.ranges);
    if (ranges === null) {
      return res.status(400).json({
        message: 'Enter up to 20 valid public IP addresses or CIDR ranges.',
      });
    }

    const config = await NetworkRestriction.findOneAndUpdate(
      { _id: NETWORK_RESTRICTION_ID },
      { $set: { ranges, updatedBy: req.user.id } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    );
    res.json({
      ranges: config.ranges,
      configured: config.ranges.length > 0,
      updatedAt: config.updatedAt,
    });
  } catch (error) {
    console.error('Failed to save authorized network configuration:', error.message);
    res.status(500).json({ message: 'Unable to save authorized network configuration.' });
  }
});

router.get('/demo-mode', auth, (req, res) => {
  res.json({ enabled: Boolean(req.app.locals.attendanceDemoMode) });
});

router.post('/mark', auth, async (req, res) => {
  let clientIp = '';
  try {
    const demoMode = Boolean(req.app.locals.attendanceDemoMode);
    const networkConfig = await NetworkRestriction.findById(NETWORK_RESTRICTION_ID)
      .select('ranges')
      .lean();
    const allowedRanges = networkConfig?.ranges || [];
    let clientDetection = {
      ip: null,
      detectedIp: null,
      reason: allowedRanges.length ? 'unavailable' : 'not-required',
    };

    if (allowedRanges.length && demoMode) {
      const simulatedIp = req.body?.demoClientIp;
      if (typeof simulatedIp !== 'string' || !isIP(simulatedIp)) {
        return res.status(400).json({
          message: 'Enter a valid public IP address for the staging demo.',
        });
      }
      try {
        const simulatedAddress = ipaddr.process(simulatedIp);
        if (simulatedAddress.range() !== 'unicast') {
          return res.status(400).json({
            message: 'The staging demo requires a public IP address.',
          });
        }
        clientIp = simulatedAddress.toString();
        clientDetection = {
          ip: clientIp,
          detectedIp: clientIp,
          reason: null,
        };
      } catch {
        return res.status(400).json({
          message: 'Enter a valid public IP address for the staging demo.',
        });
      }
    } else if (allowedRanges.length) {
      clientDetection = getPublicClientIp(req);
      clientIp = clientDetection.ip;
    }
    const networkMatched = Boolean(
      !allowedRanges.length ||
        (clientDetection.ip && ipRangeCheck(clientIp, allowedRanges)),
    );
    console.info('[attendance-network-check]', JSON.stringify({
      mode: demoMode
        ? allowedRanges.length
          ? 'staging-demo-simulated'
          : 'staging-demo-unrestricted'
        : 'production',
      networkRestrictionConfigured: allowedRanges.length > 0,
      detectedIp: clientDetection.detectedIp,
      clientIp: clientIp || null,
      clientIpVersion: clientIp ? ipaddr.parse(clientIp).kind() : null,
      detectionFailure: clientDetection.reason,
      socketRemoteAddress: req.socket.remoteAddress || null,
      trustedProxyChain: req.ips,
      untrustedForwardedForForDiagnosticsOnly:
        forwardedForCandidatesForDiagnostics(req),
      trustedProxyHops: req.app.get('trust proxy'),
      authorizedRanges: allowedRanges,
      matched: networkMatched,
    }));
    if (allowedRanges.length && !clientIp) {
      return res.status(503).json({ message: IP_DETECTION_FAILURE_MESSAGE });
    }
    if (allowedRanges.length && !networkMatched) {
      return res.status(403).json({
        message: 'Attendance is not allowed from this network.',
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
      {
        $set: {
          status,
          clientIp,
          markedAt: new Date(),
          ...(demoMode && { demo: true }),
        },
      },
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
      record = await Attendance.create({
        student: student._id,
        studentId: student.studentId,
        date,
        status,
        clientIp,
        demo: demoMode,
      });
    }
    req.app.get('io').emit('attendance:marked', { studentName: student.name, studentId: student.studentId, status, date: record.date, markedAt: record.markedAt });
    res.status(201).json({
      message: demoMode
        ? 'DEMO ONLY: simulated attendance marked in the staging database.'
        : 'Attendance marked successfully.',
      attendance: record,
    });
  } catch (e) {
    if (e.code === 11000) {
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
    return res.status(503).json({ message: IP_DETECTION_FAILURE_MESSAGE });
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
