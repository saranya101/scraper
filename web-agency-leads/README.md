# Web Agency Lead Dashboard

A private full-stack lead dashboard for discovering, scoring, reviewing, and managing website redesign prospects.

## Stack

- React + Vite, JavaScript only
- Express.js API
- Neon PostgreSQL
- Prisma ORM
- JWT auth with bcrypt password hashing
- Tailwind CSS with custom premium SaaS UI components

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from `.env.example` and fill in your Neon `DATABASE_URL`, `JWT_SECRET`, and two admin users.

3. Prepare the database:

```bash
npm run prisma:generate
npm run prisma:push
npm run prisma:seed
```

4. Run the full app:

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
- Normalized PostgreSQL schema for users, leads, issues, notes, status history, imports, and screenshots

## Import Columns

The importer recognizes common variants of:

- company
- website
- phone
- address
- industry
- score
- screenshot path
- outreach email
- issues

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
