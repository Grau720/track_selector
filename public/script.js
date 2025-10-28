// public/script.js

let config = {
    generos: [],
    excludedArtists: [],
    playlistId: null,
    favoriteArtists: []
};
let allGenres = [];
let filteredArtists = [];
let allPlaylists = [];
let userId = '';
let recommendedArtistsCache = []; // Cache para no recargar constantemente

// ----------------------------------------
// --- FUNCIONES DE UTILIDAD ---
// ----------------------------------------

function getCookie(name) {
    const cookieString = document.cookie;
    if (!cookieString) return null;

    const cookies = cookieString.split('; ').reduce((acc, current) => {
        const parts = current.split('=');
        if (parts.length === 2) {
            acc[parts[0]] = decodeURIComponent(parts[1]); 
        }
        return acc;
    }, {});
    
    return cookies[name] || null;
}

function setLoading(isLoading, message = 'Cargando...') {
    const loadingEl = document.getElementById('loading');
    const loadingText = document.getElementById('loading-text');
    if (isLoading) {
      loadingText.textContent = message;
      loadingEl.classList.remove('hidden');
    } else {
      loadingEl.classList.add('hidden');
    }
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : '⚠';
    
    if (message.includes('vuelve a iniciar sesión')) {
        toast.innerHTML = `
            <span style="font-size: 1.5rem;">${icon}</span>
            <div>
                <strong>Sesión Expirada</strong><br>
                <small>${message}</small>
            </div>
        `;
    } else {
        toast.innerHTML = `
            <span style="font-size: 1.5rem;">${icon}</span>
            <div>${message}</div>
        `;
    }
  
    container.appendChild(toast);
    
    setTimeout(() => {
      toast.style.animation = 'slideOutRight 0.3s';
      setTimeout(() => {
        toast.remove();
      }, 300);
    }, 5000); 
}

// ----------------------------------------
// --- INICIALIZACIÓN ---
// ----------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
    // Escondemos el contenido principal por defecto hasta que sepamos si hay sesión
    const loginPortal = document.getElementById('login-portal');
    const mainContent = document.body.querySelectorAll('header, nav, .container, .action-bar');
    const spotifyUserIdElement = document.getElementById('spotify-user-id');
    
    function setLoginState(isLoggedIn) {
        if (isLoggedIn) {
            loginPortal.classList.add('hidden');
            mainContent.forEach(el => el.classList.remove('hidden'));
        } else {
            loginPortal.classList.remove('hidden');
            mainContent.forEach(el => el.classList.add('hidden'));
            spotifyUserIdElement.textContent = 'No autenticado';
        }
    }

    setLoading(true, 'Comprobando sesión...');
  
    try {
      // 1. Cargar configuración básica (y comprobar sesión)
      const cfgRes = await fetch('/config');
      
      if (!cfgRes.ok) {
          const errData = await cfgRes.json().catch(() => ({ error: 'Error desconocido' }));

          if (cfgRes.status === 401) {
              // Si el middleware falla el refresh O no hay cookies.
              if (errData.error.includes('No user') || errData.error.includes('expirado')) {
                  console.log('Sesión no válida/expirada. Mostrando portal de login.');
                  setLoginState(false);
                  setLoading(false);
                  return; // Detener la ejecución del script principal
              }
              // En otros casos 401 que el middleware no manejó bien, forzamos login
              window.location.href = '/login';
              return;
          }
          throw new Error(`Error ${cfgRes.status}: No se pudo cargar la configuración`);
      }
      
      // Si la respuesta fue OK (200)
      setLoginState(true); 
      const loadedConfig = await cfgRes.json();
      config = { ...config, ...loadedConfig }; 
      
      // Asegurar arrays
      if (!config.generos) config.generos = [];
      if (!config.excludedArtists) config.excludedArtists = [];
      if (!config.favoriteArtists) config.favoriteArtists = [];
      
      // 2. Obtener usuario (de la cookie, ahora que sabemos que la sesión es válida)
      userId = getCookie('spotify_user_id') || 'No disponible';
      spotifyUserIdElement.textContent = userId;
      
      // 3. Cargar géneros (ligero)
      const genresRes = await fetch('/generos');
      if (!genresRes.ok) throw new Error('No se pudo cargar géneros');
      allGenres = await genresRes.json();
      
      // 4. Renderizar UI
      renderSelectedGenres();
      renderAllGenresList();
      
      // 5. Cargar datos asíncronos
      loadPlaylists().catch(err => console.error('Error cargando playlists:', err));
      loadFavoriteArtists().catch(err => console.error('Error cargando favoritos:', err));

      if (config.generos && config.generos.length > 0) {
          loadAndRenderRecommendedArtists().catch(err => console.error('Error cargando recomendados:', err));
      }
      
    } catch (err) {
      console.error('Error cargando:', err);
      showToast(`Error al cargar: ${err.message}`, 'error');
      // Si falla después de la comprobación 401, asumimos que la UI debe seguir visible
      setLoginState(true); 
    } finally {
      setLoading(false);
    }
  
    // ------------------------------------
    // --- INICIO DE EVENT LISTENERS ---
    // ------------------------------------
  
    // Listener para el botón de añadir géneros
    document.getElementById('add-genre-btn').addEventListener('click', (e) => { 
        e.stopPropagation(); 
        document.getElementById('all-genres').classList.toggle('hidden');
    });
  
    // Búsqueda de géneros
    document.getElementById('genre-search').addEventListener('input', (e) => {
      renderAllGenresList(e.target.value);
    });
    
    // Cerrar dropdown de géneros al hacer clic fuera
    document.addEventListener('click', (e) => {
        const genreDropdown = document.getElementById('all-genres');
        const addGenreBtn = document.getElementById('add-genre-btn');
        
        if (!genreDropdown.contains(e.target) && e.target !== addGenreBtn) {
            genreDropdown.classList.add('hidden');
        }
    });
    
    // LISTENERS DE PLAYLIST 🎧
    const playlistSelector = document.getElementById('destination-playlist');
    const createPlaylistBtn = document.getElementById('create-playlist-btn');
    const emptyPlaylistBtnCard = document.getElementById('empty-playlist-btn-card');
    const newPlaylistForm = document.getElementById('new-playlist-form');
    const confirmCreatePlaylistBtn = document.getElementById('confirm-create-playlist-btn');
    const cancelCreatePlaylistBtn = document.getElementById('cancel-create-playlist-btn');
    
    // 1. Guardar Playlist Seleccionada
    playlistSelector.addEventListener('change', async (e) => {
        const playlistId = e.target.value;
        if (playlistId) {
            config.playlistId = playlistId;
            await saveConfig();
            renderSelectedPlaylistDisplay(); 
            showToast('Playlist de destino guardada.', 'success');
        }
    });

    // 2. Mostrar/Ocultar formulario de creación
    createPlaylistBtn.addEventListener('click', () => {
        newPlaylistForm.classList.toggle('hidden');
    });
    
    cancelCreatePlaylistBtn.addEventListener('click', () => {
        newPlaylistForm.classList.add('hidden');
        document.getElementById('new-playlist-name').value = '';
    });
    
    confirmCreatePlaylistBtn.addEventListener('click', createNewPlaylist);

    // 3. Vaciar Playlist
    emptyPlaylistBtnCard.addEventListener('click', vaciarPlaylist);
    
    // Lógica de Artistas Favoritos (Búsqueda)
    let searchTimeout;
    document.getElementById('favorite-artist-search').addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => searchArtist(e.target.value), 500);
    });
    
    document.getElementById('favorite-artist-search').addEventListener('blur', () => {
        // Ocultar resultados de búsqueda después de un breve retraso
        setTimeout(() => {
            const results = document.getElementById('favorite-search-results');
            if (results) results.innerHTML = '';
        }, 200);
    });
    
    // Navegación de pestañas para cargar datos
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            
            // Actualizar navegación
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // Actualizar contenido
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
            });
            document.getElementById(tab).classList.add('active');
            
            // Cargar datos SOLO cuando se accede a la pestaña
            if (tab === 'history') {
                loadAndRenderHistory();
            } else if (tab === 'config') {
                updateFilteredArtists();
            }
        });
    });

    // Solo cargar recomendados cuando el usuario haga click
    document.getElementById('refresh-recommended-btn').addEventListener('click', loadAndRenderRecommendedArtists);

    // Botón principal de filtrar y añadir
    document.getElementById('run-filter-btn').addEventListener('click', filtrarYAnadir);
    // Botón de Logout
    document.getElementById('logout-btn').addEventListener('click', async () => {
        if (!confirm('¿Seguro que quieres cerrar sesión?')) return;

        try {
            setLoading(true, 'Cerrando sesión...');
            await fetch('/logout', { method: 'GET' });
            showToast('Sesión cerrada correctamente', 'success');
            setTimeout(() => window.location.reload(), 1000);
        } catch (err) {
            console.error('Error al cerrar sesión:', err);
            showToast('Error al cerrar sesión', 'error');
        } finally {
            setLoading(false);
        }
    });
});

// ----------------------------------------
// --- FUNCIONES DE RENDERIZADO ---
// ----------------------------------------

function renderSelectedGenres() {
    const cont = document.getElementById('selected-genres');
    cont.innerHTML = '';
    if (!config.generos || config.generos.length === 0) {
      cont.innerHTML = '<div class="empty-state"><div>No hay géneros seleccionados</div></div>';
      return;
    }
    
    config.generos.forEach(g => {
      const el = document.createElement('div');
      el.className = 'chip';
      
      const text = document.createElement('span');
      text.textContent = g;
      
      const removeBtn = document.createElement('button');
      removeBtn.textContent = '×';
      removeBtn.className = 'chip-remove';
      removeBtn.onclick = () => {
        config.generos = config.generos.filter(gen => gen !== g);
        saveConfigAndUpdateArtists();
        loadAndRenderRecommendedArtists();
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
    
    const filteredGenres = allGenres.filter(g => g.toLowerCase().includes(lowerFilter));

    if (filteredGenres.length === 0 && filter) {
        cont.innerHTML = `<div class="dropdown-item" style="color: var(--text-secondary);">No hay resultados.</div>`;
        return;
    }

    filteredGenres.forEach(g => {
        const el = document.createElement('div');
        el.className = 'dropdown-item';
        el.textContent = g;
        
        // Marcar como seleccionado si ya está en la configuración
        if (config.generos.includes(g)) {
          el.classList.add('selected');
        }
        
        el.onclick = () => {
          if (!config.generos.includes(g)) {
            // Añadir
            config.generos.push(g);
            el.classList.add('selected');
          } else {
            // Eliminar
            config.generos = config.generos.filter(gen => gen !== g);
            el.classList.remove('selected');
          }
          
          // Renderizar los chips de géneros seleccionados y guardar
          renderSelectedGenres(); 
          
          // Re-renderizar la lista de todos los géneros para actualizar su estado 'selected'
          renderAllGenresList(filter);
          
          // Guardar y actualizar las listas de artistas
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
       ul.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🎵</div><div>No se encontraron artistas para monitorizar</div><small style="color: var(--text-secondary);">Verifica géneros o artistas favoritos</small></div>';
       return;
    }
  
    artistsToShow.forEach(a => {
      const div = document.createElement('div');
      div.className = 'artist-item';
      
      const artistName = document.createElement('span');
      artistName.textContent = a.name + (a.isFavorite ? ' ⭐' : '');
  
      const removeBtn = document.createElement('button');
      removeBtn.textContent = 'Excluir';
      removeBtn.className = 'btn btn-danger';
      removeBtn.style.padding = '0.5rem 1rem';
      removeBtn.style.fontSize = '0.875rem';
  
      removeBtn.onclick = async () => {
        await excludeArtist(a, div);
      };
      
      div.appendChild(artistName);
      div.appendChild(removeBtn);
      ul.appendChild(div);
    });
}
  
function renderSelectedPlaylistDisplay() {
    // La función renderPlaylistResults y el selector ahora manejan la selección
    // Esta función se vuelve redundante con el nuevo HTML/Select,
    // pero la mantenemos para posibles usos futuros o debug.
    
    const selector = document.getElementById('destination-playlist');
    
    // Asegurar que el select refleje la configuración
    if (config.playlistId && selector.value !== config.playlistId) {
        selector.value = config.playlistId;
    }

    // Opcionalmente, mostrar info debajo del select
    const selected = allPlaylists.find(p => p.id === config.playlistId);
    
    let infoDiv = document.getElementById('selected-playlist-info');
    if (!infoDiv) {
        infoDiv = document.createElement('div');
        infoDiv.id = 'selected-playlist-info';
        infoDiv.style.marginTop = '0.5rem';
        infoDiv.style.color = 'var(--text-secondary)';
        document.querySelector('.card:nth-child(2)').appendChild(infoDiv);
    }

    if (selected) {
        infoDiv.innerHTML = `<small>Canciones: ${selected.tracks || 0}</small>`;
    } else {
        infoDiv.innerHTML = '';
    }
}

function renderPlaylistResults() {
      const selector = document.getElementById('destination-playlist');
      selector.innerHTML = '<option value="" disabled selected>-- Selecciona una Playlist --</option>';

      if (allPlaylists.length === 0) {
          selector.innerHTML += '<option value="" disabled>No se encontraron playlists...</option>';
          return;
      }
  
      allPlaylists.sort((a, b) => a.name.localeCompare(b.name));
      
      allPlaylists.forEach(p => {
          const option = document.createElement('option');
          option.value = p.id;
          option.textContent = p.name;
          selector.appendChild(option);
      });
      
      // Aseguramos que el select refleje la configuración después de renderizar
      if (config.playlistId) {
          selector.value = config.playlistId;
      }

      renderSelectedPlaylistDisplay();
}
  
// ----------------------------------------
// --- FUNCIONES DE ARTISTAS FAVORITOS Y RECOMENDADOS ---
// ----------------------------------------

async function searchArtist(query) {
    const resultsDiv = document.getElementById('favorite-search-results');
    resultsDiv.innerHTML = '';
    
    if (query.length < 3) return;

    resultsDiv.innerHTML = '<p style="margin: 10px 0; color: var(--text-secondary);">Buscando...</p>';

    try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        if (!res.ok) throw new Error('Error en la búsqueda de Spotify');
        const data = await res.json(); 

        resultsDiv.innerHTML = '';

        if (data.artists.length === 0) {
            resultsDiv.innerHTML = '<p style="margin: 10px 0; color: var(--text-secondary);">No se encontraron artistas.</p>';
            return;
        }

        data.artists.forEach(artist => {
            const button = document.createElement('button');
            button.className = 'btn btn-secondary';
            button.style.marginRight = '0.5rem';
            button.style.marginBottom = '0.5rem';
            button.textContent = `+ ${artist.name}`;
            button.disabled = config.favoriteArtists.some(a => a.id === artist.id);
            if (button.disabled) {
                button.textContent = `✓ ${artist.name}`;
                button.className = 'btn btn-primary';
                button.disabled = true;
            }
            
            button.onclick = () => addArtistToFavorites(artist.id, artist.name);
            resultsDiv.appendChild(button);
        });

    } catch (error) {
        resultsDiv.innerHTML = '<p style="margin: 10px 0; color: var(--danger);">Error al buscar.</p>';
        console.error(error);
    }
}

async function addArtistToFavorites(artistId, artistName) {
    try {
        const res = await fetch('/favorite-artists/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ artistId, artistName })
        });
        
        const data = await res.json();
        if (data.success) {
            showToast(data.message, 'success');
            await loadFavoriteArtists();
            await updateFilteredArtists();
            document.getElementById('favorite-search-results').innerHTML = ''; 
            document.getElementById('favorite-artist-search').value = '';
        } else {
            throw new Error(data.message || 'Error al añadir.');
        }

    } catch (error) {
        showToast(`Error al añadir: ${error.message}`, 'error');
        console.error(error);
    }
}

async function loadFavoriteArtists() {
    const list = document.getElementById('favorite-artist-list');
    list.innerHTML = '<div style="color: var(--text-secondary);">Cargando...</div>';
    list.className = 'favorite-list';
    
    try {
        const res = await fetch('/favorite-artists');
        if (!res.ok) throw new Error('No se pudo cargar la lista de favoritos');
        const artists = await res.json();
        
        config.favoriteArtists = artists; 

        list.innerHTML = '';
        if (artists.length === 0) {
            list.innerHTML = '<div class="empty-state"><small style="color: var(--text-secondary);">Aún no tienes artistas favoritos</small></div>';
            return;
        }

        artists.forEach(artist => {
            const chip = document.createElement('div');
            chip.className = 'favorite-chip';
            
            const img = document.createElement('img');
            img.src = artist.image || 'https://via.placeholder.com/24'; 
            img.alt = ''; 
            
            const name = document.createElement('span');
            name.textContent = artist.name; 
            
            const removeBtn = document.createElement('button');
            removeBtn.className = 'chip-remove favorite-chip-remove'; // Asegura ambas clases
            removeBtn.textContent = '×';
            
            removeBtn.onclick = async () => {
                chip.style.opacity = '0.5'; 
                await removeFavoriteArtist(artist.id, chip); 
            };
            
            chip.appendChild(img);
            chip.appendChild(name);
            chip.appendChild(removeBtn);
            list.appendChild(chip);
        });

    } catch (error) {
        list.innerHTML = '<div style="color: var(--danger);">Error al cargar la lista</div>';
        console.error(error);
    }
}

async function removeFavoriteArtist(artistId, chipElement) {
    try {
        const res = await fetch(`/favorite-artists/remove`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ artistId })
        });
        
        const data = await res.json();
        
        if (!res.ok) {
             throw new Error(data.message || `Error ${res.status} al comunicarse con el servidor.`);
        }

        if (data.success) {
            showToast(data.message || 'Artista eliminado', 'success');
            
            chipElement.remove();
            
            config.favoriteArtists = config.favoriteArtists.filter(a => a.id !== artistId);
            
            // Opcional: Refrescar la lista de recomendados si está visible
            // updateFilteredArtists(); 
            
        } else {
            throw new Error(data.message || 'La eliminación falló sin un error de red.');
        }

    } catch (error) {
        showToast(`Error al eliminar: ${error.message}`, 'error');
        console.error('Error en removeFavoriteArtist:', error);
        
        if (chipElement) {
            chipElement.style.opacity = '1';
        }
    }
}

async function loadAndRenderRecommendedArtists() {
    const cont = document.getElementById('recommended-artists-list');
    const refreshBtn = document.getElementById('refresh-recommended-btn');
    
    refreshBtn.disabled = true;
    refreshBtn.textContent = '⏳';
    
    cont.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 2rem; color: var(--text-secondary);">
            <div class="spinner" style="margin: 0 auto 1rem;"></div>
            <div>Analizando tus artistas...</div>
        </div>
    `;
    
    if (config.generos.length === 0) {
        cont.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🎵</div><div>Selecciona géneros para obtener recomendaciones</div></div>';
        refreshBtn.disabled = false;
        refreshBtn.textContent = '🔄 Recargar';
        return;
    }

    try {
        const res = await fetch('/api/recommended-artists');
        if (!res.ok) throw new Error('No se pudo cargar las recomendaciones');
        const data = await res.json();
        
        const currentFavoriteIds = config.favoriteArtists.map(a => a.id);
        const artists = data.artists.filter(a => !currentFavoriteIds.includes(a.id));

        renderRecommendedArtists(artists);

    } catch (error) {
        cont.innerHTML = '<div class="empty-state"><div style="color: var(--danger);">Error al cargar recomendaciones</div><small>Intenta de nuevo</small></div>';
        console.error('Error cargando recomendaciones:', error);
    } finally {
        refreshBtn.disabled = false;
        refreshBtn.textContent = '🔄 Recargar';
    }
}

function renderRecommendedArtists(artists) {
    const cont = document.getElementById('recommended-artists-list');
    cont.innerHTML = '';

    if (artists.length === 0) {
        cont.innerHTML = '<div class="empty-state" style="grid-column: 1 / -1;"><div class="empty-state-icon">✨</div><div>No hay nuevas sugerencias</div></div>';
        return;
    }

    artists.forEach(artist => {
        const card = document.createElement('div');
        card.className = 'artist-card';
        card.dataset.artistId = artist.id;
        
        const img = document.createElement('img');
        img.src = artist.image || 'https://via.placeholder.com/80';
        img.alt = artist.name;
        card.appendChild(img);
        
        const name = document.createElement('div');
        name.className = 'artist-card-name';
        name.textContent = artist.name;
        card.appendChild(name);
        
        const genres = document.createElement('div');
        genres.className = 'artist-card-genre';
        genres.textContent = artist.genres.slice(0, 2).join(', ') || 'Sin géneros';
        card.appendChild(genres);
        
        const addBtn = document.createElement('button');
        addBtn.className = 'btn btn-primary';
        addBtn.textContent = '+ Añadir';
        addBtn.onclick = async (e) => {
            e.stopPropagation();
            addBtn.disabled = true;
            addBtn.textContent = '✓ Añadido';
            card.classList.add('added');
            await addArtistToFavorites(artist.id, artist.name);
            
            setTimeout(() => {
                card.style.opacity = '0';
                card.style.transform = 'scale(0.8)';
                setTimeout(() => card.remove(), 300);
            }, 500);
        };
        card.appendChild(addBtn);

        cont.appendChild(card);
    });
}

// ----------------------------------------
// --- FUNCIONES DE HISTORIAL (MONITOR) ---
// ----------------------------------------

async function loadAndRenderHistory() {
    const list = document.getElementById('history-list');
    list.innerHTML = '<div class="empty-state">Cargando historial...</div>';
    
    try {
        const res = await fetch('/history');
        if (!res.ok) throw new Error('No se pudo cargar el historial');
        const history = await res.json();
        
        list.innerHTML = '';

        if (history.length === 0) {
            list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📊</div><div>No hay ejecuciones registradas</div></div>';
            return;
        }

        history.forEach(item => {
            const div = document.createElement('div');
            div.className = 'history-item';
            
            const date = new Date(item.timestamp).toLocaleString('es-ES', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            
            div.innerHTML = `
                <div class="history-header">
                    <span class="history-date">📅 ${date}</span>
                    <div class="history-stats">
                        <span class="stat-badge stat-success">${item.addedCount} añadidas</span>
                        ${item.errors && item.errors.length > 0 ? `<span class="stat-badge stat-error">${item.errors.length} errores</span>` : ''}
                    </div>
                </div>
                <div style="font-size: 0.875rem; color: var(--text-secondary); margin-top: 0.5rem;">
                    <strong>${item.playlistName}</strong> · ${item.genresUsed.join(', ')}
                </div>
                <div class="history-details">
                    ${item.errors && item.errors.length > 0 ? `
                        <p style="color: var(--danger); font-weight: 500; margin-bottom: 0.5rem;">⚠️ Errores de procesamiento:</p>
                        <ul style="list-style: none; padding-left: 0; font-size: 0.875rem; margin-bottom: 1rem;">
                            ${item.errors.map(e => `<li style="padding: 0.25rem 0;">• ${e.artistName}: ${e.message}</li>`).join('')}
                        </ul>
                    ` : ''}
                    ${item.newTracks.length > 0 ? `
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
                                    
                                    if (track.uri) {
                                        const spotifyId = track.uri.split(':').pop();
                                        linksHtml += `<a href="https://open.spotify.com/track/${spotifyId}" target="_blank" style="color: var(--accent);">Spotify</a>`; // FIX: URL de Spotify corregida
                                    }
                                    
                                    if (links.youtubeMusic) {
                                        linksHtml += `${linksHtml ? ' | ' : ''}<a href="${links.youtubeMusic}" target="_blank" style="color: var(--accent);">YouTube</a>`;
                                    }
                                    if (links.appleMusic) {
                                        linksHtml += `${linksHtml ? ' | ' : ''}<a href="${links.appleMusic}" target="_blank" style="color: var(--accent);">Apple</a>`;
                                    }
                                    if (links.beatport) {
                                        linksHtml += `${linksHtml ? ' | ' : ''}<a href="${links.beatport}" target="_blank" style="color: var(--accent);">Beatport</a>`;
                                    }

                                    return `
                                        <tr>
                                            <td>${track.title}</td>
                                            <td>${track.artist}</td>
                                            <td>${linksHtml || '-'}</td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    ` : ''}
                </div>
            `;
            
            div.addEventListener('click', (e) => {
                if (e.target.tagName === 'A' || e.target.closest('table')) return;
                
                const details = div.querySelector('.history-details');
                details.style.display = details.style.display === 'block' ? 'none' : 'block';
            });

            list.appendChild(div);
        });

    } catch (err) {
        console.error('Error cargando historial:', err);
        showToast(`Error al cargar historial: ${err.message}`, 'error');
        list.innerHTML = '<div class="empty-state" style="color: var(--danger);">Error al cargar el historial</div>';
    }
}
  
// ----------------------------------------
// --- FUNCIONES DE LÓGICA Y DATOS ---
// ----------------------------------------

async function loadPlaylists() {
    // No mostrar loading si ya están cargadas
    if (allPlaylists.length > 0) {
        renderPlaylistResults(); 
        return;
    }
    
    setLoading(true, 'Cargando playlists...');
    try {
        const playlistsRes = await fetch('/playlists');
        if (!playlistsRes.ok) throw new Error('No se pudo cargar playlists');
        allPlaylists = await playlistsRes.json();
        renderPlaylistResults(); 
    } catch (err) {
        console.error('Error recargando playlists:', err);
        showToast('Error al recargar playlists', 'error');
    } finally {
        setLoading(false);
    }
}

async function createNewPlaylist() {
    const nameInput = document.getElementById('new-playlist-name');
    const name = nameInput.value.trim();

    if (!name) {
        showToast('Debes ingresar un nombre para la playlist.', 'warning');
        return;
    }

    const confirmBtn = document.getElementById('confirm-create-playlist-btn');
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Creando...';
    
    setLoading(true, 'Creando nueva playlist...');

    try {
        const res = await fetch('/create-playlist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        const data = await res.json();

        if (!res.ok || !data.success) throw new Error(data.message || 'Fallo al crear playlist.');

        showToast(data.message, 'success');
        
        // Recargar la lista de playlists para incluir la nueva
        await loadPlaylists(); 
        
        // Seleccionar la nueva playlist
        config.playlistId = data.playlist.id;
        await saveConfig(); 
        
        document.getElementById('new-playlist-form').classList.add('hidden');
        document.getElementById('new-playlist-name').value = '';

    } catch (error) {
        showToast(`Error: ${error.message}`, 'error');
    } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Crear y Usar';
        setLoading(false);
    }
}

async function saveConfig() {
    try {
      const res = await fetch('/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            generos: config.generos,
            excludedArtists: config.excludedArtists,
            playlistId: config.playlistId,
            favoriteArtists: config.favoriteArtists 
        })
      });
      if (!res.ok) throw new Error('No se pudo guardar la config');
    } catch (err) {
      console.error('Error guardando config:', err);
      showToast('Error al guardar configuración', 'error');
    }
}

async function updateFilteredArtists() {
    // Si no hay géneros ni favoritos, no hacer nada
    if (config.generos.length === 0 && config.favoriteArtists.length === 0) {
        filteredArtists = [];
        renderArtistList();
        return;
    }

    setLoading(true, 'Actualizando lista de artistas...');

    try {
      const artistasRes = await fetch('/artistas-filtrados', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            generos: config.generos || [], 
            favoriteArtists: config.favoriteArtists || [] 
        }) // FIX: Asegurar que se envíen los favoritos también
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
  
// Añadir en la sección de UTILIDADES o PERSISTENCIA
async function saveConfigAndUpdateArtists() {
    await saveConfig();
    
    // Solo recarga los recomendados si se añadió un género
    if (config.generos && config.generos.length > 0) {
        // Carga forzada para asegurar que se actualicen las sugerencias
        loadAndRenderRecommendedArtists(true); 
    }
    
    // Opcional: Actualizar la lista filtrada si el usuario está en la pestaña de configuración
    if (document.getElementById('config').classList.contains('active')) {
         updateFilteredArtists();
    }
}
  
async function excludeArtist(artist, listItem) {
    if (!config.playlistId) {
      showToast('Error: No hay una playlist seleccionada', 'error');
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
      
      if (!config.excludedArtists.includes(artist.id)) {
        config.excludedArtists.push(artist.id);
        await saveConfig(); // Guardar exclusión
      }
      
      listItem.style.transition = 'all 0.3s';
      listItem.style.transform = 'translateX(-100%)';
      setTimeout(() => listItem.remove(), 300);
  
    } catch (err) {
      console.error('Error al excluir artista:', err);
      showToast(`Error: ${err.message}`, 'error');
      listItem.style.opacity = '1';
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Excluir';
      }
    }
}

function showProgress() {
  const btn = document.getElementById('run-filter-btn');
  const progressContainer = document.getElementById('progress-container');
  const progressBar = document.getElementById('progress-bar');
  const progressText = document.getElementById('progress-text');

  btn.classList.add('hidden');
  progressContainer.classList.remove('hidden');

  // Muestra al menos un inicio visible
  progressBar.style.width = '10%';
  progressText.textContent = 'Preparando...';
}

function updateProgress(percent, text) {
  const bar = document.getElementById('progress-bar');
  const label = document.getElementById('progress-text');
  
  bar.style.width = `${Math.max(1, percent)}%`;
  if (text) label.textContent = text;
}

function hideProgress() {
  const btn = document.getElementById('run-filter-btn');
  const progressContainer = document.getElementById('progress-container');
  const bar = document.getElementById('progress-bar');
  const label = document.getElementById('progress-text');

  btn.classList.remove('hidden');
  progressContainer.classList.add('hidden');
  bar.style.width = '0%';
  label.textContent = '';
}
  
// ----------------------------------------
// --- ACCIONES DE BOTONES PRINCIPALES ---
// ----------------------------------------

async function filtrarYAnadir() {
  try {
    // --- Mostrar barra de progreso ---
    showProgress();
    updateProgress(5, 'Preparando filtros...');
    await new Promise(r => setTimeout(r, 150)); // pequeño delay visual

    // --- Validaciones previas ---
    if (!config.playlistId) {
      showToast('Debes seleccionar una playlist de destino primero', 'error');
      hideProgress();
      return;
    }

    if ((!config.generos || config.generos.length === 0) && config.favoriteArtists.length === 0) {
      showToast('Debes seleccionar al menos un género o añadir artistas favoritos', 'warning');
      hideProgress();
      return;
    }

    updateProgress(15, 'Enviando datos al servidor...');
    await new Promise(r => setTimeout(r, 100));

    // --- Llamada al backend ---
    const res = await fetch('/filtrar-y-anadir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        generos: config.generos,
        playlistId: config.playlistId,
        excludedArtists: config.excludedArtists || []
      })
    });

    updateProgress(40, 'Procesando respuesta...');
    await new Promise(r => setTimeout(r, 100));

    // --- Manejo de errores ---
    if (res.status === 401) {
      const errData = await res.json();
      throw new Error(errData.error);
    }
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Error en el servidor');
    }

    // --- Datos correctos ---
    const data = await res.json();
    updateProgress(70, 'Actualizando interfaz...');
    await new Promise(r => setTimeout(r, 200));

    if (data.errors && data.errors.length > 0) {
      const uniqueArtists = Array.from(new Set(data.errors.map(e => e.artistName)))
        .slice(0, 3)
        .join(', ');
      showToast(
        `${data.message}<br><small>Algunos artistas fallaron: ${uniqueArtists}...</small>`,
        data.addedCount > 0 ? 'warning' : 'error'
      );
    } else {
      showToast(data.message, 'success');
    }

    updateProgress(85, 'Refrescando historial...');
    await loadAndRenderHistory();

    updateProgress(95, 'Actualizando playlists...');
    await loadPlaylists();

    updateProgress(100, 'Completado ✅');
    await new Promise(r => setTimeout(r, 600)); // deja ver el 100 % por un momento

  } catch (err) {
    console.error('Error al filtrar:', err);
    updateProgress(100, 'Error durante el proceso');
    showToast(`Error al filtrar: ${err.message}`, 'error');
  } finally {
    // --- Ocultar barra ---
    setTimeout(() => {
      hideProgress();
      setLoading(false);
    }, 800);
  }
}
  
async function vaciarPlaylist() {
  // --- Validación inicial ---
  if (!config.playlistId) {
    showToast('Debes seleccionar una playlist para vaciar', 'error');
    return;
  }

  const selectedPlaylist = allPlaylists.find(p => p.id === config.playlistId);
  const playlistName = selectedPlaylist ? selectedPlaylist.name : 'la playlist seleccionada';

  if (!confirm(`¿Estás seguro de que quieres eliminar TODAS las canciones de "${playlistName}"?`)) {
    return;
  }

  // --- Mostrar barra de progreso y loading overlay ---
  showProgress();
  updateProgress(5, 'Preparando limpieza...');
  setLoading(true, 'Vaciando playlist...');

  try {
    updateProgress(15, 'Conectando con el servidor...');

    const res = await fetch('/vaciar-playlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlistId: config.playlistId })
    });

    updateProgress(50, 'Eliminando canciones...');

    if (res.status === 401) {
      const errData = await res.json();
      throw new Error(errData.error);
    }

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Error en el servidor');
    }

    const data = await res.json();
    updateProgress(85, 'Actualizando playlists...');

    showToast(data.message, 'success');
    await loadPlaylists();

    updateProgress(100, 'Completado ✅');
  } catch (err) {
    console.error('Error vaciando:', err);
    updateProgress(100, 'Error durante el proceso');
    showToast(`Error al vaciar: ${err.message}`, 'error');
  } finally {
    setLoading(false);
    // Oculta la barra tras breve retardo
    setTimeout(hideProgress, 1500);
  }
}
