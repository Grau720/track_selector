// index.js COMPLETO
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
let currentClientToken = null; 

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
// --- Configuración de Spotify API y Cookies ---
// ----------------------------------------

// 🛑 ¡IMPORTANTE!: REVISA Y ACTUALIZA ESTAS VARIABLES CON TUS CREDENCIALES REALES
const clientId = '61f8b91c159a4e1590d083bf95049363';
const clientSecret = 'd2127c9e434042d0a2deaadd82d65056';
const redirectUri = 'http://192.168.8.128:8888/callback';

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

// Opciones de Cookies para garantizar la estabilidad y seguridad
const COOKIE_OPTIONS = {
    maxAge: 30 * 24 * 3600000, // 30 días
    httpOnly: true, // No accesible por JS (excepto spotify_user_id)
    sameSite: 'lax', // Crucial para redirecciones y seguridad moderna
    secure: process.env.NODE_ENV === 'production' // Usar HTTPS en producción
};

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
        
        // Guardar el nuevo token con las opciones de seguridad
        res.cookie('spotify_access_token', currentAccessToken, { ...COOKIE_OPTIONS, maxAge: 3600000 });
        
        if (data.body['refresh_token']) {
            currentRefreshToken = data.body['refresh_token'];
            res.cookie('spotify_refresh_token', currentRefreshToken, COOKIE_OPTIONS);
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

    // 💡 CORRECCIÓN: Aseguramos que el SDK tiene TODAS las credenciales (client y user tokens) 
    // antes de la llamada, previniendo errores 404 de configuración sutiles.
    spotifyApi.setClientId(clientId);
    spotifyApi.setClientSecret(clientSecret);
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
                    // Reintento de la llamada API
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
// --- Funciones de Utilidad ---
// ----------------------------------------

// index.js (Sección de Lógica de Refresco de Token y Wrapper)

async function getClientToken() {
    if (currentClientToken) return currentClientToken;

    spotifyApi.setClientId(clientId);
    spotifyApi.setClientSecret(clientSecret);

    try {
        // Pedir un token de credenciales de cliente
        const data = await spotifyApi.clientCredentialsGrant();
        currentClientToken = data.body['access_token'];
        console.log('✅ Token de Cliente obtenido.');
        return currentClientToken;
    } catch (err) {
        console.error('❌ Error al obtener el Token de Cliente:', err.message);
        throw { statusCode: 500, message: 'Fallo al obtener el token de cliente de Spotify.' };
    }
}

function delay(ms) {
  return new Promise(res => setTimeout(res, ms));
}

function findExternalLinks(title, artist, isrc) {
    const query = encodeURIComponent(`${title} ${artist}`);
    
    return {
        youtubeMusic: `https://music.youtube.com/search?q=${query}`,
        appleMusic: `https://music.apple.com/us/search?term=${query}`,
        beatport: `https://www.beatport.com/search?q=${query}`
    };
}


// ----------------------------------------
// --- Endpoints Públicos (Login y Servidor) ---
// ----------------------------------------
app.get('/', (req, res) => {
  const token = req.cookies?.spotify_access_token;
  if (!token) return res.redirect('/login');
  
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ENDPOINT /login (CORREGIDO: Opciones de seguridad de cookies)
app.get('/login', (req, res) => {
  const state = Math.random().toString(36).substring(2, 15);
  
  // Usamos opciones seguras para el STATE
  res.cookie('spotify_auth_state', state, { 
      ...COOKIE_OPTIONS, 
      maxAge: 300000 // 5 minutos para el estado
  }); 
  
  const authorizeURL = spotifyApi.createAuthorizeURL(scopes, state);
  res.redirect(authorizeURL);
});

// ENDPOINT /callback (CORREGIDO: Opciones de seguridad de cookies)
app.get('/callback', async (req, res) => {
  const code = req.query.code;
  const state = req.query.state;
  const storedState = req.cookies?.spotify_auth_state;
  
  if (!state || state !== storedState) return res.status(403).send('Estado inválido');
  
  // Limpia la cookie de estado con las mismas opciones que se usaron para establecerla
  res.clearCookie('spotify_auth_state', COOKIE_OPTIONS); 

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
    
    // Aplicar opciones seguras
    res.cookie('spotify_access_token', accessToken, { ...COOKIE_OPTIONS, maxAge: 3600000 }); 
    res.cookie('spotify_refresh_token', refreshToken, COOKIE_OPTIONS);
    
    // La cookie del ID de usuario debe ser legible por el frontend (httpOnly: false)
    res.cookie('spotify_user_id', currentUserId, { ...COOKIE_OPTIONS, httpOnly: false });
    
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
    if (!newConfig.favoriteArtists) newConfig.favoriteArtists = [];

    saveConfig(userId, newConfig);
    res.json({ success: true, message: '✅ Configuración guardada' });
});

app.get('/history', (req, res) => {
    const history = loadHistory();
    res.json(history);
});


// ----------------------------------------
// --- Endpoints de Artistas Favoritos ---
// ----------------------------------------
app.get('/favorite-artists', (req, res) => {
    const userId = req.cookies?.spotify_user_id || currentUserId;
    if (!userId) return res.status(401).json({ error: 'No user' });
    const config = getUserConfig(userId);
    res.json(config.favoriteArtists || []);
});

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
// --- Endpoint de Búsqueda de Spotify ---
// ----------------------------------------
app.get('/api/search', (req, res) => apiWrapper(req, res, async () => {
    const { q } = req.query;
    if (!q) throw { statusCode: 400, message: 'Falta el parámetro de búsqueda (q)' };

    const data = await spotifyApi.searchArtists(q, { limit: 5 });
    
    const simpleArtists = data.body.artists.items.map(a => ({
        id: a.id,
        name: a.name
    }));

    res.json({ artists: simpleArtists });
}));


// ----------------------------------------
// --- Endpoints de la API de Spotify ---
// ----------------------------------------

app.get('/playlists', (req, res) => apiWrapper(req, res, async () => {
    let playlists = [];
    let offset = 0;
    const targetUserId = req.cookies?.spotify_user_id || currentUserId;
    if (!targetUserId) throw { statusCode: 401, message: 'No hay ID de usuario para obtener playlists.' };
    
    while (true) {
        const data = await spotifyApi.getUserPlaylists(targetUserId, { limit: 50, offset });
        const items = data.body.items.map(p => ({
            id: p.id,
            name: p.name,
            tracks: p.tracks.total,
            // 💡 CORRECCIÓN: Usar encadenamiento opcional (?) para evitar 'Cannot read properties of null'
            image: p.images?.[0]?.url || null, 
            owner: p.owner.display_name
        }));
        playlists = playlists.concat(items);
        if (!data.body.next) break;
        offset += 50;
    }
    res.json(playlists);
}));

// index.js (Línea alrededor de 361)

// index.js (Endpoint /generos)

app.get('/generos', (req, res) => apiWrapper(req, res, async () => {
    // Capturamos el token actual
    const originalToken = spotifyApi.getAccessToken();

    // 1. 💡 CORRECCIÓN: Limpiamos el token de usuario ANTES de la llamada de géneros.
    // Esto asegura que la librería use la autenticación general (Client ID/Secret)
    // o que la llamada no se confunda con permisos de usuario.
    spotifyApi.setAccessToken(null);

    try {
        const data = await spotifyApi.getAvailableGenreSeeds();
        
        // Restauramos el token de usuario INMEDIATAMENTE después de la llamada.
        spotifyApi.setAccessToken(originalToken);

        const genres = data.body?.genres || data.genres || []; 
        
        if (genres.length === 0) {
            console.warn('⚠️ Spotify devolvió una lista de géneros vacía.');
        }

        res.json(genres);
    } catch (e) {
        // Aseguramos que el token se restaure incluso si hay un error
        spotifyApi.setAccessToken(originalToken); 
        
        console.error('Error específico al cargar géneros:', e);
        // Si el error es 404, es casi seguro un problema de autenticación/token para ese endpoint
        if (e.statusCode === 404) {
             throw { statusCode: 500, message: 'Fallo de autenticación general al obtener géneros. Intenta volver a iniciar sesión.' };
        }
        throw { statusCode: 500, message: e.message || 'Fallo al obtener la lista de géneros disponibles de Spotify.' };
    }
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
// --- Endpoint PRINCIPAL: /filtrar-y-anadir ---
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
// --- Endpoints de Artistas Filtrados/Excluidos ---
// ----------------------------------------

app.post('/artistas-filtrados', (req, res) => apiWrapper(req, res, async () => {
    const { generos } = req.body;
    if (!generos) throw { statusCode: 400, message: 'Faltan generos' };

    const uniqueArtistIds = new Set();
    const allArtists = [];
    let after = null;
    
    // 1. Incluir Artistas Seguidos (filtrados por género)
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

    // 2. Incluir Artistas Favoritos (lista interna de la app)
    const userConfig = getUserConfig(req.cookies?.spotify_user_id || currentUserId);
    if (userConfig.favoriteArtists) {
        userConfig.favoriteArtists.forEach(a => {
            if (!uniqueArtistIds.has(a.id)) {
                uniqueArtistIds.add(a.id);
                allArtists.push({ id: a.id, name: a.name, isFavorite: true }); 
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