const express = require('express');
const Arweave = require('arweave');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Inicializar Arweave apuntando a la Mainnet oficial
const arweave = Arweave.init({
    host: 'arweave.net',
    port: 443,
    protocol: 'https'
});

// Habilitar un límite amplio para procesar archivos Base64 pesados en el cuerpo JSON
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- RUTA 1 RECONSTRUIDA: ENSAMBLAR BYTES Y TRANSMITIR TRANSACCIÓN ---
app.post('/api/upload', async (req, res) => {
    try {
        const { transactionData, fileBufferBase64 } = req.body;
        
        if (!transactionData || !fileBufferBase64) {
            return res.status(400).json({ error: 'Faltan datos de la transacción o el archivo.' });
        }

        // 1. Reconstruir el objeto base enviado por la extensión Wander
        const transaction = arweave.transactions.fromRaw(transactionData);

        // 2. Decodificar el string Base64 recibido del cliente a un Buffer binario real
        const fileBuffer = Buffer.from(fileBufferBase64, 'base64');

        // 3. Inyectar de forma directa los bytes físicos dentro de la estructura de datos
        transaction.set('data', fileBuffer);

        console.log(`>>> Ensamblando archivo. Tamaño binario: ${fileBuffer.length} bytes. Transacción: ${transaction.id}`);

        // 4. Transmitir el paquete unificado de firmas y datos a la blockchain de Arweave
        const response = await arweave.transactions.post(transaction);

        console.log(`>>> Estado de la transmisión en la blockchain: Código ${response.status}`);

        if (response.status === 200 || response.status === 202) {
            return res.json({ success: true, txId: transaction.id });
        } else {
            return res.status(500).json({ error: `La red Arweave rechazó el paquete con código: ${response.status}` });
        }
    } catch (error) {
        console.error("Error crítico durante el ensamblaje en el servidor:", error);
        return res.status(500).json({ error: error.message });
    }
});

// --- RUTA 2: LISTAR ARCHIVOS POR GRAPHQL MEDIANTE DIRECCIÓN DEL CLIENTE ---
app.get('/api/files/:address', async (req, res) => {
    try {
        const address = req.params.address;
        if (!address) return res.status(400).json({ error: 'Falta la dirección pública.' });

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
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- RUTA 3: CONSULTAR PRECIO DE RED OFICIAL ---
app.get('/api/price/:bytes', async (req, res) => {
    try {
        const bytes = parseInt(req.params.bytes);
        const winstonPrice = await arweave.transactions.getPrice(bytes);
        const arPrice = arweave.ar.winstonToAr(winstonPrice);
        res.json({ success: true, ar: arPrice });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor Puente de Wander operativo en el puerto ${PORT}`);
});
