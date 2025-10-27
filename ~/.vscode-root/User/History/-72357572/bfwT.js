const express = require('express');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const SpotifyWebApi = require('spotify-web-api-node');
const path = require('path');

const app = express();
app.use(cookieParser());
app.use(express.json());
app.use(express.static('public')); 

let currentAccessToken = null;
let currentUserId = null;
let currentRefreshToken = null;

const CONFIG_PATH = path.join(__dirname, 'configs.json');
const HISTORY_PATH = path.join(__dirname, 'history.json');

// ----------------------------------------
// --- Funciones de Configuración y Historial ---
// ----------------------------------------
function loadConfigs() {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH));
  } catch (e) {
    console.error("Error leyendo configs.json, creando uno nuevo.", e);
    return {};
  }
}

function saveConfig(userId, config) {
  const configs = loadConfigs();
  configs[userId] = config;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(configs, null, 2));
}

function getUserConfig(userId) {
  const config = loadConfigs()[userId] || null;
  if (config && !config.excludedArtists) {
    config.excludedArtists = [];
  }
  if (config && !config.generos) {
    config.generos = [];
  }
  // 🛑 ACTUALIZADO: Inicializar favoriteArtists
  if (config && !config.favoriteArtists) {
    config.favoriteArtists = [];
  }
  return config;
}

function loadHistory() {
    if (!fs.existsSync(HISTORY_PATH)) return [];
    try {
        return JSON.parse(fs.readFileSync(HISTORY_PATH));
    } catch (e) {
        console.error("Error leyendo history.json.", e);
        return [];
    }
}

function saveHistory(entry) {
    const history = loadHistory();
    history.unshift(entry); 
    if (history.length > 50) {
        history.splice(50);
    }
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
}

// ----------------------------------------
// --- Configuración de Spotify API ---
// ----------------------------------------

// 🛑 ¡IMPORTANTE!: REVISA Y ACTUALIZA ESTAS VARIABLES CON TUS CREDENCIALES REALES
const clientId = process.env.SPOTIFY_CLIENT_ID || '61f8b91c159a4e1590d083bf95049363';
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET || 'd2127c9e434042d0a2deaadd82d65056';
const redirectUri = process.env.REDIRECT_URI || 'http://localhost:8888/callback';

const scopes = [
  'playlist-modify-public',
  'playlist-modify-private',
  'user-follow-read'
];

const spotifyApi = new SpotifyWebApi({ 
    clientId: clientId, 
    clientSecret: clientSecret, 
    redirectUri: redirectUri 
});

// ----------------------------------------
// --- Lógica de Refresco de Token y Wrapper ---
// ----------------------------------------

async function refreshAccessToken(req, res) {
    const refreshToken = req.cookies?.spotify_refresh_token || currentRefreshToken;
    
    if (!refreshToken) {
        console.error('❌ No hay Refresh Token disponible.');
        return false;
    }

    spotifyApi.setClientId(clientId);
    spotifyApi.setClientSecret(clientSecret);
    spotifyApi.setRefreshToken(refreshToken);
    
    try {
        const data = await spotifyApi.refreshAccessToken();
        currentAccessToken = data.body['access_token'];
        spotifyApi.setAccessToken(currentAccessToken);
        
        res.cookie('spotify_access_token', currentAccessToken, { maxAge: 3600000 });
        
        if (data.body['refresh_token']) {
            currentRefreshToken = data.body['refresh_token'];
            res.cookie('spotify_refresh_token', currentRefreshToken, { maxAge: 30 * 24 * 3600000 });
            spotifyApi.setRefreshToken(currentRefreshToken);
        }
        
        console.log('✅ Token de acceso refrescado correctamente.');
        return true;
    } catch (err) {
        console.error('❌ Error al refrescar el token (fallo final):', err.message);
        return false;
    }
}

async function apiWrapper(req, res, apiCall) {
    const token = req.cookies?.spotify_access_token || currentAccessToken;
    const refreshToken = req.cookies?.spotify_refresh_token || currentRefreshToken;

    if (!token) return res.status(401).json({ error: 'No token. Por favor, vuelve a iniciar sesión.' });

    spotifyApi.setAccessToken(token);
    if (refreshToken) spotifyApi.setRefreshToken(refreshToken);

    try {
        await apiCall();
    } catch (err) {
        if (err.statusCode === 401 && refreshToken) {
            console.log('Token expirado, intentando refrescar...');
            const success = await refreshAccessToken(req, res);
            if (success) {
                try {
                    await apiCall();
                } catch (retryErr) {
                    console.error('❌ Error en el reintento:', retryErr);
                    res.status(retryErr.statusCode || 500).json({ error: retryErr.message || 'Error en la API de Spotify (reintento fallido)' });
                }
            } else {
                res.status(401).json({ error: 'Token de sesión expirado. Por favor, vuelve a iniciar sesión.' });
            }
        } else {
            console.error('❌ Error general:', err);
            res.status(err.statusCode || 500).json({ error: err.message || 'Error en la API de Spotify' });
        }
    }
}

// ----------------------------------------
// --- Endpoints Públicos (Login y Servidor) ---
// ----------------------------------------
app.get('/', (req, res) => {
  const token = req.cookies?.spotify_access_token;
  if (!token) return res.redirect('/login');
  
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
  const state = Math.random().toString(36).substring(2, 15);
  res.cookie('spotify_auth_state', state);
  const authorizeURL = spotifyApi.createAuthorizeURL(scopes, state);
  res.redirect(authorizeURL);
});

app.get('/callback', async (req, res) => {
  const code = req.query.code;
  const state = req.query.state;
  const storedState = req.cookies?.spotify_auth_state;
  if (!state || state !== storedState) return res.status(403).send('Estado inválido');
  res.clearCookie('spotify_auth_state');

  try {
    const data = await spotifyApi.authorizationCodeGrant(code);
    const accessToken = data.body['access_token'];
    const refreshToken = data.body['refresh_token'];
    
    spotifyApi.setAccessToken(accessToken);
    spotifyApi.setRefreshToken(refreshToken);
    
    currentAccessToken = accessToken;
    currentRefreshToken = refreshToken;

    const me = await spotifyApi.getMe();
    currentUserId = me.body.id;
    
    res.cookie('spotify_access_token', accessToken, { maxAge: 3600000 });
    res.cookie('spotify_refresh_token', refreshToken, { maxAge: 30 * 24 * 3600000 });
    res.cookie('spotify_user_id', currentUserId, { maxAge: 30 * 24 * 3600000 });
    
    console.log('Conectado como:', me.body.display_name);
    res.redirect('/');
  } catch (err) {
    console.error('Error en callback:', err);
    res.status(500).send('Error autenticando con Spotify');
  }
});

// ----------------------------------------
// --- Endpoints de Configuración y Datos ---
// ----------------------------------------
app.get('/config', (req, res) => {
    const userId = req.cookies?.spotify_user_id || currentUserId;
    if (!userId) return res.status(401).json({ error: 'No user' });
    currentUserId = userId;
    const config = getUserConfig(userId);
    // Devolvemos favoriteArtists para que el cliente sepa qué artistas favoritos tiene.
    res.json(config || { generos: [], excludedArtists: [], playlistId: null, favoriteArtists: [] });
});

app.post('/config', (req, res) => {
    const userId = req.cookies?.spotify_user_id || currentUserId;
    if (!userId) return res.status(401).json({ error: 'No user' });
    currentUserId = userId;
    const config = req.body;
    
    const oldConfig = getUserConfig(userId) || {};
    const newConfig = { ...oldConfig, ...config };
    if (!newConfig.generos) newConfig.generos = [];
    if (!newConfig.excludedArtists) newConfig.excludedArtists = [];
    if (!newConfig.favoriteArtists) newConfig.favoriteArtists = []; // Asegurar inicialización

    saveConfig(userId, newConfig);
    res.json({ success: true, message: '✅ Configuración guardada' });
});

app.get('/history', (req, res) => {
    const history = loadHistory();
    res.json(history);
});

// ----------------------------------------
// --- Endpoints de Artistas Favoritos (NUEVOS) ---
// ----------------------------------------
// NOTA: Se ha añadido un endpoint para OBTENER la lista de favoritos de la configuración
app.get('/favorite-artists', (req, res) => {
    const userId = req.cookies?.spotify_user_id || currentUserId;
    if (!userId) return res.status(401).json({ error: 'No user' });
    const config = getUserConfig(userId);
    res.json(config.favoriteArtists || []);
});

// NUEVO ENDPOINT para añadir a la lista de favoritos internos
app.post('/favorite-artists/add', (req, res) => {
    const userId = req.cookies?.spotify_user_id || currentUserId;
    const { artistId, artistName } = req.body;
    if (!userId || !artistId || !artistName) return res.status(400).json({ error: 'Faltan datos' });
    
    currentUserId = userId;
    const config = getUserConfig(userId);
    
    if (!config.favoriteArtists) config.favoriteArtists = [];
    
    if (!config.favoriteArtists.some(a => a.id === artistId)) {
        config.favoriteArtists.push({ id: artistId, name: artistName });
        saveConfig(userId, config);
        return res.json({ success: true, message: `✅ Artista ${artistName} añadido a Favoritos` });
    }
    
    res.json({ success: true, message: 'Artista ya estaba en la lista.' });
});

// ----------------------------------------
// --- Endpoint de Búsqueda de Spotify (NUEVO) ---
// ----------------------------------------
app.get('/api/search', (req, res) => apiWrapper(req, res, async () => {
    const { q } = req.query;
    if (!q) throw { statusCode: 400, message: 'Falta el parámetro de búsqueda (q)' };

    // Buscamos solo artistas y obtenemos los 5 primeros
    const data = await spotifyApi.searchArtists(q, { limit: 5 });
    
    const simpleArtists = data.body.artists.items.map(a => ({
        id: a.id,
        name: a.name
    }));

    res.json({ artists: simpleArtists });
}));


// ----------------------------------------
// --- Funciones de Utilidad ---
// ----------------------------------------

function delay(ms) {
  return new Promise(res => setTimeout(res, ms));
}

// 🛑 ACTUALIZADO: Función para generar enlaces externos (incluye Beatport)
function findExternalLinks(title, artist, isrc) {
    const query = encodeURIComponent(`${title} ${artist}`);
    
    return {
        youtubeMusic: `https://music.youtube.com/search?q=${query}`,
        appleMusic: `https://music.apple.com/us/search?term=${query}`,
        beatport: `https://www.beatport.com/search?q=${query}`
    };
}


// ----------------------------------------
// --- Endpoints de la API de Spotify ---
// ----------------------------------------

app.get('/playlists', (req, res) => apiWrapper(req, res, async () => {
    let playlists = [];
    let offset = 0;
    while (true) {
        const data = await spotifyApi.getUserPlaylists(currentUserId, { limit: 50, offset });
        const items = data.body.items.map(p => ({
            id: p.id,
            name: p.name,
            tracks: p.tracks.total,
            image: p.images.length > 0 ? p.images[0].url : null,
            owner: p.owner.display_name
        }));
        playlists = playlists.concat(items);
        if (!data.body.next) break;
        offset += 50;
    }
    res.json(playlists);
}));

app.get('/generos', (req, res) => apiWrapper(req, res, async () => {
    const data = await spotifyApi.getRecommendationsGenres();
    res.json(data.body.genres);
}));

app.post('/vaciar-playlist', (req, res) => apiWrapper(req, res, async () => {
    const { playlistId } = req.body;
    if (!playlistId) throw { statusCode: 400, message: 'Falta playlistId' };

    let tracksToRemove = [];
    let offset = 0;
    // 1. Obtener todas las canciones de la playlist
    while (true) {
        const data = await spotifyApi.getPlaylistTracks(playlistId, { offset, limit: 100 });
        data.body.items.forEach(item => {
            if (item.track && item.track.uri) {
                tracksToRemove.push({ uri: item.track.uri });
            }
        });
        if (!data.body.next) break;
        offset += 100;
    }

    if (tracksToRemove.length === 0) {
        return res.json({ success: true, message: 'La playlist ya estaba vacía.' });
    }

    const batchSize = 100;
    for (let i = 0; i < tracksToRemove.length; i += batchSize) {
        const batch = tracksToRemove.slice(i, i + batchSize);
        await spotifyApi.removeTracksFromPlaylist(playlistId, batch);
        await delay(100); 
    }

    res.json({ success: true, message: `✅ Eliminadas ${tracksToRemove.length} canciones.` });
}));

// ----------------------------------------
// --- Endpoint PRINCIPAL: /filtrar-y-anadir (ACTUALIZADO) ---
// ----------------------------------------

app.post('/filtrar-y-anadir', (req, res) => apiWrapper(req, res, async () => {
    const { generos, playlistId, excludedArtists = [] } = req.body;
    if (!generos || !playlistId) throw { statusCode: 400, message: 'Faltan datos' };

    const addedTracksDetails = [];
    let existingTracksCount = 0;
    
    // 1. Obtener artistas seguidos y favoritos que coincidan con los géneros
    const artistIds = new Set(); 
    const userConfig = getUserConfig(req.cookies?.spotify_user_id || currentUserId);
    
    // A. Artistas que SIGUES en Spotify
    let after = null;
    while (true) {
      const opts = { limit: 50 };
      if (after) opts.after = after;
      const data = await spotifyApi.getFollowedArtists(opts);
      const artists = data.body.artists.items;
      artists.forEach(a => {
        if (a.genres.some(g => generos.includes(g)) && !excludedArtists.includes(a.id)) {
          artistIds.add(a.id);
        }
      });
      if (!data.body.artists.next) break;
      after = artists[artists.length - 1].id;
    }
    
    // B. Artistas Favoritos (Lista interna de la app)
    if (userConfig.favoriteArtists) {
        userConfig.favoriteArtists.forEach(a => {
            // Añadimos a la lista si no está excluido. (Se asume que los favoritos ya están 'filtrados' por el usuario)
            if (!excludedArtists.includes(a.id)) {
               artistIds.add(a.id);
            }
        });
    }

    const uniqueArtistIds = Array.from(artistIds);

    
    // 2. Obtener canciones actuales de la playlist para evitar duplicados
    const existingTracks = new Set();
    let offset = 0;
    while (true) {
      const data = await spotifyApi.getPlaylistTracks(playlistId, { offset, limit: 100 });
      data.body.items.forEach(item => {
        if (item.track && item.track.uri) {
          existingTracks.add(item.track.uri);
        }
      });
      if (!data.body.next) break;
      offset += 100;
    }
    existingTracksCount = existingTracks.size;
    
    const trackUris = new Set();
    const thisWeek = Date.now() - 7 * 24 * 3600 * 1000;
    
    // 3. Buscar lanzamientos recientes de los artistas seleccionados
    for (const id of uniqueArtistIds) { 
      try {
        const releases = await spotifyApi.getArtistAlbums(id, { limit: 5, include_groups: 'single,album' });
        for (const album of releases.body.items) {
          const date = new Date(album.release_date);
          if (date.getTime() >= thisWeek) {
            
            const tracks = await spotifyApi.getAlbumTracks(album.id);
            
            for (const t of tracks.body.items) {
              if (t.uri && !existingTracks.has(t.uri)) {
                
                // 🛑 OBTENER DETALLES COMPLETOS Y ENLACES EXTERNOS (NUEVO)
                const fullTrack = await spotifyApi.getTrack(t.id); 
                const isrc = fullTrack.body.external_ids?.isrc || null;
                const trackArtists = t.artists.map(a => a.name).join(', ');
                
                const externalLinks = findExternalLinks(t.name, trackArtists, isrc);

                trackUris.add(t.uri);
                addedTracksDetails.push({
                    title: t.name,
                    artist: trackArtists,
                    platform: 'Spotify (Nuevo Lanzamiento)',
                    uri: t.uri,
                    externalLinks: externalLinks 
                });
              }
            }
          }
        }
      } catch (e) {
        console.warn(`Error procesando artista ${id}: ${e.message}`);
      }
      await delay(200); 
    }
    
    // 4. Añadir canciones a la playlist de Spotify
    const batchSize = 100;
    const uris = Array.from(trackUris);
    let addedCount = 0;
    
    for (let i = 0; i < uris.length; i += batchSize) {
      const batch = uris.slice(i, i + batchSize);
      try {
        await spotifyApi.addTracksToPlaylist(playlistId, batch);
        addedCount += batch.length;
      } catch (e) {
        if (e.statusCode === 429) {
          const retryAfter = parseInt(e.headers['retry-after'] || '1', 10);
          console.warn(`⏳ Rate limit. Esperando ${retryAfter}s`);
          await delay(retryAfter * 1000);
          i -= batchSize; 
        } else {
          console.error('❌ Error añadiendo:', e);
        }
      }
    }

    const playlistInfo = (await spotifyApi.getPlaylist(playlistId)).body;
    saveHistory({
        timestamp: new Date().toISOString(),
        addedCount: addedCount,
        playlistName: playlistInfo.name,
        playlistId: playlistId,
        genresUsed: generos,
        newTracks: addedTracksDetails
    });
    
    res.json({ 
      success: true, 
      message: `✅ Añadidas ${addedCount} canciones nuevas (${existingTracksCount} ya existían).` 
    });
}));


// ----------------------------------------
// --- Resto de Endpoints (Se mantienen) ---
// ----------------------------------------

app.post('/artistas-filtrados', (req, res) => apiWrapper(req, res, async () => {
    const { generos } = req.body;
    if (!generos) throw { statusCode: 400, message: 'Faltan generos' };

    const uniqueArtistIds = new Set();
    const allArtists = [];
    let after = null;
    
    // Incluir Artistas Seguidos
    while (true) {
        const opts = { limit: 50 };
        if (after) opts.after = after;
        const data = await spotifyApi.getFollowedArtists(opts);
        const artists = data.body.artists.items;
        
        artists.forEach(a => {
            if (a.genres.some(g => generos.includes(g)) && !uniqueArtistIds.has(a.id)) {
                uniqueArtistIds.add(a.id);
                allArtists.push({ id: a.id, name: a.name });
            }
        });
        
        if (!data.body.artists.next) break;
        after = artists[artists.length - 1].id;
    }

    // Incluir Artistas Favoritos (aunque no se filtran por género, se añaden a la lista para verlos)
    const userConfig = getUserConfig(req.cookies?.spotify_user_id || currentUserId);
    if (userConfig.favoriteArtists) {
        userConfig.favoriteArtists.forEach(a => {
            if (!uniqueArtistIds.has(a.id)) {
                uniqueArtistIds.add(a.id);
                allArtists.push({ id: a.id, name: a.name, isFavorite: true }); // Marcamos como favorito
            }
        });
    }

    res.json(allArtists);
}));

app.post('/excluir-artista', (req, res) => apiWrapper(req, res, async () => {
    const userId = req.cookies?.spotify_user_id || currentUserId;
    const { artistId, playlistId } = req.body;
    if (!userId || !artistId || !playlistId) throw { statusCode: 400, message: 'Faltan datos' };

    currentUserId = userId;
    const config = getUserConfig(userId);

    // 1. Añadir el artista a la lista de excluidos
    if (!config.excludedArtists.includes(artistId)) {
        config.excludedArtists.push(artistId);
        saveConfig(userId, config);
    } else {
        return res.json({ success: true, message: 'Artista ya estaba excluido.' });
    }

    // 2. Eliminar canciones existentes de ese artista en la playlist
    let tracksToRemove = [];
    let offset = 0;
    while (true) {
        const data = await spotifyApi.getPlaylistTracks(playlistId, { offset, limit: 100 });
        data.body.items.forEach(item => {
            if (item.track && item.track.artists.some(a => a.id === artistId)) {
                tracksToRemove.push({ uri: item.track.uri });
            }
        });
        if (!data.body.next) break;
        offset += 100;
    }

    if (tracksToRemove.length > 0) {
        const batchSize = 100;
        for (let i = 0; i < tracksToRemove.length; i += batchSize) {
            const batch = tracksToRemove.slice(i, i + batchSize);
            await spotifyApi.removeTracksFromPlaylist(playlistId, batch);
            await delay(100); 
        }
        res.json({ success: true, message: `✅ Artista excluido y eliminadas ${tracksToRemove.length} canciones suyas de la playlist.` });
    } else {
        res.json({ success: true, message: '✅ Artista excluido. No se encontraron canciones suyas para eliminar.' });
    }
}));


// ----------------------------------------
// --- Inicio del Servidor ---
// ----------------------------------------
const port = process.env.PORT || 8888;
const host = process.env.HOST || '0.0.0.0';
app.listen(port, host, () => {
  console.log(`Servidor escuchando en http://${host}:${port}`);
});