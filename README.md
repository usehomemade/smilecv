<div align="center">

<img src="docs/screenshots/logo.png" width="72" height="72" alt="" />

# SmileCV

**Write a CV you're happy to send.**<br /> An open-source CV builder: edit the page by hand or ask the AI, then download a PDF that looks exactly like the editor.

[Open the app](https://smilecv.com) · [Features](#features) · [Run it locally](#local-development) · [How it works](#how-it-works)

</div>

## Features

|  |  |
| --- | --- |
| **Ask for changes in plain words** | The AI chat edits the CV with the same actions you have: rewrite a bullet, fill a section, reorder, translate. Each change lands on the page as it happens and can be undone. It never invents employers, dates or numbers. |
| **Import the CV you already have** | Drop in a PDF, a photo or pasted text and it gets sorted into sections. Or paste a job ad and tailor the CV to it. |
| **25 templates, switch any time** | From one calm column to dense two-column layouts, including ATS-friendly, academic and career-office styles. The picker previews your own CV in each one and switching keeps the content. |
| **Type, spacing and colour** | Six fonts, text size, line height, letter spacing, heading size and weight, margins, A4 or US Letter, and an accent colour. Every setting resets to the template default. |
| **The download matches the page** | Headless Chromium prints the PDF from the same pages you see in the editor: selectable text, embedded fonts, identical page breaks. PNG too. |
| **Share a link** | A public read-only page for the CV, one-click sharing to LinkedIn, X, WhatsApp or email, and a QR code for print. |
| **Twenty languages** | The whole interface is translated. New CVs start with headings in your language. |
| **History you can go back to** | Typing merges into one step per field and each AI reply is one step. Versions are stored, so undo and the History tab survive a reload. |

## Tech stack

| Area | Choice |
| --- | --- |
| App | [TanStack Start](https://tanstack.com/start) (React 19, file routes, server functions), Vite 8 |
| UI | Tailwind CSS 4, shadcn/ui on Base UI, Hugeicons, dnd-kit |
| Auth | [Better Auth](https://better-auth.com): email and password, Google, guest accounts that move into a real account on sign-up |
| Data | Postgres with Drizzle ORM and drizzle-kit migrations |
| Files | Cloudflare R2 (S3 API) for chat attachments, profile pictures and CV photos, served through the app's own routes |
| AI | Vercel AI SDK with OpenAI; the model edits the CV through typed tools |
| i18n | [Paraglide JS 2](https://inlang.com/m/gerre34r/library-inlang-paraglideJs), 20 locales, translated with a script |
| Email | [useSend](https://usesend.com) (self-hosted at usesend.wust.co) with react-email templates |
| Export | Playwright (headless Chromium) prints the editor's pages to PDF and PNG |
| Analytics | Umami, off unless configured |
| Quality | Biome via Ultracite, TypeScript strict |
| Hosting | Docker image deployed with Coolify |

## How it works

**Pagination engine.** Each template turns a CV into a flat stream of blocks (one main column, plus a side column for two-column layouts). The engine in `src/lib/cv/engine.ts` and `src/components/cv/paged.tsx` measures the blocks off screen and fills fixed-size A4 or Letter pages, keeping headings with what follows and dropping gaps at page tops. The editor, thumbnails, the share page and the print route all render these same pages.

**Print route.** `/print/$id` renders the paginated pages with one page per sheet and no margins. `/api/export/$id` opens it in headless Chromium and saves a PDF or PNG, so the file is the editor, not a second layout.

**AI tools.** The chat (`src/routes/api/chat.ts`) gives the model typed tools from `src/lib/ai/cv-tools.ts`: update personal details, add, edit, remove and reorder entries in any section, manage custom sections and headings, change style and template, read a linked page, and translate the whole CV. The client applies each tool call to the CV as it streams, so edits appear live and form one undo step. The system prompt (`src/lib/ai/prompt.ts`) answers in the interface language and keeps the CV in its own language.

**Editing on the page.** Text is edited in place (`src/components/cv/editing.tsx`); sections, entries and bullets reorder with drag and drop; a selection toolbar formats text or sends the selection to the AI; the clip tool sends a region of the page as an image.

## Local development

Requirements: Node 22, pnpm 12, Docker (for Postgres) and an OpenAI API key.

Icons come from the Hugeicons Pro registry. Add your token once, at user level, so it never lands in the repo:

```bash
pnpm config set //npm.hugeicons.com/:_authToken <token> --location=user
```

Then:

```bash
# 1. Postgres
docker run -d --name smilecv-pg -p 54329:5432 \
  -e POSTGRES_USER=smilecv -e POSTGRES_PASSWORD=smilecv -e POSTGRES_DB=smilecv \
  postgres:17-alpine

# 2. Environment
cp .env.example .env.local   # set BETTER_AUTH_SECRET and OPENAI_API_KEY

# 3. Install, migrate, run
pnpm install
pnpm db:migrate
pnpm dev                     # http://localhost:3033
```

### Environment variables

| Name | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string |
| `BETTER_AUTH_URL` | yes | Public URL of the app |
| `BETTER_AUTH_SECRET` | yes | Any long random string |
| `OPENAI_API_KEY` | yes | For the chat, the FAQ answers and translations |
| `OPENAI_MODEL` | no | Defaults to `gpt-5.4-mini` |
| `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | yes | Private R2 bucket for uploads; the key needs object read and write on that bucket |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | no | Google sign-in; the button hides without them |
| `USESEND_API_KEY`, `EMAIL_FROM` | no | Account emails (password reset, email change); the key is restricted to `emails.smilecv.com`. `USESEND_URL` defaults to `https://usesend.wust.co` |
| `ADMIN_EMAILS` | no | Comma-separated emails that may open `/admin` |
| `UMAMI_WEBSITE_ID`, `UMAMI_SCRIPT_URL` | no | Analytics; off when unset |

### Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Dev server on port 3033 (also builds the logo assets) |
| `pnpm build` | Production build into `.output/` |
| `pnpm lint` / `pnpm fix` | Check or fix with Ultracite (Biome) |
| `pnpm db:generate` | Create a migration from `src/db/schema.ts` |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:studio` | Browse the database |
| `node scripts/translate-messages.mjs [locales] [--force keys]` | Fill missing UI translations in `messages/*.json` from `messages/en.json` (needs `OPENAI_API_KEY`) |
| `node scripts/translate-sample.mjs [locales]` | Write the example CV in every locale (`src/lib/cv/samples/`) |

## Deployment

The `Dockerfile` builds the app with pnpm (the Hugeicons token is passed as the `HUGEICONS_TOKEN` build argument and never reaches the runtime image), installs headless Chromium for export, and runs the database migrations (`scripts/migrate.mjs`) on every start, before the server. The live site runs on a single server with Coolify, with Postgres as a separate Coolify resource.

Dependency updates come from self-hosted Renovate (`.github/workflows/renovate.yml`, config in `renovate.json`): every Monday it opens one PR with all bumps. Run it any time from the Actions tab or with `gh workflow run renovate.yml`. It needs the repo secrets `RENOVATE_TOKEN` and `HUGEICONS_TOKEN`.

## Project structure

```
messages/                 UI text, one JSON file per locale (en is the source)
project.inlang/           Paraglide settings (locales, message format)
lint/                     Biome GritQL rules that keep UI text translated
scripts/                  Migrations runner, logo builder, translation scripts
src/
  routes/                 Pages and API routes (TanStack Start file routes)
  components/
    editor/               Editor: canvas, chat, style bar, history, share
    cv/                   Paginated pages and in-place editing
    marketing/            Home page sections
    ui/, reui/            shadcn/ui and ReUI components
  lib/
    cv/                   CV schema, pagination engine, templates, samples
    ai/                   Prompt, CV tools, translation
  db/                     Drizzle schema
  server.ts               Server entry (locale middleware)
drizzle/                  SQL migrations
docs/screenshots/         Logo for this README
```

## Translations

All interface text lives in `messages/en.json` and is used through Paraglide (`m.key()` from `#/paraglide/messages.js`). Two Biome plugins in `lint/` fail `pnpm lint` on raw text in JSX, on untranslated `aria-label`, `title`, `placeholder`, `alt`, `label` and `description` props, and on untranslated toasts. To add text, add the English key, use it in code, then run `node scripts/translate-messages.mjs` to fill the other 19 locales.

The locale comes from a cookie, then the browser's language, then English. URLs carry no locale prefix.

## License

To be decided. Until a license is added, all rights are reserved.
