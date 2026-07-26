# Geranova EMS — Enrollment System

Senior High School enrollment system na may **Student Portal** at **Admin Portal**.

```
Enrollment systemproject/
├── ENROLLSYSTEM/          Student portal   → http://localhost:8000
└── ENROLLSYSTEM-ADMIN/    Admin portal     → http://localhost:8001
```

Ito ang gabay kung **ililipat mo ang buong system sa ibang laptop** (USB, Google Drive, zip, etc.).

---

## 1. Ano ang kailangan i-download / i-install sa laptop

### Required (kailangan talaga)

| Software | Download | Bakit kailangan |
|----------|----------|-----------------|
| **Python 3.10+** | https://www.python.org/downloads/ | Backend server ng student at admin portal |
| **Modern browser** | Chrome o Edge | Para buksan ang web app |
| **Internet** | — | Supabase (database), email, at AI scheduling |

**Python install tip (Windows):**
- Sa installer, i-check ang **"Add Python to PATH"**
- Pagkatapos, buksan **PowerShell** at i-test:

```powershell
python --version
```

Dapat lumabas: `Python 3.10.x` o mas bago.

> **Hindi kailangan ang Node.js / npm** — kahit may `package.json`, Python lang ang ginagamit para mag-run.

> **Hindi kailangan ang `pip install`** — stdlib lang ang Python code (walang external packages).

---

### Optional pero recommended

| Software | Download | Para saan |
|----------|----------|-----------|
| **Git** | https://git-scm.com/download/win | Kung gusto mo i-clone o i-version ang project |
| **VS Code / Cursor** | https://code.visualstudio.com/ o https://cursor.com | Para i-edit ang code at `.env` |
| **7-Zip / WinRAR** | — | Kung i-zip mo ang buong folder bago ilipat |

---

## 2. Online accounts na kailangan (gawin sa browser)

Hindi ito na-i-install sa laptop — online accounts lang. **Isang Supabase project** ang ginagamit ng parehong portal.

| Service | Sign up | Ginagamit para sa |
|---------|---------|-------------------|
| **Supabase** | https://supabase.com | Database, login, enrollment, schedules |
| **Gmail App Password** | https://myaccount.google.com/apppasswords | Email sa student (approval, enrollment) |
| **OpenRouter** (optional) | https://openrouter.ai/keys | AI Auto-Schedule sa admin |
| **Groq** (optional fallback) | https://console.groq.com/keys | Backup AI scheduler |
| **Google Gemini** (optional fallback) | https://aistudio.google.com/apikey | Backup AI scheduler |

---

## 3. Paano ilipat ang project sa ibang laptop

1. **Kopyahin ang buong folder:**
   ```
   Enrollment systemproject/
   ```
   Kasama ang:
   - `ENROLLSYSTEM/`
   - `ENROLLSYSTEM-ADMIN/`
   - `.env` files (kung meron na — **importante ito**)

2. **Ilagay sa bagong laptop**, hal.:
   ```
   C:\Users\<username>\Desktop\Enrollment systemproject\
   ```

3. Kung **walang `.env`**, gawin ang Step 4 below.

4. **Huwag i-delete** ang `uploads/` at `data/` kung may existing records na.

---

## 4. I-configure ang `.env` (importante)

May **dalawang hiwalay na `.env`** — isa bawat portal.

### Student portal — `ENROLLSYSTEM/.env`

```powershell
cd ENROLLSYSTEM
copy .env.example .env
notepad .env
```

Ilagay ang values mula sa Supabase Dashboard → **Project Settings → API**:
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`

Gmail (para sa enrollment emails):
- `GMAIL_USER`
- `GMAIL_APP_PASSWORD`

### Admin portal — `ENROLLSYSTEM-ADMIN/.env`

```powershell
cd ENROLLSYSTEM-ADMIN
copy .env.example .env
notepad .env
```

Same Supabase keys, plus:
- `OPENROUTER_API_KEY` — para sa AI Auto-Schedule (optional pero recommended)

> **Tip:** Pwede mong i-copy ang `.env` mula sa lumang laptop — same Supabase project, same keys.

---

## 5. Supabase database setup (gawin sa Supabase SQL Editor)

Buksan: https://supabase.com → iyong project → **SQL Editor**

**I-run ang mga SQL file sa ganitong order** (mula sa `ENROLLSYSTEM-ADMIN/supabase/` — pareho lang ang copies sa `ENROLLSYSTEM/supabase/`):

| Order | File | Description |
|-------|------|-------------|
| 1 | `schema.sql` | Main tables (students, faculty, enrollments, etc.) |
| 2 | `faculty-strands-rooms.sql` | Strands, rooms, faculty links |
| 3 | `seed-shs-curriculum.sql` | SHS curriculum subjects |
| 4 | `enrollment-workflow.sql` | Enrollment RPCs, notifications, pending list |
| 5 | `schedule-sync.sql` | Schedule save/sync functions |
| 6 | `apply-auto-schedule.sql` | Auto-schedule apply to DB |
| 7 | `publish-schedules.sql` | Publish schedules to students |

**Optional seed data:**

| File | Description |
|------|-------------|
| `seed-faculty.sql` | Default admin/faculty account |
| `seed-professors-subjects.sql` | Sample professors at subjects |
| `seed-enrollment-schedules.sql` | Sample schedule data |

**Kung may existing database na** at nag-update lang ng code, i-re-run lang ang updated files (lalo na `enrollment-workflow.sql` at `schedule-sync.sql`).

---

## 6. Paano i-run ang system

Kailangan **dalawang terminal** — isa para sa student, isa para sa admin.

### Terminal 1 — Student Portal (port 8000)

```powershell
cd "C:\Users\<username>\Desktop\Enrollment systemproject\ENROLLSYSTEM"
python main.py
```

Buksan: **http://localhost:8000**

### Terminal 2 — Admin Portal (port 8001)

```powershell
cd "C:\Users\<username>\Desktop\Enrollment systemproject\ENROLLSYSTEM-ADMIN"
python main.py
```

Buksan: **http://localhost:8001/login.html**

> Palitan ang path kung iba ang location ng folder mo.

---

## 7. Default login (kung na-run ang `seed-faculty.sql`)

| Portal | Username / ID | Password |
|--------|---------------|----------|
| **Admin** | `FAC-2026-0001` | `faculty123` |

Student accounts — galing sa admission approval o manual add sa admin.

---

## 8. Quick checklist bago ipasa sa ibang laptop

```
[ ] Na-install ang Python 3.10+ (with PATH)
[ ] Na-copy ang buong "Enrollment systemproject" folder
[ ] May .env sa ENROLLSYSTEM/ at ENROLLSYSTEM-ADMIN/
[ ] Na-setup ang Supabase project (SQL files na-run)
[ ] May internet connection
[ ] Na-test ang python main.py sa both folders
[ ] Student portal opens: localhost:8000
[ ] Admin portal opens: localhost:8001
```

---

## 9. Common problems

### `python is not recognized`
- Re-install Python at i-check ang **"Add Python to PATH"**
- O subukan: `py main.py` instead of `python main.py`

### `ImportError` sa server.py
- Siguraduhing nasa tamang folder ka (`ENROLLSYSTEM` o `ENROLLSYSTEM-ADMIN`)
- I-run: `python main.py` (hindi `python server.py` directly unless alam mo ang setup)

### Walang data / empty pages
- Check ang `.env` — tama ba ang Supabase URL at keys?
- Na-run ba ang SQL migrations sa Supabase?

### Admin pending enrollments walang laman
- I-re-run ang `enrollment-workflow.sql` sa Supabase SQL Editor
- Restart ang admin server

### AI Auto-Schedule hindi gumagana
- Lagyan ng `OPENROUTER_API_KEY` ang `ENROLLSYSTEM-ADMIN/.env`
- May internet connection
- Pwede pa rin gamitin ang rule-based scheduler kahit walang AI key

### Port already in use
- Isang instance lang dapat per portal
- O palitan sa `.env`: `PORT=8002` (admin) / `PORT=8003` (student)

---

## 10. System architecture (simple)

```
Browser (Student)  →  localhost:8000  →  ENROLLSYSTEM/server.py
Browser (Admin)    →  localhost:8001  →  ENROLLSYSTEM-ADMIN/server.py
                              ↓
                    Supabase (cloud database)
                              ↓
              Gmail SMTP (emails) · OpenRouter (AI schedule)
```

- **Frontend:** HTML, CSS, JavaScript (Supabase JS mula sa CDN — kailangan ng internet)
- **Backend:** Python built-in HTTP server
- **Database:** Supabase (PostgreSQL sa cloud)

---

## 11. Folder reference

| Folder | Port | Purpose |
|--------|------|---------|
| `ENROLLSYSTEM/` | 8000 | Student login, enrollment, grades, schedule view |
| `ENROLLSYSTEM-ADMIN/` | 8001 | Admin dashboard, admission review, auto-schedule, faculty/rooms |

Mas detalyadong docs:
- `ENROLLSYSTEM/README.md` — student portal
- `ENROLLSYSTEM-ADMIN/README.md` — admin portal

---

## 12. Minimum requirements summary

| Item | Required? |
|------|-----------|
| Python 3.10+ | ✅ Yes |
| pip packages | ❌ No |
| Node.js / npm | ❌ No |
| Supabase account | ✅ Yes |
| Gmail App Password | ✅ Yes (for emails) |
| OpenRouter API key | ⚪ Optional (AI schedule) |
| Internet | ✅ Yes |

---

**Geranova Senior High School — Enrollment Management System**
