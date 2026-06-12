const express = require('express');
const multer = require('multer');
const Arweave = require('arweave');
const fs = require('fs');
const path = require('path');

const app = express();
const upload = multer({ dest: 'uploads/' });
const PORT = process.env.PORT || 3000;

const arweave = Arweave.init({
    host: 'arweave.net',
    port: 443,
    protocol: 'https'
});

let wallet;
let walletAddress = "";

try {
    if (process.env.ARWEAVE_WALLET) {
        wallet = JSON.parse(process.env.ARWEAVE_WALLET);
        arweave.wallets.jwkToAddress(wallet).then(address => {
            walletAddress = address;
            console.log(`>>> Conectado a Arweave Raw. Dirección: ${address}`);
        });
    } else {
        console.error(">>> ERROR: Configura la variable ARWEAVE_WALLET en Render.");
    }
} catch (error) {
    console.error(">>> ERROR: Formato de billetera inválido.");
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- RUTA 1: SUBIR ARCHIVO RAW ---
app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No se envió ningún archivo.' });
        if (!wallet) return res.status(500).json({ error: 'Billetera no configurada.' });

        const fileData = fs.readFileSync(path.resolve(req.file.path));
        const dataBuffer = Buffer.from(fileData);
        
        const byteSize = dataBuffer.length;
        const priceInWinston = await arweave.transactions.getPrice(byteSize);

        const transaction = await arweave.createTransaction({ 
            data: dataBuffer,
            reward: priceInWinston
        }, wallet);
        
        transaction.addTag('Content-Type', req.file.mimetype);
        transaction.addTag('App-Name', 'MiArweaveUploaderBasico');
        transaction.addTag('File-Name', req.file.originalname);

        await arweave.transactions.sign(transaction, wallet);
        const response = await arweave.transactions.post(transaction);

        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

        if (response.status === 200 || response.status === 202) {
            return res.json({ success: true, txId: transaction.id });
        } else {
            return res.status(500).json({ error: `Error Arweave: ${response.status}` });
        }
    } catch (error) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(500).json({ error: error.message });
    }
});

// --- RUTA 2: LISTAR ARCHIVOS ---
app.get('/api/files', async (req, res) => {
    try {
        if (!walletAddress) return res.status(500).json({ error: 'Billetera no lista.' });

        const query = {
            query: `query {
              transactions(
                owners: ["${walletAddress}"]
                tags: { name: "App-Name", values: ["MiArweaveUploaderBasico"] }
                first: 50
              ) {
                edges { node { id tags { name value } } }
              }
            }`
        };

        const response = await arweave.api.post('/graphql', query);
        const edges = response.data.data.transactions.edges;

        const files = edges.map(edge => {
            const tags = edge.node.tags;
            const nameTag = tags.find(t => t.name === 'File-Name');
            const typeTag = tags.find(t => t.name === 'Content-Type');
            return {
                id: edge.node.id,
                name: nameTag ? nameTag.value : 'Archivo sin nombre',
                type: typeTag ? typeTag.value : 'Desconocido',
                url: `https://arweave.net{edge.node.id}`
            };
        });

        res.json({ success: true, files });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- RUTA 3: CONSULTAR BALANCE ---
app.get('/api/balance', async (req, res) => {
    try {
        if (!walletAddress) return res.status(500).json({ error: 'Dirección no lista.' });
        const winstonBalance = await arweave.wallets.getBalance(walletAddress);
        const arBalance = arweave.ar.winstonToAr(winstonBalance);
        res.json({ success: true, balance: arBalance });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- RUTA 4 REPARADA: CONCATENACIÓN CORRECTA DE LA URL ---
app.get('/api/price/:bytes', async (req, res) => {
    try {
        const bytes = req.params.bytes;
        
        // CORRECCIÓN TÉCNICA: Usamos comillas invertidas y la sintaxis template string correcta
        const response = await fetch(`https://arweave.net{bytes}`);
        const winstonPriceText = await response.text();

        const arPrice = arweave.ar.winstonToAr(winstonPriceText.trim());
        res.json({ success: true, ar: arPrice });
    } catch (error) {
        console.error("Error al calcular precio en backend:", error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor Raw corriendo en el puerto ${PORT}`);
});
