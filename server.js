const express = require('express');
const Arweave = require('arweave');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Inicializar Arweave apuntando a la Mainnet oficial
const arweave = Arweave.init({
    host: 'arweave.net',
    port: 443,
    protocol: 'https'
});

// Habilitar límites amplios para procesar paquetes JSON con archivos Base64 del cliente
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Forzar la deshabilitación de la caché en el navegador y servidores intermedios
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private, max-age=0');
    res.set('Expires', '0');
    res.set('Pragma', 'no-cache');
    next();
});

// Cargar index.html físicamente en la raíz
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

// --- RUTA 1: TRANSMITIR TRANSACCIÓN PRE-FIRMADA DESDE FRONTEND ---
app.post('/api/upload', async (req, res) => {
    try {
        const { transactionData, fileBufferBase64 } = req.body;
        if (!transactionData || !fileBufferBase64) {
            return res.status(400).json({ error: 'Faltan datos de la transacción o el archivo.' });
        }

        // Reconstruir la estructura de la transacción generada y firmada en el cliente
        const transaction = arweave.transactions.fromRaw(transactionData);
        
        // Convertir los datos Base64 devueltos en el Buffer binario final
        const fileBuffer = Buffer.from(fileBufferBase64, 'base64');
        transaction.data = fileBuffer;

        console.log(`>>> Ensamblado binario completado: ${fileBuffer.length} bytes. ID TX: ${transaction.id}`);
        
        // Publicar la transacción firmada a la red de Arweave
        const response = await arweave.transactions.post(transaction);
        console.log(`>>> Respuesta de Arweave Network: Código ${response.status}`);

        if (response.status === 200 || response.status === 202) {
            return res.json({ success: true, txId: transaction.id });
        } else {
            return res.status(500).json({ error: `Arweave rechazó el paquete. Status: ${response.status}` });
        }
    } catch (error) {
        console.error("Error crítico en el backend de subida:", error);
        return res.status(500).json({ error: error.message });
    }
});

// --- RUTA 2: LISTAR ARCHIVOS POR DIRECCIÓN DINÁMICA (GRAPHQL) ---
app.get('/api/files/:address', async (req, res) => {
    try {
        const { address } = req.params;
        if (!address) return res.status(400).json({ error: 'Falta la dirección de la billetera.' });

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
                url: "https://arweave.net/" + txId,
                txUrl: "https://viewblock.io/arweave/tx/" + txId
            };
        });

        res.json({ success: true, files });
    } catch (error) { 
        res.status(500).json({ error: error.message }); 
    }
});

// --- RUTA 3: CONSULTAR BALANCE DE UNA DIRECCIÓN DINÁMICA ---
app.get('/api/balance/:address', async (req, res) => {
    try {
        const { address } = req.params;
        if (!address) return res.status(400).json({ error: 'Dirección requerida.' });

        const winstonBalance = await arweave.wallets.getBalance(address);
        const arBalance = arweave.ar.winstonToAr(winstonBalance);
        res.json({ success: true, balance: arBalance });
    } catch (error) { 
        res.status(500).json({ error: error.message }); 
    }
});

// --- RUTA 4: CONSULTAR PRECIO ESTIMADO POR BYTES ---
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
    console.log(`Servidor Unificado corriendo en el puerto ${PORT}`);
});
