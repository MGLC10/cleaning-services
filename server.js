const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// Helmet blocks inline scripts by default (CSP). Disable CSP for this project.
app.use(helmet({ contentSecurityPolicy: false }));

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));

// Serve frontend files
app.use(express.static(path.join(__dirname, "public")));

// ---------- Simple JSON "DB" ----------
const DATA_DIR = path.join(__dirname, "data");
const REQUESTS_FILE = path.join(DATA_DIR, "requests.json");

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(REQUESTS_FILE)) fs.writeFileSync(REQUESTS_FILE, "[]");
}

function readRequestsSafe() {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(REQUESTS_FILE, "utf-8").trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Auto-repair bad JSON so the server doesn't crash
    fs.writeFileSync(REQUESTS_FILE, "[]");
    return [];
  }
}

function writeRequests(rows) {
  ensureDataFile();
  fs.writeFileSync(REQUESTS_FILE, JSON.stringify(rows, null, 2));
}

// ---------- Helpers ----------
function isValidDateYYYYMMDD(dateStr) {
  // Basic YYYY-MM-DD check
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}
function isValidTimeHHMM(timeStr) {
  // Basic HH:MM 24-hour check
  return /^\d{2}:\d{2}$/.test(timeStr);
}
function makeDateTimeKey(date, time) {
  // Stored as "YYYY-MM-DD HH:MM"
  return `${date} ${time}`;
}

// ---------- API ----------
app.get("/api/health", (req, res) => res.json({ ok: true }));

// Check availability for a date/time:
// GET /api/check?date=YYYY-MM-DD&time=HH:MM
app.get("/api/check", (req, res) => {
  const { date, time } = req.query;

  if (!date || !time) {
    return res.status(400).json({ error: "Missing date or time." });
  }
  if (!isValidDateYYYYMMDD(date)) {
    return res.status(400).json({ error: "Date must be YYYY-MM-DD." });
  }
  if (!isValidTimeHHMM(time)) {
    return res.status(400).json({ error: "Time must be HH:MM (24-hour)." });
  }

  const requests = readRequestsSafe();
  const dateTime = makeDateTimeKey(date, time);

  const conflict = requests.some(
    (r) => r.dateTime === dateTime && r.status !== "cancelled"
  );

  res.json({ available: !conflict, dateTime });
});

// Create a service request (booking)
// POST /api/requests
app.post("/api/requests", (req, res) => {
  const {
    fullName,
    email,
    phone,
    serviceType,
    propertyType,
    address,
    bedrooms,
    bathrooms,
    frequency,
    date,
    time,
    notes,
  } = req.body;

  // Validate required fields
  if (
    !fullName ||
    !email ||
    !phone ||
    !serviceType ||
    !propertyType ||
    !address ||
    !date ||
    !time
  ) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  if (!isValidDateYYYYMMDD(date)) {
    return res.status(400).json({ error: "Date must be YYYY-MM-DD." });
  }
  if (!isValidTimeHHMM(time)) {
    return res.status(400).json({ error: "Time must be HH:MM (24-hour)." });
  }

  const requests = readRequestsSafe();
  const dateTime = makeDateTimeKey(date, time);

  // Prevent double-booking
  const conflict = requests.some(
    (r) => r.dateTime === dateTime && r.status !== "cancelled"
  );
  if (conflict) {
    return res.status(409).json({ error: "That date/time is already booked." });
  }

  // Simple estimate logic (edit as you like)
  const base = serviceType === "deep" ? 180 : 120;
  const bed = Number(bedrooms || 0) * 20;
  const bath = Number(bathrooms || 0) * 15;
  const commercial = propertyType === "commercial" ? 60 : 0;
  const estimate = base + bed + bath + commercial;

  const newRequest = {
    id: Math.random().toString(16).slice(2) + Date.now().toString(16),
    createdAt: new Date().toISOString(),
    status: "pending",

    fullName,
    email,
    phone,
    serviceType,
    propertyType,
    address,

    bedrooms: bedrooms ? Number(bedrooms) : null,
    bathrooms: bathrooms ? Number(bathrooms) : null,
    frequency: frequency || "one-time",

    date,
    time,
    dateTime,

    notes: notes || "",
    estimateUSD: estimate,
  };

  requests.unshift(newRequest);
  writeRequests(requests);

  res.status(201).json({ request: newRequest });
});

// ---------- Admin (protected by ADMIN_KEY) ----------
function requireAdminKey(req, res, next) {
  const expected = process.env.ADMIN_KEY || "";
  const got = req.header("x-admin-key") || "";
  if (!expected) return res.status(500).json({ error: "ADMIN_KEY not set." });
  if (got !== expected) return res.status(401).json({ error: "Unauthorized." });
  next();
}

app.get("/api/admin/requests", requireAdminKey, (req, res) => {
  res.json({ requests: readRequestsSafe() });
});

app.patch("/api/admin/requests/:id", requireAdminKey, (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const allowed = new Set(["pending", "confirmed", "completed", "cancelled"]);
  if (!allowed.has(status)) {
    return res.status(400).json({ error: "Invalid status." });
  }

  const requests = readRequestsSafe();
  const idx = requests.findIndex((r) => r.id === id);
  if (idx === -1) return res.status(404).json({ error: "Not found." });

  requests[idx].status = status;
  writeRequests(requests);
  res.json({ request: requests[idx] });
});

// Catch-all (keep last)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});