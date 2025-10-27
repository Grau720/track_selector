const express = require('express');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const SpotifyWebApi = require('spotify-web-api-node');
const path = require('path');
const db = require('./db');

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

const clientId = '61f8b91c159a4e1590d083bf95049363';
const clientSecret = '71c6fa065dac418a984f8e5c19f01596';
const redirectUri = 'http://localhost:8888/callback';

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

    // 💡 Aseguramos que el SDK tiene TODAS las credenciales (client y user tokens) 
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
// index.js (Endpoint /)
app.get('/', async (req, res) => {
    const token = req.cookies?.spotify_access_token;
    
    if (!token) return res.redirect('/login');
    
    spotifyApi.setAccessToken(token);
    try {
        await spotifyApi.getMe(); // Llama a 'me' para validar el token
    } catch (err) {
        // Si falla con 401, forzamos el refresh ANTES de cargar la página
        if (err.statusCode === 401 && req.cookies?.spotify_refresh_token) {
            console.log('Token expirado en /, forzando refresh...');
            const success = await refreshAccessToken(req, res);
            if (!success) {
                // Si el refresh falla, redirigimos a login
                return res.redirect('/login');
            }
        } else if (err.statusCode === 401) {
             return res.redirect('/login');
        } else {
             console.error('Error no 401 al cargar /:', err.message);
        }
    }
    
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
// --- Configuración del algoritmo ---
// ----------------------------------------
const RECOMMENDATION_CONFIG = {
  topArtistsToUse: 10,           // Cuántos de tus artistas usar como semilla
  minPopularity: 30,             // Filtro de popularidad
  minFollowers: 10000,           // Filtro de seguidores
  genreWeight: 40,               // Peso de géneros coincidentes en el score
  popularityWeight: 0.5,         // Peso de popularidad general
  collaborationWeight: 10        // Peso de frecuencia de colaboración
};

// ----------------------------------------
// --- Función auxiliar: Reintentos con rate limits ---
// ----------------------------------------
async function retryApiCall(apiCall, maxRetries = 2, baseDelayMs = 1000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await apiCall();
        } catch (err) {
            // Si es 429 (rate limit), respetar el Retry-After header
            if (err.statusCode === 429) {
                const retryAfter = parseInt(err.headers?.['retry-after'] || '5', 10);
                console.warn(`⏳ Rate limit alcanzado. Esperando ${retryAfter}s...`);
                await delay(retryAfter * 1000);
                continue;
            }
            
            // Si es 404 y no es el último intento, reintentar
            if (err.statusCode === 404 && attempt < maxRetries) {
                await delay(baseDelayMs * attempt);
                continue;
            }
            
            throw err;
        }
    }
}

// ----------------------------------------
// --- Endpoint: Artistas Recomendados (ESTRATEGIA: TOP TRACKS) ---
// ----------------------------------------
app.get('/api/recommended-artists', (req, res) => apiWrapper(req, res, async () => {
    const userId = req.cookies?.spotify_user_id || currentUserId;
    if (!userId) {
        return res.status(401).json({ error: 'No hay ID de usuario disponible' });
    }

    const config = getUserConfig(userId);
    const seed_genres = config.generos || [];

    if (seed_genres.length === 0) {
        return res.json({ artists: [] });
    }

    try {
        const excludedIds = new Set(config.excludedArtists || []);
        const myArtistIds = new Set();
        let after = null;

        // ============================================
        // PASO 1: Obtener TUS artistas seguidos
        // ============================================
        console.log('📥 Obteniendo artistas seguidos...');
        
        while (true) {
            const opts = { limit: 50 };
            if (after) opts.after = after;
            
            const data = await retryApiCall(() => spotifyApi.getFollowedArtists(opts));
            const artists = data.body.artists.items;

            artists.forEach(artist => {
                if (artist.genres.some(g => seed_genres.includes(g))) {
                    myArtistIds.add(artist.id);
                    excludedIds.add(artist.id);
                }
            });

            if (!data.body.artists.next) break;
            after = artists[artists.length - 1].id;
            await delay(200);
        }

        // Añadir favoritos
        if (config.favoriteArtists) {
            config.favoriteArtists.forEach(fav => {
                myArtistIds.add(fav.id);
                excludedIds.add(fav.id);
            });
        }

        const myArtistsArray = Array.from(myArtistIds);
        
        if (myArtistsArray.length === 0) {
            return res.json({ 
                artists: [], 
                message: 'Necesitas seguir artistas primero' 
            });
        }

        console.log(`🎯 Base: ${myArtistsArray.length} artistas propios`);

        // ============================================
        // PASO 2: Validar y rankear tus artistas
        // ============================================
        console.log('🔍 Validando y rankeando artistas...');
        
        const validArtistScores = [];
        
        for (let i = 0; i < myArtistsArray.length; i += 50) {
            const batch = myArtistsArray.slice(i, i + 50);
            
            try {
                const artistsData = await retryApiCall(() => spotifyApi.getArtists(batch));
                
                artistsData.body.artists.forEach(artist => {
                    if (artist && artist.id) {
                        const matchingGenres = artist.genres.filter(g => seed_genres.includes(g)).length;
                        validArtistScores.push({
                            id: artist.id,
                            name: artist.name,
                            score: matchingGenres,
                            popularity: artist.popularity
                        });
                    }
                });
                
                if (i + 50 < myArtistsArray.length) {
                    await delay(300);
                }
            } catch (err) {
                console.warn('⚠️ Error obteniendo artistas:', err.message);
            }
        }

        if (validArtistScores.length === 0) {
            return res.json({ artists: [], message: 'No hay artistas válidos' });
        }

        // Ordenar por relevancia
        validArtistScores.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return b.popularity - a.popularity;
        });

        const topSeedArtists = validArtistScores.slice(0, RECOMMENDATION_CONFIG.topArtistsToUse);
        console.log(`🌟 Usando top ${topSeedArtists.length} artistas como semilla`);

        // ============================================
        // PASO 3: Obtener Top Tracks y extraer colaboradores
        // ============================================
        console.log('🎵 Obteniendo top tracks y colaboradores...');
        
        const collaboratorData = new Map(); // id -> { count, artist }
        let tracksProcessed = 0;

        for (const seedArtist of topSeedArtists) {
            try {
                // 🔥 USAR 'from_token' para el mercado del usuario
                const topTracks = await retryApiCall(
                    () => spotifyApi.getArtistTopTracks(seedArtist.id, 'from_token')
                );
                
                // Procesar cada track
                topTracks.body.tracks.forEach(track => {
                    tracksProcessed++;
                    
                    // Extraer TODOS los artistas de la canción
                    track.artists.forEach(artist => {
                        // Excluir si es el artista principal o ya lo sigues
                        if (artist.id === seedArtist.id || excludedIds.has(artist.id)) {
                            return;
                        }
                        
                        // Contar colaboraciones
                        if (collaboratorData.has(artist.id)) {
                            collaboratorData.get(artist.id).count++;
                        } else {
                            collaboratorData.set(artist.id, {
                                id: artist.id,
                                name: artist.name,
                                count: 1 // Primera vez que aparece
                            });
                        }
                    });
                });
                
                await delay(400); // Pausa entre artistas
                
            } catch (err) {
                console.warn(`⚠️ Error obteniendo tracks de ${seedArtist.name}:`, err.statusCode);
            }
        }

        console.log(`✅ ${tracksProcessed} tracks procesados`);
        console.log(`✅ ${collaboratorData.size} colaboradores únicos encontrados`);

        if (collaboratorData.size === 0) {
            return res.json({ 
                artists: [], 
                message: 'No se encontraron colaboradores en las top tracks' 
            });
        }

        // ============================================
        // PASO 4: Obtener detalles completos de los colaboradores
        // ============================================
        console.log('📊 Obteniendo detalles de colaboradores...');
        
        const collaboratorIds = Array.from(collaboratorData.keys());
        const collaboratorDetails = [];

        for (let i = 0; i < collaboratorIds.length; i += 50) {
            const batch = collaboratorIds.slice(i, i + 50);
            
            try {
                const artistsData = await retryApiCall(() => spotifyApi.getArtists(batch));
                
                artistsData.body.artists.forEach(artist => {
                    if (!artist || !artist.id) return;
                    
                    // FILTROS
                    if (artist.popularity < RECOMMENDATION_CONFIG.minPopularity) return;
                    if (artist.followers.total < RECOMMENDATION_CONFIG.minFollowers) return;
                    
                    const matchingGenres = artist.genres.filter(g => seed_genres.includes(g)).length;
                    
                    // Al menos debe tener 1 género coincidente
                    if (matchingGenres === 0) return;
                    
                    const collabInfo = collaboratorData.get(artist.id);
                    
                    collaboratorDetails.push({
                        id: artist.id,
                        name: artist.name,
                        image: artist.images.length > 0 
                            ? artist.images[artist.images.length - 1].url
                            : null,
                        genres: artist.genres,
                        followers: artist.followers.total,
                        popularity: artist.popularity,
                        matchingGenres: matchingGenres,
                        collaborations: collabInfo.count
                    });
                });
                
                if (i + 50 < collaboratorIds.length) {
                    await delay(300);
                }
            } catch (err) {
                console.warn('⚠️ Error obteniendo detalles de colaboradores:', err.message);
            }
        }

        console.log(`✅ ${collaboratorDetails.length} colaboradores válidos tras filtros`);

        if (collaboratorDetails.length === 0) {
            return res.json({ 
                artists: [], 
                message: 'No se encontraron colaboradores que cumplan los filtros' 
            });
        }

        // ============================================
        // PASO 5: Calcular Popularity Index y ordenar
        // ============================================
        console.log('🎯 Calculando Popularity Index...');
        
        collaboratorDetails.forEach(artist => {
            artist.popularityIndex = 
                (artist.matchingGenres * RECOMMENDATION_CONFIG.genreWeight) +
                (artist.popularity * RECOMMENDATION_CONFIG.popularityWeight) +
                (artist.collaborations * RECOMMENDATION_CONFIG.collaborationWeight);
        });

        // Ordenar por Popularity Index (descendente)
        collaboratorDetails.sort((a, b) => b.popularityIndex - a.popularityIndex);

        // Limpiar datos internos antes de enviar
        const finalArtists = collaboratorDetails.slice(0, 50).map(artist => ({
            id: artist.id,
            name: artist.name,
            image: artist.image,
            genres: artist.genres.slice(0, 3),
            followers: artist.followers,
            popularity: artist.popularity,
            collaborations: artist.collaborations,
            popularityIndex: Math.round(artist.popularityIndex)
        }));

        console.log(`🎉 Enviando ${finalArtists.length} artistas recomendados`);
        console.log(`📈 Top 3 por Popularity Index:`);
        finalArtists.slice(0, 3).forEach((a, i) => {
            console.log(`   ${i+1}. ${a.name} - Index: ${a.popularityIndex} (${a.collaborations} colabs)`);
        });

        return res.json({ 
            artists: finalArtists,
            total: finalArtists.length,
            stats: {
                tracksProcessed: tracksProcessed,
                collaboratorsFound: collaboratorData.size,
                afterFilters: collaboratorDetails.length
            },
            config: RECOMMENDATION_CONFIG
        });

    } catch (error) {
        console.error('❌ Error general:', error.message);
        return res.status(500).json({ 
            artists: [], 
            error: error.message
        });
    }
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

app.get('/generos', (req, res) => apiWrapper(req, res, async () => {
    
    console.log('DEBUG: Ejecutando /generos (NUEVA ESTRATEGIA: Extracción de Artistas Seguidos)');
    
    const uniqueGenres = new Set();
    let after = null; // Para paginación

    // Iterar sobre todos los artistas seguidos del usuario autenticado
    while (true) {
        const opts = { limit: 50 }; // Paginación: obtener 50 artistas a la vez
        if (after) opts.after = after;
        
        // spotifyApi.getFollowedArtists requiere el scope 'user-follow-read'
        const data = await spotifyApi.getFollowedArtists(opts);
        const artists = data.body.artists.items;

        // Recolectar todos los géneros de estos 50 artistas
        artists.forEach(a => {
            a.genres.forEach(g => uniqueGenres.add(g));
        });

        // 🚨 CRUCIAL: Detener la paginación si no hay más elementos
        if (!data.body.artists.next) break;
        
        // Establecer el ID del último artista como cursor para la siguiente página
        after = artists[artists.length - 1].id;
    }

    const genresArray = Array.from(uniqueGenres).sort();
    
    console.log(`DEBUG: ✅ ${genresArray.length} géneros únicos extraídos de artistas seguidos.`);
    
    // Devolver la lista compilada para que el frontend la use
    res.json(genresArray);
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
// --- Endpoint PRINCIPAL: /filtrar-y-anadir (OPTIMIZADO) ---
// ----------------------------------------

app.post('/filtrar-y-anadir', (req, res) => apiWrapper(req, res, async () => {
    const { generos, playlistId, excludedArtists = [] } = req.body;
    if (!generos || !playlistId) throw { statusCode: 400, message: 'Faltan datos' };

    const addedTracksDetails = [];
    let existingTracksCount = 0;
    const errors = []; // 💡 NUEVO: Array para errores descriptivos

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

    // Convertimos el Set a Array para iterar en el Paso 3
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
    
    // 💡 CAMBIO: Límite de 90 días
    const thisWeek = Date.now() - 90 * 24 * 3600 * 1000; 
    const trackUris = new Set();
    const tracksToDetail = []; // 💡 NUEVO: Array para IDs de tracks que necesitan detalles

    // 3. Buscar lanzamientos recientes de los artistas seleccionados
    for (const id of uniqueArtistIds) { 
      // Buscamos el nombre del artista para el manejo de errores
      const artist = userConfig.favoriteArtists.find(a => a.id === id) || { name: `ID: ${id}` };

      try {
        // 💡 CAMBIO: Límite de 50 lanzamientos por artista
        const releases = await spotifyApi.getArtistAlbums(id, { limit: 50, include_groups: 'single,album' });
        
        for (const album of releases.body.items) {
          const date = new Date(album.release_date);
          
          if (date.getTime() >= thisWeek) { // Filtro temporal de 90 días
            
            const tracks = await spotifyApi.getAlbumTracks(album.id);
            
            for (const t of tracks.body.items) {
              if (t.uri && !existingTracks.has(t.uri)) {
                
                // 💡 OPTIMIZACIÓN: Solo guardamos el ID para obtener detalles después
                tracksToDetail.push(t.id);
                trackUris.add(t.uri); 
              }
            }
          }
        }
      } catch (e) {
        // 💡 NUEVO: Registro de error descriptivo
        errors.push({
            artistId: id,
            artistName: artist.name,
            message: e.message,
            statusCode: e.statusCode || 500
        });
        console.warn(`Error procesando artista ${artist.name} (${id}): ${e.message}`);
      }
      await delay(200); 
    }
    
    // -----------------------------------------------------
    // 💡 OPTIMIZACIÓN: Procesar los detalles de las canciones en lote (50 en 50)
    // -----------------------------------------------------
    const detailBatchSize = 50;
    const allTrackIds = Array.from(tracksToDetail);
    
    for (let i = 0; i < allTrackIds.length; i += detailBatchSize) {
        const batchIds = allTrackIds.slice(i, i + detailBatchSize);
        
        try {
            // 🚨 Única llamada para 50 tracks
            const detailData = await spotifyApi.getTracks(batchIds); 
            
            detailData.body.tracks.forEach(fullTrack => {
                if (fullTrack && fullTrack.uri) {
                    const isrc = fullTrack.external_ids?.isrc || null;
                    const trackArtists = fullTrack.artists.map(a => a.name).join(', ');
                    
                    const externalLinks = findExternalLinks(fullTrack.name, trackArtists, isrc);

                    // Añadir a los detalles finales
                    addedTracksDetails.push({
                        title: fullTrack.name,
                        artist: trackArtists,
                        platform: 'Spotify (Nuevo Lanzamiento)',
                        uri: fullTrack.uri,
                        externalLinks: externalLinks 
                    });
                }
            });
            await delay(100); 
        } catch (e) {
             console.error('❌ Error obteniendo detalles de tracks en lote:', e.message);
        }
    }
    // -----------------------------------------------------
    
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
    
    // 💡 NUEVO: Devolver los errores
    res.json({ 
      success: true, 
      message: `✅ Añadidas ${addedCount} canciones nuevas (${existingTracksCount} ya existían).`,
      errors: errors 
    });
}));


// ----------------------------------------
// --- Endpoints de Artistas Filtrados/Excluidos ---
// ----------------------------------------
// ... (El código de /artistas-filtrados y /excluir-artista no ha sido modificado, se mantiene igual)

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