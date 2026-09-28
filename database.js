// database.js
const Database = require('better-sqlite3');
const db = new Database('books.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    author TEXT,
    genre TEXT,
    tags TEXT,
    rating INTEGER,
    date_finished TEXT,
    notes TEXT
  )
`);

// Migrations: add new columns to the existing table.
// Each one errors harmlessly if the column already exists.
try {
  db.exec(`ALTER TABLE books ADD COLUMN status TEXT DEFAULT 'read'`);
} catch (err) {}

try {
  db.exec(`ALTER TABLE books ADD COLUMN cover_url TEXT`);
} catch (err) {}

try {
  db.exec(`ALTER TABLE books ADD COLUMN description TEXT`);
} catch (err) {}
// Demo data for hosted copies (only runs when SEED_DEMO=true and the shelf is empty)
if (process.env.SEED_DEMO === 'true') {
  const count = db.prepare('SELECT COUNT(*) AS n FROM books').get().n;
  if (count === 0) {
    const insert = db.prepare(`
      INSERT INTO books (title, author, genre, tags, rating, date_finished, notes, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const samples = [
      ['Pride and Prejudice', 'Jane Austen', 'Romance', 'classic', 5, '2026-01-15', '', 'read'],
      ['Gone Girl', 'Gillian Flynn', 'Thriller', 'twisty', 4, '2026-03-02', '', 'read'],
      ['The Hound of the Baskervilles', 'Arthur Conan Doyle', 'Crime', 'detective', 4, '2026-05-20', '', 'read'],
      ['1984', 'George Orwell', 'Dystopian', 'classic', 5, '2026-07-11', '', 'read'],
      ['Dune', 'Frank Herbert', 'Sci-Fi', '', null, '', '', 'want'],
    ];
    for (const s of samples) insert.run(...s);
  }
}
module.exports = db;