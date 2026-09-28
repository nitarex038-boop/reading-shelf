const form = document.getElementById('book-form');
const bookList = document.getElementById('book-list');
const recsDiv = document.getElementById('recommendations');
const searchInput = document.getElementById('search');
const statusFilter = document.getElementById('status-filter');

let allBooks = [];
let currentPicks = [];
let editingId = null;
let monthsChart = null;
let genreChart = null;
let paceChart = null;

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

// '2026-03-20' -> '20 Mar 2026'
function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function datesLine(book) {
  if (book.date_started && book.date_finished) {
    return `Started ${formatDate(book.date_started)}, finished ${formatDate(book.date_finished)}`;
  }
  if (book.date_finished) return `Finished ${formatDate(book.date_finished)}`;
  if (book.date_started) return `Started ${formatDate(book.date_started)}`;
  return '';
}

function coverHtml(coverUrl, title) {
  if (coverUrl) {
    return `<img class="cover" src="${escapeHtml(coverUrl)}" alt="Cover of ${escapeHtml(title)}" loading="lazy">`;
  }
  const initial = escapeHtml((title || '?').trim().charAt(0).toUpperCase());
  return `<div class="cover cover--empty" aria-hidden="true">${initial}</div>`;
}

function rowHtml(book) {
  const dates = datesLine(book);
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
        ${dates ? `<p class="dates">${dates}</p>` : ''}
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
        <label>Date started <input type="date" id="edit-start" value="${escapeHtml(book.date_started)}"></label>
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

function shorten(text, max = 18) {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

async function loadStats() {
  const res = await fetch('/api/stats');
  const data = await res.json();

  if (monthsChart) monthsChart.destroy();
  if (genreChart) genreChart.destroy();
  if (paceChart) paceChart.destroy();

  // Fill in months with no books so the line shows the real gaps
  const monthCounts = {};
  data.perMonth.forEach(m => { monthCounts[m.month] = m.count; });

  const monthLabels = [];
  const monthValues = [];
  if (data.perMonth.length > 0) {
    let [year, month] = data.perMonth[0].month.split('-').map(Number);
    const [lastYear, lastMonth] = data.perMonth[data.perMonth.length - 1].month.split('-').map(Number);

    while (year < lastYear || (year === lastYear && month <= lastMonth)) {
      const key = `${year}-${String(month).padStart(2, '0')}`;
      monthLabels.push(key);
      monthValues.push(monthCounts[key] || 0);
      month++;
      if (month > 12) { month = 1; year++; }
    }
  }

  monthsChart = new Chart(document.getElementById('months-chart'), {
    type: 'line',
    data: {
      labels: monthLabels,
      datasets: [{
        label: 'Books finished',
        data: monthValues,
        borderColor: '#C99A44',
        backgroundColor: 'rgba(201, 154, 68, 0.2)',
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: '#C99A44',
      }],
    },
    options: {
      scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
    },
  });
    const palette = ['#C99A44', '#4F6B54', '#1B1F3B', '#A8553F', '#7A6FA8', '#3F8FA8', '#C27C8C', '#8A8F4E'];

  genreChart = new Chart(document.getElementById('genre-chart'), {
    type: 'pie',
    data: {
      labels: data.perGenre.map(g => g.genre),
      datasets: [{
        data: data.perGenre.map(g => g.count),
        backgroundColor: data.perGenre.map((g, i) => palette[i % palette.length]),
        borderColor: '#EDE3CE',
        borderWidth: 2,
      }],
    },
    options: {
      plugins: {
        legend: { position: 'bottom' },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const g = data.perGenre[ctx.dataIndex];
              const books = `${g.count} book${g.count === 1 ? '' : 's'}`;
              const rating = g.avg_rating != null ? `, average rating ${g.avg_rating.toFixed(1)}` : '';
              return ` ${g.genre}: ${books}${rating}`;
            },
          },
        },
      },
    },
  });

  // Reading pace: days taken to finish each book
  const paceCanvas = document.getElementById('pace-chart');
  const paceSummary = document.getElementById('pace-summary');

  if (data.pace.length === 0) {
    paceCanvas.style.display = 'none';
    paceSummary.textContent = 'Add a start and finish date to a book (use Edit) to see your pace.';
    return;
  }

  paceCanvas.style.display = 'block';
  const average = data.pace.reduce((sum, p) => sum + p.days, 0) / data.pace.length;
  paceSummary.textContent = `On average you finish a book in ${average.toFixed(1)} days (across ${data.pace.length} book${data.pace.length === 1 ? '' : 's'}).`;

  paceChart = new Chart(paceCanvas, {
    type: 'bar',
    data: {
      labels: data.pace.map(p => shorten(p.title)),
      datasets: [{
        label: 'Days to finish',
        data: data.pace.map(p => p.days),
        backgroundColor: '#1B1F3B',
      }],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: 'Days' } },
      },
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
    date_started: document.getElementById('edit-start').value,
    date_finished: document.getElementById('edit-date').value,
    notes: document.getElementById('edit-notes').value,
  };

  if (updated.date_started && updated.date_finished && updated.date_finished < updated.date_started) {
    alert('The finish date is before the start date. Please check them.');
    return;
  }

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

  const started = document.getElementById('date_started').value;
  const finished = document.getElementById('date_finished').value;
  if (started && finished && finished < started) {
    alert('The finish date is before the start date. Please check them.');
    return;
  }

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
    date_started: started,
    date_finished: finished,
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
      date_started: '',
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