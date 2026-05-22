#!/usr/bin/env node

const crypto = require("node:crypto");

const password = process.argv[2];
if (!password) {
  console.error("Usage: node scripts/hash-admin-password.js <password>");
  process.exit(1);
}

const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync(password, salt, 64).toString("hex");
process.stdout.write(`scrypt:${salt}:${hash}\n`);
