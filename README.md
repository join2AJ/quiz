# PassSection Quiz Platform

A bilingual (English / हिन्दी) assessment portal for the Pass Section team. Participants take a
one-question-at-a-time exam; answers and detailed timings are written to Excel; results unlock for
each participant a set number of days after they submit. There is **no database**: everything is
stored in `.xlsx` files.

- **Frontend:** React + Vite (`frontend/`)
- **Backend:** Node.js + Express (`backend/`)
- **Storage:** Excel files via SheetJS (`xlsx`) in `backend/data/` (or `DATA_DIR`)
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

### Netlify (frontend only) + Railway/Render (backend)

Netlify serves static files only. It cannot run the Express server or keep the Excel files, so the
backend **must** run on Railway or Render as described above. Netlify can host the frontend and
forward `/api/*` to the backend.

1. Deploy the backend on Railway or Render first (steps above) and note its URL, e.g.
   `https://pass-section-quiz.up.railway.app`. Add the variable `TRUST_PROXY=2` there.
2. In Netlify, import this repo. `netlify.toml` already sets the build: base directory `frontend`,
   command `npm run build && node netlify-redirects.mjs`, publish directory `dist`.
3. In Netlify, go to **Site configuration → Environment variables** and add
   `BACKEND_URL = https://pass-section-quiz.up.railway.app` (your backend URL, without a trailing slash).
4. Trigger a new deploy. The build writes `dist/_redirects` so that:
   - `/api/*` is proxied to the backend (login cookies keep working because the browser only sees
     your Netlify domain), and
   - every other path serves `index.html`, so links like `/admin/exams/...` don't return
     "Page not found".

If the login page says **"Cannot reach the server"**, `BACKEND_URL` is missing or wrong, or the
backend is not running.

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
│   ├── services/             excelService, scoringService, timerService
│   ├── data/                 Excel files (runtime; git-ignored)
│   ├── test/                 API tests (node --test)
│   └── server.js
├── netlify.toml              Netlify build (frontend only; proxies /api to the backend)
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
