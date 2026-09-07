# Geranova EMS — Student Portal

Standalone **Student** application. No admin pages or faculty routes.

## Run

```bash
cd ENROLLSYSTEM
python main.py
```

Open: **http://localhost:8000/index.html**

## Setup

1. Copy `.env.example` → `.env`
2. Add Supabase URL + Publishable Key (+ Secret Key for server login)
3. Add Gmail for enrollment confirmation emails
4. Set `ADMIN_PORTAL_URL=http://localhost:8001` if admin runs on another host/port
5. Run SQL in `supabase/` as needed (`fix-approve-review.sql`, `strand-subject-validation.sql`, etc.)

## Directory Tree

```
ENROLLSYSTEM/               (Student portal)
├── main.py                 # Entry point (port 8000)
├── server.py               # Student API only
├── login.html              # Student login
├── enroll.html             # New admission wizard
├── index.html              # Student landing
├── student/                # Dashboard pages (home, enrollment, grades…)
├── js/                     # Student frontend scripts
├── css/
├── supabase/               # Shared SQL migrations
├── enrollment_curriculum.py
├── assets/  images/
├── uploads/admissions/
└── data/
```

## API Routes (Student only)

| Method | Path |
|--------|------|
| POST | `/api/auth/student` |
| POST | `/api/admission/submit` |
| GET | `/api/enrollment/offerings` |
| POST | `/api/enrollment/submit` |
| POST | `/api/payment/gcash/*` |
| GET | `/api/health` |

## Packages

**Python 3.10+** — no pip packages required (stdlib only).

## Admin Portal

Faculty/admin use the sibling folder: **`../ENROLLSYSTEM-ADMIN`** (port **8001**).

Run both at the same time:
- Student: `cd ENROLLSYSTEM && python main.py` → :8000
- Admin:   `cd ENROLLSYSTEM-ADMIN && python main.py` → :8001
