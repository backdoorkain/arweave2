const express = require('express');
const multer = require('multer');
const Arweave = require('arweave');
const fs = require('fs');
const path = require('path');

const app = express();
const upload = multer({ dest: 'uploads/' });
const PORT = process.env.PORT || 3000;

// Inicializar Arweave apuntando a la Mainnet oficial
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

// --- RUTA 1 REPARADA: SUBIR ARCHIVO CON MULTIPLICADOR DE RECOMPENSA (INCENTIVO) ---
app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No se envió ningún archivo.' });
        if (!wallet) return res.status(500).json({ error: 'Billetera no configurada.' });

        const fileData = fs.readFileSync(path.resolve(req.file.path));
        const dataBuffer = Buffer.from(fileData);
        
        const byteSize = dataBuffer.length;
        
        // 1. Obtener el precio base en Winston
        const basePriceInWinston = await arweave.transactions.getPrice(byteSize);
        
        // 2. INCENTIVO DE VELOCIDAD: Multiplicamos el costo por 1.4 usando BigInt para no perder precisión
        // Esto le da prioridad máxima ante los mineros por fracciones insignificantes de centavo
        const boostedReward = (BigInt(basePriceInWinston) * 14n / 10n).toString();

        console.log(`>>> Tamaño: ${byteSize} bytes. Recompensa base: ${basePriceInWinston}. Recompensa con incentivo: ${boostedReward}`);

        // 3. Crear la transacción asignando el incentivo
        const transaction = await arweave.createTransaction({ 
            data: dataBuffer,
            reward: boostedReward // <-- EVITA QUE LA TRANSACCIÓN SE QUEDE CONGELADA
        }, wallet);
        
        transaction.addTag('Content-Type', req.file.mimetype);
        transaction.addTag('App-Name', 'MiArweaveUploaderBasico');
        transaction.addTag('File-Name', req.file.originalname);

        await arweave.transactions.sign(transaction, wallet);
        
        // 4. Enviar los datos al gateway de Mainnet
        const response = await arweave.transactions.post(transaction);

        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

        console.log(`>>> Respuesta del nodo validador de Arweave: Código ${response.status}`);

        // Los nodos aceptan de inmediato la transacción con códigos 200 o 202
        if (response.status === 200 || response.status === 202) {
            return res.json({ success: true, txId: transaction.id });
        } else {
            return res.status(500).json({ error: `Arweave rechazó la firma con código: ${response.status}` });
        }
    } catch (error) {
        console.error("Error crítico durante el envío:", error);
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

// --- RUTA 4: CONSULTAR PRECIO DE RED NATIVO ---
app.get('/api/price/:bytes', async (req, res) => {
    try {
        const bytes = parseInt(req.params.bytes);
        if (isNaN(bytes) || bytes <= 0) return res.status(400).json({ error: 'Bytes inválidos.' });

        const winstonPrice = await arweave.transactions.getPrice(bytes);
        const arPrice = arweave.ar.winstonToAr(winstonPrice);
        
        res.json({ success: true, ar: arPrice });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor Raw corriendo en el puerto ${PORT}`);
});

