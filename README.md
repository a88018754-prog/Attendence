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

Generate a secret with `node -p "require('crypto').randomBytes(48).toString('base64url')"` and put it in `.env` as `JWT_SECRET`. Set your MongoDB URI and admin credentials. `ALLOWED_IP_RANGE=127.0.0.1/32,::1/128` permits only local requests for development; replace it with the institute's actual allowed IP/CIDR. The example private network `192.168.0.0`–`192.168.0.255` is written as `192.168.0.0/24` and works when the backend can see campus device addresses directly. For a cloud-hosted backend such as Render, configure the institute's public egress IP/CIDR instead, because the router hides private `192.168.x.x` addresses. Multiple IPv4/IPv6 ranges may be comma-separated. The server will refuse to start if `JWT_SECRET` is missing.

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
- The `ALLOWED_IP_RANGE` setting is optional. When unset or blank, requests from any network pass the IP gate; when configured with one or more comma-separated IP/CIDR ranges, the backend enforces them. Face verification and authentication remain required in either mode.
- IP checks use Express's resolved client IP, not arbitrary client-supplied forwarding headers. `TRUST_PROXY_HOPS` defaults to `0`; set it to the exact number of trusted reverse proxies in front of the backend (for the Render web service's single ingress proxy, use `1`). Never use `true` or a hop count that exceeds the real proxy chain.
- Browser-based face descriptors are not liveness detection; a photo/video spoof may be possible. Add liveness checks and review false-accept/false-reject thresholds for production.
- Admin account credentials are seeded from environment variables. Change the sample password immediately.
- Attendance can be marked throughout the day: before 9:30 AM is `Present`, and from 9:30 AM onward is `Late`. The 10:30 AM absent job uses the configured timezone; a later successful face verification updates that day's `Absent` entry to `Late`. For reliable deployment, use a single scheduler/worker and monitor job execution.
- `Attendance` has a unique index on student + date to prevent duplicates.
- For institute-only deployments, set `ALLOWED_IP_RANGE` to the institute's public egress IP/CIDR. The private example range `192.168.0.0/24` will not match a request sent over the public internet unless the backend is on the institute LAN/VPN. Set `TRUST_PROXY_HOPS` to the verified proxy-chain length; Render's single ingress proxy uses `1`.

## API overview

- `POST /api/auth/register` — student registration with 128-value face descriptor
- `POST /api/auth/login` — student/admin login
- `POST /api/attendance/mark` — authenticated face match, optional configured IP-range validation, and attendance status rules
- `GET /api/attendance/mine` — student's attendance history, including the recorded IP address
- `GET /api/attendance/my-ip` — authenticated IP address seen by the attendance server
- `GET /api/attendance/admin/summary` — admin daily statistics and records
- `GET /api/attendance/admin/students` — admin student list
- `GET /api/attendance/admin/export` — admin CSV export, including the full recorded IP address
