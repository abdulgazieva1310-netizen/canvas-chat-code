# Interview Mirror MVP backlog

This is a build-from-scratch backlog based on [plan.md](plan.md), not an audit of the existing implementation. Each task is scoped for one development session and includes enough context to assign separately; use a small fixture or stub when a required integration is unavailable. Complete the stated verification as part of each task, use `uv` for backend dependencies, and commit each completed change.

## 1. Set up an empty project with a passing test
Goal: Establish a minimal, runnable development baseline.
Description: Create an empty frontend and backend project structure, using `uv` for backend dependency management, with documented installation and test commands. Add one smoke test that passes without credentials, network access, or application features; verify it from a clean dependency installation.

## 2. Define the MVP API contract
Goal: Give frontend and backend developers a shared integration reference.
Description: Document request, response, and error shapes for authentication, profile, interview setup, conversation, reports, history, and dashboard data. Include session statuses, nullable scores, ownership rules, and examples for text answers, code submissions, and early-ended sessions; validate the contract syntax.

## 3. Add persistent storage and migrations
Status: Complete. Versioned Alembic baseline and upgrade command added; verified empty-database upgrades, adoption of existing data, repeated upgrades, and persistence after reopening in `backend/tests/test_migrations.py` and the backend API suite.

Goal: Preserve users and interview data across application restarts.
Description: Configure a database through environment settings and introduce versioned migrations for users, authentication sessions, interviews, messages, and answer evaluations. Document local database setup and verify that migrations run on an empty database and stored records survive reopening it.

## 4. Build the application shell and page navigation
Goal: Provide a consistent layout for the six main website areas.
Description: Add navigation and placeholder routes for Dashboard, Interview Setup, Interview Room, Interview Results, Interview History, and Profile & Settings, plus authentication pages. Verify that links reach the intended routes and the layout works on narrow screens and with keyboard navigation.

## 5. Implement account registration
Goal: Let a user create an account with email and password.
Description: Build the registration API and form with validated input, securely hashed passwords, and duplicate-email handling. Verify successful registration and rejected invalid or duplicate submissions without exposing passwords or password hashes in responses.

## 6. Implement login and logout
Goal: Let registered users establish and revoke authenticated sessions.
Description: Add login and logout endpoints and UI using expiring server-validated credentials and secure browser session handling. Verify incorrect credentials, expiration, logout revocation, and restoration of a valid session after a page reload.

## 7. Enforce authenticated access and ownership
Goal: Keep each user's interview data private.
Description: Protect private frontend routes and backend interview, report, profile, and dashboard operations, returning users to their intended page after login. Verify with two accounts that neither can read, modify, or delete the other's interviews and that unauthenticated requests fail consistently.

## 8. Implement password reset token handling
Status: Complete. Added hashed, expiring single-use tokens, session revocation, local mailbox and SMTP adapters, migration `0002`, and recovery API contract. Verified in `backend/tests/test_password_reset.py`.

Goal: Support secure account recovery on the backend.
Description: Add reset requests and password replacement using expiring, single-use tokens stored securely, with a configurable email delivery adapter and local test mailbox. Verify token expiry, reuse rejection, invalidation of existing login sessions after reset, and indistinguishable reset-request responses for known and unknown emails.

## 9. Build password recovery pages
Status: Complete. Public recovery and reset forms connect to the recovery API, with expired-link, request-failure, confirmation, and success states. Verified frontend behavior in `frontend/src/test/recovery.test.tsx` and the mailbox-to-replacement-login flow in `backend/tests/test_password_reset.py`.

Goal: Let users request and complete a password reset.
Description: Add recovery and reset forms connected to the password-reset API, including clear handling for expired links and delivery failures. Verify the complete recovery flow with a test mailbox and confirm that the replacement password works for login.

## 10. Implement professional profile settings
Status: Complete. Profile form and API save name, all nine roles, level, and language preference while displaying account email and keeping interviews English. Persistence, validation, ownership, and UI saving are verified by backend API and frontend profile tests.

Goal: Save the preferences needed to personalize interview preparation.
Description: Add profile read/update operations and a settings form for name, target role, Junior/Middle/Senior level, and preferred language, showing the account email. Support the nine roles listed in the product plan, keep MVP interviews in English, and verify persistence and validation of updates.

## 11. Build custom interview setup
Goal: Capture and validate a complete interview configuration.
Description: Build a form and validated configuration model for role, level, Technical/Behavioral/Role-specific type, Practice/Real Interview mode, text/voice input, 5/10/15 main questions, and an optional job description. Verify every allowed option and reject unsupported values; use a stub start handler if interview creation is unavailable.

## 12. Create interview sessions and Quick Start
Goal: Start a saved interview from custom settings or reusable defaults.
Description: Implement session creation and connect both the setup form and Dashboard Quick Start to it, using saved profile preferences and explicit defaults for missing settings. Persist the full configuration without changing the profile, open the new Interview Room, and verify that retrying a pending start cannot accidentally create duplicate sessions.

## 13. Add a curated question bank
Goal: Supply reliable questions when AI generation is unavailable.
Description: Create a versioned question bank and selector covering the nine MVP roles, three interview types, and starting levels, with enough choices to avoid repeats in a 15-question session. Technical questions for Java, Python, C++, Backend, and Full Stack roles must be coding challenges with examples and constraints; verify coverage and selection rules.

## 14. Implement the text interview lifecycle
Goal: Complete a question-based interview with persisted text answers.
Description: Add backend operations to retrieve a session and submit answers, advancing through exactly 5, 10, or 15 main questions and saving each exchange transactionally. Use curated questions and verify completion, rejected submissions after completion, and safe handling of duplicate or stale answer requests.

## 15. Build the text Interview Room
Goal: Let users read questions and submit answers comfortably.
Description: Connect the room to session retrieval and answer submission, displaying the transcript, main-question progress, and elapsed time without a time cutoff. Preserve drafts on request failures, prevent duplicate sends, and verify loading, error, and completed-session states.

## 16. Integrate AI question generation
Goal: Generate relevant questions while retaining a reliable fallback.
Description: Introduce a server-side AI provider adapter that uses role, level, interview type, optional job description, and prior exchanges to generate a validated main question. Keep credentials out of the browser, enforce bounded request timeouts, and verify curated fallback on missing credentials, provider failure, or malformed output.

## 17. Add bounded conversational follow-ups
Goal: Ask relevant clarifying questions without consuming main-question slots.
Description: Add an explicit distinction between main questions and follow-ups, allowing at most one follow-up per main question based on the user's answer. Persist that relationship and verify that follow-ups do not advance the selected 5/10/15 main-question limit or prevent a session from finishing.

## 18. Adapt question difficulty
Goal: Adjust future questions to the user's demonstrated performance.
Description: Define a bounded difficulty policy starting at Junior/Middle/Senior and using available answer evaluations to select subsequent main questions. Persist difficulty decisions and verify stronger, weaker, and unscored answer cases, keeping the current level when reliable evaluation is unavailable.

## 19. Implement stored answer evaluation
Goal: Produce grounded numerical and written coaching for submitted answers.
Description: Evaluate answers against their questions using validated 1–10 accuracy, completeness, clarity, and structure scores where applicable, plus strengths, missing points, and an improved example answer. Save evaluations once, recognize valid alternative answers, and verify that provider failures leave answers saved and explicitly unscored rather than inventing feedback.

## 20. Add Practice Mode hints and immediate feedback
Goal: Provide learning assistance only when Practice Mode permits it.
Description: Add a hint operation and room controls for question-specific clues, plus immediate feedback after Practice Mode answers. Enforce mode restrictions on the server, keep hints from advancing question counts, and verify that Real Interview responses never expose hints or live evaluations.

## 21. Save early-ended sessions and restore active interviews
Goal: Preserve progress when users leave or end an interview early.
Description: Add an explicit early-end operation that marks the session Incomplete and retains answered questions for partial feedback, including a clear empty-results state when no answer exists. Restore the persisted transcript and pending question when reopening an active interview, and verify that early-ended sessions cannot accept answers unless explicitly resumed.

## 22. Add coding answer input
Goal: Let candidates submit formatted code for technical challenges.
Description: Add Monaco with a usable textarea fallback for Technical interviews in Java, Python, C++, Backend, and Full Stack roles, supporting Python, Java, C++, JavaScript, and TypeScript. Default named roles to their language and provide language templates; verify that submissions preserve whitespace and include the selected language, with coding input taking precedence over voice.

## 23. Add static AI code review
Goal: Give useful coding feedback without executing submissions.
Description: Extend answer evaluation for coding interviews to consider language semantics, correctness, edge cases, complexity, readability, and organization, with an improved code example. Verify selected-language handling, unavailable evaluations, and saved formatted code, and clearly state in the UI that submissions are reviewed without compilation or execution.

## 24. Add microphone transcription
Goal: Let users dictate English answers and review them before sending.
Description: Add microphone controls for voice-configured, noncoding interviews, placing recognized speech into an editable answer field without automatic submission. Stop recognition on editing, sending, ending, or leaving the room, and verify permission denial, unsupported browsers, and typing fallback without storing raw audio in the application.

## 25. Add spoken interview questions
Goal: Let users hear interviewer questions in voice mode.
Description: Add speech playback for main questions and follow-ups with stop, replay, and mute controls, while retaining the visible transcript. Verify that leaving the room or starting microphone input stops playback and that unavailable speech support leaves the interview usable through text.

## 26. Generate saved final and partial reports
Goal: Aggregate available evaluations into durable interview results.
Description: Build a report operation for completed and early-ended sessions containing category averages, an overall score, per-answer feedback, transcript references, and recurring strengths and weaknesses. Define how missing or inapplicable scores affect averages, label partial and unscored results clearly, and verify that repeated report reads reuse saved evaluations without calling AI again.

## 27. Build the Interview Results page
Goal: Make feedback understandable and actionable.
Description: Display saved scores, explanations, stronger answer examples, transcript highlights tied to actual answers, and incomplete or unscored states. Render generated Markdown safely, preserve code formatting, and label scores as approximate AI coaching estimates without claiming to measure hiring readiness, body language, or visual confidence.

## 28. Build searchable interview history
Goal: Help users find and review their saved interviews.
Description: Add an owner-scoped, paginated history API and page with role, interview-type, date, and score filters plus clearly defined text search. Show Completed and Incomplete labels, link to saved reports, and verify combined filters, empty results, pagination, and treatment of unscored sessions.

## 29. Implement interview deletion
Goal: Let users permanently remove their saved interview records.
Description: Add an owner-authorized delete operation that removes an interview, transcript, and evaluations together, and expose it from history with a confirmation step. Verify complete removal, inaccessible IDs, and failed-request handling; refresh history and dashboard data after success.

## 30. Add retry and targeted practice actions
Goal: Turn interview feedback into another useful practice session.
Description: Add a retry action that creates a new interview with the reviewed session's configuration, plus suggested Practice sessions based on documented weak areas. Preserve the original record, carry the selected practice topic into question selection, and verify behavior when a report has no reliable weakness data.

## 31. Compute personal dashboard statistics
Goal: Replace dashboard placeholders with meaningful user data.
Description: Add an owner-scoped summary API for completed-interview totals, recent activity, category averages, trends, and repeated strengths and weaknesses. Group comparisons by compatible interview types, define handling of incomplete and unscored sessions, and verify aggregates against a small known dataset.

## 32. Build dashboard charts and recommendations
Goal: Show progress and the next useful practice action.
Description: Connect the Dashboard to personal summary data, displaying recent sessions, score trends, strengths, weaknesses, and links to targeted practice and Quick Start. Include readable chart labels and text equivalents, distinguish comparison groups, and verify empty, loading, failure, and sparse-history states without demo statistics.

## 33. Verify the complete MVP journey
Goal: Catch integration failures across the core preparation workflow.
Description: Add a focused end-to-end suite covering registration, setup, a short text interview, saved results, history, and deletion using deterministic AI fixtures. Include an early-ended session and a Real Interview feedback-visibility check, and document how to run the suite without live AI credentials.

## 34. Document and verify deployment
Goal: Make the MVP reproducibly deployable.
Description: Document production build/start commands, database migrations, AI and email configuration, HTTPS session settings, allowed frontend origins, and persistent database storage. Add a deployment health check and CI checks for the existing test suites and frontend build, then verify the documented setup using placeholder secrets and deterministic provider fixtures.
