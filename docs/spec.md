# Interview Mirror — MVP Scope and Product Decisions

**Product:** Interview Mirror  
**Version:** MVP 1.0  
**Audience:** IT professionals preparing for job interviews  
**Product type:** AI-powered interview preparation website  
**Status:** Scope defined; implementation not yet started

## 1. Product vision

Interview Mirror helps IT professionals prepare for technical, behavioral, and role-specific interviews through realistic AI-led practice, useful feedback, and progress tracking.

**Core journey:** Configure interview → Practice with AI → Review feedback → Track progress → Retry and improve.

The product should teach users *why* an answer was strong or weak, not merely assign scores.

## 2. Decisions made during brainstorming

| Topic | Decision | Notes |
|---|---|---|
| Product concept | All-in-one interview preparation | Mock interviews, coaching, review, and progress tracking |
| Target audience | IT professionals | Emphasis on software and related IT roles |
| Interview categories | Technical, behavioral, role-specific | All three supported |
| Interaction modes (vision) | Text, voice, video | MVP uses text and voice; video is later |
| AI interviewer | Realistic, conversational | Natural follow-ups and challenges to vague answers |
| Feedback | Complete feedback | Technical and communication feedback with actionable advice |
| Progress | Visual dashboard | History, scores, weaknesses, and trends |
| Personalization | Role, level, interview type, optional job description | Quick Start or custom setup |
| Accounts | Required | Email/password in MVP |
| Session duration (earlier choice) | User-selectable 10/20/30/60 min | **Superseded** by question-based sessions below |
| Review (long-term) | Transcript, recordings, AI highlights | MVP saves transcripts and feedback, not raw audio/video recordings |
| Assistance | Practice Mode and Real Interview Mode | Hints only in Practice Mode |
| Interviewer appearance (vision) | 3D avatar | Post-MVP |
| Avatar selection (vision) | Multiple avatars | Post-MVP |
| Languages (vision) | Multilingual | English first for MVP |
| Coding interview capability (vision) | Verbal questions, code editor, interactive coding | Verbal technical interviews in MVP; editor and interactive coding later |
| Feedback timing | Mode-based | Immediate in Practice Mode; at end in Real Interview Mode |
| Post-interview options | Review, retry, suggested practice | Included in product experience |
| MVP breadth | Simple MVP | Keep advanced interaction features for later |
| Question source | Hybrid | Curated questions + AI-generated questions and follow-ups |
| Session ending | Question-based | **Latest decision:** replaces strict duration-based ending |
| Main question count | 5, 10, or 15 | Follow-ups do not count toward main limit |
| Difficulty | Adaptive | Adjust based on answers; start from selected/profile level |
| Evaluation | Numerical + written | 1–10 scores, explanations, stronger answer examples |
| Saving | Automatic | Completed interviews saved automatically |
| Early ending | Save partial results | Incomplete sessions receive feedback based on answered questions |
| History | Search and filters | Role, interview type, date, score |
| Dashboard | Visual | Charts, strengths, weaknesses, score trends |
| Authentication | Email and password | Register, login, logout, reset password |
| Interview start | Quick Start + Custom Setup | Defaults or full configuration |

## 3. MVP features

### 3.1 User accounts and profile

- Register, log in, log out, and reset password with email/password.
- Professional profile: name, email, target IT role, experience level, and preferred language.
- Quick Start reuses saved preferences.
- Users may delete saved interviews.

### 3.2 Interview setup

- Choose technical, behavioral, or role-specific interview.
- Choose target role and starting experience level (Junior, Middle, Senior).
- Choose Practice Mode or Real Interview Mode.
- Choose text or voice interaction.
- Choose 5, 10, or 15 main questions.
- Optionally paste a job description to tailor questions.
- Use Quick Start to begin with default or saved settings.

### 3.3 AI interview experience

- Natural AI-led conversation with relevant follow-up questions.
- Hybrid source of curated and AI-generated questions.
- Difficulty adapts to how well the user answers, starting at an appropriate experience level.
- Follow-up questions do not count against the selected main question total.
- Session ends after the chosen number of main questions, or when the user ends it early.
- Display elapsed time without a hard time cutoff.
- Voice mode: AI asks aloud, user responds by microphone, and a transcript is available.
- Text mode: users type answers.

### 3.4 Two interview modes

| Behavior | Practice Mode | Real Interview Mode |
|---|---|---|
| Hints/explanations during interview | Yes | No |
| Feedback during interview | Yes | No |
| Final report | Yes | Yes |
| Adaptive questions | Yes | Yes |
| Natural follow-ups | Yes | Yes |

### 3.5 Feedback and review

- Numerical scores from 1–10 and written feedback for each applicable category.
- Evaluation categories: accuracy, completeness, clarity, and structure.
- Explain what went well, what was missing, and how to make the response stronger.
- Give example improved answers and identify recurring weak areas.
- Show transcripts and important answer highlights.
- Scores are **AI coaching estimates**, not objective measures of hiring readiness.
- Do not pretend to measure visual confidence or body language in text/voice-only sessions.

### 3.6 Interview history and incomplete results

- Save completed sessions automatically.
- When users manually end early, save completed answers and generate partial feedback.
- Mark early-ended sessions **Incomplete**.
- Browse past sessions; search or filter by role, interview type, date, and score.
- Users can review past responses, retry an interview, or work on recommended weak areas.
- Save text transcripts and reports, but **do not permanently store raw audio in the MVP**.

### 3.7 Progress dashboard

- Total completed interviews and recent activity.
- Average scores and performance trends over time.
- Charts showing progress by relevant evaluation categories.
- Repeated strengths and weaknesses, plus personalized practice suggestions.
- Prefer like-for-like comparisons (e.g. similar interview types) to avoid misleading progress claims.

## 4. Remaining decisions made by the assistant, with rationale and alternatives

### Decision 1 — Professional Profile

**Chosen:** Name, email, target IT role, experience level, preferred language.  
**Why:** Useful Quick Start personalization without burdensome onboarding.  
**Other options:** Basic name/email only (too little personalization); detailed career profile with CV and skills (too much for MVP).

### Decision 2 — Six starting IT roles

**Chosen:** Frontend Developer, Backend Developer, Full Stack Developer, QA Engineer, Data Analyst, DevOps Engineer.  
**Why:** Broad enough to be useful while keeping question quality manageable.  
**Other options:** One role only (too narrow); all possible roles (too broad).

### Decision 3 — English for the first release

**Chosen:** English interviews and feedback; profile can retain language preference for expansion.  
**Why:** Reduces complexity in voice recognition and evaluation.  
**Other options:** English/Russian; English/Russian/Kazakh; fully multilingual from day one.

### Decision 4 — Quick Start plus custom setup

**Chosen:** Start using saved defaults, or configure interview details and optionally paste a job description.  
**Why:** Fast repeat usage without limiting targeted preparation.  
**Other options:** Mandatory configuration every time; AI-guided setup chat.

### Decision 5 — Adaptive difficulty with an initial level

**Chosen:** Start from Junior/Middle/Senior and adjust during the interview.  
**Why:** Avoids giving inappropriate initial questions while preserving adaptive behavior.  
**Other options:** Entirely fixed difficulty; same starting difficulty for everyone.

### Decision 6 — Voice without an avatar in MVP

**Chosen:** Spoken questions and microphone responses, with transcript displayed.  
**Why:** Delivers realistic spoken practice without the complexity of animated characters.  
**Other options:** Text only; video; 3D interviewer.

### Decision 7 — Four feedback categories

**Chosen:** Accuracy, completeness, clarity, structure, each scored when applicable.  
**Why:** More actionable than one overall score; easier to interpret than dozens of metrics.  
**Other options:** Single score; prose only; many narrow criteria.

### Decision 8 — Separate assistance rules for two modes

**Chosen:** Hints and immediate feedback in Practice Mode; no live assistance in Real Interview Mode.  
**Why:** Separates learning from realistic assessment.  
**Other options:** One universal interview behavior.

### Decision 9 — Question-based sessions

**Chosen:** 5/10/15 main questions, follow-ups not counted, with early ending allowed.  
**Why:** Matches the user's latest explicit choice and avoids abruptly cutting off answers.  
**Other options:** Strict timer; both time and question limits; unlimited sessions.

### Decision 10 — Visual dashboard, without full AI study plans

**Chosen:** Totals, averages, trends, strengths and weaknesses.  
**Why:** Meaningful progress indicators with reasonable first-release scope.  
**Other options:** Only basic counts; full personalized study-plan engine.

### Decision 11 — Automatic saving, user control, limited recording retention

**Chosen:** Save completed and explicitly early-ended sessions, allow deletion, retain transcripts but not permanent raw audio.  
**Why:** Supports review while reducing privacy and storage burden.  
**Other options:** Full audio/video storage; scores only.

### Decision 12 — Evidence-based AI feedback

**Chosen:** Feedback refers to actual answers, recognizes valid alternatives, and communicates uncertainty.  
**Why:** Prevents misleading technical coaching.  
**Other options:** Unrestricted AI scoring; inflexible exact-answer matching.

### Decision 13 — Six main website areas

**Chosen:** Dashboard, Interview Setup, Interview Room, Interview Results, Interview History, Profile & Settings. Supporting pages: register, login, password recovery.  
**Why:** Covers the full user journey without unnecessary navigation.  
**Other options:** One giant page; many narrowly separated feature pages.

## 5. Main website pages

1. **Dashboard:** Overview, Quick Start, statistics, score trends and recommended practice.
2. **Interview Setup:** Role, interview type, experience level, mode, question count and optional job description.
3. **Interview Room:** Text/voice conversation, current question, elapsed time, allowed practice hints, early-end action.
4. **Interview Results:** Scores, rationale, stronger example answers, transcript, highlights and retry recommendations.
5. **Interview History:** Saved sessions, incomplete/completed labels, search, filters and deletion.
6. **Profile & Settings:** Professional preferences, email/password settings and account controls.

## 6. Example user journey

1. A Junior Backend Developer registers and chooses Backend Developer as their target role.
2. They configure a **Technical** interview in **Real Interview Mode**, using **Voice**, with **5 main questions**.
3. AI asks: “Can you explain the difference between SQL and NoSQL databases?”
4. After the answer, AI follows up: “When would you choose a relational database?”
5. The interview ends after five main questions (plus any follow-ups).
6. The user receives an illustrative overall score, for example **7.5/10**, plus category feedback explaining strengths and missing concepts.
7. The session and transcript are saved automatically.
8. The dashboard updates, and the user may retry or practice relevant database topics.

## 7. Excluded from the first release

| Later feature | Reason to defer |
|---|---|
| 3D interviewer | Complex rendering, lip sync and real-time animation |
| Multiple selectable avatars | Depends on avatar system |
| Video interviews | Additional recording and privacy challenges |
| Built-in coding editor | Separate substantial feature |
| Interactive AI coding interviews | Depends on coding editor and reliable evaluation |
| Full multilingual interviews | Additional speech, feedback, and quality testing |
| Advanced AI learning plans | Requires enough performance history to be useful |
| Playback of stored raw audio/video | Storage, consent, and privacy considerations |

## 8. MVP acceptance checklist

- [ ] User can register, securely log in, log out and recover their account.
- [ ] User can edit professional profile and preferences.
- [ ] User can start an interview with Quick Start or Custom Setup.
- [ ] Interview supports selected IT role, type and 5/10/15 questions.
- [ ] User can respond in text or voice.
- [ ] AI asks natural follow-ups and adapts difficulty.
- [ ] Practice Mode offers hints and immediate feedback.
- [ ] Real Interview Mode provides feedback only after the session.
- [ ] User receives understandable scores and actionable written feedback.
- [ ] User can end early and receive partial results.
- [ ] Completed and early-ended sessions are saved in history.
- [ ] User can filter/search history and delete sessions.
- [ ] Dashboard shows meaningful performance charts and weak areas.
- [ ] User can review, retry, and practice recommended topics.
- [ ] Feedback is presented as approximate AI coaching, not hiring certainty.

## 9. Final product principle

**Do not expand the MVP further until the core interview → feedback → improvement experience works reliably.**

The first version is intentionally **text and voice, not video/3D**. The long-term vision remains a flexible, multilingual, avatar-powered interview preparation experience with coding interviews and deeper analytics.
