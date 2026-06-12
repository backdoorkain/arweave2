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

// Cargar billetera real (Soporta archivo local o Variable de Entorno para Render)
let wallet;
let walletAddress = "";

try {
    if (process.env.ARWEAVE_WALLET) {
        // En Render leerá el JSON desde una variable de entorno
        wallet = JSON.parse(process.env.ARWEAVE_WALLET);
    } else {
        // En local leerá el archivo físico
        const walletPath = path.join(__dirname, 'wallet.json');
        wallet = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
    }
    
    arweave.wallets.jwkToAddress(wallet).then(address => {
        walletAddress = address;
        console.log(`>>> Conectado exitosamente. Dirección: ${address}`);
    });
} catch (error) {
    console.error(">>> ERROR: Configura tu wallet.json localmente o ARWEAVE_WALLET en producción.");
}

app.use(express.use ? express.json() : express.json()); // Middleware para JSON
app.use(express.static('public'));

// --- RUTA 1: SUBIR ARCHIVO ---
app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No se envió ningún archivo.' });
        if (!wallet) return res.status(500).json({ error: 'Billetera no configurada.' });

        // Leer los datos binarios del archivo temporal
        const fileData = fs.readFileSync(req.file.path);
        
        // Crear la transacción de datos en Arweave
        const transaction = await arweave.createTransaction({ data: fileData }, wallet);
        
        // Agregar etiquetas (Tags) para identificar el tipo de archivo y poder listarlo después
        transaction.addTag('Content-Type', req.file.mimetype);
        transaction.addTag('App-Name', 'MiArweaveUploaderBasico');
        transaction.addTag('File-Name', req.file.originalname);

        // Firmar y enviar la transacción
        await arweave.transactions.sign(transaction, wallet);
        const response = await arweave.transactions.post(transaction);

        // Borrar el archivo temporal del servidor Express inmediatamente
        fs.unlinkSync(req.file.path);

        if (response.status === 200 || response.status === 202) {
            return res.json({ 
                success: true, 
                txId: transaction.id,
                message: "Archivo enviado a Mainnet. Puede tardar unos minutos en confirmarse."
            });
        } else {
            return res.status(500).json({ error: `Error en red Arweave: Código ${response.status}` });
        }
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: error.message });
    }
});

// --- RUTA 2: LISTAR ARCHIVOS (GraphQL) ---
app.get('/api/files', async (req, res) => {
    try {
        if (!walletAddress) return res.status(500).json({ error: 'Dirección de billetera no lista.' });

        // Consulta GraphQL oficial para buscar transacciones de tu billetera con la etiqueta de nuestra App
        const query = {
            query: `
            query {
              transactions(
                owners: ["${walletAddress}"]
                tags: { name: "App-Name", values: ["MiArweaveUploaderBasico"] }
                first: 50
              ) {
                edges {
                  node {
                    id
                    tags {
                      name
                      value
                    }
                  }
                }
              }
            }`
        };

        const response = await arweave.api.post('/graphql', query);
        const edges = response.data.data.transactions.edges;

        // Formatear los resultados para el frontend
        const files = edges.map(edge => {
            const tags = edge.node.tags;
            const nameTag = tags.find(t => t.name === 'File-Name');
            const typeTag = tags.find(t => t.name === 'Content-Type');
            
            return {
                id: edge.node.id,
                name: nameTag ? nameTag.value : 'Archivo sin nombre',
                type: typeTag ? typeTag.value : 'Desconocido',
                url: `https://arweave.net{edge.node.id}` // La descarga es directa desde el gateway de Arweave
            };
        });

        res.json({ success: true, files });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
