const express = require("express");
const multer = require("multer");
const mysql = require("mysql2");
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
const db = mysql.createConnection({
  host: process.env.MYSQLHOST,
  port: process.env.MYSQLPORT,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE
});

db.connect((err) => {
  if (err) {
    console.error("❌ MySQL Connection Error:", err);
    return;
  }

  console.log("✅ Connected to Railway MySQL!");
});

/* ================= TABLES ================= */

db.query(`
CREATE TABLE IF NOT EXISTS admins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(255) UNIQUE,
  password VARCHAR(255),
  profile_pic TEXT,
  role VARCHAR(50) DEFAULT 'admin',
  department VARCHAR(255)
)
`);

db.query(`
CREATE TABLE IF NOT EXISTS reports (
  id INT AUTO_INCREMENT PRIMARY KEY,
  complainant_name TEXT,
  respondent_name TEXT,
  description TEXT,
  report_image TEXT,
  ticket VARCHAR(255) UNIQUE,
  solved INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status_message TEXT,
  has_new_message INT DEFAULT 1,
  status VARCHAR(50) DEFAULT 'pending'
)
`);

db.query(`
CREATE TABLE IF NOT EXISTS messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  report_id INT,
  sender VARCHAR(50),
  message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
`);

db.query(
  "SELECT * FROM admins WHERE username=?",
  ["developer"],
  (err, rows) => {

    if (err) {
      console.error(err);
      return;
    }

    if (rows.length === 0) {

      db.query(
        "INSERT INTO admins (username,password,role) VALUES (?,?,?)",
        ["developer", "dev122717", "super_admin"]
      );

    } else {

      db.query(
        "UPDATE admins SET role='super_admin' WHERE username='developer'"
      );

    }
  }
);

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

db.query(
  "SELECT * FROM admins WHERE username=? AND password=?",
  [u, p],
  (err, rows) => {

    if (err || rows.length === 0) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    req.admin = rows[0];
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

  db.query(
  "SELECT id, username, password, role, department FROM admins WHERE username=? AND password=?",
  [username, password],
  (err, rows) => {

    if (err || rows.length === 0) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    res.json({
      success: true,
      admin: rows[0]
    });
  }
);
});
app.get("/api/admin/list", requireAdmin, requireSuperAdmin, (_, res) => {
 db.query(
  "SELECT id, username, role, department FROM admins ORDER BY username",
  (err, rows) => {

    if (err) {
      return res.status(500).json({ error: "Failed to fetch admins" });
    }

    res.json(rows);
  }
);
});
app.post("/api/admin/change-password", requireAdmin, (req, res) => {
  const { newPassword } = req.body;

  if (!newPassword) {
    return res.status(400).json({ error: "Password required" });
  }

  db.query(
  "UPDATE admins SET password=? WHERE id=?",
  [newPassword, req.admin.id],
  (err, result) => {

    if (err) {
      console.error("❌ Password update error:", err);
      return res.status(500).json({ error: "Update failed" });
    }

    res.json({ success: true });
  }
);
});
app.get("/api/admin/reports", requireAdmin, (_, res) => {
    db.query(
      `SELECT * FROM reports ORDER BY id DESC`,
    async (_, rows) => {

      for (let report of rows) {

        // Fix image URL
        if (report.report_image) {
          report.report_image = `https://norsu-complaint-system.onrender.com/uploads/${report.report_image}`;
        }

        // 🔥 ADD THIS PART (GET MESSAGES)
        report.messages = await new Promise((resolve, reject) => {
          db.query(
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

  db.query(
  "INSERT INTO admins (username,password,role, department) VALUES (?,?,?,?)",
  [username, password, "admin", department],
  (err, result) => {

    if (err) {
      return res.status(500).json({ error: "Create failed" });
    }

    res.json({ success: true });
  }
);
});

app.delete("/api/super/admins/:id", requireAdmin, requireSuperAdmin, (req, res) => {
  if (parseInt(req.params.id) === req.admin.id)
    return res.status(400).json({ error: "Cannot delete yourself" });

  db.query("DELETE FROM admins WHERE id=?", [req.params.id], (err, result) => {
    if (err) return res.status(500).json({ error: "Delete failed" });
    res.json({ success: true });
  });
});
app.delete("/api/super/reports/:id", requireAdmin, requireSuperAdmin, (req, res) => {
  db.query("DELETE FROM reports WHERE id=?", [req.params.id], (err, result) => {
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

  db.query(
    "UPDATE admins SET password=? WHERE id=?",
    [password, req.params.id],
    (err, result) => {

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

    db.query(
  "SELECT id FROM reports WHERE ticket=?",
  [ticket],
  (err, rows) => {

    if (rows.length > 0) {
      createUniqueTicket(callback);
    } else {
      callback(ticket);
    }
  }
 );
  }

  createUniqueTicket((ticket) => {

   db.query(
  `INSERT INTO reports 
(
  complainant_name,
  respondent_name,
  description,
  report_image,
  ticket,
  created_at,
  has_new_message,
  status
)
VALUES (?,?,?,?,?,?,?,?)`,
  [
    req.body.complainant_name,
    req.body.respondent_name,
    req.body.description,
    req.file?.filename || null,
    ticket,
    phTime,
    1,
    "pending"
  ],
      (err, result) => {
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
  db.query(
  "SELECT status, created_at, status_message FROM reports WHERE ticket=?",
  [req.params.ticket],
  (err, rows) => {

    if (err || rows.length === 0) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    const row = rows[0];

    res.json({
      status: row.status,
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

  db.query(
    "SELECT id FROM reports WHERE ticket=?",
    [req.params.ticket],
    (err, rows) => {

      if (err || rows.length === 0) {
        return res.status(404).json({ error: "Ticket not found" });
      }

    db.query(
  "INSERT INTO messages (report_id, sender, message) VALUES (?, 'user', ?)",
  [rows[0].id, message],
  (insertErr) => {

    if (insertErr) {
      return res.status(500).json({ error: "Failed to send message" });
    }

    db.query(
      "UPDATE reports SET has_new_message = 1 WHERE id=?",
      [rows[0].id],
      (updateErr) => {

        if (updateErr) {
          return res.status(500).json({ error: "Failed to update message status" });
        }

        res.json({ success: true });

      }
    );

  }
);

});
});
});
app.get("/api/report/messages/:ticket"
app.get("/api/report/messages/:ticket", (req, res) => {
  db.query(
  "SELECT id FROM reports WHERE ticket=?",
  [req.params.ticket],
  (err, rows) => {

    if (err || rows.length === 0) {
      return res.status(404).json({ error: "Not found" });
    }

    db.query(
      "SELECT sender, message, created_at FROM messages WHERE report_id=? ORDER BY created_at ASC",
      [rows[0].id],
      (err, messages) => {

        if (err) {
          return res.status(500).json({ error: "Failed to fetch messages" });
        }

        res.json(messages);
      }
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

  db.query(
    "UPDATE reports SET status_message=? WHERE id=?",
    [message, req.params.id],
    (err, result) => {

      if (err) {
        console.error("❌ Message update error:", err);
        return res.status(500).json({ error: "Update failed" });
      }

      db.query(
        "INSERT INTO messages (report_id, sender, message) VALUES (?, 'admin', ?)",
        [req.params.id, message],
        (insertErr) => {

          if (insertErr) {
            console.error("❌ Insert message error:", insertErr);
            return res.status(500).json({ error: "Insert failed" });
          }

          db.query(
            "UPDATE reports SET has_new_message = 0 WHERE id=?",
            [req.params.id],
            (updateErr) => {

              if (updateErr) {
                return res.status(500).json({ error: "Failed to update status" });
              }

              res.json({ success: true });

            }
          );

        }
      );

    }
  );

});
/* ================= OLD SOLVE ROUTE (LEFT UNCHANGED) ================= */
app.put("/api/reports/:id/solve", (req, res) => {
  db.query(
  "UPDATE reports SET solved=1 WHERE id=?",
  [req.params.id],
  (err, result) => {

    if (err) {
      return res.status(500).json({ error: "Solve failed" });
    }

    res.json({ success: true });
  }
);
});

/* ================= NEW GLOBAL STATUS ROUTE (ADDED) ================= */
app.put("/api/reports/:id/status", (req, res) => {
  const { status } = req.body;

  if (!["pending", "processing", "solved", "default"].includes(status)) {
  return res.status(400).json({ error: "Invalid status value" });
}

db.query(
  "UPDATE reports SET status=? WHERE id=?",
  [status, req.params.id],
  (err, result) => {

    if (err) {
      return res.status(500).json({ error: "Status update failed" });
    }

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
