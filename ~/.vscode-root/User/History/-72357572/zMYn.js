// index.js
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

const CONFIG_PATH = path.join(__dirname, 'configs.json');

function loadConfigs() {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  return JSON.parse(fs.readFileSync(CONFIG_PATH));
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
  return config;
}

// CAMBIA ESTAS VARIABLES POR TUS PROPIAS CREDENCIALES
const clientId = process.env.SPOTIFY_CLIENT_ID || '61f8b91c159a4e1590d083bf95049363';
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET || 'd2127c9e434042d0a2deaadd82d65056';
const redirectUri = process.env.REDIRECT_URI || 'http://192.168.8.128:8888/callback';

const scopes = [
  'playlist-modify-public',
  'playlist-modify-private',
  'user-follow-read'
];

const spotifyApi = new SpotifyWebApi({ clientId, clientSecret, redirectUri });

app.get('/', (req, res) => {
  const token = req.cookies?.spotify_access_token;
  if (!token) return res.redirect('/login');
  
  currentAccessToken = token;
  spotifyApi.setAccessToken(token);
  
  res.sendFile(__dirname + '/public/index.html');
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

    const me = await spotifyApi.getMe();
    currentUserId = me.body.id;
    
    // Guardar tokens en cookies
    res.cookie('spotify_access_token', accessToken, { 
      httpOnly: true, 
      maxAge: 3600000 // 1 hora
    });
    res.cookie('spotify_refresh_token', refreshToken, { 
      httpOnly: true, 
      maxAge: 30 * 24 * 3600000 // 30 días
    });
    res.cookie('spotify_user_id', currentUserId, { 
      httpOnly: true, 
      maxAge: 30 * 24 * 3600000 
    });
    
    console.log('Conectado como:', me.body.display_name);
    res.redirect('/');
  } catch (err) {
    console.error('Error en callback:', err);
    res.status(500).send('Error autenticando con Spotify');
  }
});

app.get('/config', (req, res) => {
  const userId = req.cookies?.spotify_user_id || currentUserId;
  if (!userId) return res.status(401).json({ error: 'No user' });
  currentUserId = userId;
  const config = getUserConfig(userId);
  res.json(config || { generos: [], excludedArtists: [] });
});

app.post('/config', (req, res) => {
  const userId = req.cookies?.spotify_user_id || currentUserId;
  if (!userId) return res.status(401).json({ error: 'No user' });
  currentUserId = userId;
  const config = req.body;
  if (!config.generos) config.generos = [];
  if (!config.excludedArtists) config.excludedArtists = [];
  saveConfig(userId, config);
  res.json({ success: true, message: '✅ Configuración guardada' });
});

app.get('/playlists', async (req, res) => {
  try {
    const token = req.cookies?.spotify_access_token || currentAccessToken;
    if (!token) return res.status(401).json({ error: 'No token' });
    currentAccessToken = token;
    spotifyApi.setAccessToken(token);
    const data = await spotifyApi.getUserPlaylists({ limit: 100 });
    const playlists = data.body.items.map(p => ({
      name: p.name,
      id: p.id,
      public: p.public,
      tracks: p.tracks.total,
      image: (p.images && p.images.length > 0) ? p.images[0].url : null
    }));
    res.json(playlists);
  } catch (err) {
    console.error('Error obteniendo playlists:', err);
    res.status(500).json({ error: 'Error al obtener playlists' });
  }
});

app.get('/generos', async (req, res) => {
  try {
    if (!currentAccessToken) return res.status(401).json({ error: 'No token' });
    spotifyApi.setAccessToken(currentAccessToken);
    const genres = new Set();
    let after = null;
    while (true) {
      const opts = { limit: 50 };
      if (after) opts.after = after;
      const data = await spotifyApi.getFollowedArtists(opts);
      const artists = data.body.artists.items;
      artists.forEach(a => a.genres.forEach(g => genres.add(g)));
      if (!data.body.artists.next) break;
      after = artists[artists.length - 1].id;
    }
    res.json(Array.from(genres).sort());
  } catch (err) {
    console.error('Error obteniendo géneros:', err);
    res.status(500).json({ error: 'Error al obtener géneros' });
  }
});

app.post('/vaciar-playlist', async (req, res) => {
  const { playlistId } = req.body;
  try {
    if (!currentAccessToken) return res.status(401).json({ error: 'No token' });
    spotifyApi.setAccessToken(currentAccessToken);
    const data = await spotifyApi.getPlaylistTracks(playlistId);
    const uris = data.body.items.map(t => ({ uri: t.track.uri }));
    if (uris.length > 0) await spotifyApi.removeTracksFromPlaylist(playlistId, uris);
    res.json({ success: true, message: '✅ Playlist vaciada' });
  } catch (err) {
    console.error('Error vaciando playlist:', err);
    res.status(500).json({ error: 'Error al vaciar playlist' });
  }
});

function delay(ms) {
  return new Promise(res => setTimeout(res, ms));
}

app.post('/filtrar-y-anadir', async (req, res) => {
  try {
    const { generos, playlistId, excludedArtists = [] } = req.body;
    if (!currentAccessToken) return res.status(401).json({ error: 'No token' });
    if (!generos || !playlistId) return res.status(400).json({ error: 'Faltan datos' });
    
    spotifyApi.setAccessToken(currentAccessToken);
    
    // Obtener artistas seguidos que coincidan con los géneros
    const artistIds = [];
    let after = null;
    while (true) {
      const opts = { limit: 50 };
      if (after) opts.after = after;
      const data = await spotifyApi.getFollowedArtists(opts);
      const artists = data.body.artists.items;
      artists.forEach(a => {
        if (a.genres.some(g => generos.includes(g)) && !excludedArtists.includes(a.id)) {
          artistIds.push(a.id);
        }
      });
      if (!data.body.artists.next) break;
      after = artists[artists.length - 1].id;
    }
    
    // Obtener canciones actuales de la playlist para evitar duplicados
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
    
    const trackUris = new Set();
    const thisWeek = Date.now() - 7 * 24 * 3600 * 1000;
    
    for (const id of artistIds) {
      const releases = await spotifyApi.getArtistAlbums(id, { limit: 5, include_groups: 'single,album' });
      for (const album of releases.body.items) {
        const date = new Date(album.release_date);
        if (date.getTime() >= thisWeek) {
          const tracks = await spotifyApi.getAlbumTracks(album.id);
          tracks.body.items.forEach(t => {
            // Solo añadir si no existe ya en la playlist
            if (!existingTracks.has(t.uri)) {
              trackUris.add(t.uri);
            }
          });
        }
      }
      await delay(300);
    }
    
    const batchSize = 50;
    const uris = Array.from(trackUris);
    let addedCount = 0;
    
    for (let i = 0; i < uris.length; i += batchSize) {
      const batch = uris.slice(i, i + batchSize);
      try {
        await spotifyApi.addTracksToPlaylist(playlistId, batch);
        addedCount += batch.length;
        console.log(`✅ Añadido batch de ${batch.length}`);
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
    
    res.json({ 
      success: true, 
      message: `✅ Añadidas ${addedCount} canciones nuevas (${existingTracks.size} ya existían).` 
    });
  } catch (err) {
    console.error('❌ Error general:', err);
    res.status(500).json({ error: 'Error al añadir canciones' });
  }
});

app.post('/artistas-filtrados', async (req, res) => {
  try {
    const { generos } = req.body;
    if (!currentAccessToken) return res.status(401).json({ error: 'No token' });
    spotifyApi.setAccessToken(currentAccessToken);

    const artists = [];
    let after = null;

    while (true) {
      const opts = { limit: 50 };
      if (after) opts.after = after;
      const data = await spotifyApi.getFollowedArtists(opts);
      const batch = data.body.artists.items;
      batch.forEach(a => {
        if (a.genres.some(g => generos.includes(g))) {
          artists.push({ id: a.id, name: a.name });
        }
      });
      if (!data.body.artists.next) break;
      after = batch[batch.length - 1].id;
    }

    res.json(artists);
  } catch (err) {
    console.error('Error listando artistas filtrados:', err);
    res.status(500).json({ error: 'Error obteniendo artistas' });
  }
});

app.post('/excluir-artista', async (req, res) => {
  try {
    const { artistId, playlistId } = req.body;
    if (!currentAccessToken) return res.status(401).json({ error: 'No token' });
    if (!currentUserId) return res.status(401).json({ error: 'No user' });
    if (!artistId || !playlistId) return res.status(400).json({ error: 'Faltan datos' });
    
    spotifyApi.setAccessToken(currentAccessToken);
    
    // Agregar artista a la lista de excluidos
    const config = getUserConfig(currentUserId);
    if (!config.excludedArtists) config.excludedArtists = [];
    if (!config.excludedArtists.includes(artistId)) {
      config.excludedArtists.push(artistId);
      saveConfig(currentUserId, config);
    }
    
    // Obtener todas las canciones de la playlist
    const tracksToRemove = [];
    let offset = 0;
    
    while (true) {
      const data = await spotifyApi.getPlaylistTracks(playlistId, { offset, limit: 100 });
      
      for (const item of data.body.items) {
        if (item.track && item.track.artists) {
          // Verificar si alguno de los artistas de la canción es el excluido
          const isFromExcludedArtist = item.track.artists.some(a => a.id === artistId);
          if (isFromExcludedArtist) {
            tracksToRemove.push({ uri: item.track.uri });
          }
        }
      }
      
      if (!data.body.next) break;
      offset += 100;
    }
    
    // Eliminar las canciones en lotes de 100 (límite de Spotify)
    if (tracksToRemove.length > 0) {
      for (let i = 0; i < tracksToRemove.length; i += 100) {
        const batch = tracksToRemove.slice(i, i + 100);
        await spotifyApi.removeTracksFromPlaylist(playlistId, batch);
      }
    }
    
    res.json({ 
      success: true, 
      message: `✅ Artista excluido y ${tracksToRemove.length} canciones eliminadas`,
      removedTracks: tracksToRemove.length
    });
  } catch (err) {
    console.error('Error excluyendo artista:', err);
    res.status(500).json({ error: 'Error al excluir artista' });
  }
});

const port = process.env.PORT || 8888;
const host = process.env.HOST || '0.0.0.0';
app.listen(port, host, () => {
  console.log(`Servidor escuchando en http://${host}:${port}`);
});