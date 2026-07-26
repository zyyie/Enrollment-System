# Setup Guide — Geranova EMS Enrollment System

Gabay para sa **bagong laptop**. Sundin ang steps na ito para ma-run ang Student Portal at Admin Portal.

---

## System Overview

| App | Folder | Port | URL |
|-----|--------|------|-----|
| **Student Portal** | `ENROLLSYSTEM/` | 8000 | http://localhost:8000 |
| **Admin Portal** | `ENROLLSYSTEM-ADMIN/` | 8001 | http://localhost:8001/login.html |

---

## Step 1 — Install Python (Required)

### Download
- **Python 3.10 or newer:** https://www.python.org/downloads/
- Recommended: **Python 3.11** or **3.12** (stable)

### Windows Install
1. Run the installer
2. ✅ Check **"Add python.exe to PATH"**
3. Click **Install Now**

### Verify (PowerShell or CMD)

```powershell
python --version
```

Expected output:
```
Python 3.11.x
```
(or 3.10+, 3.12, etc.)

---

## Step 2 — Copy Project Folder

Copy the entire folder to the new laptop:

```
Enrollment systemproject/
├── ENROLLSYSTEM/
├── ENROLLSYSTEM-ADMIN/
├── README.md
└── SETUP-README.md   ← this file
```

Example location:
```
C:\Users\YourName\Desktop\Enrollment systemproject\
```

---

## Step 3 — Python Packages (pip install)

> **Important:** This project does **NOT** use Flask, Django, FastAPI, or Node.js.
> The server runs on Python's built-in `http.server` (stdlib only).

**No pip install is required** for normal operation.

Optional — if you want to verify Python works:

```powershell
python -m pip --version
```

If you ever add optional tools later, they would go in a `requirements.txt`. For now, **skip pip install**.

### What you do NOT need to install

| Software | Needed? |
|----------|---------|
| Flask | ❌ No |
| Django | ❌ No |
| FastAPI | ❌ No |
| Node.js / npm | ❌ No |
| XAMPP / Apache | ❌ No |
| MySQL / PostgreSQL local | ❌ No (uses Supabase cloud) |

---

## Step 4 — Online Accounts (Browser)

Create or reuse these accounts:

### 1. Supabase (Database) — **Required**
- Sign up: https://supabase.com
- Create a project
- Go to **Project Settings → API**
- Copy:
  - `Project URL` → `SUPABASE_URL`
  - `anon` / publishable key → `SUPABASE_PUBLISHABLE_KEY`
  - `service_role` / secret key → `SUPABASE_SECRET_KEY`

### 2. Gmail App Password — **Required for emails**
- Google Account → Security → 2-Step Verification (enable first)
- App passwords: https://myaccount.google.com/apppasswords
- Generate password for "Mail"
- Use in `.env` as `GMAIL_APP_PASSWORD`

### 3. OpenRouter (AI Auto-Schedule) — **Optional**
- https://openrouter.ai/keys
- Free tier available
- Only needed for Admin **AI Auto-Scheduling**

### 4. Groq / Gemini — **Optional fallbacks**
- Groq: https://console.groq.com/keys
- Gemini: https://aistudio.google.com/apikey

---

## Step 5 — Configure `.env` Files

Each portal has its own `.env` file.

### Student Portal

```powershell
cd "C:\Users\YourName\Desktop\Enrollment systemproject\ENROLLSYSTEM"
copy .env.example .env
notepad .env
```

Fill in:
```env
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_PUBLISHABLE_KEY=your_publishable_key
SUPABASE_SECRET_KEY=your_secret_key

GMAIL_USER=your-email@gmail.com
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
ADMIN_EMAIL=your-email@gmail.com
SCHOOL_NAME=Geranova Senior High School

ADMIN_PORTAL_URL=http://localhost:8001
```

### Admin Portal

```powershell
cd "C:\Users\YourName\Desktop\Enrollment systemproject\ENROLLSYSTEM-ADMIN"
copy .env.example .env
notepad .env
```

Same Supabase + Gmail keys, plus:
```env
OPENROUTER_API_KEY=sk-or-v1-your-key-here
OPENROUTER_MODEL=meta-llama/llama-3.3-70b-instruct:free
```

> **Tip:** Copy `.env` from the old laptop if you already configured everything.

---

## Step 6 — Supabase SQL Setup

Open **Supabase Dashboard → SQL Editor** and run these files **in order**:

From folder: `ENROLLSYSTEM-ADMIN/supabase/` (same files exist in `ENROLLSYSTEM/supabase/`)

| # | SQL File | Purpose |
|---|----------|---------|
| 1 | `schema.sql` | Main database tables |
| 2 | `faculty-strands-rooms.sql` | Strands, rooms, faculty |
| 3 | `seed-shs-curriculum.sql` | Curriculum subjects |
| 4 | `enrollment-workflow.sql` | Enrollment + notifications |
| 5 | `schedule-sync.sql` | Schedule sync |
| 6 | `apply-auto-schedule.sql` | Auto-schedule apply |
| 7 | `publish-schedules.sql` | Publish to students |

**Optional seed data:**
- `seed-faculty.sql` — default admin login
- `seed-professors-subjects.sql` — sample teachers
- `seed-enrollment-schedules.sql` — sample schedules

---

## Step 7 — Run the System

Open **two separate terminals** (PowerShell or CMD).

### Terminal 1 — Student Portal

```powershell
cd "C:\Users\YourName\Desktop\Enrollment systemproject\ENROLLSYSTEM"
python main.py
```

Then open browser: **http://localhost:8000**

### Terminal 2 — Admin Portal

```powershell
cd "C:\Users\YourName\Desktop\Enrollment systemproject\ENROLLSYSTEM-ADMIN"
python main.py
```

Then open browser: **http://localhost:8001/login.html**

### Alternative command (if `python` doesn't work)

```powershell
py main.py
```

---

## Step 8 — Default Admin Login

After running `seed-faculty.sql`:

| Field | Value |
|-------|-------|
| Faculty ID | `FAC-2026-0001` |
| Password | `faculty123` |

---

## Quick Install Checklist

Copy-paste checklist for new laptop setup:

```
[ ] Python 3.10+ installed (Add to PATH checked)
[ ] python --version works in terminal
[ ] Project folder copied to new laptop
[ ] ENROLLSYSTEM/.env configured
[ ] ENROLLSYSTEM-ADMIN/.env configured
[ ] Supabase SQL files run (schema → enrollment-workflow → schedule-sync)
[ ] Internet connection active
[ ] Terminal 1: python main.py in ENROLLSYSTEM → :8000
[ ] Terminal 2: python main.py in ENROLLSYSTEM-ADMIN → :8001
[ ] Admin login works (FAC-2026-0001 / faculty123)
```

---

## Troubleshooting

### `python is not recognized`
```powershell
# Try this instead:
py main.py

# Or reinstall Python with "Add to PATH" checked
```

### `SyntaxError` in server.py
- Make sure you have the latest `server.py` from the project
- Do not mix JavaScript syntax (`if (error) {`) into Python files

### `ImportError: cannot import name ...`
```powershell
cd ENROLLSYSTEM-ADMIN
python -m py_compile server.py
```
Fix any reported errors, then restart.

### Port already in use
Close other running servers, or change port in `.env`:
```env
PORT=8002
```

### Supabase / empty data errors
- Check `.env` keys are correct
- Re-run `enrollment-workflow.sql` in Supabase SQL Editor
- Restart both servers

### AI Schedule not working
- Add `OPENROUTER_API_KEY` in admin `.env`
- Rule-based scheduler still works without AI key

---

## Tech Stack (for reference)

| Layer | Technology |
|-------|------------|
| Backend | Python 3.10+ (`http.server`, stdlib only) |
| Frontend | HTML, CSS, JavaScript |
| Database | Supabase (PostgreSQL cloud) |
| Auth | Custom RPC + Supabase REST |
| Email | Gmail SMTP |
| AI Schedule | OpenRouter / Groq / Gemini (optional) |
| CDN | Supabase JS from jsdelivr (needs internet) |

**No Flask. No Node. No local database server.**

---

## One-Line Summary

```powershell
# Install Python → copy folder → setup .env → run SQL in Supabase → then:
cd ENROLLSYSTEM && python main.py          # :8000
cd ENROLLSYSTEM-ADMIN && python main.py    # :8001
```

---

*Geranova Senior High School — Enrollment Management System*
