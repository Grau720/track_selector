let config = {
    generos: [],
    excludedArtists: [],
    playlistId: null
  };
  let allGenres = [];
  let filteredArtists = [];
  let allPlaylists = [];
  
  // --- INICIALIZACIÓN ---
  
  document.addEventListener('DOMContentLoaded', async () => {
    setLoading(true, 'Cargando configuración...');
  
    try {
      // 1. Cargar configuración del usuario
      const cfgRes = await fetch('/config');
      if (!cfgRes.ok) throw new Error('No se pudo cargar la configuración');
      config = await cfgRes.json();
      if (!config.generos) config.generos = [];
      if (!config.excludedArtists) config.excludedArtists = [];
  
      // 2. Cargar todas las playlists del usuario
      setLoading(true, 'Cargando playlists...');
      const playlistsRes = await fetch('/playlists');
      if (!playlistsRes.ok) throw new Error('No se pudo cargar playlists');
      allPlaylists = await playlistsRes.json();
      renderPlaylistSelector();
  
      // 3. Cargar todos los géneros disponibles
      setLoading(true, 'Cargando géneros...');
      const genresRes = await fetch('/generos');
      if (!genresRes.ok) throw new Error('No se pudo cargar géneros');
      allGenres = await genresRes.json();
      
      renderSelectedGenres();
      renderAllGenresList();
      
      // 4. Obtener artistas filtrados (basado en géneros guardados)
      if (config.generos.length > 0) {
        await updateFilteredArtists();
      } else {
        renderArtistList(); // Renderiza la lista vacía o con mensaje
      }
  
    } catch (err) {
      console.error('Error cargando:', err);
      showToast(`Error al cargar: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  
    // --- EVENT LISTENERS ---
  
    document.getElementById('add-genre-btn').addEventListener('click', () => {
      document.getElementById('all-genres').classList.toggle('hidden');
    });
  
    document.getElementById('genre-search').addEventListener('input', (e) => {
      renderAllGenresList(e.target.value);
    });
  
    document.getElementById('playlist-selector').addEventListener('change', (e) => {
      config.playlistId = e.target.value;
      saveConfig();
      showToast('Playlist seleccionada guardada', 'success');
    });
  });
  
  // --- FUNCIONES DE RENDERIZADO (VISTA) ---
  
  function renderSelectedGenres() {
    const cont = document.getElementById('selected-genres');
    cont.innerHTML = '';
    if (!config.generos || config.generos.length === 0) {
      cont.innerHTML = '<div class="empty-message">No has seleccionado ningún género.</div>';
      return;
    }
    
    config.generos.forEach(g => {
      const el = document.createElement('div');
      el.className = 'genre';
      
      const text = document.createElement('span');
      text.textContent = g;
      
      const removeBtn = document.createElement('button');
      removeBtn.textContent = '×';
      removeBtn.className = 'remove-btn';
      removeBtn.onclick = () => {
        config.generos = config.generos.filter(gen => gen !== g);
        saveConfigAndUpdateArtists();
      };
      
      el.appendChild(text);
      el.appendChild(removeBtn);
      cont.appendChild(el);
    });
  }
  
  function renderAllGenresList(filter = '') {
    const cont = document.getElementById('genre-list-container');
    cont.innerHTML = '';
    const lowerFilter = filter.toLowerCase();
    
    allGenres
      .filter(g => g.toLowerCase().includes(lowerFilter))
      .forEach(g => {
        const el = document.createElement('div');
        el.className = 'genre-option';
        el.textContent = g;
        
        if (config.generos.includes(g)) {
          el.classList.add('selected');
        }
        
        el.onclick = () => {
          if (!config.generos.includes(g)) {
            config.generos.push(g);
            el.classList.add('selected');
          } else {
            config.generos = config.generos.filter(gen => gen !== g);
            el.classList.remove('selected');
          }
          // Guardar y actualizar artistas
          saveConfigAndUpdateArtists();
        };
        cont.appendChild(el);
      });
  }
  
  function renderPlaylistSelector() {
    const selector = document.getElementById('playlist-selector');
    selector.innerHTML = '<option value="">Selecciona una playlist...</option>';
    
    allPlaylists.forEach(p => {
      const option = document.createElement('option');
      option.value = p.id;
      option.textContent = `${p.name} (${p.tracks} canciones)`;
      if (p.id === config.playlistId) {
        option.selected = true;
      }
      selector.appendChild(option);
    });
  }
  
  function renderArtistList() {
    const ul = document.getElementById('artist-list');
    ul.innerHTML = '';
  
    if (!filteredArtists || filteredArtists.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty-message';
      li.textContent = 'No se encontraron artistas con esos géneros (o ya has excluido a todos).';
      ul.appendChild(li);
      return;
    }
  
    let artistsToShow = filteredArtists.filter(
      a => !config.excludedArtists.includes(a.id)
    );
    
    if (artistsToShow.length === 0) {
       const li = document.createElement('li');
       li.className = 'empty-message';
       li.textContent = 'Todos los artistas filtrados han sido excluidos.';
       ul.appendChild(li);
       return;
    }
  
    artistsToShow.forEach(a => {
      const li = document.createElement('li');
      
      const artistName = document.createElement('span');
      artistName.textContent = a.name;
  
      const removeBtn = document.createElement('button');
      removeBtn.textContent = 'Excluir Artista';
      removeBtn.className = 'remove-artist-btn'; 
  
      removeBtn.onclick = async () => {
        await excludeArtist(a, li);
      };
      
      li.appendChild(artistName);
      li.appendChild(removeBtn);
      ul.appendChild(li);
    });
  }
  
  // --- FUNCIONES DE LÓGICA Y DATOS ---
  
  async function saveConfig() {
    try {
      const res = await fetch('/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      if (!res.ok) throw new Error('No se pudo guardar la config');
    } catch (err) {
      console.error('Error guardando config:', err);
      showToast('Error al guardar configuración', 'error');
    }
  }
  
  async function updateFilteredArtists() {
    setLoading(true, 'Actualizando lista de artistas...');
    try {
      const artistasRes = await fetch('/artistas-filtrados', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generos: config.generos || [] })
      });
      if (!artistasRes.ok) throw new Error('Error del servidor');
      
      filteredArtists = await artistasRes.json();
      renderArtistList();
  
    } catch (err) {
      console.error('Error filtrando artistas:', err);
      showToast('Error al filtrar artistas', 'error');
    } finally {
      setLoading(false);
    }
  }
  
  async function saveConfigAndUpdateArtists() {
    await saveConfig();
    renderSelectedGenres(); // Actualiza la vista de géneros seleccionados
    await updateFilteredArtists(); // Vuelve a cargar los artistas
  }
  
  async function excludeArtist(artist, listItem) {
    if (!config.playlistId) {
      showToast('Error: No hay una playlist seleccionada.', 'error');
      return;
    }
    
    // Feedback visual
    listItem.style.opacity = '0.5'; 
    const btn = listItem.querySelector('button');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Excluyendo...';
    }
  
    try {
      // 1. Llamamos al ENDPOINT del servidor
      const res = await fetch('/excluir-artista', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artistId: artist.id,
          playlistId: config.playlistId
        })
      });
  
      if (!res.ok) throw new Error('El servidor no pudo excluir al artista');
      
      const data = await res.json();
      showToast(data.message, 'success');
      
      // 2. Actualizamos la config LOCAL para que coincida
      if (!config.excludedArtists) config.excludedArtists = [];
      config.excludedArtists.push(artist.id);
  
      // 3. Actualizamos la lista visual (más rápido que recargar todo)
      listItem.remove();
      // Opcionalmente, recargar la lista entera:
      // renderArtistList(); 
  
    } catch (err) {
      console.error('Error al excluir artista:', err);
      showToast(`Error: ${err.message}`, 'error');
      // Restaurar el botón si falla
      listItem.style.opacity = '1';
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Excluir Artista';
      }
    }
  }
  
  // --- ACCIONES DE BOTONES PRINCIPALES ---
  
  async function filtrarYAnadir() {
    if (!config.playlistId) {
      showToast('Debes seleccionar una playlist de destino primero.', 'error');
      return;
    }
    if (!config.generos || config.generos.length === 0) {
      showToast('Debes seleccionar al menos un género.', 'error');
      return;
    }
  
    setLoading(true, 'Filtrando y añadiendo canciones (puede tardar)...');
  
    try {
      const res = await fetch('/filtrar-y-anadir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          generos: config.generos, 
          playlistId: config.playlistId,
          // ¡Importante! Enviar los artistas ya excluidos
          excludedArtists: config.excludedArtists || [] 
        })
      });
      
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Error en el servidor');
      }
      
      const data = await res.json();
      showToast(data.message, 'success');
  
    } catch (err) {
      console.error('Error al filtrar:', err);
      showToast(`Error al filtrar: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }
  
  async function vaciarPlaylist() {
    if (!config.playlistId) {
      showToast('Debes seleccionar una playlist para vaciar.', 'error');
      return;
    }
    
    if (!confirm('¿Estás seguro de que quieres eliminar TODAS las canciones de esta playlist?')) {
      return;
    }
  
    setLoading(true, 'Vaciando playlist...');
    try {
      const res = await fetch('/vaciar-playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playlistId: config.playlistId })
      });
      
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Error en el servidor');
      }
      
      const data = await res.json();
      showToast(data.message, 'success');
    } catch (err) {
      console.error('Error vaciando:', err);
      showToast(`Error al vaciar: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }
  
  
  // --- UTILIDADES ---
  
  function setLoading(isLoading, message = 'Cargando...') {
    const loadingEl = document.getElementById('loading');
    if (isLoading) {
      loadingEl.textContent = message;
      loadingEl.style.display = 'flex';
    } else {
      loadingEl.style.display = 'none';
    }
  }
  
  function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container') || document.body;
    const toast = document.createElement('div');
    toast.className = `message-toast ${type}`;
    toast.textContent = message;
    
    container.appendChild(toast);
    
    // Mostrar
    setTimeout(() => {
      toast.classList.add('show');
    }, 10); // Pequeño delay para activar la transición CSS
    
    // Ocultar y eliminar
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        toast.remove();
      }, 300); // Esperar a que termine la transición de salida
    }, 4000); // Duración del toast
  }