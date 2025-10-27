let selectedGenres = new Set();
let selectedPlaylist = null;

async function fetchData() {
  document.getElementById('loading').style.display = 'block';

  try {
    const [resGenres, resPlaylists, resConfig] = await Promise.all([
      fetch('/generos'),
      fetch('/playlists'),
      fetch('/config'),
    ]);

    const genres = await resGenres.json();
    const playlists = await resPlaylists.json();
    const config = await resConfig.json();

    const genresDiv = document.getElementById('genres');
    const playlistsDiv = document.getElementById('playlists');

    genres.forEach((g) => {
      const el = document.createElement('div');
      el.className = 'genre';
      el.textContent = g;
      if (config.generos?.includes(g)) {
        el.classList.add('selected');
        selectedGenres.add(g);
      }

      el.onclick = () => {
        if (selectedGenres.has(g)) {
          selectedGenres.delete(g);
          el.classList.remove('selected');
        } else {
          selectedGenres.add(g);
          el.classList.add('selected');
        }
        guardarConfig();
      };

      genresDiv.appendChild(el);
    });

    playlists.forEach((p) => {
      const el = document.createElement('div');
      el.className = 'playlist';
      if (p.image) {
        const img = document.createElement('img');
        img.src = p.image;
        img.className = 'cover';
        el.appendChild(img);
      }
      el.appendChild(document.createTextNode(p.name));
      el.onclick = () => {
        document.querySelectorAll('.playlist').forEach((x) => x.classList.remove('selected'));
        el.classList.add('selected');
        selectedPlaylist = p.id;
        guardarConfig();
      };

      if (p.id === config.playlistId) {
        el.classList.add('selected');
        selectedPlaylist = p.id;
      }

      playlistsDiv.appendChild(el);
    });
  } catch (err) {
    console.error('❌ Error cargando datos:', err);
  } finally {
    document.getElementById('loading').style.display = 'none';
  }
}

async function guardarConfig() {
  const body = {
    generos: Array.from(selectedGenres),
    playlistId: selectedPlaylist,
  };
  await fetch('/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function filtrarYAnadir() {
  if (!selectedGenres.size || !selectedPlaylist) {
    alert('Selecciona al menos un género y una playlist.');
    return;
  }

  const res = await fetch('/filtrar-y-anadir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ generos: Array.from(selectedGenres), playlistId: selectedPlaylist }),
  });
  const msg = await res.text();
  alert(msg);
}

async function vaciarPlaylist() {
  if (!selectedPlaylist) {
    alert('Selecciona una playlist para vaciar.');
    return;
  }

  const res = await fetch('/vaciar-playlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playlistId: selectedPlaylist }),
  });
  const msg = await res.text();
  alert(msg);
}

document.addEventListener('DOMContentLoaded', fetchData);
