# DayStart — Setup Guide

## Prerequisites
- Node.js 18+
- A [Supabase](https://supabase.com) account with a project created
- Supabase CLI (`npm i -g supabase`)

---

## 1. Install frontend dependencies

```bash
npm install
```

---

## 2. Configure environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local` and fill in your Supabase project credentials:

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

Both values are in **Supabase Dashboard → Project Settings → API**.

---

## 3. Set up Supabase Storage

The `/quote` Edge Function reads `quotes.txt` from a Storage bucket called **`assets`**.

1. Go to **Supabase Dashboard → Storage**
2. Click **New bucket**, name it `assets`  
   (Private is fine — the Edge Function uses the service role key)
3. Upload `quotes.txt` from this project's root into the bucket

### Quote format
Each line in `quotes.txt` is one quote:
```
The quote text here. | Author Name
A quote with no author (the pipe and author are optional).
```
Lines starting with `#` are ignored (useful for comments).

---

## 4. Deploy Edge Functions

```bash
# Log in and link to your Supabase project
supabase login
supabase link --project-ref YOUR_PROJECT_REF

# Deploy both functions with --no-verify-jwt
# This flag is required to prevent Supabase's gateway from rejecting requests
# before your function code runs. Without it the gateway returns a 401/403
# that has no CORS headers, which the browser reports as a "CORS error".
supabase functions deploy quote --no-verify-jwt
supabase functions deploy scrape --no-verify-jwt
```

Your project ref is the string in your Supabase project URL:  
`https://supabase.com/dashboard/project/YOUR_PROJECT_REF`

---

## 5. Run the app

```bash
npm run dev
```

Open **http://localhost:5173** in your browser.

- Allow location access for local weather, or it falls back to New York City coordinates.
- The daily quote is cached in `localStorage` under the key `daily-quote-YYYY-MM-DD`.
  Clear localStorage to force a re-fetch during development.

---

## Customizing sources

Edit **`src/lib/sources.js`** — it's heavily commented with instructions for adding
new scraping sources, adjusting CSS selectors, and tweaking keyword filters.

## Microlearning book tab

The **Microlearning** tab in Curated Reads contains short, original summaries of all
18 chapters of *Business Analysis For Dummies* (2nd edition). The book PDF is not
copied into the project or served to visitors. Edit `src/lib/lessons.js` to revise
the summaries, key points, or practice prompts. Chapter selection and completion
are saved in the current browser's localStorage under
`daystart-business-analysis-progress-v1`.

---

## Build for production

```bash
npm run build       # outputs to dist/
npm run preview     # preview the production build locally
```

Deploy the `dist/` folder to any static host (Vercel, Netlify, Cloudflare Pages, etc.).
The Edge Functions stay on Supabase and are called from the browser via the Supabase JS client.
