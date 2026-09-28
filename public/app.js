const form = document.getElementById('book-form');
const bookList = document.getElementById('book-list');
const recsDiv = document.getElementById('recommendations');
const searchInput = document.getElementById('search');
const statusFilter = document.getElementById('status-filter');

let allBooks = [];
let currentPicks = [];  // the recommended books currently on screen
let editingId = null;
let monthsChart = null;
let genreChart = null;

const STATUS_LABELS = {
  read: 'Read',
  reading: 'Currently reading',
  want: 'Want to read',
};

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function starsFor(rating) {
  const full = Number(rating) || 0;
  let out = '';
  for (let i = 1; i <= 5; i++) {
    out += i <= full ? '★' : '☆';
  }
  return out;
}

// A cover image, or a plain placeholder with the title's first letter
function coverHtml(coverUrl, title) {
  if (coverUrl) {
    return `<img class="cover" src="${escapeHtml(coverUrl)}" alt="Cover of ${escapeHtml(title)}" loading="lazy">`;
  }
  const initial = escapeHtml((title || '?').trim().charAt(0).toUpperCase());
  return `<div class="cover cover--empty" aria-hidden="true">${initial}</div>`;
}

function rowHtml(book) {
  return `
    <div class="book-row book-grid">
      <h3 class="g-title">${escapeHtml(book.title)}</h3>
      <p class="g-author">by ${escapeHtml(book.author) || 'Unknown'}</p>
      <div class="g-genre">
        ${book.genre ? `<span class="badge">${escapeHtml(book.genre)}</span>` : ''}
        ${book.status && book.status !== 'read' ? `<span class="badge badge--status">${STATUS_LABELS[book.status]}</span>` : ''}
        ${book.rating ? `<span class="stars">${starsFor(book.rating)}</span>` : ''}
      </div>
      <div class="g-actions">
        <button class="link-button" onclick="startEdit(${book.id})">Edit</button>
        <button class="book-row__delete" onclick="deleteBook(${book.id})" aria-label="Remove ${escapeHtml(book.title)}">✕</button>
      </div>
      <div class="g-cover">${coverHtml(book.cover_url, book.title)}</div>
      <div class="g-blurb">
        ${book.description ? `<p class="blurb">${escapeHtml(book.description)}</p>` : ''}
        ${book.notes ? `<p class="notes">${escapeHtml(book.notes)}</p>` : ''}
      </div>
    </div>
  `;
}
      
function editRowHtml(book) {
  const options = Object.keys(STATUS_LABELS).map(key =>
    `<option value="${key}" ${book.status === key ? 'selected' : ''}>${STATUS_LABELS[key]}</option>`
  ).join('');

  return `
    <div class="book-row">
      <h3>${escapeHtml(book.title)}</h3>
      <p class="book-row__author">by ${escapeHtml(book.author) || 'Unknown'}</p>
      <div class="edit-grid">
        <label>Status <select id="edit-status">${options}</select></label>
        <label>Rating (1-5) <input type="number" id="edit-rating" min="1" max="5" value="${book.rating ?? ''}"></label>
        <label>Date finished <input type="date" id="edit-date" value="${escapeHtml(book.date_finished)}"></label>
        <label>Notes <textarea id="edit-notes">${escapeHtml(book.notes)}</textarea></label>
      </div>
      <div class="edit-buttons">
        <button onclick="saveEdit(${book.id})">Save</button>
        <button class="secondary" onclick="cancelEdit()">Cancel</button>
      </div>
    </div>
  `;
}

function renderBooks() {
  const query = searchInput.value.trim().toLowerCase();
  const statusValue = statusFilter.value;

  if (allBooks.length === 0) {
    bookList.innerHTML = '<p class="empty-state">No books yet — add your first one above.</p>';
    return;
  }

  const visible = allBooks.filter(book => {
    const matchesStatus = statusValue === 'all' || book.status === statusValue;
    const haystack = [book.title, book.author, book.genre, book.tags].join(' ').toLowerCase();
    return matchesStatus && haystack.includes(query);
  });

  if (visible.length === 0) {
    bookList.innerHTML = '<p class="empty-state">No books match your search.</p>';
    return;
  }

  bookList.innerHTML = visible
    .map(book => (book.id === editingId ? editRowHtml(book) : rowHtml(book)))
    .join('');
}

async function loadBooks() {
  const res = await fetch('/api/books');
  allBooks = await res.json();
  renderBooks();
}

async function loadRecommendations() {
  recsDiv.innerHTML = '<p class="empty-state">Finding books you might like…</p>';

  try {
    const res = await fetch('/api/recommendations');
    const data = await res.json();
    currentPicks = data.picks || [];

    if (data.topGenres.length === 0 && currentPicks.length === 0) {
      recsDiv.innerHTML = '<p class="empty-state">Rate a few books 4-5 stars to get recommendations.</p>';
      return;
    }

    if (currentPicks.length === 0) {
      recsDiv.innerHTML = '<p class="empty-state">Couldn\'t find suggestions right now. Try again in a moment.</p>';
      return;
    }

         recsDiv.innerHTML = currentPicks.map((pick, i) => `
      <div class="pick">
        <h3 class="g-title">${escapeHtml(pick.title)}</h3>
        <p class="g-author">${pick.author ? `by ${escapeHtml(pick.author)}` : ''}${pick.year ? `, first published ${pick.year}` : ''}</p>
        <div class="g-genre">
          ${pick.genre ? `<span class="badge">${escapeHtml(pick.genre)}</span>` : ''}
          <p class="pick__reason">${escapeHtml(pick.reason)}</p>
        </div>
        <div class="g-actions">
          <button class="link-button" onclick="addPick(${i}, this)">Add to want to read</button>
        </div>
        <div class="g-cover">${coverHtml(pick.cover_url, pick.title)}</div>
        <div class="g-blurb">
          ${pick.description ? `<p class="blurb">${escapeHtml(pick.description)}</p>` : ''}
        </div>
      </div>
    `).join('');
    
  } catch (err) {
    recsDiv.innerHTML = '<p class="empty-state">Couldn\'t load recommendations right now.</p>';
  }
}

async function loadStats() {
  const res = await fetch('/api/stats');
  const data = await res.json();

  if (monthsChart) monthsChart.destroy();
  if (genreChart) genreChart.destroy();

  monthsChart = new Chart(document.getElementById('months-chart'), {
    type: 'bar',
    data: {
      labels: data.perMonth.map(m => m.month),
      datasets: [{
        label: 'Books finished',
        data: data.perMonth.map(m => m.count),
        backgroundColor: '#C99A44',
      }],
    },
    options: {
      scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
    },
  });

  genreChart = new Chart(document.getElementById('genre-chart'), {
    type: 'bar',
    data: {
      labels: data.perGenre.map(g => g.genre),
      datasets: [{
        label: 'Average rating',
        data: data.perGenre.map(g => g.avg_rating),
        backgroundColor: '#4F6B54',
      }],
    },
    options: {
      scales: { y: { beginAtZero: true, max: 5 } },
    },
  });
}

async function refreshAll() {
  await loadBooks();
  loadRecommendations();
  loadStats();
}

// --- Editing ---
function startEdit(id) {
  editingId = id;
  renderBooks();
}

function cancelEdit() {
  editingId = null;
  renderBooks();
}

async function saveEdit(id) {
  const updated = {
    status: document.getElementById('edit-status').value,
    rating: document.getElementById('edit-rating').value,
    date_finished: document.getElementById('edit-date').value,
    notes: document.getElementById('edit-notes').value,
  };

  await fetch(`/api/books/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updated),
  });

  editingId = null;
  refreshAll();
}

// --- Adding ---
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Adding…';

  const newBook = {
    title: document.getElementById('title').value,
    author: document.getElementById('author').value,
    genre: document.getElementById('genre').value.trim(),
    tags: document.getElementById('tags').value,
    status: document.getElementById('status').value,
    rating: document.getElementById('rating').value,
    date_finished: document.getElementById('date_finished').value,
    notes: document.getElementById('notes').value,
  };

  try {
    await fetch('/api/books', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newBook),
    });
    form.reset();
    refreshAll();
  } finally {
    button.disabled = false;
    button.textContent = 'Add to shelf';
  }
});

// One-click add from the recommendations list
async function addPick(index, button) {
  const pick = currentPicks[index];
  if (!pick) return;

  button.disabled = true;
  button.textContent = 'Adding…';

  await fetch('/api/books', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: pick.title,
      author: pick.author,
      genre: pick.genre || '',
      tags: '',
      status: 'want',
      rating: '',
      date_finished: '',
      notes: '',
    }),
  });

  refreshAll();
}

// --- Deleting ---
async function deleteBook(id) {
  if (!confirm('Remove this book from your shelf?')) return;
  await fetch(`/api/books/${id}`, { method: 'DELETE' });
  refreshAll();
}

searchInput.addEventListener('input', renderBooks);
statusFilter.addEventListener('change', renderBooks);

refreshAll();