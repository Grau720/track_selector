let config = {};
let allGenres = [];
let filteredArtists = [];

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('loading').style.display = 'block';

  try {
    // Cargar configuración del usuario
    const cfgRes = await fetch('/config');
    config = await cfgRes.json();

    // Cargar todos los géneros disponibles
    const genresRes = await fetch('/generos');
    allGenres = await genresRes.json();

    renderGenres();
    renderAllGenres();

    // Obtener artistas filtrados
    const artistasRes = await fetch('/artistas-filtrados', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generos: config.generos || [] })
    });
    filteredArtists = await artistasRes.json();
    renderArtistList();

    // Obtener playlist seleccionada
    const playlistsRes = await fetch('/playlists');
    const playlists = await playlistsRes.json();
    const selected = playlists.find(p => p.id === config.playlistId);
    if (selected) {
      const div = document.createElement('div');
      div.className = 'playlist';
      if (selected.image) {
        const img = document.createElement('img');
        img.src = selected.image;
        img.style.width = '100px';
        img.style.borderRadius = '8px';
        div.appendChild(img);
      }
      const title = document.createElement('div');
      title.textContent = selected.name;
      div.appendChild(title);
      document.getElementById('playlist-info').appendChild(div);
    }

  } catch (err) {
    console.error('Error cargando:', err);
  } finally {
    document.getElementById('loading').style.display = 'none';
  }

  document.getElementById('add-genre-btn').addEventListener('click', () => {
    document.getElementById('all-genres').classList.toggle('hidden');
  });
});

function renderGenres() {
  const cont = document.getElementById('selected-genres');
  cont.innerHTML = '';
  (config.generos || []).forEach(g => {
    const el = document.createElement('div');
    el.className = 'genre';
    el.textContent = g;
    cont.appendChild(el);
  });
}

function renderAllGenres() {
  const cont = document.getElementById('all-genres');
  cont.innerHTML = '';
  allGenres.forEach(g => {
    const el = document.createElement('div');
    el.className = 'genre-option';
    el.textContent = g;
    el.onclick = () => {
      if (!config.generos.includes(g)) {
        config.generos.push(g);
        saveConfig();
        renderGenres();
      }
    };
    cont.appendChild(el);
  });
}

function renderArtistList() {
  const ul = document.getElementById('artist-list');
  ul.innerHTML = '';
  filteredArtists.forEach(a => {
    const li = document.createElement('li');
    li.textContent = a.name;
    const removeBtn = document.createElement('button');
    removeBtn.textContent = '❌';
    removeBtn.onclick = () => {
      filteredArtists = filteredArtists.filter(x => x.id !== a.id);
      renderArtistList();
    };
    li.appendChild(removeBtn);
    ul.appendChild(li);
  });
}

function saveConfig() {
  fetch('/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config)
  });
}

async function filtrarYAnadir() {
  if (!config.generos || !config.playlistId) return alert('Falta configuración');
  const res = await fetch('/filtrar-y-anadir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ generos: config.generos, playlistId: config.playlistId })
  });
  const text = await res.text();
  alert(text);
}

async function vaciarPlaylist() {
  if (!config.playlistId) return alert('No hay playlist configurada');
  const res = await fetch('/vaciar-playlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playlistId: config.playlistId })
  });
  const text = await res.text();
  alert(text);
}
