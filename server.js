const express = require('express');
const multer = require('multer');
const Arweave = require('arweave');
const fs = require('fs');
const path = require('path');

const app = express();
const upload = multer({ dest: 'uploads/' }); // Carpeta temporal para recibir archivos
const PORT = process.env.PORT || 3000;

// 1. Inicializar Arweave apuntando a la Mainnet oficial
const arweave = Arweave.init({
    host: 'arweave.net',
    port: 443,
    protocol: 'https'
});

// 2. Cargar tu billetera real (¡Solo localmente, excluida en .gitignore!)
let wallet;
try {
    const walletPath = path.join(__dirname, 'wallet.json');
    wallet = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
    
    // Obtener y mostrar la dirección en consola para confirmar la conexión
    arweave.wallets.jwkToAddress(wallet).then(address => {
        console.log(`>>> Conectado exitosamente a Mainnet con la dirección: ${address}`);
    });
} catch (error) {
    console.error(">>> ERROR: No se encontró el archivo wallet.json en la raíz o es inválido.");
}

// Servir archivos estáticos del frontend (HTML/JS)
app.use(express.static('public'));

app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
