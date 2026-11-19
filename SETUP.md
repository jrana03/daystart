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

The **Microlearning** tab in Curated Reads contains original summaries and key
points for all 30 chapters of *How to Win Friends and Influence People* by Dale
Carnegie. The book PDF is not copied into the project or served to visitors.
Edit `src/lib/lessons.js` to revise the summaries, key points, or reflection
prompts. Chapter selection and completion are saved in the current browser's
localStorage under `daystart-how-to-win-friends-progress-v1`. Progress from
previous books is not reused.

## Important Articles tab

The **Important Articles** tab collects headlines from five pages:

- Washington Post front page
- Washington Post Business
- New York Times front page
- New York Times Business
- Wall Street Journal front page

It asks Claude (`claude-sonnet-5-5`) to group headlines that cover the same story,
and keeps only stories covered by at least two outlets. Each card reads
**"Topic: …"** and lists every outlet's article. Links open on the publisher's
site in a new tab, so your subscriptions apply.

All of this runs in the `important-articles` Edge Function. Your Anthropic key
stays on Supabase and is never shipped to the browser.

### 1. Paste your Anthropic API key

Get a key at **https://console.anthropic.com → API Keys**. Then use **one** of these options:

**Option A — env file (recommended):**

```bash
cp supabase/functions/.env.example supabase/functions/.env
```

Open `supabase/functions/.env` and replace the placeholder:

```
ANTHROPIC_API_KEY=sk-ant-...your key...
```

Then upload it:

```bash
supabase secrets set --env-file supabase/functions/.env
```

`supabase/functions/.env` is gitignored. Never put the key in `.env.local` or in
any `VITE_` variable, because those are bundled into the frontend.

**Option B — command line:**

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...your key...
```

**Option C — dashboard:** go to **Supabase Dashboard → Edge Functions → Secrets**
and add `ANTHROPIC_API_KEY`.

### 2. Deploy the function

```bash
supabase functions deploy important-articles --no-verify-jwt
```

Secrets take effect without redeploying. If you change the key later, run
`supabase secrets set` again.

### 3. Check it

Open the app, then click **Curated Reads → Important Articles**. The first load
takes about 10–30 seconds while the pages are scraped and Claude groups them.
Until the key is set, the tab shows a "needs an Anthropic API key" message.

### How it behaves

- **Scraping and fallbacks:** each page is scraped first. NYT and WSJ often block
  automated requests. When a page is blocked, times out, or yields fewer than 5
  headlines, the function uses that outlet's official RSS feed instead. A source
  that fails both ways is skipped and listed as "Skipped" in the tab.
- **Caching:** results are cached for 3 hours in Supabase Storage at
  `assets/cache/important-articles.json`, in the same `assets` bucket the quote
  function uses. The browser also caches for 1 hour in localStorage under
  `daystart-important-articles-v1`. **↻ Refresh** forces a new run, but no more
  than once every 10 minutes. If a refresh fails, the last good result is shown.
- **Cost:** each uncached run is one Claude call with about 150 headlines, which
  costs roughly a cent or two. With the 3-hour cache, that's at most about 8 calls a day.
- **Refusals:** the request enables Anthropic's server-side fallback
  (`fallbacks: "default"`). If Claude Sonnet 5.5 declines the request, another
  model is used automatically. To turn this off, remove the `betas` and
  `fallbacks` lines in `supabase/functions/important-articles/index.ts`.
- **Changing sources or settings:** edit the `SOURCES` list and the constants at
  the top of `supabase/functions/important-articles/index.ts`, then redeploy.

---

## Build for production

```bash
npm run build       # outputs to dist/
npm run preview     # preview the production build locally
```

Deploy the `dist/` folder to any static host (Vercel, Netlify, Cloudflare Pages, etc.).
The Edge Functions stay on Supabase and are called from the browser via the Supabase JS client.
