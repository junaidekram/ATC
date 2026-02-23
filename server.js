import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Middleware
app.use(express.json({ limit: '10mb' }));

// Enable CORS for local development
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// POST endpoint to save taxiways
app.post('/api/save-taxiways', (req, res) => {
  try {
    console.log('[Taxiway Save] POST request received');
    
    const payload = req.body;
    
    // Validate payload has required fields
    if (!payload.taxiways || !Array.isArray(payload.taxiways)) {
      return res.status(400).json({ error: 'Invalid payload: missing taxiways array' });
    }
    
    const outPath = path.join(__dirname, 'data', 'custom_taxiways.json');
    const jsonStr = JSON.stringify(payload, null, 2);
    
    // Create data directory if it doesn't exist
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    // Write the file
    fs.writeFileSync(outPath, jsonStr, 'utf-8');
    
    console.log(`[Taxiway Save] Saved ${payload.taxiways.length} taxiways to ${outPath}`);
    
    res.json({
      ok: true,
      message: `Saved ${payload.taxiways.length} taxiways and ${payload.graph_edges?.length || 0} edges`
    });
  } catch (err) {
    console.error('[Taxiway Save] Error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`\n✅ ATC Backend Server running on http://localhost:${PORT}`);
  console.log(`📁 Data will be saved to: ${path.join(__dirname, 'data')}`);
  console.log('');
});
