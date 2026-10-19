# Interview Mirror

See the [project specifications](../docs/spec.md).

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://canvas-chat-code.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/653602a7-1dbe-4cb6-a584-142b3b245686).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Backend connection

Start the backend from the repository root with `make run`, then run
`npm run dev` from `frontend`. Authentication and interview operations use
`src/lib/api/client.ts`. Sign in with **demo@example.com / demo-password**, or
create an account at `/register`; `/login` is the sign-in page. Unauthenticated
private pages redirect to `/login` and return to the original page after sign-in.

Login and registration establish an HttpOnly cookie and return an Authorization
header. The frontend keeps that bearer token in tab-scoped `sessionStorage`,
restores it after reload, and sends it on subsequent API requests alongside
`credentials: "include"`. Expired tokens are cleared. Passwords are never stored.
Cookie authentication remains available when browser storage is disabled.

The default API URL is `http://localhost:8000/api`. Copy `.env.example` to
`.env.local` to override `VITE_API_BASE_URL` (including `/api`). For deployment,
use `/api` behind a same-origin reverse proxy, or configure backend `CORS_ORIGINS`
for the frontend origin and expose the `Authorization` response header (the
backend does this by default). Cookie authentication requires same-site hosting;
set `SECURE_COOKIES=true` with HTTPS.

The backend persists sessions and interviews in its configured database. Question
generation and answer evaluation use Groq when configured; see `../backend/README.md`.
Dashboard summary statistics and charts remain demo fixtures. `mock-api.ts`
is retained for fixture tests only; application routes use HTTP.

In Setup choose **Voice** under **Answer by**. In the interview room, click the
microphone, grant permission, and speak in English. Transcription appears in the
answer field as you speak. Stop the microphone to review the transcript, edit it
if needed, then click Send (or press Enter). Speech never submits automatically;
existing typed text is preserved when starting dictation. Editing the field stops
recognition so later speech results cannot overwrite edits. Sending, ending the
interview, and leaving the room also stop recognition.

The implementation supports `SpeechRecognition` and `webkitSpeechRecognition`.
Use localhost or HTTPS and a browser with speech recognition support. Unsupported
browsers retain text input; permission, microphone, and network errors are shown
with a typing fallback. The application sends only the resulting text to its
backend, without recording or storing audio. The browser's recognition service
may process audio remotely; see [MDN SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition).

The avatar opens an accessible account menu with the signed-in user's name and
email (loaded on opening the menu; cached after login). Profile Settings opens
`/profile`, where name, target role, and level are saved to the backend. Logout
revokes the server session and expires the cookie, clears the browser bearer token
and React Query cache, then returns to login. Failed saves/logouts show an error
and support retrying.

The Dashboard reads the shared profile query for the greeting and target role/level,
with `User` and `Not set` as missing-data fallbacks. Profile edits update this cache
immediately. Successful starts from Setup or Lobby invalidate the profile query,
so returning to the Dashboard fetches the newly saved interview target.

Technical interviews for Python Developer, Java Developer, and C++ Developer use
Monaco Editor with the matching `python`, `java`, or `cpp` language. It is loaded
only in the browser, and its editor, syntax grammars, and worker are bundled locally
(no editor CDN request). Multiline answers preserve indentation, Enter inserts a
newline, and Send submits the code for AI review. The editor becomes read-only
while a request is pending; failures retain the draft and successful answers clear
it for the next question. A plain code textarea remains usable while loading or
if the editor assets fail to load. Coding mode takes precedence over Voice for
these Technical interviews; other role/type combinations keep text/voice input.
Code is reviewed by AI without executing or compiling it.
