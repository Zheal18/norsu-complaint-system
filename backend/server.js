const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const multer = require("multer");
const path = require("path");
const cors = require("cors");
const fs = require("fs");
const os = require("os");

const app = express();
const port = 5000;

/* ================= HELPERS ================= */
function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name in nets) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "localhost";
}
const LOCAL_IP = getLocalIp();

/* ================= UPLOADS ================= */
const uploadsPath = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsPath)) fs.mkdirSync(uploadsPath);

/* ================= MIDDLEWARE ================= */
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(uploadsPath));
app.use(express.static(path.join(__dirname, "../frontend")));


/* ================= DATABASE ================= */
const db = new sqlite3.Database("./database.db", err => {
  if (err) console.error("❌ DB error:", err.message);
  else console.log("✅ SQLite connected");
});

/* ================= TABLES ================= */
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      profile_pic TEXT,
      role TEXT DEFAULT 'admin',
      department TEXT
    )
  `);
 db.run(`
  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    complainant_name TEXT,
    respondent_name TEXT,
    description TEXT,
    report_image TEXT,
    ticket TEXT UNIQUE,
    solved INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status_message TEXT
  )
`);
db.run(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER,
    sender TEXT,              -- 'admin' or 'user'
    message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);

  // Ensure super admin
  db.get("SELECT * FROM admins WHERE username=?", ["developer"], (_, row) => {
    if (!row) {
      db.run(
        "INSERT INTO admins (username,password,role) VALUES (?,?,?)",
        ["developer", "dev122717", "super_admin"]
      );
    } else {
      db.run("UPDATE admins SET role='super_admin' WHERE username='developer'");
    }
  });
});

/* ================= MULTER ================= */
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadsPath),
  filename: (_, file, cb) =>
    cb(null, Date.now() + "-" + Math.round(Math.random() * 1e9) + path.extname(file.originalname))
});
const upload = multer({ storage });

/* ================= AUTH ================= */
function requireAdmin(req, res, next) {
  const u = req.headers["x-admin-username"];
  const p = req.headers["x-admin-password"];

  if (!u || !p) return res.status(401).json({ error: "Missing credentials" });

  db.get(
    "SELECT * FROM admins WHERE username=? AND password=?",
    [u, p],
    (err, row) => {
      if (err || !row) return res.status(403).json({ error: "Unauthorized" });
      req.admin = row;
      next();
    }
  );
}

function requireSuperAdmin(req, res, next) {
  if (req.admin.role !== "super_admin")
    return res.status(403).json({ error: "Super Admin only" });
  next();
}

/* ================= BASIC ================= */
app.get("/", (_, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

/* ================= ADMIN ================= */
app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body;

  db.get(
    "SELECT id, username, password, role, department FROM admins WHERE username=? AND password=?",
    [username, password],
    (_, row) => {
      if (!row) return res.status(401).json({ error: "Invalid credentials" });
      res.json({ success: true, admin: row });
    }
  );
});
app.get("/api/admin/list", requireAdmin, requireSuperAdmin, (_, res) => {
  db.all("SELECT id, username, role, department FROM admins ORDER BY username", [], (_, rows) =>
    res.json(rows)
  );
});
app.post("/api/admin/change-password", requireAdmin, (req, res) => {
  const { newPassword } = req.body;

  if (!newPassword) {
    return res.status(400).json({ error: "Password required" });
  }

  db.run(
    "UPDATE admins SET password=? WHERE id=?",
    [newPassword, req.admin.id],
    function (err) {
      if (err) {
        console.error("❌ Password update error:", err);
        return res.status(500).json({ error: "Update failed" });
      }

      res.json({ success: true });
    }
  );
});
app.get("/api/admin/reports", requireAdmin, (_, res) => {
  db.all(
    `SELECT * FROM reports ORDER BY id DESC`,
    [],
    async (_, rows) => {

      for (let report of rows) {

        // Fix image URL
        if (report.report_image) {
          report.report_image = `https://norsu-complaint-system.onrender.com/uploads/${report.report_image}`;
        }

        // 🔥 ADD THIS PART (GET MESSAGES)
        report.messages = await new Promise((resolve, reject) => {
          db.all(
            "SELECT sender, message, created_at FROM messages WHERE report_id=? ORDER BY created_at ASC",
            [report.id],
            (err, msgs) => {
              if (err) reject(err);
              else resolve(msgs);
            }
          );
        });

      }
	

      res.json(rows);
    }
  );
});

/* ================= SUPER ADMIN ================= */
app.post("/api/super/admins", requireAdmin, requireSuperAdmin, (req, res) => {
  const { department, username, password } = req.body;

  db.run(
    "INSERT INTO admins (username,password,role, department) VALUES (?,?,?,?)",
    [username, password, "admin", department],
    err => {
      if (err) return res.status(500).json({ error: "Create failed" });
      res.json({ success: true });
    }
  );
});

app.delete("/api/super/admins/:id", requireAdmin, requireSuperAdmin, (req, res) => {
  if (parseInt(req.params.id) === req.admin.id)
    return res.status(400).json({ error: "Cannot delete yourself" });

  db.run("DELETE FROM admins WHERE id=?", [req.params.id], err => {
    if (err) return res.status(500).json({ error: "Delete failed" });
    res.json({ success: true });
  });
});
app.delete("/api/super/reports/:id", requireAdmin, requireSuperAdmin, (req, res) => {
  db.run("DELETE FROM reports WHERE id=?", [req.params.id], err => {
    if (err) return res.status(500).json({ error: "Delete failed" });
    res.json({ success: true });
  });
});

/* ================= RESET ADMIN PASSWORD ================= */
app.post("/api/super/admin/reset/:id", requireAdmin, requireSuperAdmin, (req, res) => {

  const { password } = req.body;

  if (!password || password.trim() === "") {
    return res.status(400).json({ error: "Password required" });
  }

  db.run(
    "UPDATE admins SET password=? WHERE id=?",
    [password, req.params.id],
    function(err) {

      if (err) {
        console.error("❌ Admin reset error:", err);
        return res.status(500).json({ error: "Reset failed" });
      }

      res.json({ success: true });
    }
  );

});
/* ================= REPORT ================= */
app.post("/api/report", upload.single("report_image"), (req, res) => {

  const phTime = new Date().toLocaleString("sv-SE", {
    timeZone: "Asia/Manila"
  }).replace(" ", "T");

  function generateTicket() {
    return "TCKT-" + Math.random().toString(36).substring(2, 10).toUpperCase();
  }

  function createUniqueTicket(callback) {
    const ticket = generateTicket();

    db.get("SELECT id FROM reports WHERE ticket=?", [ticket], (err, row) => {
      if (row) {
        // Ticket already exists → try again
        createUniqueTicket(callback);
      } else {
        callback(ticket);
      }
    });
  }

  createUniqueTicket((ticket) => {

   db.run(
  `INSERT INTO reports 
  (complainant_name, respondent_name, description, report_image, ticket, created_at)
  VALUES (?,?,?,?,?,?)`,
  [
    req.body.complainant_name,
    req.body.respondent_name,
    req.body.description,
    req.file?.filename || null,
    ticket,
    phTime
  ],
      function (err) {
        if (err) {
          console.error("❌ Report insert error:", err);
          return res.status(500).json({ error: "Failed to submit report" });
        }

        res.json({
          success: true,
          ticket: ticket
        });
      }
    );

  });

});
/* ================= TRACK REPORT BY TICKET ================= */
app.get("/api/report/status/:ticket", (req, res) => {
  db.get(
    "SELECT solved, created_at, status_message FROM reports WHERE ticket=?",
    [req.params.ticket],
    (err, row) => {
      if (err || !row) {
        return res.status(404).json({ error: "Ticket not found" });
      }

      res.json({
        status: row.solved === 1 ? "Solved" : "Under Review",
        created_at: row.created_at,
	status_message: row.status_message
      });
    }
  );
});
/* ================ USER REPLY===================*/
app.post("/api/report/reply/:ticket", (req, res) => {
  const { message } = req.body;

  if (!message || message.trim() === "") {
    return res.status(400).json({ error: "Message required" });
  }

  db.get(
    "SELECT id FROM reports WHERE ticket=?",
    [req.params.ticket],
    (err, row) => {
      if (!row) return res.status(404).json({ error: "Ticket not found" });

      db.run(
        "INSERT INTO messages (report_id, sender, message) VALUES (?, 'user', ?)",
        [row.id, message],
        () => res.json({ success: true })
      );
    }
  );
});
app.get("/api/report/messages/:ticket", (req, res) => {
  db.get(
    "SELECT id FROM reports WHERE ticket=?",
    [req.params.ticket],
    (err, row) => {
      if (!row) return res.status(404).json({ error: "Not found" });

      db.all(
        "SELECT sender, message, created_at FROM messages WHERE report_id=? ORDER BY created_at ASC",
        [row.id],
        (_, rows) => res.json(rows)
      );
    }
  );
});
/* ================= ADMIN MESSAGE ================= */
app.post("/api/reports/:id/message", requireAdmin, (req, res) => {

  const { message } = req.body;

  if (!message || message.trim() === "") {
    return res.status(400).json({ error: "Message required" });
  }

db.run(
  "UPDATE reports SET status_message=? WHERE id=?",
  [message, req.params.id],
  err => {
    if (err) {
      console.error("❌ Message update error:", err);
      return res.status(500).json({ error: "Update failed" });
    }

    db.run(
      "INSERT INTO messages (report_id, sender, message) VALUES (?, 'admin', ?)",
      [req.params.id, message],
      insertErr => {
        if (insertErr) {
          console.error("❌ Insert message error:", insertErr);
        }

        res.json({ success: true });
      }
    );
  }
);
});
/* ================= OLD SOLVE ROUTE (LEFT UNCHANGED) ================= */
app.put("/api/reports/:id/solve", (req, res) => {
  db.run("UPDATE reports SET solved=1 WHERE id=?", [req.params.id], () =>
    res.json({ success: true })
  );
});

/* ================= NEW GLOBAL STATUS ROUTE (ADDED) ================= */
app.put("/api/reports/:id/status", (req, res) => {
  const { status } = req.body;

  if (!["solved", "unsolved"].includes(status)) {
    return res.status(400).json({ error: "Invalid status value" });
  }
	const solvedValue = status === "solved" ? 1 : 0;
  db.run(
    "UPDATE reports SET solved=? WHERE id=?",
    [solvedValue, req.params.id],
    err => {
      if (err) return res.status(500).json({ error: "Status update failed" });
      res.json({ success: true, status });
    }
  );
});
/* ================= START ================= */
app.listen(port, "0.0.0.0", () => {
  console.log("🚀 Server running");
  console.log(`Local:   http://localhost:${port}`);
  console.log(`Network: http://${LOCAL_IP}:${port}`);
});
