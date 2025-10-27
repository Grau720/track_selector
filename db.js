const fs = require('fs/promises');
const path = require('path');

// Nombre del archivo de datos donde guardamos la configuración de todos los usuarios
const DB_FILE = path.join(__dirname, 'db_data.json'); 

/**
 * Carga todos los datos de la "base de datos" (el archivo JSON)
 * @returns {Promise<Object>} Un objeto con todos los datos.
 */
async function loadData() {
    try {
        const data = await fs.readFile(DB_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        // Si el archivo no existe o falla la lectura, devolver una estructura vacía
        if (error.code === 'ENOENT') {
            console.log('DB file not found, initializing empty data.');
            return { users: {} };
        }
        throw error;
    }
}

/**
 * Guarda los datos en el archivo JSON.
 * @param {Object} data - Los datos completos a guardar.
 */
async function saveData(data) {
    await fs.writeFile(DB_FILE, JSON.stringify(data, null, 2));
}


// ----------------------------------------
// --- Funciones requeridas por index.js ---
// ----------------------------------------

/**
 * Obtiene la configuración de un usuario.
 * @param {string} userId - ID del usuario de Spotify.
 * @returns {Promise<Object>} La configuración del usuario.
 */
async function getConfig(userId) {
    const data = await loadData();
    // Devolver la configuración existente o un objeto vacío por defecto
    return data.users[userId]?.config || { 
        generos: [], 
        excludedArtists: [], 
        playlistId: null,
        favoriteArtists: []
    };
}

/**
 * Guarda la configuración completa de un usuario.
 * @param {string} userId - ID del usuario de Spotify.
 * @param {Object} config - El objeto de configuración a guardar.
 */
async function saveConfig(userId, config) {
    const data = await loadData();
    if (!data.users[userId]) {
        data.users[userId] = {};
    }
    data.users[userId].config = config;
    await saveData(data);
}

// Aquí puedes añadir más funciones como getFavoriteArtists, etc., cuando las necesites.

// Exportar las funciones para que index.js pueda usarlas
module.exports = {
    getConfig,
    saveConfig,
    // ... (otras funciones que index.js necesita)
};