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

/* DATABASE CONNECTION */
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false }
});

db.connect((err) => {
  if (err) console.log("Database connection failed:", err);
  else console.log("✅ Connected to MySQL database");
});

/* UPLOAD FOLDER */
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

/* MULTER CONFIG */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) =>
    cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

/* ===================== LOGIN ===================== */
app.post("/login", (req, res) => {
  const { reg_number, password } = req.body;
  db.query(
    "SELECT * FROM students WHERE reg_number=? AND password=?",
    [reg_number, password],
    (err, result) => {
      if (err) return res.json({ success: false });
      res.json({ success: result.length > 0, student: result[0] });
    }
  );
});

/* ===================== ADMIN LOGIN ===================== */
app.post("/admin/login", (req, res) => {
  const { username, password } = req.body;

  db.query(
    "SELECT * FROM admins WHERE username=?",
    [username],
    async (err, result) => {
      if (err) return res.status(500).json({ success: false });
      if (result.length === 0) return res.json({ success: false });

      const match = await bcrypt.compare(password, result[0].password);
      if (!match) return res.json({ success: false });

      res.json({ success: true, admin: result[0] });
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

      // Create student if not exists
      const student = await query("SELECT * FROM students WHERE reg_number=?", [reg_number]);
      if (student.length === 0) {
        await query(
          "INSERT INTO students (full_name, reg_number, password) VALUES (?,?,?)",
          [full_name, reg_number, "1234"]
        );
      }

      // Insert result if not exists
      const existing = await query(
        "SELECT * FROM results WHERE reg_number=? AND course_code=? AND semester=? AND academic_year=?",
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
    res.json({ message: "Results uploaded successfully" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Upload failed" });
  }
});

/* ===================== GET ALL COURSES ===================== */
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

/* ===================== GET COURSE RESULTS ===================== */
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
      res.json({ success: true, message: "Result updated" });
    }
  );
});

/* ===================== DELETE SINGLE RESULT ===================== */
app.delete("/admin/results/:id", (req, res) => {
  db.query(
    "DELETE FROM results WHERE id=?",
    [req.params.id],
    (err, result) => {
      if (err) return res.status(500).json({ success: false });
      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, message: "Not found" });
      }
      res.json({ success: true, message: "Result deleted" });
    }
  );
});

/* ===================== BULK DELETE ===================== */
app.post("/admin/results/bulk-delete", (req, res) => {
  const { ids } = req.body;

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, message: "No IDs provided" });
  }

  const placeholders = ids.map(() => '?').join(',');
  db.query(
    `DELETE FROM results WHERE id IN (${placeholders})`,
    ids,
    (err, result) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Database error" });
      }
      res.json({ 
        success: true, 
        message: `${result.affectedRows} result(s) deleted successfully` 
      });
    }
  );
});

/* ===================== DELETE ENTIRE COURSE ===================== */
app.post("/admin/results/course/delete", (req, res) => {
  const { course, level, semester, year } = req.body;

  console.log("Delete Entire Course Request:", { course, level, semester, year });

  if (!course || !level || !semester || !year) {
    return res.status(400).json({
      success: false,
      message: "Missing course details"
    });
  }

  db.query(
    `DELETE FROM results 
     WHERE course_code = ? 
       AND level = ? 
       AND semester = ? 
       AND academic_year = ?`,
    [course, level, semester, year],
    (err, result) => {
      if (err) {
        console.error("Delete Course Error:", err);
        return res.status(500).json({
          success: false,
          message: "Database error while deleting course"
        });
      }

      res.json({
        success: true,
        message: `✅ Entire course ${course} (${level} - ${semester} ${year}) deleted successfully. ${result.affectedRows} records removed.`
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


/* ===================== ADMIN CHANGE PASSWORD ===================== */
app.post("/admin/change-password", async (req, res) => {
  const { username, oldPassword, newPassword } = req.body;

  if (!username || !oldPassword || !newPassword) {
    return res.status(400).json({ success: false, message: "All fields are required" });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ success: false, message: "New password must be at least 6 characters" });
  }

  try {
    // Find admin
    const [admins] = await db.promise().query(
      "SELECT * FROM admins WHERE username = ?",
      [username]
    );

    if (admins.length === 0) {
      return res.status(404).json({ success: false, message: "Admin not found" });
    }

    const admin = admins[0];

    // Verify old password
    const isMatch = await bcrypt.compare(oldPassword, admin.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Old password is incorrect" });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedNewPassword = await bcrypt.hash(newPassword, salt);

    // Update password
    await db.promise().query(
      "UPDATE admins SET password = ? WHERE username = ?",
      [hashedNewPassword, username]
    );

    res.json({ 
      success: true, 
      message: "Password changed successfully! ✅" 
    });

  } catch (err) {
    console.error("Change Password Error:", err);
    res.status(500).json({ 
      success: false, 
      message: "Server error. Please try again later." 
    });
  }
});


/* ===================== HOME ===================== */
app.get("/", (req, res) => {
  res.send("Server is running ✅");
});

/* ===================== START SERVER ===================== */
const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});