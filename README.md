# PassSection Quiz Platform

A bilingual (English / हिन्दी) assessment portal for the Pass Section team. Participants take a
one-question-at-a-time exam; answers and detailed timings are written to Excel; results unlock for
each participant a set number of days after they submit. There is **no database**: everything is
stored in `.xlsx` files.

- **Frontend:** React + Vite (`frontend/`)
- **Backend:** Node.js + Express (`backend/`)
- **Storage:** Supabase Postgres when `SUPABASE_URL` is set (needed on Netlify); otherwise Excel files via SheetJS in `backend/data/`. The Excel report is always available as a download
- **Auth:** username + password, bcrypt-hashed passwords, signed session cookie

---

## 1. Run it locally

Requirements: **Node.js 18+** (20 or 22 recommended).

```bash
git clone <this repo> pass-section-quiz
cd pass-section-quiz
cp .env.example .env         # then edit .env (see below)
npm install                  # installs root, backend and frontend packages
npm run dev                  # API on :4000, web app on http://localhost:5173
```

Open <http://localhost:5173> and sign in as `admin` with the password from `.env`.

To run the production build locally:

```bash
npm run build                # builds frontend/dist
npm start                    # serves app + API on http://localhost:4000
```

Run the backend tests with `npm test`.

## 2. Set the admin password (`.env`)

```ini
ADMIN_PASSWORD=choose-a-strong-password
SESSION_SECRET=<long random string>
```

- The admin username is always **`admin`**. The password comes only from `ADMIN_PASSWORD`, and
  admin login is disabled until it is set.
- Generate a session secret with
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
  If `SESSION_SECRET` is missing, a random one is used and everyone is logged out whenever the server restarts.
- Optional settings: `PORT` (default 4000), `DATA_DIR` (where Excel files are kept), `TIMEZONE`
  (default `Asia/Kolkata`, used for times written to Excel), and `COOKIE_SECURE=false` if you serve
  production over plain HTTP.

## 3. Add your first exam and participants

1. Sign in as **admin**. Go to **Exams → + Create new exam**.
2. Fill in the title, team, site, date, instructions (EN + HI), the result unlock delay (default 10 days)
   and the estimated time.
3. Two sections are pre-filled (Knowledge, Behaviour). Add, rename or remove sections as needed.
4. Add questions one by one with **+ Add question**, or click **Bulk import (JSON)** and paste an array of
   questions. See `backend/data/sample-questions.json` for ready-made examples:

   ```json
   [
     {
       "type": "KNOWLEDGE",
       "category": "TAEP Fundamentals",
       "textEn": "Question in English",
       "textHi": "प्रश्न हिन्दी में",
       "options": [
         { "en": "Option A", "hi": "विकल्प A" },
         { "en": "Option B", "hi": "विकल्प B" },
         { "en": "Option C", "hi": "विकल्प C" },
         { "en": "Option D", "hi": "विकल्प D" }
       ],
       "correct": "B",
       "explanation": "Optional — appears only in the Answer Key sheet"
     }
   ]
   ```

   `type` should be `KNOWLEDGE` or `BEHAVIOUR`. The Knowledge % and Behaviour % used in the remarks
   are calculated from this tag.
5. Adjust the **remarks thresholds** if needed, then click **Save exam**.
6. Open the exam and add participants:
   - **+ Add participant:** name, username and password, or
   - **Bulk upload CSV:** a file with the header `name,username,password`:

     ```csv
     name,username,password
     Asha Singh,asha.singh,Welcome@123
     Ravi Kumar,ravi.kumar,Welcome@456
     ```

   Give each participant their username and password. The **Participants** page lists every user and
   lets you assign an existing user to another exam.

**Exam status:** `Active` (participants can start it), `Closed` (no new starts), or `Results Released`
(everyone who submitted sees their result straight away, whatever the unlock date).

## 3a. Import the PassSection question database (fastest)

If you have the **PassSection database JSON** (questions, answer key, behaviour scoring, remark rules and staff roster in
one file):

1. Sign in as `admin` and open **Import**.
2. Choose the JSON file. The page shows what it contains (question counts, staff, remark rules, dimensions, suggested
   times) and lists the staff it will create.
3. Check the exam details (title, team, site, date, instructions in EN/HI, unlock delay, partial credit), then click
   **Import**.

This creates:
- one exam with a **Knowledge** and a **Behaviour** section, all bilingual questions and scenarios, and the answer key;
- the behaviour scoring model: best answer = full credit, other *preferred* answers = partial credit (50% by default),
  *concern* answers flagged for the admin, and what each option reveals (admin only);
- the weight and scoring dimension of each question, with bilingual dimension labels;
- your remark rules (checked in order, first match wins) and suggested seconds per question type;
- a login for every staff member (initial password from the file, stored as a bcrypt hash), assigned to the exam.

The file's `admin` row is ignored. The admin password is always the `ADMIN_PASSWORD` setting.

> **Keep this file private.** It contains the answer key and everyone's initial passwords. Upload it through the admin
> page only. Never commit it to the repository, which is public. `.gitignore` blocks the usual file names.

## 4. The participant experience

- The login page has an EN/HI toggle. The choice is saved in the browser (`localStorage`).
- Before starting, the participant sees the title, team, site, date, instructions, and the question,
  section and time counts. **Begin Exam** starts the timer.
- Questions appear one at a time, with a progress bar, section label, flag button, previous/next buttons
  and a small per-question timer. The palette colours are grey (not visited), outlined (visited),
  blue (answered) and orange (flagged). On a phone it slides in from the side.
- Every selection is saved to the server straight away. Refreshing or reconnecting resumes where the
  participant left off.
- The review screen lists answered, unanswered and flagged questions. Submitting asks for confirmation
  and warns about unanswered questions without blocking submission.
- After submitting, the thank-you page shows the unlock date in both languages and a live countdown.
- After the unlock date the participant sees a result card: total score, per-section %, time taken,
  a gauge, and bilingual remarks. It never shows a leaderboard or anyone else's data.

## 5. Download Excel results

On an exam's page (or in the exam list), click **⬇ Download Excel**. The file is named
`[ExamTitle]_[Date]_Results.xlsx` and contains:

| Sheet | Contents |
|---|---|
| Participants Summary | Name, username, exam, team, site, start/end/total time, time per section, answered/unanswered/flagged, score % per section, total %, remarks, unlock date, submitted on (plus correct count, Knowledge %, Behaviour %, time on flagged questions) |
| Question-wise Responses | One row per participant per question: section, category, question text, option selected, time on question (first display → last answer), active time, times changed, flagged, correct Y/N |
| Answer Key | Question no, correct option, category, explanation |
| Analytics | Average score per question, most flagged, average time per question, section-wise performance, participant rank. Regenerated on every submission and download |
| Sections / Questions | The bilingual question bank the exam is served from |

The same file is kept up to date on the server (`backend/data/exams/`) after every submission, and
past exams stay available for download.

The **Analytics** tab in the dashboard shows the same analysis as charts: score distribution, time
distribution, section averages, question accuracy, most flagged questions and ranking.

## 6. Deploy (free tier)

Excel files are written to disk, so **production needs a persistent disk**. Without one, results are
lost on every redeploy or restart. Always download the Excel files regularly as a backup.

### Railway

1. Create a new project from this GitHub repo.
2. **Variables:** `ADMIN_PASSWORD`, `SESSION_SECRET`, `DATA_DIR=/data`, `NODE_ENV=production`.
3. **Volume:** add a volume mounted at `/data`.
4. **Settings → Build command:** `npm install && npm run build`. **Start command:** `npm start`.
5. Deploy and open the generated domain.

### Render

1. **New → Web Service**, then connect this repo.
2. Runtime: Node. **Build command:** `npm install && npm run build`. **Start command:** `npm start`.
3. **Environment:** `ADMIN_PASSWORD`, `SESSION_SECRET`, `NODE_ENV=production`, `DATA_DIR=/var/data`.
4. Add a **Persistent Disk** mounted at `/var/data`. Render's free instances have no persistent disk
   and are wiped on restart, so use a paid instance with a disk for real exams, or download the Excel
   right after each exam.

Any other Node host works the same way: `npm install && npm run build`, then `npm start`.

### Netlify + Supabase (recommended, no server to manage)

On Netlify the whole app runs in one site: the React pages are static files, and the API runs as a
Netlify Function (`netlify/functions/api.js`). Netlify has no permanent disk, so data is stored in a
free **Supabase** Postgres database. Excel reports are generated from it whenever you click
**Download Excel**.

**1. Create the database (Supabase, free)**
1. Sign up at <https://supabase.com> and click **New project**. Pick a region close to your users
   (e.g. Mumbai) and any database password.
2. When the project is ready, open **SQL Editor → New query**, paste the whole of
   [`supabase/schema.sql`](supabase/schema.sql) and click **Run**. It creates the `psq_*` tables and
   the audit log, and is safe to run again. **Run it again after updating the app**, because it adds any new columns.
3. Open **Project Settings → API** and copy:
   - **Project URL**, e.g. `https://abcdefgh.supabase.co`
   - the **service_role** secret key (not the anon key). Keep it secret: it is only ever used on
     the server.

**2. Deploy on Netlify**
1. **Add new site → Import an existing project**, then pick this GitHub repo and branch.
   `netlify.toml` already sets everything (build command `npm run build`, publish `frontend/dist`,
   functions in `netlify/functions`).
2. **Site configuration → Environment variables**. Add:

   | Key | Value |
   |---|---|
   | `ADMIN_PASSWORD` | the admin login password |
   | `SESSION_SECRET` | a long random string |
   | `SUPABASE_URL` | the Project URL from step 1 |
   | `SUPABASE_SERVICE_ROLE_KEY` | the service_role key from step 1 |

3. **Deploys → Trigger deploy → Clear cache and deploy site**.
4. Check `https://<your-site>.netlify.app/api/health`. It should show
   `{"ok":true,"store":"supabase",...}`. If it doesn't, the message says what is missing.
5. Sign in as `admin`.

Notes:
- The public anon key cannot read anything: every table has Row Level Security on with no policies,
  and only the server uses the service_role key.
- Large CSV uploads are sent in batches of 50 rows to stay within Netlify's function time limit.
- The same Supabase settings also work on Railway/Render or locally. Without them, the app stores
  Excel files on disk as before.

## Scoring model

- Every question is worth its **weight** in points (default 1).
- **Full credit**: the best answer, plus any other option marked "also full credit".
- **Partial credit**: acceptable options earn a set percentage of the points (default 50%, set per exam).
- **Neutral / concern / wrong / unanswered**: 0 points. Concern answers are counted and listed for the admin.
- Section, Knowledge, Behaviour, dimension and total percentages are *points earned ÷ points possible*.
- **Remarks**: if the exam has remark rules, they are checked in order and the first match is shown (conditions like
  `total_pct >= 70 and knowledge_pct >= behaviour_pct + 20`, evaluated safely on the server). Without rules, the threshold
  remarks are used. Editing rules or thresholds updates remarks for results already submitted.
- Participants see their total, section scores, a per-dimension breakdown and the remark. They never see the answer key,
  what their answers reveal, their concern count or their integrity signals.

## Audit trail

Every login attempt, login, logout, session timeout, exam start, question view, navigation (button, palette or review),
answer, answer change, flag, language switch, tab hide/show (Page Visibility API), review screen, submit attempt, submit,
result view and admin action (create/import exam, add participant, view result, download, threshold or rule change,
status change, reset) is recorded. Times are ISO 8601 UTC, each login gets a random session ID, and IP addresses are
stored only as keyed SHA-256 hashes.

Each entry stores the SHA-256 hash of the previous entry, so editing, deleting or re-ordering any entry breaks the chain.
In Supabase the chain is computed by a database trigger under a lock (safe with many users at once), and the table rejects
updates and deletes. **Admin → Audit log** lets you filter entries, **Verify integrity** (recomputes every hash) and
download everything as Excel. Each exam's Excel download also includes an `Audit_Log` sheet for that exam.

The Analytics tab shows **integrity signals** per participant (tab switches, time away from the exam tab, answer changes,
language switches). The exam instructions tell participants that leaving the tab is recorded.

## Capacity and reliability

**Load test** (Supabase-style database, all 66 questions, everyone at the same moment):

| | |
|---|---|
| Participants at once | 100, each clicking non-stop (about 30× faster than people really answer) |
| Requests | ~14,000 in 70 s, **0 server errors** |
| Submissions recorded | 100 of 100, 66 answers each |
| Saves deliberately dropped | 325 → **all recovered**, 0 wrong answers |
| Audit log | 21,952 entries, chain verified intact |

How answers are protected:
1. **Autosave on every click.** Each person's progress is saved in its own database row, so participants never
   block or overwrite each other.
2. **Retries.** A failed save is retried automatically and then again every few seconds. Meanwhile the participant
   sees "Connection problem — your answers are kept on this device…".
3. **On-device copy.** Answers are also stored in the browser until submission, so a refresh or a dropped connection
   loses nothing.
4. **Recovery at submit.** Submission sends every answer shown on screen, and the server fills in any save that never
   arrived (recorded in the audit log as `recovered_at_submit`).
5. **Results are stored at submission.** Scores, the question-wise answers and the audit trail are written to the
   database when each person submits. Nothing depends on a later step.

Practical limits on the free tiers:
- **Supabase free projects pause after about a week without activity.** Open the site (or `/api/health`) the day before
  the exam. Consider the Pro plan for automatic daily backups.
- Netlify Functions return files up to about 6 MB. If an exam's Excel file would be larger (more than about 100–150
  participants with full click logs), the per-click audit rows are left out of that file. The complete log is always
  available from Admin → Audit log.
- Netlify free includes 125,000 function requests a month. One participant uses about 150–250.
- **After every exam, download the Excel file and the audit log** as your own offline record.

## 7. Security notes

- The answer key is stored in the exam workbook and read only by the scoring code on the server.
  No participant API response includes correct options or explanations, and a test checks this.
- All scoring happens on the server when the participant submits. Timings are stamped with the
  server clock.
- Participants can read only their own result, and only after the unlock date (or once the exam is
  set to *Results Released*). Other participants' names and scores are never sent to them.
- Admin can see all results from day 0.
- Passwords are hashed with bcrypt (`bcryptjs`). Login errors never say which field was wrong, and
  repeated failures are rate-limited.
- Sessions are signed, `httpOnly`, `SameSite=Lax` cookies (HTTPS-only in production). Every API route
  is protected by the `authCheck` and `roleCheck` middleware.
- Participant data lives in `backend/data/`, which is excluded from git.

## Project structure

```
pass-section-quiz/
├── frontend/                 React + Vite
│   └── src/
│       ├── pages/            Login, ParticipantHome, Exam, Review, ThankYou, Result, AdminDashboard
│       ├── components/       palette, countdown, charts, gauge, admin/* (editor, detail, participants, settings)
│       ├── context/          AuthContext, LanguageContext
│       └── lang/             en.js, hi.js (all UI strings)
├── backend/                  Express
│   ├── routes/               auth, exam, result, admin
│   ├── middleware/           authCheck, roleCheck
│   ├── services/             excelService, scoringService, timerService, store/ (fileStore, supabaseStore)
│   ├── data/                 Excel files (runtime; git-ignored)
│   ├── test/                 API tests (node --test)
│   └── server.js
├── netlify.toml              Netlify build + /api → function rewrite
├── netlify/functions/api.js  Express API as a Netlify Function
├── supabase/schema.sql       Database tables for Supabase
├── .env.example
└── package.json
```

## Notes

- **Remarks** are built from the total score band plus, when Knowledge and Behaviour differ by the
  "gap" threshold or more, a focus-area remark. If you change the thresholds on an exam, the remarks
  in Excel and on result cards update automatically.
- **Reset** (Participants tab) deletes one participant's attempt and their Excel rows so they can
  retake the exam.
- Editing questions after people have submitted does not re-score existing submissions.
- Storage is designed for team-sized use (hundreds of participants per exam). Every write rewrites the
  relevant `.xlsx` file, and writes are serialised within the single Node process, so run **one**
  instance.
