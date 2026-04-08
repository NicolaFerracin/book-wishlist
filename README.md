# Book Wishlist

A local tool for tracking books you want to buy and finding the cheapest second-hand prices across multiple sources.

## Features

- **Book wishlist** — track books you want to read/buy, with cover images, ISBNs, and notes
- **Amazon import** — import wishlists from Amazon using the [Amazon Wishlist Exporter](https://chromewebstore.google.com/detail/amazon-wishlist-exporter/jggmpdkkdepkhdbmfplkabhjkahgnoip) Chrome extension (JSON format)
- **Multi-source price checking** — scrapes AbeBooks, Amazon, and BookFinder in parallel using Playwright
- **Multi-edition ISBN lookup** — fetches all known ISBNs for a book via Open Library, checks prices across editions to find the cheapest
- **Deals view** — flat list of all offers sorted by price, or grouped by seller to consolidate orders and save on shipping
- **Region selector** — configurable Amazon domain and shipping destination (Portugal, Spain, Italy, Germany, France, UK, US)
- **Exclude US sellers** — filter toggle to hide US-based sellers (expensive shipping to EU)
- **Metadata from multiple sources** — searches both Open Library and Google Books in parallel for book info
- **Background scraping** — price checks run server-side, survives page refresh, resumable after interruption

## Setup

```bash
git clone git@github.com:NicolaFerracin/book-wishlist.git
cd book-wishlist
npm run install:all
npm run dev
```

Open `http://localhost:5174`

## Architecture

```
client/          → Vite + React + TypeScript + Tailwind CSS
server/          → Express + Playwright (headless Chromium)
scripts/         → One-off import/scrape scripts
data/            → wishlist.json (local, gitignored)
```

- **Client** (port 5174): React SPA with Vite dev server, proxies `/api` to the server
- **Server** (port 3001): Express API for book CRUD, price scraping via Playwright, JSON file storage
- **Data**: `data/wishlist.json` stores all books and cached prices locally

### Price sources

| Source | What it checks | Notes |
|--------|---------------|-------|
| AbeBooks (iberlibro.com) | Used books, EUR prices | Largest second-hand book marketplace |
| Amazon (configurable domain) | New + marketplace used | Domain set via region selector |
| BookFinder | Aggregator (Biblio, ThriftBooks, Alibris, etc.) | Destination country set via region selector |

## Commands

```bash
npm run dev              # Start both client and server
npm run install:all      # Install dependencies for root, client, and server

# One-off scripts (run from project root)
npm run import:amazon    # Import from Amazon JSON exports (searches Open Library for ISBNs)
npm run import:amazon -- --skip-enrich   # Fast import without Open Library lookup
npm run scrape:prices    # CLI price scrape for all books without prices
```

## Amazon Import

1. Install the [Amazon Wishlist Exporter](https://chromewebstore.google.com/detail/amazon-wishlist-exporter/jggmpdkkdepkhdbmfplkabhjkahgnoip) Chrome extension
2. Go to your Amazon wishlist page
3. Click the extension icon → **Export as JSON**
4. Either:
   - Use the **Import** button in the app UI to upload the JSON files, or
   - Place the files in `~/Downloads/` and run `npm run import:amazon`
