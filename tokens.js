// ----------------------------------------
// --- tokens.js ---
// ----------------------------------------
const fs = require('fs').promises;
const path = require('path');
const TOKEN_FILE = path.join(__dirname, 'tokens.json');

// Carga todos los tokens del archivo JSON
async function loadAllTokens() {
    try {
        const data = await fs.readFile(TOKEN_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') return {};
        console.error('Error al cargar tokens:', error);
        return {};
    }
}

// Guarda o actualiza los tokens de un usuario específico
async function saveUserTokens(userId, accessToken, refreshToken) {
    const allTokens = await loadAllTokens();
    allTokens[userId] = { 
        accessToken: accessToken, 
        refreshToken: refreshToken,
        // Almacenamiento en caché del token de acceso (opcional)
        expiresAt: Date.now() + 3600000 
    };
    try {
        // Guarda en disco
        await fs.writeFile(TOKEN_FILE, JSON.stringify(allTokens, null, 2));
    } catch (error) {
        console.error('Error al guardar tokens:', error);
    }
}

// Carga los tokens de un usuario específico (no usado por el nuevo middleware, pero útil)
async function loadUserTokens(userId) {
    const allTokens = await loadAllTokens();
    return allTokens[userId] || null;
}

module.exports = {
    saveUserTokens,
    loadUserTokens
};