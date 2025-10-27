document.addEventListener('DOMContentLoaded', async () => {
    const generoContainer = document.getElementById('generoContainer');
    const playlistContainer = document.getElementById('playlistContainer');
    const status = document.getElementById('status');
    const spinner = document.getElementById('spinner');
  
    // Mostrar spinner mientras se carga
    spinner.style.display = 'block';
  
    try {
      // Obtener géneros
      const resGeneros = await fetch('/generos');
      const generos = await resGeneros.json();
  
      generos.forEach(g => {
        const div = document.createElement('div');
        div.className = 'genero-card';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = g;
        const label = document.createElement('label');
        label.textContent = g;
        div.appendChild(checkbox);
        div.appendChild(label);
        generoContainer.appendChild(div);
      });
  
      // Obtener playlists
      const resPlaylists = await fetch('/playlists');
      const playlists = await resPlaylists.json();
  
      playlists.forEach(p => {
        const div = document.createElement('div');
        div.className = 'playlist-card';
        div.dataset.playlistId = p.id;
  
        const img = document.createElement('img');
        img.src = p.image || 'default_playlist.png'; // Si no tiene imagen, usa una por defecto
        img.alt = p.name;
  
        const title = document.createElement('h3');
        title.textContent = p.name;
  
        div.appendChild(img);
        div.appendChild(title);
        playlistContainer.appendChild(div);
      });
  
      // Ocultar spinner
      spinner.style.display = 'none';
    } catch (err) {
      console.error('❌ Error cargando datos:', err);
      status.textContent = 'Error cargando géneros o playlists';
      spinner.style.display = 'none';
    }
  
    // Añadir evento al botón principal
    document.getElementById('filtrarBtn').addEventListener('click', async () => {
      const seleccionados = [...document.querySelectorAll('#generoContainer input:checked')].map(el => el.value);
      const playlistId = document.querySelector('.playlist-card.selected')?.dataset.playlistId;
  
      if (!seleccionados.length || !playlistId) {
        status.textContent = 'Selecciona al menos un género y una playlist.';
        return;
      }
  
      status.textContent = '⏳ Añadiendo canciones...';
      try {
        const res = await fetch('/filtrar-y-anadir', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ generos: seleccionados, playlistId })
        });
        const msg = await res.text();
        status.textContent = msg;
      } catch (err) {
        console.error(err);
        status.textContent = '❌ Error añadiendo canciones';
      }
    });
  
    // Añadir evento a los cards de playlist
    playlistContainer.addEventListener('click', e => {
      const card = e.target.closest('.playlist-card');
      if (!card) return;
  
      document.querySelectorAll('.playlist-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
    });
  });
  