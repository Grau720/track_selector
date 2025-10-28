
const express = require('express');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const SpotifyWebApi = require('spotify-web-api-node');
const path = require('path');
// const db = require('./db'); // Comentado si no lo estás usando

// 💡 NUEVO: Importar funciones de tokens para persistencia multiusuario
const { saveUserTokens } = require('./tokens'); 

const app = express();
app.use(cookieParser());
app.use(express.json());
app.use(express.static('public')); 

// 🛑 ELIMINADAS: Estas variables globales ya NO se usan para tokens de usuario.
// let currentAccessToken = null;
// let currentUserId = null; 
// let currentRefreshToken = null;

const CONFIG_PATH = path.join(__dirname, 'configs.json');
const HISTORY_PATH = path.join(__dirname, 'history.json');

// ----------------------------------------
// --- Funciones de Configuración y Historial (SIN CAMBIOS) ---
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
// --- MIDDLEWARE: Carga y Refresco de Tokens (CRUCIAL) ---
// ----------------------------------------

async function loadAndRefreshUserTokens(req, res, next) {
    const userId = req.cookies?.spotify_user_id;
    let accessToken = req.cookies?.spotify_access_token;
    let refreshToken = req.cookies?.spotify_refresh_token;

    // Si no hay cookies, no hay sesión activa.
    if (!userId || !accessToken || !refreshToken) {
        spotifyApi.setAccessToken(undefined);
        spotifyApi.setRefreshToken(undefined);
        return next();
    }
    
    // 1. Aplicar los tokens del usuario actual a la instancia global (spotifyApi)
    spotifyApi.setAccessToken(accessToken);
    spotifyApi.setRefreshToken(refreshToken);

    try {
        // 2. Intentar validar el token con una llamada ligera
        await spotifyApi.getMe(); 
        
    } catch (err) {
        if (err.statusCode === 401) {
            console.log(`[${userId}] Token expirado. Refrescando...`);
            
            try {
                // El SDK ya tiene el client ID/Secret de la inicialización.
                const data = await spotifyApi.refreshAccessToken();
                const newAccessToken = data.body['access_token'];
                
                // 3. ACTUALIZAR COOKIES Y PERSISTENCIA
                res.cookie('spotify_access_token', newAccessToken, { 
                    ...COOKIE_OPTIONS, 
                    maxAge: 3600000 // 1 hora
                });
                spotifyApi.setAccessToken(newAccessToken);
                
                // 4. Guardar el nuevo token en el almacenamiento persistente
                await saveUserTokens(userId, newAccessToken, refreshToken);
                console.log(`[${userId}] Token refrescado correctamente.`);

            } catch (refreshErr) {
                console.error(`[${userId}] Error al refrescar token:`, refreshErr.message);
                
                // Falló el refresco: forzar reautenticación
                res.clearCookie('spotify_access_token', COOKIE_OPTIONS);
                res.clearCookie('spotify_refresh_token', COOKIE_OPTIONS);
                res.clearCookie('spotify_user_id', COOKIE_OPTIONS);

                // Si es un endpoint de API, devolvemos 401.
                if (req.path.startsWith('/api') || req.path.startsWith('/playlists')) {
                    return res.status(401).json({ error: 'Token de sesión expirado. Vuelve a iniciar sesión.' });
                }
            }
        } else {
            console.error(`Error de Spotify no 401 para ${userId}:`, err.message);
        }
    }
    
    // El token (refrescado o no) ya está configurado en spotifyApi para la siguiente llamada
    next();
}

// Aplicar el middleware a TODAS las rutas que necesiten Spotify
app.use(loadAndRefreshUserTokens);


// ----------------------------------------
// --- WRAPPER DE ERRORES (Reemplaza al antiguo apiWrapper) ---
// ----------------------------------------

// Esta función es un simple manejador de errores, ya que el middleware
// se encargó de la autenticación y el refresco.
function standardApiWrapper(apiCall) {
    return async (req, res) => {
        try {
            // El middleware ya garantizó que spotifyApi tiene el token correcto.
            await apiCall(req, res);
        } catch (err) {
            // El 401 ya fue manejado por el middleware.
            console.error('❌ Error de Endpoint (tras middleware):', err.message);
            res.status(err.statusCode || 500).json({ error: err.message || 'Error en la API de Spotify' });
        }
    }
}


// ----------------------------------------
// --- Funciones de Utilidad (SIN CAMBIOS) ---
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
    // Si el middleware borró las cookies (por refresh fallido) o no existen, redirigir.
    if (!req.cookies?.spotify_access_token) {
        return res.redirect('/login');
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ENDPOINT /login (SIN CAMBIOS)
app.get('/login', (req, res) => {
  const state = Math.random().toString(36).substring(2, 15);
  res.cookie('spotify_auth_state', state, { 
      ...COOKIE_OPTIONS, 
      maxAge: 300000 // 5 minutos para el estado
  }); 
  const authorizeURL = spotifyApi.createAuthorizeURL(scopes, state);
  res.redirect(authorizeURL);
});

// ENDPOINT /callback (CORREGIDO para Persistencia)
app.get('/callback', async (req, res) => {
  const code = req.query.code;
  const state = req.query.state;
  const storedState = req.cookies?.spotify_auth_state;
  
  if (!state || state !== storedState) return res.status(403).send('Estado inválido');
  
  res.clearCookie('spotify_auth_state', COOKIE_OPTIONS); 

  try {
    const data = await spotifyApi.authorizationCodeGrant(code);
    const accessToken = data.body['access_token'];
    const refreshToken = data.body['refresh_token'];
    
    spotifyApi.setAccessToken(accessToken);
    spotifyApi.setRefreshToken(refreshToken);
    
    // 🛑 ELIMINADAS: No asignamos a variables globales
    // currentAccessToken = accessToken;
    // currentRefreshToken = refreshToken;

    const me = await spotifyApi.getMe();
    const userId = me.body.id; // Usar variable local

    // 💡 CLAVE: Guardar los tokens en el almacenamiento persistente
    await saveUserTokens(userId, accessToken, refreshToken);
    
    // Aplicar opciones seguras
    res.cookie('spotify_access_token', accessToken, { ...COOKIE_OPTIONS, maxAge: 3600000 }); 
    res.cookie('spotify_refresh_token', refreshToken, COOKIE_OPTIONS);
    
    // La cookie del ID de usuario debe ser legible por el frontend (httpOnly: false)
    res.cookie('spotify_user_id', userId, { ...COOKIE_OPTIONS, httpOnly: false });
    
    console.log('Conectado como:', me.body.display_name);
    res.redirect('/');
  } catch (err) {
    console.error('Error en callback:', err);
    res.status(500).send('Error autenticando con Spotify');
  }
});


// ----------------------------------------
// --- Endpoints de Configuración y Datos (AJUSTADOS) ---
// ----------------------------------------
app.get('/config', (req, res) => {
    // 🛑 ELIMINADO: Ya no usamos currentUserId
    const userId = req.cookies?.spotify_user_id; 
    if (!userId) return res.status(401).json({ error: 'No user' });
    
    const config = getUserConfig(userId);
    res.json(config || { generos: [], excludedArtists: [], playlistId: null, favoriteArtists: [] });
});

app.post('/config', (req, res) => {
    // 🛑 ELIMINADO: Ya no usamos currentUserId
    const userId = req.cookies?.spotify_user_id; 
    if (!userId) return res.status(401).json({ error: 'No user' });
    
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
// --- Endpoints de Artistas Favoritos (AJUSTADOS) ---
// ----------------------------------------
app.get('/favorite-artists', (req, res) => {
    const userId = req.cookies?.spotify_user_id;
    if (!userId) return res.status(401).json({ error: 'No user' });
    const config = getUserConfig(userId);
    res.json(config.favoriteArtists || []);
});

app.post('/favorite-artists/add', standardApiWrapper(async (req, res) => {
    
    const userId = req.cookies?.spotify_user_id;
    const { artistId, artistName } = req.body;
    
    if (!userId || !artistId || !artistName) {
        return res.status(400).json({ error: 'Faltan datos (userId, artistId o artistName).' });
    }
    
    const config = getUserConfig(userId);
    
    if (!config.favoriteArtists) config.favoriteArtists = [];
    
    if (config.favoriteArtists.some(a => a.id === artistId)) {
        return res.json({ success: true, message: 'Artista ya estaba en la lista.' });
    }
    
    let artistImage = null;
    
    try {
        const artistData = await spotifyApi.getArtist(artistId); 

        const images = artistData.body.images; 
        if (images && images.length > 0) {
            // Última imagen (generalmente la más pequeña)
            artistImage = images[images.length - 1].url; 
        }
        
    } catch (error) {
        console.error(`⚠️ Error al obtener la imagen del artista ${artistName} (${artistId}):`, error.message);
    }
    
    config.favoriteArtists.push({ 
        id: artistId, 
        name: artistName, 
        image: artistImage 
    });
    
    saveConfig(userId, config);
    return res.json({ success: true, message: `✅ Artista ${artistName} añadido a Favoritos` });

}));

// --- Endpoint para Eliminar Artista Favorito (AJUSTADO) ---
app.post('/favorite-artists/remove', (req, res) => {
    const userId = req.cookies?.spotify_user_id;
    const { artistId } = req.body;
    
    if (!userId || !artistId) {
        return res.status(400).json({ error: 'Faltan datos del artista o usuario' });
    }

    const config = getUserConfig(userId);
    
    if (!config.favoriteArtists) {
        return res.status(404).json({ success: true, message: 'Lista de favoritos vacía.' });
    }
    
    const initialCount = config.favoriteArtists.length;
    
    config.favoriteArtists = config.favoriteArtists.filter(a => a.id !== artistId);
    
    saveConfig(userId, config);
    
    if (config.favoriteArtists.length < initialCount) {
        return res.json({ success: true, message: '🗑️ Artista eliminado de Favoritos.' });
    } else {
        return res.json({ success: false, message: 'El artista no fue encontrado en la lista.' });
    }
});

// ----------------------------------------
// --- Endpoint de Búsqueda de Spotify (AJUSTADO) ---
// ----------------------------------------
app.get('/api/search', standardApiWrapper(async (req, res) => {
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
// --- Configuración del algoritmo (SIN CAMBIOS) ---
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
// --- Función auxiliar: Reintentos con rate limits (SIN CAMBIOS) ---
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
            
            if (err.statusCode === 404 && attempt < maxRetries) {
                await delay(baseDelayMs * attempt);
                continue;
            }
            
            throw err;
        }
    }
}

// ----------------------------------------
// --- Endpoint: Artistas Recomendados (AJUSTADO) ---
// ----------------------------------------
app.get('/api/recommended-artists', standardApiWrapper(async (req, res) => {
    const userId = req.cookies?.spotify_user_id;
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
        // ... (el resto del algoritmo permanece igual, ya que usa spotifyApi) ...

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
// --- Endpoints de la API de Spotify (AJUSTADOS) ---
// ----------------------------------------

app.get('/playlists', standardApiWrapper(async (req, res) => {
    let playlists = [];
    let offset = 0;
    const targetUserId = req.cookies?.spotify_user_id; // 🛑 Usamos solo la cookie
    if (!targetUserId) throw { statusCode: 401, message: 'No hay ID de usuario para obtener playlists.' };
    
    while (true) {
        const data = await spotifyApi.getUserPlaylists(targetUserId, { limit: 50, offset });
        const items = data.body.items.map(p => ({
            id: p.id,
            name: p.name,
            tracks: p.tracks.total,
            image: p.images?.[0]?.url || null, 
            owner: p.owner.display_name
        }));
        playlists = playlists.concat(items);
        if (!data.body.next) break;
        offset += 50;
    }
    res.json(playlists);
}));

app.get('/generos', standardApiWrapper(async (req, res) => {
    
    console.log('DEBUG: Ejecutando /generos (NUEVA ESTRATEGIA: Extracción de Artistas Seguidos)');
    
    const uniqueGenres = new Set();
    let after = null; // Para paginación

    while (true) {
        const opts = { limit: 50 };
        if (after) opts.after = after;
        
        const data = await spotifyApi.getFollowedArtists(opts);
        const artists = data.body.artists.items;

        artists.forEach(a => {
            a.genres.forEach(g => uniqueGenres.add(g));
        });

        if (!data.body.artists.next) break;
        
        after = artists[artists.length - 1].id;
    }

    const genresArray = Array.from(uniqueGenres).sort();
    
    console.log(`DEBUG: ✅ ${genresArray.length} géneros únicos extraídos de artistas seguidos.`);
    
    res.json(genresArray);
}));

app.post('/vaciar-playlist', standardApiWrapper(async (req, res) => {
    const { playlistId } = req.body;
    if (!playlistId) throw { statusCode: 400, message: 'Falta playlistId' };

    let tracksToRemove = [];
    let offset = 0;
    
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
// --- Endpoint PRINCIPAL: /filtrar-y-anadir (AJUSTADO) ---
// ----------------------------------------

app.post('/filtrar-y-anadir', standardApiWrapper(async (req, res) => {
    const { generos, playlistId, excludedArtists = [] } = req.body;
    const userId = req.cookies?.spotify_user_id; // 🛑 Usamos solo la cookie
    if (!generos || !playlistId || !userId) throw { statusCode: 400, message: 'Faltan datos' };

    const addedTracksDetails = [];
    let existingTracksCount = 0;
    const errors = []; 

    // 1. Obtener artistas seguidos y favoritos que coincidan con los géneros
    const artistIds = new Set(); 
    const userConfig = getUserConfig(userId); // 🛑 Usamos userId de la cookie
    
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
    
    // 💡 Límite de 90 días
    const thisWeek = Date.now() - 90 * 24 * 3600 * 1000; 
    const trackUris = new Set();
    const tracksToDetail = []; 

    // 3. Buscar lanzamientos recientes de los artistas seleccionados
    for (const id of uniqueArtistIds) { 
      // Buscamos el nombre del artista para el manejo de errores
      // Mejoramos la búsqueda: busca en los favoritos O usa el ID
      const artist = userConfig.favoriteArtists.find(a => a.id === id) || 
                     userConfig.favoriteArtists.find(a => a.id === id) || 
                     { name: `ID: ${id}` };

      try {
        const releases = await spotifyApi.getArtistAlbums(id, { limit: 50, include_groups: 'single,album' });
        
        for (const album of releases.body.items) {
          const date = new Date(album.release_date);
          
          if (date.getTime() >= thisWeek) { // Filtro temporal de 90 días
            
            const tracks = await spotifyApi.getAlbumTracks(album.id);
            
            for (const t of tracks.body.items) {
              if (t.uri && !existingTracks.has(t.uri)) {
                
                tracksToDetail.push(t.id);
                trackUris.add(t.uri); 
              }
            }
          }
        }
      } catch (e) {
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
    // OPTIMIZACIÓN: Procesar los detalles de las canciones en lote (50 en 50)
    // -----------------------------------------------------
    const detailBatchSize = 50;
    const allTrackIds = Array.from(tracksToDetail);
    
    for (let i = 0; i < allTrackIds.length; i += detailBatchSize) {
        const batchIds = allTrackIds.slice(i, i + detailBatchSize);
        
        try {
            const detailData = await spotifyApi.getTracks(batchIds); 
            
            detailData.body.tracks.forEach(fullTrack => {
                if (fullTrack && fullTrack.uri) {
                    const isrc = fullTrack.external_ids?.isrc || null;
                    const trackArtists = fullTrack.artists.map(a => a.name).join(', ');
                    
                    const externalLinks = findExternalLinks(fullTrack.name, trackArtists, isrc);

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
    
    res.json({ 
      success: true, 
      message: `✅ Añadidas ${addedCount} canciones nuevas (${existingTracksCount} ya existían).`,
      errors: errors 
    });
}));


// ----------------------------------------
// --- Endpoints de Artistas Filtrados/Excluidos (AJUSTADOS) ---
// ----------------------------------------

app.post('/artistas-filtrados', standardApiWrapper(async (req, res) => {
    const { generos } = req.body;
    const userId = req.cookies?.spotify_user_id;
    if (!generos || !userId) throw { statusCode: 400, message: 'Faltan datos' };

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
    const userConfig = getUserConfig(userId); // 🛑 Usamos userId de la cookie
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

app.post('/excluir-artista', standardApiWrapper(async (req, res) => {
    const userId = req.cookies?.spotify_user_id; // 🛑 Usamos solo la cookie
    const { artistId, playlistId } = req.body;
    if (!userId || !artistId || !playlistId) throw { statusCode: 400, message: 'Faltan datos' };

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
// --- Endpoints de Gestión de Playlists (AJUSTADOS) ---
// ----------------------------------------

// A. Endpoint para Listar Playlists del Usuario
app.get('/user-playlists', standardApiWrapper(async (req, res) => {
    const targetUserId = req.cookies?.spotify_user_id; // 🛑 Usamos solo la cookie
    if (!targetUserId) throw { statusCode: 401, message: 'No hay ID de usuario para obtener playlists.' };

    let playlists = [];
    let offset = 0;
    
    while (true) {
        const data = await spotifyApi.getUserPlaylists(targetUserId, { limit: 50, offset });
        
        const items = data.body.items.map(p => ({
            id: p.id,
            name: p.name,
            ownerId: p.owner.id,
            owner: p.owner.display_name,
            collaborative: p.collaborative 
        }));
        playlists = playlists.concat(items);
        
        if (!data.body.next) break;
        offset += 50;
    }
    return res.json(playlists);
}));

// B. Endpoint para Crear una Nueva Playlist
app.post('/create-playlist', standardApiWrapper(async (req, res) => {
    const { name } = req.body;
    const targetUserId = req.cookies?.spotify_user_id; 
    
    if (!name) throw { statusCode: 400, message: 'Se requiere el nombre de la playlist.' };
    if (!targetUserId) throw { statusCode: 401, message: 'No hay ID de usuario para crear playlist.' };
    
    // El SDK de Spotify usa el token del usuario autenticado para crear la playlist.
    const data = await spotifyApi.createPlaylist(name, {
        'public': false, 
        'description': 'Playlist generada automáticamente por FilterFlow.'
    });

    const newPlaylist = {
        id: data.body.id,
        name: data.body.name,
        ownerId: targetUserId 
    };
    return res.json({ success: true, playlist: newPlaylist, message: `Playlist ${name} creada.` });
}));

// ----------------------------------------
// --- Inicio del Servidor (SIN CAMBIOS) ---
// ----------------------------------------
const port = process.env.PORT || 8888;
const host = process.env.HOST || '0.0.0.0';
app.listen(port, host, () => {
  console.log(`Servidor escuchando en http://${host}:${port}`);
});