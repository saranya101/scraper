# Web Agency Lead Dashboard

A private full-stack lead dashboard for discovering, scoring, reviewing, and managing website redesign prospects.

## Stack

- React + Vite, JavaScript only
- Express.js API
- Neon PostgreSQL
- Prisma ORM
- JWT auth with bcrypt password hashing
- Tailwind CSS with custom premium SaaS UI components
- Google Places API New, Playwright screenshots, and OpenAI audits for scanner runs

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from `.env.example` and fill in your Neon `DATABASE_URL`, `JWT_SECRET`, and two admin users.
Also add `GOOGLE_API_KEY` and `OPENAI_API_KEY` for the Scanner Dashboard.

3. Prepare the database:

```bash
npm run prisma:generate
npx prisma migrate dev --schema prisma/schema.prisma
npx prisma db seed --schema prisma/schema.prisma
```

4. Install the browser used by scanner screenshots:

```bash
npx playwright install chromium
```

5. Run the full app:

```bash
npm run dev
```

Frontend: `http://localhost:5173`  
Backend API: `http://localhost:4000/api`

## Core Features

- Admin-only login with JWT cookies and bearer-token support
- Seeded admin users from environment variables
- Protected React routes and protected API endpoints
- Lead dashboard with statistics, search, filters, sorting, card view, table view, and pagination
- Lead create, edit, delete, archive, status updates, issue lists, outreach copy, notes, and status history
- CSV/XLSX import for `leads.csv` and `audited_leads.xlsx`
- Automatic import column mapping and duplicate detection by normalized website URL
- Scanner Dashboard: Google Places search, Playwright desktop/mobile screenshots, website status detection, OpenAI audit, scan logs, scan history, saved templates, result filters, and import selected leads
- Normalized PostgreSQL schema for users, leads, issues, notes, status history, scan jobs, scan results, scan templates, imports, and screenshots

## Scanner Flow

1. Open `Scanner`.
2. Enter an industry/keyword, location, max results, and optional filters.
3. Click `Run Scan`.
4. The backend searches Google Places API New, visits each website with Playwright, saves desktop and mobile screenshots, detects access issues, sends screenshot/text context to OpenAI, and saves audit results in Neon.
5. Review results, select the ones you want, then click `Import selected`.

## Import Columns

The importer recognizes common variants of:

- company
- website
- phone
- address
- industry
- score
- visual design score
- mobile score
- trust score
- cta score
- seo score
- opportunity score
- screenshot path
- mobile screenshot path
- outreach email
- issues
- recommended fixes
- website status

Issue cells can be separated with new lines, semicolons, or `|`.

## Project Structure

```text
frontend/
  src/
    components/
    pages/
    layouts/
    hooks/
    services/
    utils/

backend/
  src/
    controllers/
    routes/
    middleware/
    services/
    repositories/
    utils/

prisma/
  schema.prisma
  seed.js
```

## Future Extensions

The code is structured so the next layers can be added cleanly:

- Google Places scraping
- AI website audits
- Playwright screenshots
- OpenAI integration
- Automated outreach
- Email campaigns
- Team collaboration
- Activity feeds
- PostgreSQL scaling
