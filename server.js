// ============================================================
//  Font Manager — Express.js Server (Supabase Storage)
//  All fonts are stored in Supabase — no local fonts/ folder.
// ============================================================

const express    = require('express');
const path       = require('path');
const multer     = require('multer');
const { createClient } = require('@supabase/supabase-js');

// ────────────────────────────────────────────────────────────
//  Configuration
// ────────────────────────────────────────────────────────────

const PORT             = process.env.PORT || 3000;
const UPLOAD_PASSWORD  = process.env.UPLOAD_PASSWORD || '12345';
const SUPABASE_URL     = process.env.SUPABASE_URL     || 'https://pvxkmtajktghggwettjl.supabase.co';
const SUPABASE_KEY     = process.env.SUPABASE_KEY     || 'sb_publishable_Qc8A0r926ucy2FX70JXaLQ__DMGUbUs';
const BUCKET           = process.env.SUPABASE_BUCKET  || 'fonts';

const ALLOWED_EXTENSIONS = ['.ttf', '.otf', '.woff', '.woff2'];

const MIME_TYPES = {
  '.ttf':   'font/ttf',
  '.otf':   'font/otf',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
};

// ────────────────────────────────────────────────────────────
//  Supabase Client
// ────────────────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ────────────────────────────────────────────────────────────
//  Multer — memory storage (buffer → Supabase, no local disk)
// ────────────────────────────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return cb(new Error(`"${ext}" not allowed. Accepted: ${ALLOWED_EXTENSIONS.join(', ')}`), false);
    }
    cb(null, true);
  },
});

// ────────────────────────────────────────────────────────────
//  Utility — Format bytes
// ────────────────────────────────────────────────────────────

function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  return i === 0 ? `${size} ${units[i]}` : `${size.toFixed(1)} ${units[i]}`;
}

// ────────────────────────────────────────────────────────────
//  Utility — List fonts from Supabase Storage
//  Handles pagination — Supabase returns max 1000 per call.
// ────────────────────────────────────────────────────────────

async function getFontList() {
  try {
    let allFiles = [];
    let offset   = 0;
    const limit  = 1000;

    // Page through the bucket until we have everything
    while (true) {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .list('', { limit, offset, sortBy: { column: 'name', order: 'asc' } });

      if (error) throw error;
      if (!data || data.length === 0) break;

      allFiles = allFiles.concat(data);
      if (data.length < limit) break; // last page
      offset += limit;
    }

    // Filter to allowed font extensions only
    const fontFiles = allFiles.filter(file => {
      const ext = path.extname(file.name).toLowerCase();
      return ALLOWED_EXTENSIONS.includes(ext);
    });

    // Build public URL + metadata for each font
    const fonts = fontFiles.map(file => {
      const ext      = path.extname(file.name).toLowerCase();
      const rawName  = path.basename(file.name, path.extname(file.name));
      const cleanName = rawName
        .replace(/[_]/g, ' ')
        .replace(/[-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      // Get the public URL from Supabase
      const { data: urlData } = supabase.storage
        .from(BUCKET)
        .getPublicUrl(file.name);

      return {
        name:      cleanName,
        fileName:  file.name,
        extension: ext.slice(1),
        size:      formatFileSize(file.metadata?.size),
        sizeBytes: file.metadata?.size || 0,
        url:       urlData.publicUrl,   // direct Supabase public URL
      };
    });

    // Sort alphabetically
    fonts.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

    return fonts;
  } catch (err) {
    console.error('❌ Supabase list error:', err.message);
    return [];
  }
}

// ────────────────────────────────────────────────────────────
//  Express App
// ────────────────────────────────────────────────────────────

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (_req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Logger
app.use((req, _res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}]  ${req.method}  ${req.url}`);
  next();
});

// Serve static front-end files
app.use(express.static(__dirname, { index: false }));

// ────────────────────────────────────────────────────────────
//  Pages
// ────────────────────────────────────────────────────────────

app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/upload', (_req, res) => res.sendFile(path.join(__dirname, 'upload.html')));

// ────────────────────────────────────────────────────────────
//  API — List fonts
// ────────────────────────────────────────────────────────────

app.get('/api/fonts', async (req, res) => {
  try {
    let fonts = await getFontList();
    if ((req.query.sort || '').toLowerCase() === 'desc') fonts.reverse();
    res.json({ success: true, fonts, count: fonts.length });
  } catch (err) {
    console.error('❌ /api/fonts:', err.message);
    res.status(500).json({ success: false, message: 'Failed to retrieve font list' });
  }
});

// ────────────────────────────────────────────────────────────
//  API — Download (proxy from Supabase → client)
// ────────────────────────────────────────────────────────────

app.get('/api/fonts/download/:filename', async (req, res) => {
  try {
    const fileName = req.params.filename;

    // Download the file buffer from Supabase
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .download(fileName);

    if (error) {
      return res.status(404).json({ success: false, message: 'Font not found' });
    }

    const ext = path.extname(fileName).toLowerCase();
    const buffer = Buffer.from(await data.arrayBuffer());

    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) {
    console.error('❌ Download error:', err.message);
    res.status(500).json({ success: false, message: 'Download failed' });
  }
});

// ────────────────────────────────────────────────────────────
//  API — Verify password
// ────────────────────────────────────────────────────────────

app.post('/api/verify-password', (req, res) => {
  const { password } = req.body;
  res.json({ success: password === UPLOAD_PASSWORD });
});

// ────────────────────────────────────────────────────────────
//  API — Upload fonts to Supabase Storage
// ────────────────────────────────────────────────────────────

app.post('/api/upload', upload.array('fonts'), async (req, res) => {
  // Password check
  const { password } = req.body;
  if (password !== UPLOAD_PASSWORD) {
    return res.status(401).json({ success: false, message: 'Wrong Password' });
  }

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ success: false, message: 'No files received' });
  }

  const uploaded   = [];
  const duplicates = [];
  const errors     = [];

  // Upload each file to Supabase Storage
  for (const file of req.files) {
    const ext      = path.extname(file.originalname).toLowerCase();
    const fileName = file.originalname;

    try {
      // Check if file already exists
      const { data: existing } = await supabase.storage
        .from(BUCKET)
        .list('', { search: fileName });

      const alreadyExists = existing && existing.some(f => f.name === fileName);

      if (alreadyExists) {
        duplicates.push(fileName);
        continue;
      }

      // Upload buffer to Supabase
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(fileName, file.buffer, {
          contentType: MIME_TYPES[ext] || 'application/octet-stream',
          upsert: false,
        });

      if (uploadError) {
        // If it's a duplicate (already exists error from Supabase)
        if (uploadError.message?.includes('already exists')) {
          duplicates.push(fileName);
        } else {
          errors.push(fileName);
          console.error(`❌ Upload failed for ${fileName}:`, uploadError.message);
        }
      } else {
        uploaded.push(fileName);
      }
    } catch (err) {
      errors.push(fileName);
      console.error(`❌ Error uploading ${fileName}:`, err.message);
    }
  }

  console.log(`✅ Uploaded ${uploaded.length} font(s)`);
  if (duplicates.length) console.log(`⚠️  Skipped ${duplicates.length} duplicate(s)`);

  res.json({
    success:    true,
    message:    'Upload complete',
    uploaded,
    duplicates,
    errors,
  });
});

// ────────────────────────────────────────────────────────────
//  Global error handler
// ────────────────────────────────────────────────────────────

app.use((err, _req, res, _next) => {
  console.error('💥 Unhandled error:', err.message);
  res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

// ────────────────────────────────────────────────────────────
//  Start
// ────────────────────────────────────────────────────────────

process.on('uncaughtException',  (err)    => console.error('💥 Uncaught:', err.message));
process.on('unhandledRejection', (reason) => console.error('💥 Rejection:', reason));

(async () => {
  // Verify Supabase connection on startup
  const fonts = await getFontList();
  console.log(`📦 Supabase bucket "${BUCKET}": ${fonts.length} font(s) found.`);

  app.listen(PORT, () => {
    console.log('');
    console.log('─────────────────────────────────────────');
    console.log(`  🚀  Font Manager running at:`);
    console.log(`       http://localhost:${PORT}`);
    console.log(`  ☁️   Storage: Supabase (${BUCKET})`);
    console.log('─────────────────────────────────────────');
    console.log('');
  });
})();
