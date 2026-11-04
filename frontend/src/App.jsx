import React, { useEffect, useRef, useState } from "react";
import { Routes, Route, Navigate, Link, useNavigate } from "react-router-dom";
import * as faceapi from "face-api.js";
import { io } from "socket.io-client";
import api from "./api";
const socket = io(import.meta.env.VITE_API_URL || "http://localhost:5000", {
  autoConnect: false,
});
let faceModelsPromise;

function loadFaceModels() {
  if (!faceModelsPromise) {
    faceModelsPromise = Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri("/models"),
      faceapi.nets.faceLandmark68Net.loadFromUri("/models"),
      faceapi.nets.faceRecognitionNet.loadFromUri("/models"),
    ]).catch((error) => {
      faceModelsPromise = null;
      throw new Error(
        `Could not load face recognition models from /models. ${error.message}`,
      );
    });
  }
  return faceModelsPromise;
}

function requestCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera access requires HTTPS or localhost.");
  }
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: "user" },
      width: { ideal: 640 },
      height: { ideal: 480 },
    },
  });
}

function waitForVideo(videoElement) {
  if (videoElement.readyState >= 2 && videoElement.videoWidth > 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let timeoutId;
    const cleanup = () => {
      clearTimeout(timeoutId);
      videoElement.removeEventListener("loadeddata", checkReady);
      videoElement.removeEventListener("playing", checkReady);
      videoElement.removeEventListener("error", handleError);
    };
    const checkReady = () => {
      if (videoElement.readyState >= 2 && videoElement.videoWidth > 0) {
        cleanup();
        resolve();
      }
    };
    const handleError = () => {
      cleanup();
      reject(new Error("The camera preview could not be started."));
    };

    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error("Camera did not start. Check camera permission and try again."));
    }, 10000);
    videoElement.addEventListener("loadeddata", checkReady);
    videoElement.addEventListener("playing", checkReady);
    videoElement.addEventListener("error", handleError);
    checkReady();
  });
}

function cameraErrorMessage(error) {
  if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
    return "Allow camera access in your browser settings, then try again.";
  }
  if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
    return "No camera was found. Connect a camera and try again.";
  }
  if (error.name === "NotReadableError" || error.name === "TrackStartError") {
    return "The camera is already in use by another app. Close it and try again.";
  }
  return error.message || "Could not start the camera.";
}

function stopStream(mediaStream) {
  mediaStream?.getTracks().forEach((track) => track.stop());
}

async function captureFaceDescriptor(videoElement) {
  await loadFaceModels();
  const options = new faceapi.TinyFaceDetectorOptions({
    inputSize: 416,
    scoreThreshold: 0.4,
  });
  const samples = [];

  for (let attempt = 0; attempt < 5 && samples.length < 3; attempt += 1) {
    const detections = await faceapi
      .detectAllFaces(videoElement, options)
      .withFaceLandmarks()
      .withFaceDescriptors();

    if (detections.length > 1) {
      throw new Error("More than one face detected. Make sure only you are in view.");
    }
    if (detections.length === 1) {
      samples.push(Array.from(detections[0].descriptor));
    }
    if (samples.length < 3) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  if (!samples.length) {
    throw new Error("No clear face detected. Face the camera in good lighting and try again.");
  }

  return samples[0].map(
    (_, index) =>
      samples.reduce((sum, sample) => sum + sample[index], 0) / samples.length,
  );
}

function getUser() {
  try {
    return JSON.parse(localStorage.getItem("user"));
  } catch {
    return null;
  }
}
function Guard({ children, admin = false }) {
  const u = getUser();
  return u ? (
    admin && u.role !== "admin" ? (
      <Navigate to="/student" />
    ) : (
      children
    )
  ) : (
    <Navigate to="/login" />
  );
}
function ThemeToggle({ theme, onToggleTheme }) {
  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={onToggleTheme}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      aria-pressed={theme === "dark"}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      role="switch"
      aria-checked={theme === "dark"}
    >
      <span className="theme-toggle-track" aria-hidden="true">
        <span className="theme-toggle-icon sun">☀</span>
        <span className="theme-toggle-icon moon">☾</span>
        <span className="theme-toggle-thumb" />
      </span>
    </button>
  );
}
function Welcome({ theme, onToggleTheme }) {
  const navigate = useNavigate();
  return (
    <main className="welcome">
      <div className="welcome-theme-toggle">
        <ThemeToggle theme={theme} onToggleTheme={onToggleTheme} />
      </div>
      <section className="welcome-content">
        <div className="welcome-brand">AttendAI</div>
        <button type="button" onClick={() => navigate("/login")}>
          Enter
        </button>
      </section>
    </main>
  );
}
function Nav({ theme, onToggleTheme }) {
  const u = getUser(),
    nav = useNavigate();
  return (
    <nav>
      <Link to="/" className="brand">
        ◉ AttendAI
      </Link>
      <div>
        <ThemeToggle theme={theme} onToggleTheme={onToggleTheme} />
        {u && (
          <>
            <span>{u.name}</span>
            <button
              className="secondary"
              onClick={() => {
                localStorage.clear();
                localStorage.setItem("theme", theme);
                nav("/login");
              }}
            >
              Logout
            </button>
          </>
        )}
      </div>
    </nav>
  );
}
function Auth({ register = false, theme, onToggleTheme }) {
  const [form, setForm] = useState({
      name: "",
      email: "",
      studentId: "",
      course: "",
      password: "",
    }),
    [face, setFace] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [capturing, setCapturing] = useState(false),
    [cameraReady, setCameraReady] = useState(false);
  const video = useRef(null),
    stream = useRef(null),
    nav = useNavigate();
  useEffect(() => {
    if (!register) return undefined;
    let active = true;
    let cameraStream;
    const videoElement = video.current;

    async function startCamera() {
      try {
        cameraStream = await requestCamera();
        if (!active) {
          stopStream(cameraStream);
          return;
        }
        videoElement.srcObject = cameraStream;
        await videoElement.play();
        await waitForVideo(videoElement);
        if (active) {
          stream.current = cameraStream;
          setCameraReady(true);
          setError("");
        }
      } catch (cameraError) {
        stopStream(cameraStream);
        if (active) {
          setCameraReady(false);
          setError(cameraErrorMessage(cameraError));
        }
      }
    }

    startCamera();
    return () => {
      active = false;
      stopStream(cameraStream);
      if (stream.current === cameraStream) stream.current = null;
      if (videoElement?.srcObject === cameraStream) {
        videoElement.srcObject = null;
      }
    };
  }, [register]);

  async function capture() {
    setCapturing(true);
    setError("");
    try {
      const descriptor = await captureFaceDescriptor(video.current);
      setFace(descriptor);
      setError("Face captured successfully.");
    } catch (captureError) {
      setError(captureError.message || "Face capture failed. Please try again.");
    } finally {
      setCapturing(false);
    }
  }
  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const endpoint = register ? "/auth/register" : "/auth/login";
      const body = register ? { ...form, faceDescriptor: face } : form;
      const { data } = await api.post(endpoint, body);
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      nav(data.user.role === "admin" ? "/admin" : "/student");
    } catch (e) {
      setError(e.response?.data?.message || "Could not connect to server.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth">
      <div className="auth-theme-toggle">
        <ThemeToggle theme={theme} onToggleTheme={onToggleTheme} />
      </div>
      <section className="panel">
        <div className="eyebrow">SMART CAMPUS · ATTENDANCE</div>
        <h1>{register ? "Create student account" : "Welcome back"}</h1>
        <p className="muted">
          {register
            ? "Register your details and face to get started."
            : "Sign in to your attendance dashboard."}
        </p>
        <form onSubmit={submit}>
          {register && (
            <>
              <label>
                Full name
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <label>
                Student ID
                <input
                  required
                  value={form.studentId}
                  onChange={(e) =>
                    setForm({ ...form, studentId: e.target.value })
                  }
                />
              </label>
              <label>
                Course / Batch
                <input
                  required
                  value={form.course}
                  onChange={(e) => setForm({ ...form, course: e.target.value })}
                />
              </label>
            </>
          )}
          <label>
            Email
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              minLength="6"
              required
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>
          {register && (
            <div className="camera">
              <video ref={video} autoPlay muted playsInline />
              <button
                type="button"
                className="secondary"
                onClick={capture}
                disabled={!cameraReady || capturing}
              >
                {capturing ? "Capturing…" : "Capture face"}
              </button>
              <span className="muted">
                {face
                  ? "Face ready ✓"
                  : cameraReady
                    ? "Look at the camera in good lighting"
                    : "Starting camera…"}
              </span>
            </div>
          )}
          {error && <p className="notice" role="status">{error}</p>}
          <button disabled={busy || (register && !face)}>
            {busy ? "Please wait…" : register ? "Create account" : "Sign in"}
          </button>
        </form>
        <p className="muted">
          {register ? "Already registered? " : "New student? "}
          <Link to={register ? "/login" : "/register"}>
            {register ? "Sign in" : "Create account"}
          </Link>
        </p>
      </section>
    </main>
  );
}
function Student({ theme, onToggleTheme }) {
  const user = getUser(),
    [history, setHistory] = useState([]),
    [msg, setMsg] = useState(""),
    [demoMode, setDemoMode] = useState(false),
    [demoClientIp, setDemoClientIp] = useState(""),
    [busy, setBusy] = useState(false),
    video = useRef(null),
    stream = useRef(null);
  useEffect(() => {
    api
      .get("/attendance/mine")
      .then((r) => setHistory(r.data))
      .catch(() => {});
    api
      .get("/attendance/demo-mode")
      .then(({ data }) => setDemoMode(data.enabled))
      .catch((error) =>
        setMsg(
          error.response?.data?.message || "Unable to load attendance mode.",
        ),
      );
    return () => {
      stopStream(stream.current);
      stream.current = null;
      if (video.current) video.current.srcObject = null;
    };
  }, []);
  async function mark() {
    setMsg("");
    setBusy(true);
    let cameraStream;
    try {
      cameraStream = await requestCamera();
      stream.current = cameraStream;
      video.current.srcObject = cameraStream;
      await video.current.play();
      await waitForVideo(video.current);
      const descriptor = await captureFaceDescriptor(video.current);
      const { data } = await api.post("/attendance/mark", {
        descriptor,
        ...(demoMode && { demoClientIp: demoClientIp.trim() }),
      });
      setMsg(data.message);
      const h = await api.get("/attendance/mine");
      setHistory(h.data);
    } catch (e) {
      const { message, attendance } = e.response?.data || {};
      if (attendance) {
        setHistory((records) => [
          attendance,
          ...records.filter((record) => record._id !== attendance._id),
        ]);
      }
      setMsg(
        message ||
          cameraErrorMessage(e) ||
          "Face verification failed. Please try again.",
      );
    } finally {
      stopStream(cameraStream);
      if (stream.current === cameraStream) stream.current = null;
      if (video.current?.srcObject === cameraStream) {
        video.current.srcObject = null;
      }
      setBusy(false);
    }
  }
  return (
    <>
      <Nav theme={theme} onToggleTheme={onToggleTheme} />
      <main className="page">
        <div className="eyebrow">STUDENT PORTAL</div>
        <h1>Hello, {user.name.split(" ")[0]} 👋</h1>
        <p className="muted">
          {user.studentId} · {user.course}
        </p>
        {demoMode && (
          <p className="notice demo-notice" role="alert">
            STAGING DEMO ONLY: IPs are simulated. Use the saved authorized IP
            to simulate Wi-Fi, or a different public IP to simulate another
            network. Demo records go only to the isolated staging database.
          </p>
        )}
        <section className="panel mark">
          <div>
            <h2>Today's attendance</h2>
            <p className="muted">
              Connect to institute Wi-Fi, then verify your face.
            </p>
            {demoMode && (
              <label>
                Simulated public IP
                <input
                  type="text"
                  value={demoClientIp}
                  onChange={(event) => setDemoClientIp(event.target.value)}
                  placeholder="Authorized IP to allow; different IP to reject"
                  autoComplete="off"
                />
              </label>
            )}
            <button onClick={mark} disabled={busy}>
              {busy ? "Verifying…" : "Mark attendance with face"}
            </button>
            {msg && <p className="notice">{msg}</p>}
          </div>
          <video ref={video} autoPlay muted playsInline />
        </section>
        <AttendanceCalendar records={history} />
        <section className="panel">
          <h2>Attendance history</h2>
          <Records rows={history} />
        </section>
      </main>
    </>
  );
}
function AttendanceCalendar({ records }) {
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const recordsByDate = new Map(records.map((record) => [record.date, record]));
  const monthLabel = visibleMonth.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
  const cells = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];

  function changeMonth(offset) {
    setVisibleMonth((current) =>
      new Date(current.getFullYear(), current.getMonth() + offset, 1),
    );
  }

  return (
    <section className="panel attendance-calendar">
      <div className="calendar-heading">
        <h2>Monthly attendance</h2>
        <div className="calendar-navigation">
          <button
            type="button"
            className="secondary"
            onClick={() => changeMonth(-1)}
            aria-label="Previous month"
          >
            ‹
          </button>
          <strong aria-live="polite">{monthLabel}</strong>
          <button
            type="button"
            className="secondary"
            onClick={() => changeMonth(1)}
            aria-label="Next month"
          >
            ›
          </button>
        </div>
      </div>
      <div className="calendar-grid" role="grid" aria-label={monthLabel}>
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
          <div className="calendar-weekday" role="columnheader" key={day}>
            {day}
          </div>
        ))}
        {cells.map((day, index) => {
          if (day === null) {
            return (
              <div
                className="calendar-day calendar-day-empty"
                role="gridcell"
                aria-hidden="true"
                key={`empty-${index}`}
              />
            );
          }
          const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const record = recordsByDate.get(date);
          const statusClass = record
            ? `calendar-day-${record.status.toLowerCase()}`
            : "";

          return (
            <div
              className={`calendar-day ${statusClass}`}
              role="gridcell"
              aria-label={`${date}: ${record?.status || "No attendance record"}`}
              key={date}
            >
              <span className="calendar-day-number">{day}</span>
              {record && (
                <span className="calendar-day-status">{record.status}</span>
              )}
            </div>
          );
        })}
      </div>
      <div className="calendar-legend" aria-label="Attendance status legend">
        {["Present", "Absent", "Late"].map((status) => (
          <span className="calendar-legend-item" key={status}>
            <span
              className={`calendar-legend-dot calendar-day-${status.toLowerCase()}`}
              aria-hidden="true"
            />
            {status}
          </span>
        ))}
      </div>
    </section>
  );
}
function Records({ rows, ipLabel = "IP address" }) {
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Status</th>
            <th>Marked at</th>
            <th>{ipLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r._id}>
              <td>{r.date}</td>
              <td>
                <span className={"pill " + r.status.toLowerCase()}>
                  {r.status}
                </span>
                {r.demo && <span className="demo-tag">DEMO</span>}
              </td>
              <td>
                {r.markedAt ? new Date(r.markedAt).toLocaleTimeString() : "—"}
              </td>
              <td>{r.clientIp || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p className="muted">No attendance records yet.</p>}
    </div>
  );
}
function Admin({ theme, onToggleTheme }) {
  const [summary, setSummary] = useState(null),
    [students, setStudents] = useState([]),
    [err, setErr] = useState(""),
    [networkRanges, setNetworkRanges] = useState(""),
    [savedNetworkRanges, setSavedNetworkRanges] = useState(""),
    [networkConfigured, setNetworkConfigured] = useState(false),
    [demoMode, setDemoMode] = useState(false),
    [networkMessage, setNetworkMessage] = useState(""),
    [savingNetwork, setSavingNetwork] = useState(false);
  async function load() {
    try {
      const [s, u] = await Promise.all([
        api.get("/attendance/admin/summary"),
        api.get("/attendance/admin/students"),
      ]);
      setSummary(s.data);
      setStudents(u.data);
    } catch (e) {
      setErr(e.response?.data?.message || "Unable to load admin data");
    }
  }
  async function loadNetworkRestriction() {
    try {
      const { data } = await api.get("/attendance/admin/network-restriction");
      setNetworkRanges(data.ranges.join(", "));
      setSavedNetworkRanges(data.ranges.join(", "));
      setNetworkConfigured(data.configured);
    } catch (e) {
      setNetworkMessage(
        e.response?.data?.message || "Unable to load network restriction.",
      );
    }
  }
  async function persistNetworkRanges(ranges) {
    setSavingNetwork(true);
    setNetworkMessage("");
    try {
      const { data } = await api.put("/attendance/admin/network-restriction", {
        ranges,
      });
      setNetworkRanges(data.ranges.join(", "));
      setSavedNetworkRanges(data.ranges.join(", "));
      setNetworkConfigured(data.configured);
      setNetworkMessage(
        data.configured
          ? "Authorized network saved and will be used for attendance checks."
          : "No network is configured. Attendance is denied until one is saved.",
      );
    } catch (e) {
      setNetworkMessage(
        e.response?.data?.message || "Unable to save network restriction.",
      );
    } finally {
      setSavingNetwork(false);
    }
  }
  async function saveNetworkRestriction(event) {
    event.preventDefault();
    const ranges = networkRanges
      .split(",")
      .map((range) => range.trim())
      .filter(Boolean);
    await persistNetworkRanges(ranges);
  }
  useEffect(() => {
    load();
    loadNetworkRestriction();
    api
      .get("/attendance/demo-mode")
      .then(({ data }) => setDemoMode(data.enabled))
      .catch((e) =>
        setErr(e.response?.data?.message || "Unable to load attendance mode"),
      );
    socket.connect();
    socket.on("attendance:marked", load);
    return () => {
      socket.off("attendance:marked", load);
      socket.disconnect();
    };
  }, []);
  const exportCsv = async () => {
    const r = await api.get("/attendance/admin/export", {
      responseType: "blob",
    });
    const url = URL.createObjectURL(r.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance-${summary?.date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <>
      <Nav theme={theme} onToggleTheme={onToggleTheme} />
      <main className="page">
        <div className="eyebrow">ADMIN CONSOLE</div>
        <h1>Attendance overview</h1>
        <p className="muted">
          Live campus attendance · {summary?.date || "Loading…"}
        </p>
        {demoMode && (
          <p className="notice demo-notice" role="alert">
            STAGING DEMO ONLY: attendance records and simulated IP checks are
            isolated from production.
          </p>
        )}
        {err && <p className="notice">{err}</p>}
        <details className="panel">
          <summary>Settings</summary>
          <section>
            <h2>Authorized Network</h2>
            <p className="muted">
              Saved authorized IP / CIDR: {savedNetworkRanges || "None"}
            </p>
            <form onSubmit={saveNetworkRestriction}>
              <label>
                IP / CIDR
                <input
                  type="text"
                  value={networkRanges}
                  onChange={(event) => setNetworkRanges(event.target.value)}
                  placeholder="Public IPv4 or IPv6 address / CIDR"
                  aria-describedby="network-restriction-status"
                />
              </label>
              <button type="submit" disabled={savingNetwork}>
                {savingNetwork ? "Saving…" : "Save network"}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={!networkConfigured || savingNetwork}
                onClick={() => persistNetworkRanges([])}
              >
                Delete authorized network
              </button>
            </form>
            <p
              className="notice"
              id="network-restriction-status"
              role="status"
            >
              {networkMessage ||
                (networkConfigured
                  ? "Students can mark attendance only from the saved network."
                  : "No authorized network is configured; attendance can be marked without IP verification.")}
            </p>
          </section>
        </details>
        <div className="stats">
          {[
            ["Total students", summary?.totalStudents],
            ["Present", summary?.present],
            ["Late", summary?.late],
            ["Absent", summary?.absent],
          ].map(([label, value]) => (
            <section className="panel stat" key={label}>
              <span className="muted">{label}</span>
              <strong>{value ?? "—"}</strong>
            </section>
          ))}
        </div>
        <section className="panel">
          <div className="sectionhead">
            <h2>Today's records</h2>
            <button className="secondary" onClick={exportCsv}>
              Export CSV
            </button>
          </div>
          <Records rows={summary?.records || []} />
        </section>
        <section className="panel">
          <h2>Registered students</h2>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Student ID</th>
                  <th>Email</th>
                  <th>Course</th>
                  <th>Face</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s._id}>
                    <td>{s.name}</td>
                    <td>{s.studentId}</td>
                    <td>{s.email}</td>
                    <td>{s.course}</td>
                    <td>
                      <span className="pill present">Registered</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </>
  );
}
export default function App() {
  const [theme, setTheme] = useState(() =>
    localStorage.getItem("theme") === "dark" ? "dark" : "light",
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggleTheme = () =>
    setTheme((currentTheme) => (currentTheme === "dark" ? "light" : "dark"));

  return (
    <Routes>
      <Route
        path="/"
        element={<Welcome theme={theme} onToggleTheme={toggleTheme} />}
      />
      <Route
        path="/login"
        element={<Auth theme={theme} onToggleTheme={toggleTheme} />}
      />
      <Route
        path="/register"
        element={
          <Auth
            register
            theme={theme}
            onToggleTheme={toggleTheme}
          />
        }
      />
      <Route
        path="/student"
        element={
          <Guard>
            <Student theme={theme} onToggleTheme={toggleTheme} />
          </Guard>
        }
      />
      <Route
        path="/admin"
        element={
          <Guard admin>
            <Admin theme={theme} onToggleTheme={toggleTheme} />
          </Guard>
        }
      />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}
