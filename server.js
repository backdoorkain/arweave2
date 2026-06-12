const express = require('express');
const multer = require('multer');
const Arweave = require('arweave');
const fs = require('fs');
const path = require('path');

const app = express();
const upload = multer({ dest: 'uploads/' }); // Almacenamiento temporal en el servidor
const PORT = process.env.PORT || 3000;

// Inicializar Arweave apuntando a la Mainnet
const arweave = Arweave.init({
    host: 'arweave.net',
    port: 443,
    protocol: 'https'
});

// Cargar billetera de manera 100% segura mediante variable de entorno
let wallet;
let walletAddress = "";

try {
    if (process.env.ARWEAVE_WALLET) {
        // Formato estándar para producción (Render) y desarrollo seguro local
        wallet = JSON.parse(process.env.ARWEAVE_WALLET);
        
        arweave.wallets.jwkToAddress(wallet).then(address => {
            walletAddress = address;
            console.log(`>>> Conectado exitosamente. Dirección: ${address}`);
        });
    } else {
        console.error(">>> ERROR DE SEGURIDAD: Define la variable de entorno ARWEAVE_WALLET con el contenido de tu JSON.");
    }
} catch (error) {
    console.error(">>> ERROR: El formato del JSON en la variable ARWEAVE_WALLET es inválido.");
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

// --- NUEVA RUTA 1 CORREGIDA: SUBIR ARCHIVO ---
app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No se envió ningún archivo.' });
        if (!wallet) return res.status(500).json({ error: 'Billetera no configurada.' });

        // Forzar la lectura explícita como un Buffer de Node.js
        const fileData = fs.readFileSync(path.resolve(req.file.path));
        const dataBuffer = Buffer.from(fileData);
        
        // Crear la transacción envolviendo el buffer explícitamente
        const transaction = await arweave.createTransaction({ 
            data: dataBuffer 
        }, wallet);
        
        // Etiquetas optimizadas para compatibilidad nativa en Mainnet
        transaction.addTag('Content-Type', req.file.mimetype);
        transaction.addTag('App-Name', 'MiArweaveUploaderBasico');
        transaction.addTag('File-Name', req.file.originalname);
        transaction.addTag('Data-Protocol', 'Binary');

        // Firmar la transacción con tu JWK segura
        await arweave.transactions.sign(transaction, wallet);
        
        // Enviar al nodo de producción
        const response = await arweave.transactions.post(transaction);

        // Limpieza obligatoria del almacenamiento temporal en Render
        if (fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        if (response.status === 200 || response.status === 202) {
            return res.json({ 
                success: true, 
                txId: transaction.id,
                message: "Archivo enviado a Mainnet con éxito."
            });
        } else {
            return res.status(500).json({ error: `Error en red Arweave: Código ${response.status}` });
        }
    } catch (error) {
        console.error("Detalle del error en consola:", error);
        // Asegurar limpieza incluso si el proceso falla a mitad
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        return res.status(500).json({ error: error.message });
    }
});

// --- LISTAR ARCHIVOS (GraphQL) ---
// --- RUTA 3: CONSULTAR BALANCE GENERAL DE LA WALLET EN ARWEAVE ---
app.get('/api/balance', async (req, res) => {
    try {
        if (!walletAddress) {
            // Reutilizamos el walletAddress que calcula tu servidor al arrancar
            return res.status(500).json({ error: 'Dirección de billetera no lista.' });
        }
        // Consultar el saldo directo en la unidad mínima Winston
        const winstonBalance = await arweave.wallets.getBalance(walletAddress);
        // Convertirlo a un formato legible de tokens AR
        const arBalance = arweave.ar.winstonToAr(winstonBalance);
        
        res.json({ success: true, balance: arBalance });
    } catch (error) {
        console.error("Error al consultar balance general:", error);
        res.status(500).json({ error: error.message });
    }
});

// --- RUTA 4: CONSULTAR PRECIO OFICIAL DE LA BLOCKCHAIN POR BYTES ---
app.get('/api/price/:bytes', async (req, res) => {
    try {
        const bytes = req.params.bytes;
        if (!bytes || isNaN(bytes)) {
            return res.status(400).json({ error: 'Cantidad de bytes inválida.' });
        }
        
        // Petición directa al endpoint oficial de precios de la red principal
        const response = await fetch(`https://arweave.net{bytes}`);
        const winstonPrice = await response.text();
        
        // Convertir el costo de Winston a AR utilizando el conversor del SDK
        const arPrice = arweave.ar.winstonToAr(winstonPrice);
        
        res.json({ 
            success: true, 
            winston: winstonPrice, 
            ar: arPrice 
        });
    } catch (error) {
        console.error("Error al calcular precio de red:", error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
