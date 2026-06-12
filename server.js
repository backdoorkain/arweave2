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
