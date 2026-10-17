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
create an account. Sessions use HttpOnly cookies; expired sessions show sign-in.

The default API URL is `http://localhost:8000/api`. Copy `.env.example` to
`.env.local` to override `VITE_API_BASE_URL` (including `/api`). For deployment,
use `/api` behind a same-origin reverse proxy, or configure backend `CORS_ORIGINS`
for the frontend origin. Cookie authentication requires same-site hosting;
set `SECURE_COOKIES=true` with HTTPS.

Restarting the backend clears its in-memory sessions and interviews. Questions,
scores, and coaching remain deterministic fixtures; voice input submits text.
Dashboard summary statistics and charts remain demo fixtures. `mock-api.ts`
is retained for fixture tests only; application routes use HTTP.
