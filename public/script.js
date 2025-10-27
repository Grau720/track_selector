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
    setLoading(true, 'Cargando configuración...');
  
    try {
      // 1. Solo cargar configuración básica
      const cfgRes = await fetch('/config');
      if (!cfgRes.ok) {
          if (cfgRes.status === 401) {
              window.location.href = '/login';
              return;
          }
          throw new Error('No se pudo cargar la configuración');
      }
      
      const loadedConfig = await cfgRes.json();
      config = { ...config, ...loadedConfig }; 

      if (!config.generos) config.generos = [];
      if (!config.excludedArtists) config.excludedArtists = [];
      if (!config.favoriteArtists) config.favoriteArtists = [];
      
      // 2. Obtener usuario
      userId = getCookie('spotify_user_id') || 'No disponible';
      document.getElementById('spotify-user-id').textContent = userId;
      
      // 3. Cargar géneros (ligero)
      const genresRes = await fetch('/generos');
      if (!genresRes.ok) throw new Error('No se pudo cargar géneros');
      allGenres = await genresRes.json();
      
      // 4. Solo renderizar lo que ya tenemos guardado
      renderSelectedGenres();
      renderAllGenresList();
      
      // 5. Cargar playlists en segundo plano (no bloqueante)
      loadPlaylists().catch(err => console.error('Error cargando playlists:', err));
      
      // 6. Cargar favoritos (ligero) también en segundo plano
      loadFavoriteArtists().catch(err => console.error('Error cargando favoritos:', err));
      
      // 7. NO cargar recomendados ni artistas filtrados automáticamente
      // El usuario debe hacer click en las pestañas o botón refrescar
      
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
    
    let searchTimeout;
    document.getElementById('favorite-artist-search').addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => searchArtist(e.target.value), 500);
    });
    
    // NUEVO: Solo cargar recomendados cuando el usuario haga click
    document.getElementById('refresh-recommended-btn').addEventListener('click', loadAndRenderRecommendedArtists);

    document.getElementById('run-filter-btn').addEventListener('click', filtrarYAnadir);
    document.getElementById('empty-playlist-btn').addEventListener('click', vaciarPlaylist);
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
    
    allGenres
      .filter(g => g.toLowerCase().includes(lowerFilter))
      .forEach(g => {
        const el = document.createElement('div');
        el.className = 'dropdown-item';
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
          loadAndRenderRecommendedArtists();
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
      const display = document.getElementById('selected-playlist-display');
      const selected = allPlaylists.find(p => p.id === config.playlistId);
  
      display.innerHTML = '';
  
      if (selected) {
          display.classList.remove('hidden');
          display.className = 'playlist-display';
          
          if (selected.image) {
              const img = document.createElement('img');
              img.src = selected.image;
              display.appendChild(img);
          }
          const info = document.createElement('div');
          info.innerHTML = `<strong>${selected.name}</strong><br><small style="color: var(--text-secondary);">${selected.tracks} canciones</small>`;
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
          resultsCont.classList.remove('hidden');
      } else {
          playlistsToShow = allPlaylists.slice(0, 5);
          resultsCont.classList.remove('hidden');
      }
      
      if (playlistsToShow.length === 0) {
          resultsCont.innerHTML = '<div class="empty-state">No se encontraron playlists</div>';
          return;
      }
  
      playlistsToShow.forEach(p => {
          const div = document.createElement('div');
          div.className = 'dropdown-item';
          div.style.display = 'flex';
          div.style.alignItems = 'center';
          div.style.gap = '0.75rem';
          
          if (p.id === config.playlistId) {
              div.classList.add('selected');
          }
  
          if (p.image) {
              const img = document.createElement('img');
              img.src = p.image;
              img.style.width = '40px';
              img.style.height = '40px';
              img.style.borderRadius = '4px';
              img.style.objectFit = 'cover';
              div.appendChild(img);
          }
  
          const name = document.createElement('span');
          name.innerHTML = `${p.name}<br><small style="color: var(--text-secondary);">${p.tracks} canciones</small>`;
          div.appendChild(name);
          
          div.onclick = () => {
              config.playlistId = p.id;
              saveConfig();
              renderPlaylistResults(filter); 
              renderSelectedPlaylistDisplay(); 
              showToast(`Playlist "${p.name}" seleccionada`, 'success');
          };
  
          resultsCont.appendChild(div);
      });
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
            img.alt = artist.name;
            
            const name = document.createElement('span');
            name.textContent = artist.name;
            
            const removeBtn = document.createElement('button');
            removeBtn.className = 'favorite-chip-remove';
            removeBtn.textContent = '×';
            removeBtn.onclick = async () => {
                chip.remove();
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
        refreshBtn.textContent = '🔄';
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
        refreshBtn.textContent = '🔄';
    }
}

function renderRecommendedArtists(artists) {
    const cont = document.getElementById('recommended-artists-list');
    cont.innerHTML = '';

    if (artists.length === 0) {
        cont.innerHTML = '<div class="empty-state"><div class="empty-state-icon">✨</div><div>No hay nuevas sugerencias</div></div>';
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
                                        linksHtml += `<a href="https://open.spotify.com/track/${spotifyId}" target="_blank" style="color: var(--accent);">Spotify</a>`;
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
        renderSelectedPlaylistDisplay(); 
        renderPlaylistResults();
        return;
    }
    
    setLoading(true, 'Cargando playlists...');
    try {
        const playlistsRes = await fetch('/playlists');
        if (!playlistsRes.ok) throw new Error('No se pudo cargar playlists');
        allPlaylists = await playlistsRes.json();
        renderSelectedPlaylistDisplay(); 
        renderPlaylistResults(); 
    } catch (err) {
        console.error('Error recargando playlists:', err);
        showToast('Error al recargar playlists', 'error');
    } finally {
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
    
    // Solo actualizar artistas si estamos en la pestaña de Configuración
    const configTab = document.getElementById('config');
    if (configTab.classList.contains('active')) {
        await updateFilteredArtists();
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
  
// ----------------------------------------
// --- ACCIONES DE BOTONES PRINCIPALES ---
// ----------------------------------------

async function filtrarYAnadir() {
    if (!config.playlistId) {
      showToast('Debes seleccionar una playlist de destino primero', 'error');
      return;
    }
    if ((!config.generos || config.generos.length === 0) && config.favoriteArtists.length === 0) {
      showToast('Debes seleccionar al menos un género o añadir artistas favoritos', 'warning');
      return;
    }
  
    setLoading(true, 'Filtrando y añadiendo canciones...');
  
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
      
      if (data.errors && data.errors.length > 0) {
        const uniqueArtists = Array.from(new Set(data.errors.map(e => e.artistName))).slice(0, 3).join(', ');
        showToast(`${data.message}<br><small>Algunos artistas fallaron: ${uniqueArtists}...</small>`, data.addedCount > 0 ? 'warning' : 'error');
      } else {
        showToast(data.message, 'success');
      }
      
      await loadAndRenderHistory(); 
      await loadPlaylists(); 
  
    } catch (err) {
      console.error('Error al filtrar:', err);
      showToast(`Error al filtrar: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
}
  
async function vaciarPlaylist() {
    if (!config.playlistId) {
      showToast('Debes seleccionar una playlist para vaciar', 'error');
      return;
    }
    
    const selectedPlaylist = allPlaylists.find(p => p.id === config.playlistId);
    const playlistName = selectedPlaylist ? selectedPlaylist.name : 'la playlist seleccionada';
    
    if (!confirm(`¿Estás seguro de que quieres eliminar TODAS las canciones de "${playlistName}"?`)) {
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
      await loadPlaylists(); 
    } catch (err) {
      console.error('Error vaciando:', err);
      showToast(`Error al vaciar: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
}