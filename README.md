# AttendAI — Smart Attendance MVP

A full-stack assignment starter implementing student/admin login, face descriptor registration, face matching, attendance time rules, IP-range restriction, duplicate prevention, admin statistics, CSV export, Socket.IO updates, and a 10:30 AM absent job.

## Requirements

- Node.js 20+ (LTS)
- MongoDB Community Server running locally, or a MongoDB Atlas URI
- Webcam and browser camera permission

## 1. Configure backend

```bash
cd backend
copy .env.example .env
```

Generate a secret with `node -p "require('crypto').randomBytes(48).toString('base64url')"` and put it in `.env` as `JWT_SECRET`. Set your MongoDB URI and admin credentials. The server will refuse to start if `JWT_SECRET` is missing. Network access is not configured through an environment variable: sign in as an admin and enter the authorized IP address or CIDR range in the admin panel. Leave it empty to deny attendance until configured. On Render, use the institute's public egress IP/CIDR; private ranges such as `192.168.0.0/24` are not visible through the college router. Multiple IPv4/IPv6 ranges may be comma-separated. For local development, configure the loopback address shown by the backend (usually `127.0.0.1/32` or `::1/128`).

Install and start:

```bash
npm install
npm run dev
```

Backend: `http://localhost:5000/api/health`

## 2. Configure frontend

Open a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

## 3. Add face-api.js model files

The browser face recognition code expects these files under `frontend/public/models/`:

- `tiny_face_detector_model-weights_manifest.json` and its shard file(s)
- `face_landmark_68_model-weights_manifest.json` and its shard file(s)
- `face_recognition_model-weights_manifest.json` and its shard file(s)

Download the matching model files from the face-api.js project's official weights/model repository and preserve the exact filenames and shard paths referenced by each JSON manifest. Do not rename shard files. The project intentionally does not bundle third-party model weights.

## Demo flow

1. Register a student; camera face descriptor is captured and stored.
2. Login as student and click “Mark attendance with face”.
3. Admin login uses `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env` (seeded on startup).
4. Demo student login uses `STUDENT_EMAIL` / `STUDENT_PASSWORD` from `.env`; defaults are `student@gmail.com` / `123456`.
5. Admin dashboard displays summary, records, registered students, and CSV export.

## Important limitations / before real deployment

- This is an educational MVP, not production biometric software. Use consent, retention rules, secure transport, access controls, and a privacy review before using real student biometrics.
- An administrator can configure an authorized network in the admin panel. When one or more IP/CIDR ranges are saved, the backend enforces them for every attendance request. If none are configured, attendance is allowed without IP verification and the record stores no client IP. Authentication, face verification, and duplicate prevention remain required. This is less restrictive; configure an authorized network to limit attendance by network.
- IP checks use Express's resolved client IP, not a client-supplied IP field or a separately fetched server egress address. Loopback and non-public addresses are rejected as unverifiable. Proxy trust defaults to `0` locally and is fixed at one trusted public ingress hop on Render; that ingress must provide the original client address for public-IP attendance checks to work. A `TRUST_PROXY_HOPS` value set in Render is ignored. Attendance network checks log the resolved IP, trusted proxy chain, configured ranges, and match result without logging request credentials.
- For an isolated presentation only, create a separate staging Render service and MongoDB database (with a database name ending in `-demo`), point the staging service's `MONGO_URI` at that database, and set `ATTENDANCE_DEMO_MODE=true`. The service refuses to start in demo mode with a database name that does not end in `-demo`. When an authorized range is configured, the student page can simulate an allow by entering the saved public IP, or a rejection by entering another public IP. Face verification and duplicate prevention still run, and created attendance rows are tagged `DEMO`. This is not a real network test: production ignores the simulated IP field and enforces configured ranges using the trusted server-resolved IP. With no authorized range configured, IP verification is skipped and no client IP is stored.
- Browser-based face descriptors are not liveness detection; a photo/video spoof may be possible. Add liveness checks and review false-accept/false-reject thresholds for production.
- Admin account credentials are seeded from environment variables. Change the sample password immediately.
- Attendance can be marked throughout the day: before 9:30 AM is `Present`, and from 9:30 AM onward is `Late`. The 10:30 AM absent job uses the configured timezone; a later successful face verification updates that day's `Absent` entry to `Late`. For reliable deployment, use a single scheduler/worker and monitor job execution.
- `Attendance` has a unique index on student + date to prevent duplicates.
- To restrict attendance by network, configure the institute's public egress IP/CIDR in the admin panel. A private range such as `192.168.0.0/24` will not match requests that reach Render over the public internet unless the backend is on the institute LAN/VPN. If network ranges are cleared, attendance remains available without IP verification.

## API overview

- `POST /api/auth/register` — student registration with 128-value face descriptor
- `POST /api/auth/login` — student/admin login
- `POST /api/attendance/mark` — authenticated face match, required configured IP-range validation, and attendance status rules
- `GET /api/attendance/mine` — student's attendance history, including the recorded IP address
- `GET /api/attendance/my-ip` — authenticated IP address seen by the attendance server
- `GET /api/attendance/admin/summary` — admin daily statistics and records
- `GET /api/attendance/admin/students` — admin student list
- `GET /api/attendance/admin/network-restriction` and `PUT /api/attendance/admin/network-restriction` — admin-only authorized network configuration
- `GET /api/attendance/admin/export` — admin CSV export, including the full recorded IP address
