// server.js
const express = require('express');
const cors = require('cors');
const db = require('./database');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ---------- Open Library helpers ----------

const OL_HEADERS = { 'User-Agent': 'ReadingShelf/1.0 (nitarex038@gmail.com)' };
const cache = new Map(); // remembers recent lookups so we don't repeat requests

async function olFetch(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.time < 10 * 60 * 1000) return hit.data;

  const res = await fetch(url, { headers: OL_HEADERS, signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`Open Library returned ${res.status}`);
  const data = await res.json();
  cache.set(url, { time: Date.now(), data });
  return data;
}

// Turns a title into a simple comparable form: "The Hobbit!" -> "thehobbit"
function normalise(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Fetches a short blurb for a work (returns '' if there isn't one)
async function getDescription(key) {
  if (!key) return '';
  const workKey = key.startsWith('/works/') ? key : `/works/${key}`;
  const work = await olFetch(`https://openlibrary.org${workKey}.json`);
  const d = work.description;
  let text = typeof d === 'string' ? d : (d && d.value) || '';

  // Keep just the first paragraph, and keep it short
  text = text.split(/\r?\n\r?\n|----/)[0].trim();
  if (text.length > 350) text = text.slice(0, 350).trim() + '…';
  return text;
}

// Finds a cover image and a short blurb for a book
async function lookupBook(title, author) {
  const params = new URLSearchParams({
    title,
    limit: '1',
    fields: 'key,cover_i,first_publish_year',
  });
  if (author) params.set('author', author);

  const data = await olFetch(`https://openlibrary.org/search.json?${params}`);
  const doc = data.docs && data.docs[0];
  if (!doc) return { cover_url: '', description: '' };

  const cover_url = doc.cover_i
    ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
    : '';

  const description = await getDescription(doc.key);
  return { cover_url, description };
}


// On startup, fill in covers for any books that don't have them yet.
// NULL = not looked up yet. '' = looked up, nothing found.
async function backfillCovers() {
  const missing = db.prepare('SELECT id, title, author FROM books WHERE cover_url IS NULL').all();
  for (const book of missing) {
    try {
      const info = await lookupBook(book.title, book.author);
      db.prepare('UPDATE books SET cover_url = ?, description = ? WHERE id = ?')
        .run(info.cover_url, info.description, book.id);
    } catch (err) {
      console.error(`Could not look up "${book.title}":`, err.message);
    }
    await new Promise(resolve => setTimeout(resolve, 1200)); // be polite: ~1 request per second
  }
}

// ---------- Routes ----------

// GET all books
app.get('/api/books', (req, res) => {
  const books = db.prepare('SELECT * FROM books ORDER BY id DESC').all();
  res.json(books);
});

// POST a new book (also fetches its cover and blurb)
app.post('/api/books', async (req, res) => {
   const { title, author, genre, tags, rating, date_started, date_finished, notes, status } = req.body;
  const result = db.prepare(`
    INSERT INTO books (title, author, genre, tags, rating, date_started, date_finished, notes, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(title, author, genre, tags, rating || null, date_started, date_finished, notes, status || 'read');
  const id = result.lastInsertRowid;

  try {
    const info = await lookupBook(title, author);
    db.prepare('UPDATE books SET cover_url = ?, description = ? WHERE id = ?')
      .run(info.cover_url, info.description, id);
  } catch (err) {
    console.error('Open Library lookup failed:', err.message);
  }

  res.json({ id });
});

// PUT (update) an existing book
app.put('/api/books/:id', (req, res) => {
   const { rating, date_started, date_finished, notes, status } = req.body;
  db.prepare(`
    UPDATE books
    SET rating = ?, date_started = ?, date_finished = ?, notes = ?, status = ?
    WHERE id = ?
  `).run(rating || null, date_started, date_finished, notes, status, req.params.id);
  res.json({ success: true });
});

// DELETE a book
app.delete('/api/books/:id', (req, res) => {
  db.prepare('DELETE FROM books WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// GET real book recommendations
app.get('/api/recommendations', async (req, res) => {
  const topGenres = db.prepare(`
    SELECT TRIM(genre) AS genre, AVG(rating) AS avg_rating, COUNT(*) AS count
    FROM books
    WHERE rating >= 4 AND genre IS NOT NULL AND TRIM(genre) != ''
    GROUP BY TRIM(genre)
    ORDER BY avg_rating DESC
    LIMIT 3
  `).all();

  const topAuthors = db.prepare(`
    SELECT TRIM(author) AS author, AVG(rating) AS avg_rating
    FROM books
    WHERE rating >= 4 AND author IS NOT NULL AND TRIM(author) != ''
    GROUP BY TRIM(author)
    ORDER BY avg_rating DESC
    LIMIT 2
  `).all();

  // Titles you already have, so we never recommend them back to you
  const seen = new Set(db.prepare('SELECT title FROM books').all().map(b => normalise(b.title)));
  const picks = [];

  async function collect(query, reason, genreLabel, max) {
    try {
      const params = new URLSearchParams({
        q: query,
        sort: 'want_to_read', // most popular first
        limit: '20',
        fields: 'key,title,author_name,cover_i,first_publish_year',
      });
      const data = await olFetch(`https://openlibrary.org/search.json?${params}`);

      let added = 0;
      for (const doc of data.docs || []) {
        const norm = normalise(doc.title);
        if (!norm || seen.has(norm)) continue;
        seen.add(norm);
        picks.push({
          key: doc.key,
          title: doc.title,
          author: (doc.author_name && doc.author_name[0]) || '',
          year: doc.first_publish_year || null,
          cover_url: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : '',
          description: '',
          reason,
          genre: genreLabel,
        });
        added++;
        if (added >= max) break;
      }
    } catch (err) {
      console.error('Recommendation lookup failed:', err.message);
    }
  }

  for (const a of topAuthors) {
    const name = a.author.replace(/"/g, '');
    await collect(`author:"${name}"`, `More by ${a.author}`, '', 2);
  }
  for (const g of topGenres) {
    const name = g.genre.replace(/"/g, '').toLowerCase();
    await collect(`subject:"${name}"`, `Because you rated ${g.genre} highly`, g.genre, 3);
  }

  // Fetch a short blurb for each pick (in parallel; results are cached)
  await Promise.all(picks.map(async (pick) => {
    try {
      pick.description = await getDescription(pick.key);
    } catch (err) {
      pick.description = '';
    }
  }));

  res.json({ topGenres, picks });
});
// GET stats (only books with status 'read')
app.get('/api/stats', (req, res) => {
  const perMonth = db.prepare(`
    SELECT strftime('%Y-%m', date_finished) as month, COUNT(*) as count
    FROM books
    WHERE status = 'read' AND date_finished IS NOT NULL AND date_finished != ''
    GROUP BY month
    ORDER BY month ASC
  `).all();

  const perGenre = db.prepare(`
    SELECT genre, AVG(rating) as avg_rating, COUNT(*) as count
    FROM books
    WHERE status = 'read' AND genre IS NOT NULL AND genre != '' AND rating IS NOT NULL
    GROUP BY genre
    ORDER BY avg_rating DESC
  `).all();

    // Days taken to finish each book (start date to end date, counting both days)
  const pace = db.prepare(`
    SELECT title,
           CAST(julianday(date_finished) - julianday(date_started) AS INTEGER) + 1 AS days
    FROM books
    WHERE status = 'read'
      AND date_started IS NOT NULL AND date_started != ''
      AND date_finished IS NOT NULL AND date_finished != ''
      AND julianday(date_finished) >= julianday(date_started)
    ORDER BY date_finished ASC
  `).all();

  res.json({ perMonth, perGenre, pace });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  backfillCovers(); // runs in the background
});