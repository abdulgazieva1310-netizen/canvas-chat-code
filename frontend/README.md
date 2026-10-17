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

## Mock backend

`src/lib/api/types.ts` defines the shared entities. `src/lib/api/mock-api.ts`
exports `MockApi`; every operation is asynchronous with 500 ms simulated latency.
The setup, lobby, interview, report, and saved-session history use this service.
Interview IDs travel in route search parameters; sessions are kept in browser
`sessionStorage` so reloading a page preserves the current mock interview.

Login and registration return fake users without checking real credentials.
Questions, scores, and coaching are illustrative fixtures; there is no AI or
speech integration. Real Interview mode withholds live hints and scores.
The dashboard summary statistics and charts remain demo fixtures.
No backend HTTP endpoints or authentication transport have been chosen yet.
