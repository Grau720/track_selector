let config = {
    generos: [],
    excludedArtists: [],
    playlistId: null
  };
  let allGenres = [];
  let filteredArtists = [];
  let allPlaylists = [];
  let userId = '';
  
  // --- INICIALIZACIÓN ---
  
  document.addEventListener('DOMContentLoaded', async () => {
    setLoading(true, 'Cargando configuración...');
  
    try {
      // 1. Cargar configuración del usuario
      const cfgRes = await fetch('/config');
      // Si la configuración no carga (ej: token no existe), redirigimos al login.
      if (!cfgRes.ok) {
          if (cfgRes.status === 401) {
              window.location.href = '/login';
              return;
          }
          throw new Error('No se pudo cargar la configuración');
      }
      
      config = await cfgRes.json();
      if (!config.generos) config.generos = [];
      if (!config.excludedArtists) config.excludedArtists = [];
      
      // Obtener ID de usuario (solo para mostrarlo)
      const cookies = document.cookie.split('; ').reduce((acc, current) => {
          const [key, value] = current.split('=');
          acc[key] = value;
          return acc;
      }, {});
      userId = cookies['spotify_user_id'] || 'No disponible';
      document.getElementById('spotify-user-id').textContent = userId;
      
      // 2. Cargar todas las playlists 
      setLoading(true, 'Cargando playlists...');
      const playlistsRes = await fetch('/playlists');
      if (!playlistsRes.ok) throw new Error('No se pudo cargar playlists');
      allPlaylists = await playlistsRes.json();
      renderSelectedPlaylistDisplay(); 
      renderPlaylistResults(); 
  
      // 3. Cargar todos los géneros disponibles
      setLoading(true, 'Cargando géneros...');
      const genresRes = await fetch('/generos');
      if (!genresRes.ok) throw new Error('No se pudo cargar géneros');
      allGenres = await genresRes.json();
      
      renderSelectedGenres();
      renderAllGenresList();
      
      // 4. Obtener artistas filtrados
      if (config.generos.length > 0) {
        await updateFilteredArtists();
      } else {
        renderArtistList();
      }
      
      // 5. Cargar historial
      await loadAndRenderHistory();
  
  
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
    
    document.getElementById('playlist-search').addEventListener('input', (e) => {
      renderPlaylistResults(e.target.value);
    });
    
    // Manejo de pestañas (TABS)
    document.querySelectorAll('.tab-button').forEach(button => {
      button.addEventListener('click', () => {
        openTab(button.dataset.tab);
      });
    });
  });
  
  // Función para cambiar de pestaña
  function openTab(tabId) {
      document.querySelectorAll('.tab-content').forEach(content => {
          content.classList.remove('active');
      });
      document.querySelectorAll('.tab-button').forEach(button => {
          button.classList.remove('active');
      });
  
      document.getElementById(tabId).classList.add('active');
      document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');
      
      // Recargar el historial si cambiamos a la pestaña Monitor
      if (tabId === 'monitor-tab') {
          loadAndRenderHistory();
      }
  }
  
  
  // --- FUNCIONES DE RENDERIZADO DE CONFIGURACIÓN ---
  
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
          saveConfigAndUpdateArtists();
        };
        cont.appendChild(el);
      });
  }
  
  function renderArtistList() {
    const ul = document.getElementById('artist-list');
    ul.innerHTML = '';
  
    let artistsToShow = filteredArtists.filter(
      a => !config.excludedArtists.includes(a.id)
    );
    
    if (artistsToShow.length === 0) {
       const li = document.createElement('li');
       li.className = 'empty-message';
       li.textContent = filteredArtists.length > 0 ? 'Todos los artistas filtrados han sido excluidos.' : 'No se encontraron artistas con esos géneros.';
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
  
  function renderSelectedPlaylistDisplay() {
      const display = document.getElementById('selected-playlist-display');
      const selected = allPlaylists.find(p => p.id === config.playlistId);
  
      display.innerHTML = '';
  
      if (selected) {
          display.classList.remove('hidden');
          if (selected.image) {
              const img = document.createElement('img');
              img.src = selected.image;
              display.appendChild(img);
          }
          const info = document.createElement('div');
          info.innerHTML = `<strong>Playlist Seleccionada:</strong><br>${selected.name} (${selected.tracks} canciones)`;
          display.appendChild(info);
      } else {
          display.classList.add('hidden');
      }
  }
  
  function renderPlaylistResults(filter = '') {
      const resultsCont = document.getElementById('playlist-results');
      resultsCont.innerHTML = '';
      const lowerFilter = filter.toLowerCase().trim();
  
      let playlistsToShow = allPlaylists;
      
      if (lowerFilter.length > 0) {
          playlistsToShow = allPlaylists.filter(p => p.name.toLowerCase().includes(lowerFilter));
      }
      
      if (playlistsToShow.length === 0) {
          resultsCont.innerHTML = '<div class="empty-message">No se encontraron playlists.</div>';
          return;
      }
  
      playlistsToShow.forEach(p => {
          const div = document.createElement('div');
          div.className = 'playlist-option';
          
          if (p.id === config.playlistId) {
              div.classList.add('selected');
          }
  
          if (p.image) {
              const img = document.createElement('img');
              img.src = p.image;
              div.appendChild(img);
          }
  
          const name = document.createElement('span');
          name.textContent = `${p.name} (${p.tracks} canciones)`;
          div.appendChild(name);
          
          div.onclick = () => {
              config.playlistId = p.id;
              saveConfig();
              renderPlaylistResults(filter); 
              renderSelectedPlaylistDisplay(); 
              showToast(`Playlist "${p.name}" seleccionada.`, 'success');
          };
  
          resultsCont.appendChild(div);
      });
  }
  
  
  // --- FUNCIONES DE HISTORIAL (MONITOR) ---
  
// ----------------------------------------
// --- FUNCIONES DE HISTORIAL (MONITOR) ---
// ----------------------------------------

    async function loadAndRenderHistory() {
        const list = document.getElementById('history-list');
        list.innerHTML = '<li class="empty-message">Cargando historial...</li>';
        
        try {
            const res = await fetch('/history');
            if (!res.ok) throw new Error('No se pudo cargar el historial');
            const history = await res.json();
            
            list.innerHTML = '';

            if (history.length === 0) {
                list.innerHTML = '<li class="empty-message">No hay ejecuciones registradas todavía.</li>';
                return;
            }

            history.forEach(item => {
                const li = document.createElement('li');
                li.className = 'history-item';
                
                const date = new Date(item.timestamp).toLocaleString();
                
                li.innerHTML = `
                    <div class="history-header">
                        <span>📅 ${date}</span>
                        <span class="status-text">Playlist: ${item.playlistName}</span>
                        <span style="color: ${item.addedCount > 0 ? '#1db954' : '#888'};">
                            ${item.addedCount} Canciones añadidas
                        </span>
                    </div>
                    <div class="history-details">
                        <p>Géneros usados: ${item.genresUsed.join(', ')}</p>
                        <table>
                            <thead>
                                <tr>
                                    <th>Canción</th>
                                    <th>Artista</th>
                                    <th>Enlaces</th> 
                                </tr>
                            </thead>
                            <tbody>
                                ${item.newTracks.map(track => {
                                    let linksHtml = '';
                                    const links = track.externalLinks || {};
                                    
                                    // Generar enlaces para cada plataforma
                                    if (track.uri) {
                                        const spotifyId = track.uri.split(':').pop();
                                        linksHtml += `<a href="https://open.spotify.com/track/${spotifyId}" target="_blank">Spotify</a>`;
                                    }
                                    
                                    if (links.youtubeMusic) {
                                        linksHtml += ` | <a href="${links.youtubeMusic}" target="_blank">YouTube Music</a>`;
                                    }
                                    if (links.appleMusic) {
                                        linksHtml += ` | <a href="${links.appleMusic}" target="_blank">Apple Music</a>`;
                                    }
                                    if (links.beatport) {
                                        linksHtml += ` | <a href="${links.beatport}" target="_blank">Beatport</a>`;
                                    }

                                    return `
                                        <tr>
                                            <td>${track.title}</td>
                                            <td>${track.artist}</td>
                                            <td>${linksHtml}</td> 
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                `;
                
                li.addEventListener('click', (e) => {
                    // Previene que el clic en los enlaces colapse la fila
                    if (e.target.tagName === 'A' || e.target.tagName === 'TD' || e.target.tagName === 'TH' || e.target.tagName === 'TABLE') return;
                    
                    const details = li.querySelector('.history-details');
                    details.style.display = details.style.display === 'block' ? 'none' : 'block';
                });

                list.appendChild(li);
            });

        } catch (err) {
            // Manejo de error 401 que el toast ya maneja
            console.error('Error cargando historial:', err);
            showToast(`Error al cargar historial: ${err.message}`, 'error');
        }
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
      
      if (artistasRes.status === 401) {
          const errData = await artistasRes.json();
          throw new Error(errData.error);
      }
      if (!artistasRes.ok) throw new Error('Error del servidor');
      
      filteredArtists = await artistasRes.json();
      renderArtistList();
  
    } catch (err) {
      console.error('Error filtrando artistas:', err);
      showToast(`Error al filtrar artistas: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }
  
  async function saveConfigAndUpdateArtists() {
    await saveConfig();
    renderSelectedGenres();
    await updateFilteredArtists();
  }
  
  async function excludeArtist(artist, listItem) {
    if (!config.playlistId) {
      showToast('Error: No hay una playlist seleccionada.', 'error');
      return;
    }
    
    listItem.style.opacity = '0.5'; 
    const btn = listItem.querySelector('button');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Excluyendo...';
    }
  
    try {
      const res = await fetch('/excluir-artista', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artistId: artist.id,
          playlistId: config.playlistId
        })
      });
  
      if (res.status === 401) {
          const errData = await res.json();
          throw new Error(errData.error);
      }
      if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'El servidor no pudo excluir al artista');
      }
      
      const data = await res.json();
      showToast(data.message, 'success');
      
      if (!config.excludedArtists) config.excludedArtists = [];
      config.excludedArtists.push(artist.id);
  
      listItem.remove();
  
    } catch (err) {
      console.error('Error al excluir artista:', err);
      showToast(`Error: ${err.message}`, 'error');
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
          excludedArtists: config.excludedArtists || [] 
        })
      });
      
      if (res.status === 401) {
          const errData = await res.json();
          throw new Error(errData.error);
      }
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Error en el servidor');
      }
      
      const data = await res.json();
      showToast(data.message, 'success');
      
      await loadAndRenderHistory(); 
  
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
      
      if (res.status === 401) {
          const errData = await res.json();
          throw new Error(errData.error);
      }
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
  
  
  // --- UTILIDADES (showToast MODIFICADO) ---
  
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
    
    // Si el mensaje es el de re-login forzado por el servidor
    if (message.includes('vuelve a iniciar sesión')) {
        toast.innerHTML = `
            <strong>❌ Sesión Expirada</strong><br>${message}<br>
            <button class="btn" style="background: #e22134; color: white; margin-top: 5px;" onclick="window.location.href='/login'">
                Iniciar Sesión
            </button>
        `;
    } else {
        toast.textContent = message;
    }
  
    container.appendChild(toast);
    
    setTimeout(() => {
      toast.classList.add('show');
    }, 10);
    
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        toast.remove();
      }, 300);
    }, 7000); // 7 segundos para que el usuario vea el botón de login
  }