let selectedPlaylistId = null;
let selectedGenres = new Set();

async function cargarPlaylists() {
  const container = document.getElementById('playlists');
  container.innerHTML = '';

  const res = await fetch('/playlists');
  const data = await res.json();

  data.forEach(p => {
    const div = document.createElement('div');
    div.className = 'card';
    div.innerHTML = `
      <img src="https://i.scdn.co/image/ab67616d0000b273000000000000000000000000" alt="cover" />
      <div><strong>${p.name}</strong></div>
    `;

    div.addEventListener('click', () => {
      document.querySelectorAll('#playlists .card').forEach(c => c.classList.remove('selected'));
      div.classList.add('selected');
      selectedPlaylistId = p.id;
    });

    container.appendChild(div);
  });
}

async function cargarGeneros() {
  const container = document.getElementById('generos');
  container.innerHTML = '';

  const res = await fetch('/generos');
  const data = await res.json();

  data.forEach(g => {
    const div = document.createElement('div');
    div.className = 'card';
    div.textContent = g;

    div.addEventListener('click', () => {
      div.classList.toggle('selected');
      if (selectedGenres.has(g)) {
        selectedGenres.delete(g);
      } else {
        selectedGenres.add(g);
      }
    });

    container.appendChild(div);
  });
}

async function filtrarYAnadir() {
  if (!selectedPlaylistId || selectedGenres.size === 0) {
    alert('Selecciona una playlist y al menos un género');
    return;
  }

  document.getElementById('loading').classList.remove('hidden');
  const res = await fetch('/filtrar-y-anadir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      playlistId: selectedPlaylistId,
      generos: Array.from(selectedGenres)
    })
  });

  const text = await res.text();
  document.getElementById('loading').classList.add('hidden');
  alert(text);
}

async function borrarPlaylist() {
  if (!selectedPlaylistId) {
    alert('Selecciona una playlist para vaciar');
    return;
  }

  if (!confirm('¿Estás seguro de que quieres borrar TODAS las canciones de esta playlist?')) return;

  document.getElementById('loading').classList.remove('hidden');

  const res = await fetch('/vaciar-playlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playlistId: selectedPlaylistId })
  });

  const text = await res.text();
  document.getElementById('loading').classList.add('hidden');
  alert(text);
}

async function checkLogin() {
  const res = await fetch('/playlists');
  if (res.status === 401) {
    window.location.href = '/login';
  } else {
    document.getElementById('status').textContent = '✅ Login exitoso. Token activo.';
    cargarPlaylists();
    cargarGeneros();
  }
}

document.getElementById('filtrar').addEventListener('click', filtrarYAnadir);
document.getElementById('borrar').addEventListener('click', borrarPlaylist);

window.onload = checkLogin;
