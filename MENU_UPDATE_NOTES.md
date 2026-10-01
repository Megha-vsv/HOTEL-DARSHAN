# Hotel Darshan Menu Update

This version uses the supplied Hotel Darshan menu as the authoritative dataset.

- 101 menu items are included.
- Item IDs are preserved exactly (including the gaps in the supplied IDs).
- Prices, base prices, availability, vegetarian status, popular/special flags and image URLs are preserved.
- All 17 supplied categories are preserved, including categories that currently have zero items.
- The backend now synchronizes its SQLite menu with the same dataset used by the frontend.
- The frontend legacy `MenuScreen` data file was also synchronized so it does not contain the older sample menu.

## First run

From the project root:

```bash
npm install
npm --prefix client install
npm --prefix server install
npm run build
npm start
```

The backend runs on `http://localhost:5000` and serves the built frontend after `npm run build`.

If you already have an older `server/hotel_darshan.db`, back it up and remove it before the first run of this menu version so the supplied menu is seeded cleanly.
