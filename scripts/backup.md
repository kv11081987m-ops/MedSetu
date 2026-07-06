# MedSetu — Database Backup & Restore

Supabase ka **Free plan** automatic backup nahi deta (daily backups
Pro plan se shuru hote hain). Jab tak plan upgrade nahi hota, backup
manual lena hoga — yeh scripts wahi karte hain.

---

## Ek baar ka setup

### 1. PostgreSQL client tools install karo

`pg_dump` (backup) aur `psql` (restore) chahiye — Windows par by
default nahi aate.

**Option A — Chocolatey (sabse aasaan, isi machine par already hai):**
```
choco install postgresql --params '/Password:temp-unused' -y
```
(Yeh password sirf ek local dummy Postgres server ke liye hai jo
choco install ke saath aata hai, use hoga nahi — humara asli DB
Supabase par hai, uska password alag jagah, neeche step 2 mein.)

**Option B — Direct installer:**
https://www.postgresql.org/download/windows/ se installer download
karo. Setup ke dauraan sirf **"Command Line Tools"** component check
karo — baaki (server, pgAdmin, etc.) uncheck kar sakte ho, zaroorat
nahi.

Install ke baad ek **naya** PowerShell/terminal window kholo (PATH
refresh hone ke liye), phir confirm karo:
```
pg_dump --version
psql --version
```

### 2. Connection details save karo (`.env.local`)

Repo root (`d:\MedSetu`) mein `.env.local` naam ki file banao
(already `.gitignore` mein hai — kabhi commit nahi hogi):

```
MEDSETU_DB_HOST=db.xyjkivjnetlpqeitncgc.supabase.co
MEDSETU_DB_PORT=5432
MEDSETU_DB_USER=postgres
MEDSETU_DB_NAME=postgres
MEDSETU_DB_PASSWORD=your-real-password
```

Yeh values kahan se milengi: **Supabase Dashboard → Project Settings
→ Database → Connection string**. HOST/PORT/USER/NAME "Direct
connection" ya "Session pooler" tab se le sakte ho (dono chalte hain
— "Transaction pooler" (port 6543) se bacho, pg_dump ke kuch
operations ke saath theek se kaam nahi karta). PASSWORD wahi hai jo
project banate waqt set kiya tha, ya Dashboard → Database → "Reset
database password" se naya bana sakte ho.

**Alag-alag fields kyun, ek `postgresql://` URL kyun nahi:** agar
password mein `@`, `#`, `%` jaisa koi special character ho (bahut
common hai) to ek single URL string mein woh galat jagah split ho
jaata hai aur connection fail hota hai — yeh exact problem pehle real
test mein aayi thi. Alag fields se yeh dikkat hi nahi aati.

⚠️ **Yeh password sirf `.env.local` mein rahega — kabhi kisi `.sql`
script, `.md` file, ya git commit mein NAHI jaayega.**

---

## Routine — kab chalana hai

**Har hafte, aur har bade SQL change se pehle** (RLS phase, schema
migration, koi bhi `migrations/0XX_*.sql` file run karne se pehle):

```
scripts\backup.bat
```

(double-click kar sakte ho, ya PowerShell mein
`powershell -ExecutionPolicy Bypass -File scripts\backup.ps1`)

Ek file ban jayegi: `backups\MedSetu_backup_2026-07-06_1530.sql`
(schema + data dono, poora database).

`backups\` folder git mein kabhi nahi jaata (`.gitignore` mein hai)
— isme real customer/order/prescription data hota hai. Yeh files
apne paas kahin surakshit rakho (external drive, Google Drive, jahan
bhi) — yeh repo ke saath push nahi hongi.

---

## Restore — jab wapas laana ho

⚠️ **RESTORE EXISTING DATA KO OVERWRITE/MIX KAR SAKTA HAI.** Kisi bhi
production database par chalane se pehle:
1. Pakka karo ki yeh sach mein zaroori hai (galti se latest backup
   restore karke naya data mit to nahi jaayega?).
2. Agar sirf kuch wapas laana hai (poora reset nahi), pehle ek AUR
   fresh backup le lo — taaki restore se theek pehle ka state bhi
   mehfooz rahe agar kuch galat ho jaaye.

Chalane ka tareeka:
```
scripts\restore.bat
```
(sabse latest `backups\` file automatically uthayega), ya specific
file ke liye:
```
powershell -ExecutionPolicy Bypass -File scripts\restore.ps1 -BackupFile backups\MedSetu_backup_2026-07-06_1530.sql
```

Script chalane se pehle poora warning dikhayega aur `RESTORE` type
karke confirm karwayega — bina confirm kiye kuch nahi hoga.

---

## Agar kuch fail ho

- **"pg_dump/psql nahi mila"** — Setup step 1 dobara karo, naya
  terminal window kholo.
- **".env.local nahi mila" / "MEDSETU_DB_HOST/PORT/USER/NAME/PASSWORD
  missing"** — Setup step 2 dobara karo, saari 5 lines check karo.
- **pg_dump connection error** — connection string check karo
  (password sahi hai? Dashboard se dobara copy karo), ya Supabase
  project pause to nahi hai (Free plan projects inactivity ke baad
  pause ho jaate hain — Dashboard se resume karo).
- **Backup file bani par size 0 KB ya bahut chhoti hai** — connection
  string galat database point kar rahi ho sakti hai, ya sirf schema
  mila data nahi (rare) — `Get-Content` se file khol ke dekho.
