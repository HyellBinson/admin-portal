// hashPassword.js
const bcrypt = require("bcrypt");

async function hashPassword(plainPassword) {
  const salt = await bcrypt.genSalt(10); // generate a salt
  const hash = await bcrypt.hash(plainPassword, salt);
  console.log("Hashed password:", hash);
  return hash;
}

// replace "admin123" with your desired password
hashPassword("admin123");