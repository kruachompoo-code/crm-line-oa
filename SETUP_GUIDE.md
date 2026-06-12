# 🦀 ครัวชมพู่ อ่างศิลา — คู่มือติดตั้งระบบ CRM LINE OA

## สิ่งที่ต้องมีก่อน

- บัญชี LINE Official Account (ฟรี หรือ Premium)
- บัญชี Railway.app (ฟรี tier ได้เลย)
- Domain name (ถ้ามี) หรือใช้ URL จาก Railway

---

## STEP 1: สร้าง LINE Official Account

1. ไปที่ https://manager.line.biz → **สร้างบัญชี**
2. เลือก **ประเภทธุรกิจ** → ร้านอาหาร
3. บัญชีจะได้ **Channel ID** + **Channel Secret**

### 1.1 เปิด Messaging API
- LINE OA Manager → **Settings → Messaging API → Enable**
- กด **Issue Channel Access Token** → คัดลอกเก็บไว้

### 1.2 สร้าง LIFF Apps (ต้องสร้าง 6 apps)
ไปที่ LINE Developers Console → **LIFF → Add**

| ชื่อ LIFF         | Size   | Endpoint URL (ใส่หลัง deploy) |
|-------------------|--------|-------------------------------|
| walkin            | Full   | `https://YOUR_DOMAIN/liff/walkin.html` |
| reservation       | Full   | `https://YOUR_DOMAIN/liff/reservation.html` |
| group-booking     | Full   | `https://YOUR_DOMAIN/liff/group-booking.html` |
| group-menu        | Full   | `https://YOUR_DOMAIN/liff/group-menu.html` |
| onboarding        | Full   | `https://YOUR_DOMAIN/liff/onboarding.html` |
| staff-verify      | Full   | `https://YOUR_DOMAIN/liff/staff-verify.html` |

บันทึก **LIFF ID** ทั้ง 6 ตัว

### 1.3 สร้าง Staff Group (สำหรับแจ้งเตือนพนักงาน)
- สร้าง LINE Group → เพิ่ม LINE OA Bot เข้ากลุ่ม
- ดึง Group ID จาก webhook event (`source.groupId`)

---

## STEP 2: Deploy บน Railway

### 2.1 สมัคร Railway
1. ไปที่ https://railway.app → **Login with GitHub**
2. กด **New Project → Deploy from GitHub repo**

### 2.2 Upload โค้ด
```bash
# สร้าง Git repository
cd "CRM_LINE OA"
git init
git add .
git commit -m "Initial CRM system"

# Push to GitHub
git remote add origin https://github.com/YOUR_USERNAME/crm-line-oa.git
git push -u origin main
```

### 2.3 เพิ่ม Services บน Railway
ใน Railway project กด **+ Add Service**:
1. **PostgreSQL** → Add → รับ DATABASE_URL อัตโนมัติ
2. **Redis** → Add → รับ REDIS_URL อัตโนมัติ
3. **Backend** → GitHub repo → เลือก `/backend` folder

### 2.4 ตั้งค่า Environment Variables
ใน Railway → Backend service → **Variables** → เพิ่มทั้งหมดนี้:

```
NODE_ENV=production
PORT=3000

# LINE (จาก Step 1)
LINE_CHANNEL_ACCESS_TOKEN=Ly5h/dWY3x89527f...
LINE_CHANNEL_SECRET=YOUR_CHANNEL_SECRET
STAFF_LINE_GROUP_ID=C1234567890abcdef

# LIFF IDs (จาก Step 1.2)
LIFF_ID_WALKIN=1234567890-xxxxxxxx
LIFF_ID_RESERVATION=1234567890-xxxxxxxx
LIFF_ID_GROUP=1234567890-xxxxxxxx
LIFF_ID_GROUP_MENU=1234567890-xxxxxxxx
LIFF_ID_ONBOARDING=1234567890-xxxxxxxx
LIFF_ID_STAFF_VERIFY=1234567890-xxxxxxxx

# App URL (รับจาก Railway หลัง deploy)
APP_URL=https://YOUR-APP.railway.app

# JWT
JWT_SECRET=กรอก_random_string_ยาวๆ

# SMTP (ถ้าต้องการส่งใบเสนอราคาทางอีเมล)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASS=app_password
SMTP_FROM=krauchompu@gmail.com
```

### 2.5 Deploy Frontend (Static Files)
ใน Railway → **+ Add Service → Static Site**
- Root: `/frontend`
- Build command: (ว่าง)
- Start command: (ว่าง)

หรือใช้ **Vercel/Netlify** deploy `/frontend` folder ฟรี

---

## STEP 3: ตั้งค่า LINE Webhook

1. หลัง Railway deploy สำเร็จ → คัดลอก URL เช่น `https://crm-line-oa.railway.app`
2. ไปที่ LINE Developers Console → **Messaging API → Webhook URL**
3. ใส่: `https://crm-line-oa.railway.app/webhook`
4. กด **Verify** → ต้องได้ ✅ Success

---

## STEP 4: สร้าง Rich Menu

```bash
# รัน script สร้าง Rich Menu
make setup-rich-menu

# หรือรันตรงๆ
cd backend && node scripts/setupRichMenu.js
```

Rich Menu จะมี 3 ปุ่ม:
- 🍽️ สั่งอาหาร → walkin LIFF
- 📅 จองโต๊ะ → reservation LIFF  
- 🎉 จองหมู่คณะ → group-booking LIFF

---

## STEP 5: อัปเดต LIFF IDs ในไฟล์ HTML

แก้ไขไฟล์ `.env` เพิ่ม LIFF IDs แล้ว backend จะ serve ผ่าน `/api/config/liff` หรือ
แก้ไข `window.__LIFF_WALKIN__` ใน walkin.html โดยตรง:

```html
<script>
window.__LIFF_WALKIN__ = '1234567890-abcdefgh';
</script>
```

---

## STEP 6: สร้าง QR Code โต๊ะ

```bash
# รัน seed data + สร้าง QR
make seed

# หรือผ่าน Admin Dashboard
# ไปที่ https://YOUR_DOMAIN/admin
# เมนู UTM QR → กรอก tableNumber + branchId → Generate
```

---

## โครงสร้างไฟล์ทั้งหมด

```
CRM_LINE OA/
├── backend/
│   ├── src/
│   │   ├── index.js              # Entry point
│   │   ├── routes/               # API routes
│   │   │   ├── webhook.js        # LINE webhook
│   │   │   ├── booking.js        # Walk-in, Reservation, Group
│   │   │   ├── member.js         # Member CRUD, PDPA
│   │   │   ├── dashboard.js      # Admin analytics
│   │   │   └── auth.js           # JWT auth
│   │   ├── services/             # Business logic
│   │   │   ├── chatbotService.js # Intent detection, flows
│   │   │   ├── bookingService.js # Booking logic
│   │   │   ├── loyaltyService.js # Points, tiers, coupons
│   │   │   ├── memberService.js  # Member CRUD
│   │   │   ├── rfmService.js     # RFM segmentation
│   │   │   ├── quotationService.js # PDF quotation
│   │   │   └── campaignService.js  # Broadcast, automation
│   │   ├── jobs/
│   │   │   └── scheduler.js      # Cron jobs
│   │   └── middleware/
│   │       ├── auth.js           # JWT middleware
│   │       └── frequencyCap.js   # Message frequency limit
│   ├── database/
│   │   ├── schema.sql            # Main schema
│   │   └── migration_v2_*.sql    # Migrations
│   └── scripts/
│       ├── setupRichMenu.js      # สร้าง Rich Menu
│       └── seed.js               # Sample data
│
├── frontend/
│   ├── liff/
│   │   ├── walkin.html           # 🍽️ สั่งอาหาร + เรียกพนักงาน + เช็คบิล
│   │   ├── staff-verify.html     # 🔍 พนักงาน verify บิล
│   │   ├── reservation.html      # 📅 จองล่วงหน้า + pre-order + มัดจำ
│   │   ├── group-booking.html    # 🎉 จองหมู่คณะ
│   │   ├── group-menu.html       # 🎯 เลือกเมนูตามงบ (หมู่คณะ)
│   │   ├── onboarding.html       # 📋 สมัครสมาชิก
│   │   ├── profile.html          # 👤 โปรไฟล์ + แต้ม + Tier
│   │   └── pdpa.html             # 🔒 จัดการความยินยอม PDPA
│   └── admin/
│       └── index.html            # 📊 Admin Dashboard
│
├── nginx/
│   └── nginx.conf                # Nginx reverse proxy
├── docker-compose.yml            # Local development
├── railway.toml                  # Railway deployment
├── Makefile                      # Shortcuts
└── .env.example                  # Template env vars
```

---

## ทดสอบระบบ

### Local (Docker)
```bash
# Copy env
cp .env.example .env
# แก้ไข .env ใส่ LINE tokens

# Start all services
make dev

# สร้าง Rich Menu
make setup-rich-menu

# Seed ข้อมูลตัวอย่าง
make seed
```

### URLs หลัง start
| URL | หน้าที่ |
|-----|---------|
| `http://localhost/liff/walkin.html?table=1&branch=1` | Walk-in ordering |
| `http://localhost/liff/reservation.html` | จองโต๊ะ |
| `http://localhost/liff/group-booking.html` | จองหมู่คณะ |
| `http://localhost/liff/group-menu.html` | เลือกเมนูตามงบ |
| `http://localhost/admin` | Admin Dashboard |
| `http://localhost:3000/health` | Health check |

---

## FAQ

**Q: LIFF ต้องใช้ HTTPS ใช่ไหม?**
A: ใช่ — Railway/Vercel ให้ HTTPS ฟรีอัตโนมัติ สำหรับ local dev ใช้ ngrok

**Q: ngrok ใช้ทดสอบ webhook ยังไง?**
```bash
ngrok http 3000
# Copy URL เช่น https://abc123.ngrok.io
# ใส่ใน LINE Webhook URL: https://abc123.ngrok.io/webhook
```

**Q: ลูกค้าสแกน QR ต้องมี LINE ไหม?**
A: ต้องมี LINE app — LIFF ทำงานบน LINE browser เท่านั้น

**Q: ค่าใช้จ่าย Railway?**
A: Free tier = 500 hours/เดือน เพียงพอสำหรับร้านเล็ก Hobby plan $5/เดือน ถ้าต้องการไม่หยุด
