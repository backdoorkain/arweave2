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

// SEGURIDAD MÁXIMA: Ya no cargamos claves privadas, variables de entorno ni JWK en el servidor

app.use(express.json({ limit: '50mb' })); // Permitimos JSONs grandes para transferir las firmas de archivos
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- RUTA 1 REESTRUCTURADA: TRANSMITIR TRANSACCIÓN YA FIRMADA POR EL FRONTEND ---
app.post('/api/upload', async (req, res) => {
    try {
        const { transactionData } = req.body;
        if (!transactionData) {
            return res.status(400).json({ error: 'No se recibió ninguna estructura de transacción.' });
        }

        // 1. Reconstruir el objeto de la transacción firmado a partir de los datos recibidos del cliente
        const transaction = arweave.transactions.fromRaw(transactionData);

        // 2. Transmitir de forma segura los bytes ya firmados al gateway oficial de Arweave
        const response = await arweave.transactions.post(transaction);

        console.log(`>>> Transacción transmitida al nodo. Código de respuesta de red: ${response.status}`);

        if (response.status === 200 || response.status === 202) {
            return res.json({ success: true, txId: transaction.id });
        } else {
            return res.status(500).json({ error: `La red Arweave rechazó los bytes con código: ${response.status}` });
        }
    } catch (error) {
        console.error("Error crítico durante la transmisión:", error);
        return res.status(500).json({ error: error.message });
    }
});

// --- RUTA 2: LISTAR ARCHIVOS MEDIANTE DIRECCIÓN PÚBLICA DEL CLIENTE ---
app.get('/api/files/:address', async (req, res) => {
    try {
        const address = req.params.address;
        if (!address) return res.status(400).json({ error: 'Falta la dirección del usuario.' });

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

// --- RUTA 3: CONSULTAR PRECIO DE RED NATIVO ---
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
    console.log(`Servidor de Transmisión Abierto en el puerto ${PORT}`);
});
