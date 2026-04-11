# Book Wishlist

A local tool for tracking books you want to buy and finding the cheapest second-hand prices across multiple sources.

## Features

- **Book wishlist** — track books you want to read/buy, with cover images, ISBNs, and notes
- **Amazon import** — import wishlists using the [Amazon Wishlist Exporter](https://chromewebstore.google.com/detail/amazon-wishlist-exporter/jggmpdkkdepkhdbmfplkabhjkahgnoip) Chrome extension (JSON)
- **Goodreads import** — import your to-read shelf from a Goodreads CSV export
- **Multi-source price checking** — scrapes AbeBooks and BookFinder in parallel using Playwright
- **Multi-edition ISBN lookup** — fetches all known ISBNs for a book via Open Library, checks prices across editions to find the cheapest
- **Deals view** — flat list of all offers sorted by price, or grouped by seller to consolidate orders and save on shipping
- **Region selector** — configurable Amazon domain and shipping destination (Portugal, Spain, Italy, Germany, France, UK)
- **Exclude US sellers** — filter toggle to hide US-based sellers (expensive shipping to EU)
- **Metadata from multiple sources** — searches both Open Library and Google Books in parallel for book info
- **Bulk metadata enrichment** — fetch covers and ISBNs for all books missing metadata in one click
- **Background scraping** — price checks and enrichment run server-side, survive page refresh, can be stopped and resumed
- **Logs** — persistent error log with a dedicated viewer to inspect scraping failures

## Setup

```bash
git clone git@github.com:NicolaFerracin/book-wishlist.git
cd book-wishlist
npm run install:all
npx --prefix server playwright install chromium
npm run dev
```

Open `http://localhost:5174`

## Architecture

```
client/          → Vite + React + TypeScript + Tailwind CSS
server/          → Express + Playwright (headless Chromium)
scripts/         → One-off import/scrape scripts
data/            → wishlist.json + logs.json (local, gitignored)
```

- **Client** (port 5174): React SPA with Vite dev server, proxies `/api` to the server
- **Server** (port 3001): Express API for book CRUD, price scraping via Playwright, JSON file storage
- **Data**: `data/wishlist.json` stores all books and cached prices locally. `data/logs.json` stores error logs.

### Price sources

| Source | What it checks | Notes |
|--------|---------------|-------|
| AbeBooks (iberlibro.com) | Used books, EUR prices | Largest second-hand book marketplace |
| BookFinder | Aggregator (Amazon, Biblio, ThriftBooks, Alibris, etc.) | Destination country set via region selector |

Both sources are scraped **in parallel** for each ISBN using Playwright (headless Chromium). BookFinder aggregates from Amazon and many other stores, so Amazon prices are still included. The scraper runs server-side so you can close the browser tab while it works.

## Commands

```bash
npm run dev              # Start both client and server
npm run install:all      # Install dependencies for root, client, and server

# One-off scripts (run from project root)
npm run import:amazon    # Import from Amazon JSON exports (searches Open Library for ISBNs)
npm run import:amazon -- --skip-enrich   # Fast import without Open Library lookup
npm run scrape:prices    # CLI price scrape for all books without prices
```

## Importing Books

### Amazon

1. Install the [Amazon Wishlist Exporter](https://chromewebstore.google.com/detail/amazon-wishlist-exporter/jggmpdkkdepkhdbmfplkabhjkahgnoip) Chrome extension
2. Go to your Amazon wishlist page
3. Click the extension icon → **Export as JSON**
4. In the app, click **Import** → **Amazon** tab → upload the JSON file(s)

Or from the CLI: place files in `~/Downloads/` and run `npm run import:amazon`

### Goodreads

1. Go to [goodreads.com/review/import](https://www.goodreads.com/review/import)
2. Click **Export Library** and download the CSV
3. In the app, click **Import** → **Goodreads** tab → upload the CSV

Only books on the **to-read** shelf are imported. ISBN and page count come directly from the CSV.

### After importing

Click the **refresh icon** in the header to bulk-fetch covers and edition ISBNs from Open Library and Google Books for all books missing metadata.

## Data Backup

Your book data lives in `data/wishlist.json` (gitignored). To avoid losing it:

- **Cloud sync**: symlink to a synced folder (Dropbox, iCloud, etc.):
  ```bash
  mv data/wishlist.json ~/Dropbox/wishlist.json
  ln -s ~/Dropbox/wishlist.json data/wishlist.json
  ```
- **Manual backup**: `cp data/wishlist.json ~/backup/wishlist-$(date +%Y%m%d).json`
