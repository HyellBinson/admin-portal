const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const multer = require("multer");
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ===================== DATABASE ===================== */
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false }
});

db.connect((err) => {
  if (err) console.log("❌ DB connection failed:", err);
  else console.log("✅ Connected to MySQL database");
});

/* ===================== UPLOAD FOLDER ===================== */
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

/* ===================== MULTER ===================== */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) =>
    cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

/* ===================== STUDENT LOGIN ===================== */
app.post("/login", (req, res) => {
  const { reg_number, password } = req.body;

  db.query(
    "SELECT * FROM students WHERE reg_number=? AND password=?",
    [reg_number, password],
    (err, result) => {
      if (err) return res.status(500).json({ success: false });
      res.json({ success: result.length > 0, student: result[0] });
    }
  );
});

/* ===================== ADMIN LOGIN (FIXED) ===================== */
app.post("/admin/login", (req, res) => {
  const { username, password } = req.body;

  db.query(
    "SELECT * FROM admins WHERE username=?",
    [username],
    async (err, result) => {
      if (err) return res.status(500).json({ success: false, message: "Server error" });

      if (result.length === 0) {
        return res.json({ success: false, message: "Invalid credentials" });
      }

      const admin = result[0];

      try {
        const isMatch = await bcrypt.compare(password, admin.password);

        if (!isMatch) {
          return res.json({ success: false, message: "Invalid credentials" });
        }

        res.json({ success: true, admin });
      } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Login error" });
      }
    }
  );
});

/* ===================== UPLOAD RESULTS ===================== */
app.post("/upload-results", upload.single("file"), async (req, res) => {
  try {
    const { level, semester, academic_year } = req.body;

    const workbook = XLSX.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);

    const query = (sql, params) =>
      new Promise((resolve, reject) => {
        db.query(sql, params, (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });

    for (const row of rows) {
      const { reg_number, full_name, course_code, course_title, unit, score } = row;

      if (!reg_number || !course_code) continue;

      const student = await query(
        "SELECT * FROM students WHERE reg_number=?",
        [reg_number]
      );

      if (student.length === 0) {
        await query(
          "INSERT INTO students (full_name, reg_number, password) VALUES (?,?,?)",
          [full_name, reg_number, "1234"]
        );
      }

      const existing = await query(
        `SELECT * FROM results 
         WHERE reg_number=? AND course_code=? AND semester=? AND academic_year=?`,
        [reg_number, course_code, semester, academic_year]
      );

      if (existing.length === 0) {
        await query(
          `INSERT INTO results 
          (reg_number, course_code, course_title, unit, score, semester, academic_year, level)
          VALUES (?,?,?,?,?,?,?,?)`,
          [reg_number, course_code, course_title, unit, score, semester, academic_year, level]
        );
      }
    }

    fs.unlinkSync(req.file.path);

    res.json({ success: true, message: "Results uploaded successfully" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Upload failed" });
  }
});

/* ===================== COURSES ===================== */
app.get("/admin/courses", (req, res) => {
  db.query(
    `SELECT DISTINCT course_code, level, semester, academic_year 
     FROM results ORDER BY academic_year DESC`,
    (err, result) => {
      if (err) return res.status(500).json(err);
      res.json(result);
    }
  );
});

/* ===================== COURSE RESULTS ===================== */
app.get("/admin/results/course", (req, res) => {
  const { course, level, semester, year } = req.query;

  db.query(
    `SELECT * FROM results 
     WHERE course_code=? AND level=? AND semester=? AND academic_year=?`,
    [course, level, semester, year],
    (err, result) => {
      if (err) return res.status(500).json(err);
      res.json(result);
    }
  );
});

/* ===================== UPDATE RESULT ===================== */
app.put("/admin/results/:id", (req, res) => {
  const { id } = req.params;
  const { reg_number, score } = req.body;

  db.query(
    "UPDATE results SET reg_number=?, score=? WHERE id=?",
    [reg_number, score, id],
    (err) => {
      if (err) return res.status(500).json(err);
      res.json({ success: true, message: "Updated successfully" });
    }
  );
});

/* ===================== DELETE RESULT ===================== */
app.delete("/admin/results/:id", (req, res) => {
  db.query(
    "DELETE FROM results WHERE id=?",
    [req.params.id],
    (err, result) => {
      if (err) return res.status(500).json({ success: false });

      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, message: "Not found" });
      }

      res.json({ success: true, message: "Deleted successfully" });
    }
  );
});

/* ===================== BULK DELETE ===================== */
app.post("/admin/results/bulk-delete", (req, res) => {
  const { ids } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, message: "No IDs" });
  }

  const placeholders = ids.map(() => "?").join(",");

  db.query(
    `DELETE FROM results WHERE id IN (${placeholders})`,
    ids,
    (err, result) => {
      if (err) return res.status(500).json({ success: false });

      res.json({
        success: true,
        message: `${result.affectedRows} deleted`
      });
    }
  );
});

/* ===================== NOTICES ===================== */
app.get("/admin/notices", (req, res) => {
  db.query(
    "SELECT * FROM notices ORDER BY date_posted DESC",
    (err, result) => {
      if (err) return res.status(500).json(err);
      res.json(result);
    }
  );
});

app.post("/admin/notice", (req, res) => {
  const { title, message, student_reg, expires_at } = req.body;

  db.query(
    "INSERT INTO notices (title, message, student_reg, expires_at, date_posted) VALUES (?,?,?,?,NOW())",
    [title, message, student_reg || null, expires_at || null],
    (err) => {
      if (err) return res.status(500).json({ success: false });
      res.json({ success: true });
    }
  );
});

app.delete("/admin/notice/:id", (req, res) => {
  db.query("DELETE FROM notices WHERE id=?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ success: false });
    res.json({ success: true });
  });
});

/* ===================== ROOT ===================== */
app.get("/", (req, res) => {
  res.send("Server is running ✅");
});

/* ===================== START ===================== */
const PORT = process.env.PORT || 5000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});