const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const multer = require("multer");
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");


const app = express();

app.use(cors());
app.use(express.json());

/* DATABASE CONNECTION */

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: {
    rejectUnauthorized: false
  }
});


db.connect((err) => {
  if (err) {
    console.log("Database connection failed:", err);
  } else {
    console.log("Connected to MySQL database");
  }
});

/* ENSURE UPLOAD FOLDER EXISTS */

if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

/* FILE UPLOAD CONFIG */

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

/* LOGIN API */

app.post("/login", (req, res) => {

  const { reg_number, password } = req.body;

  const sql = "SELECT * FROM students WHERE reg_number=? AND password=?";

  db.query(sql, [reg_number, password], (err, result) => {

    if (err) {
      console.log(err);
      return res.json({ success: false, message: "Server error" });
    }

    if (result.length > 0) {
      res.json({
        success: true,
        student: result[0]
      });
    } else {
      res.json({
        success: false,
        message: "Invalid login details"
      });
    }

  });

});



/* ---------------------- ADD THIS ADMIN LOGIN SECTION ---------------------- */



app.post("/admin/login", (req, res) => {
  const { username, password } = req.body;

  const sql = "SELECT * FROM admins WHERE username=?";
  db.query(sql, [username], async (err, result) => {
    if (err) return res.status(500).json({ success: false, message: "Server error" });

    if (result.length === 0) return res.json({ success: false, message: "Invalid username or password" });

    const admin = result[0];

    const match = await bcrypt.compare(password, admin.password);
    if (!match) return res.json({ success: false, message: "Invalid username or password" });

    res.json({ success: true, admin: { id: admin.id, username: admin.username, full_name: admin.full_name } });
  });
});

/* ---------------------- EXISTING RESULT UPLOAD AND NOTICES CODE CONTINUE BELOW ---------------------- */




/* CHANGE ADMIN PASSWORD */

app.post("/admin/change-password", async (req,res)=>{

const {username,oldPassword,newPassword} = req.body;



db.query(
"SELECT * FROM admins WHERE username=?",
[username],
async (err,result)=>{

if(err){
return res.json({message:"Server error"});
}

if(result.length === 0){
return res.json({message:"Admin not found"});
}

const admin = result[0];

const match = await bcrypt.compare(oldPassword, admin.password);

if(!match){
return res.json({message:"Old password incorrect"});
}

const hash = await bcrypt.hash(newPassword,10);

db.query(
"UPDATE admins SET password=? WHERE username=?",
[hash,username],
(err)=>{

if(err){
return res.json({message:"Password update failed"});
}

res.json({message:"Password changed successfully"});

});

});

});


/* RESULT UPLOAD API */

app.post("/upload-results", upload.single("file"), async (req, res) => {

  try {

    if (!req.file) {
      return res.json({ message: "No file uploaded" });
    }

    const level = req.body.level;
    const semester = req.body.semester;
    const academic_year = req.body.academic_year;

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

    const notifiedStudents = new Set();

    for (const row of rows) {

      const {
        reg_number,
        full_name,
        course_code,
        course_title,
        unit,
        score
      } = row;

      if (!reg_number || !course_code) continue;

      /* CHECK STUDENT */

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

      /* CHECK DUPLICATE RESULT */

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
          [
            reg_number,
            course_code,
            course_title,
            unit,
            score,
            semester,
            academic_year,
            level
          ]
        );

      }

      /* CREATE NOTICE FOR STUDENT (ONLY ONCE PER UPLOAD) */

      if (!notifiedStudents.has(reg_number)) {

        await query(
          `INSERT INTO notices (title, message, date_posted, expires_at, student_reg)
           VALUES (?,?,?,?,?)`,
          [
            "Result Uploaded",
            `Your ${semester} semester result for ${academic_year} has been uploaded.`,
            new Date(),
            new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            reg_number
          ]
        );

        notifiedStudents.add(reg_number);

      }

    }

    fs.unlinkSync(req.file.path);

    res.json({
      message: "Results uploaded and notifications sent successfully"
    });

  } catch (err) {

    console.log(err);

    res.status(500).json({
      message: "Upload failed"
    });

  }

});

/* TEST ROUTE */

app.get("/", (req, res) => {
  res.send("School Result Server Running");
});



/* ---------------------- NOTICES ENDPOINTS ---------------------- */

// GET all notices (for admin page)
app.get("/admin/notices", (req, res) => {
  const sql = `SELECT * FROM notices ORDER BY date_posted DESC`;
  db.query(sql, (err, result) => {
    if (err) return res.status(500).json({ error: err });
    res.json(result);
  });
});

// POST a new notice (from admin page)
app.post("/admin/notice", (req, res) => {
  const { title, message, student_reg, expires_at } = req.body;

  const sql = `
    INSERT INTO notices (title, message, date_posted, student_reg, expires_at)
    VALUES (?, ?, NOW(), ?, ?)
  `;

  db.query(sql, [title, message, student_reg || null, expires_at], (err) => {
    if (err) return res.status(500).json({ success: false, error: err });
    res.json({ success: true, message: "Notice created successfully" });
  });
});

// DELETE a notice (from admin page)
app.delete("/admin/notice/:id", (req, res) => {
  const id = req.params.id;
  const sql = `DELETE FROM notices WHERE id=?`;

  db.query(sql, [id], (err) => {
    if (err) return res.status(500).json({ error: err });
    res.json({ success: true, message: "Notice deleted" });
  });
});


const path = require("path");

// Serve static files for admin
app.use("/admin", express.static(path.join(__dirname, "admin-portal")));

/* SERVER */

app.listen(5000, "0.0.0.0", () => {
  console.log("Server running on port 5000");
});