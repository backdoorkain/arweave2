const express = require('express');
const Arweave = require('arweave');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

const arweave = Arweave.init({
    host: 'arweave.net',
    port: 443,
    protocol: 'https'
});

// Habilitar un límite amplio para procesar los JSONs del cliente
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// --- SOLUCIÓN CRÍTICA ANTI-CACHÉ TOTAL ---
// Obligamos a que ningún navegador ni servidor intermedio guarde copias viejas
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private, max-age=0');
    res.set('Expires', '0');
    res.set('Pragma', 'no-cache');
    next();
});

// Forzamos la lectura física del archivo index.html en cada petición para saltarnos express.static
app.get('/', (req, res) => {
    const htmlPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(htmlPath)) {
        res.sendFile(htmlPath);
    } else {
        res.status(404).send('Archivo index.html no encontrado en la carpeta public.');
    }
});

// El resto de recursos se sirven de forma estática normal
app.use(express.static(path.join(__dirname, 'public')));

// --- RUTA 1: TRANSMITIR TRANSACCIÓN FIRMADA ---
app.post('/api/upload', async (req, res) => {
    try {
        const { transactionData, fileBufferBase64 } = req.body;
        if (!transactionData || !fileBufferBase64) {
            return res.status(400).json({ error: 'Faltan datos de la transacción o el archivo.' });
        }

        const transaction = arweave.transactions.fromRaw(transactionData);
        const fileBuffer = Buffer.from(fileBufferBase64, 'base64');
        transaction.set('data', fileBuffer);

        console.log(`>>> Ensamblando binario: ${fileBuffer.length} bytes. ID: ${transaction.id}`);

        const response = await arweave.transactions.post(transaction);
        console.log(`>>> Respuesta de Arweave Network: Código ${response.status}`);

        if (response.status === 200 || response.status === 202) {
            return res.json({ success: true, txId: transaction.id });
        } else {
            return res.status(500).json({ error: `Arweave rechazó el paquete: ${response.status}` });
        }
    } catch (error) {
        console.error("Error crítico en servidor:", error);
        return res.status(500).json({ error: error.message });
    }
});

// --- RUTA 2: LISTAR ARCHIVOS (GRAPHQL) ---
app.get('/api/files/:address', async (req, res) => {
    try {
        const address = req.params.address;
        if (!address) return res.status(400).json({ error: 'Falta la dirección.' });

        const query = {
            query: `query {
              transactions(
                owners: ["${address}"]
                tags: { name: "App-Name", values: ["MiArweaveUploaderBasico"] }
                first: 50
              ) { edges { node { id tags { name value } } } }
            }`
        };

        const response = await arweave.api.post('/graphql', query);
        const edges = response.data.data.transactions.edges;

        const files = edges.map(edge => {
            const tags = edge.node.tags;
            const nameTag = tags.find(t => t.name === 'File-Name');
            const typeTag = tags.find(t => t.name === 'Content-Type');
            const txId = edge.node.id;
            
            return {
                id: txId,
                name: nameTag ? nameTag.value : 'Archivo sin nombre',
                type: typeTag ? typeTag.value : 'Desconocido',
                url: "https://arweave.net" + txId,
                txUrl: "https://viewblock.io" + txId
            };
        });

        res.json({ success: true, files });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// --- RUTA 3: CONSULTAR PRECIO ---
app.get('/api/price/:bytes', async (req, res) => {
    try {
        const bytes = parseInt(req.params.bytes);
        const winstonPrice = await arweave.transactions.getPrice(bytes);
        const arPrice = arweave.ar.winstonToAr(winstonPrice);
        res.json({ success: true, ar: arPrice });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.listen(PORT, () => {
    console.log(`Servidor con bypass de caché corriendo en el puerto ${PORT}`);
});
