// ============================================================
//  Font Manager — Express.js Server
//  Supabase Storage backend (bucket: "fonts")
// ============================================================

// Load .env file if present (ignored in production where env vars are set directly)
try { require('dotenv').config(); } catch {}

const express     = require('express');
const path        = require('path');
const multer      = require('multer');
const { createClient } = require('@supabase/supabase-js');

// ────────────────────────────────────────────────────────────
//  Configuration
// ────────────────────────────────────────────────────────────

const PORT            = process.env.PORT || 3000;
const UPLOAD_PASSWORD = process.env.UPLOAD_PASSWORD || '12345';

// Supabase credentials — set these in your environment or a .env file
const SUPABASE_URL    = process.env.SUPABASE_URL    || '';
const SUPABASE_KEY    = process.env.SUPABASE_KEY    || '';   // service_role key (allows uploads)
const BUCKET_NAME     = process.env.SUPABASE_BUCKET || 'fonts';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌  SUPABASE_URL and SUPABASE_KEY must be set as environment variables.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const ALLOWED_EXTENSIONS = ['.ttf', '.otf', '.woff', '.woff2', '.TTF', '.OTF'];

const MIME_TYPES = {
  '.ttf':   'font/ttf',
  '.TTF':   'font/ttf',
  '.otf':   'font/otf',
  '.OTF':   'font/otf',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
};

// ────────────────────────────────────────────────────────────
//  Multer — memory storage (we stream straight to Supabase)
// ────────────────────────────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.map(e => e.toLowerCase()).includes(ext)) {
      return cb(new Error(`"${ext}" not allowed. Accepted: ttf, otf, woff, woff2`), false);
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
  const i     = Math.floor(Math.log(bytes) / Math.log(1024));
  const size  = bytes / Math.pow(1024, i);
  return i === 0 ? `${size} ${units[i]}` : `${size.toFixed(1)} ${units[i]}`;
}

// ────────────────────────────────────────────────────────────
//  Utility — Build font list from Supabase Storage bucket
// ────────────────────────────────────────────────────────────

async function getFontList() {
  try {
    // List all files in the bucket (handles up to 1000 per page)
    let allFiles = [];
    let offset   = 0;
    const limit  = 1000;

    while (true) {
      const { data, error } = await supabase.storage
        .from(BUCKET_NAME)
        .list('', { limit, offset, sortBy: { column: 'name', order: 'asc' } });

      if (error) throw error;
      if (!data || data.length === 0) break;

      allFiles = allFiles.concat(data);
      if (data.length < limit) break;
      offset += limit;
    }

    // Filter to only font files
    const fontFiles = allFiles.filter(file => {
      const ext = path.extname(file.name).toLowerCase();
      return ALLOWED_EXTENSIONS.map(e => e.toLowerCase()).includes(ext);
    });

    const fonts = fontFiles.map(file => {
      const ext      = path.extname(file.name).toLowerCase();
      const rawName  = path.basename(file.name, path.extname(file.name));
      const cleanName = rawName
        .replace(/[_]/g, ' ')
        .replace(/[-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      // Build the public URL for this file
      const { data: { publicUrl } } = supabase.storage
        .from(BUCKET_NAME)
        .getPublicUrl(file.name);

      return {
        name:      cleanName,
        fileName:  file.name,
        extension: ext.slice(1),
        size:      formatFileSize(file.metadata?.size || 0),
        sizeBytes: file.metadata?.size || 0,
        url:       publicUrl,
      };
    });

    fonts.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    return fonts;
  } catch (err) {
    console.error('❌  Error listing fonts from Supabase:', err.message);
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
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
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

app.get('/',       (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
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
    res.status(500).json({ success: false, message: 'Failed to retrieve font list' });
  }
});

// ────────────────────────────────────────────────────────────
//  API — Download (redirect to Supabase public URL)
// ────────────────────────────────────────────────────────────

app.get('/api/fonts/download/:filename', async (req, res) => {
  try {
    const fileName = req.params.filename;

    // Validate extension
    const ext = path.extname(fileName).toLowerCase();
    if (!ALLOWED_EXTENSIONS.map(e => e.toLowerCase()).includes(ext)) {
      return res.status(400).json({ success: false, message: 'Invalid file type' });
    }

    // Check the file actually exists in the bucket
    const { data: list, error: listErr } = await supabase.storage
      .from(BUCKET_NAME)
      .list('', { search: fileName });

    if (listErr) throw listErr;

    const found = list?.some(f => f.name === fileName);
    if (!found) {
      return res.status(404).json({ success: false, message: 'Font not found' });
    }

    // Get a signed URL valid for 60 seconds so the browser downloads it directly
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUrl(fileName, 60, { download: true });

    if (error) throw error;

    res.redirect(data.signedUrl);
  } catch (err) {
    console.error('Download error:', err.message);
    res.status(500).json({ success: false, message: 'Download failed' });
  }
});

// ────────────────────────────────────────────────────────────
//  API — Verify password
// ────────────────────────────────────────────────────────────

app.post('/api/verify-password', (req, res) => {
  res.json({ success: req.body.password === UPLOAD_PASSWORD });
});

// ────────────────────────────────────────────────────────────
//  API — Upload (stream files to Supabase Storage)
// ────────────────────────────────────────────────────────────

app.post('/api/upload', (req, res) => {
  upload.array('fonts')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ success: false, message: err.message });
    }
    if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }

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

    for (const file of req.files) {
      const fileName  = file.originalname;
      const mimeType  = MIME_TYPES[path.extname(fileName).toLowerCase()] || 'application/octet-stream';

      // Check if the file already exists in the bucket
      const { data: existingList } = await supabase.storage
        .from(BUCKET_NAME)
        .list('', { search: fileName });

      const alreadyExists = existingList?.some(f => f.name === fileName);

      if (alreadyExists) {
        duplicates.push(fileName);
        continue;
      }

      // Upload to Supabase Storage
      const { error: uploadErr } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(fileName, file.buffer, {
          contentType: mimeType,
          upsert: false,
        });

      if (uploadErr) {
        console.error(`❌  Failed to upload "${fileName}":`, uploadErr.message);
        errors.push(fileName);
      } else {
        uploaded.push(fileName);
      }
    }

    console.log(`✅  Uploaded: ${uploaded.length} font(s), Skipped: ${duplicates.length}, Errors: ${errors.length}`);
    res.json({ success: true, uploaded, duplicates, errors });
  });
});

// ────────────────────────────────────────────────────────────
//  Error handler
// ────────────────────────────────────────────────────────────

app.use((err, _req, res, _next) => {
  res.status(500).json({ success: false, message: err.message });
});

// ────────────────────────────────────────────────────────────
//  Start
// ────────────────────────────────────────────────────────────

process.on('uncaughtException',  err    => console.error('💥', err.message));
process.on('unhandledRejection', reason => console.error('💥', reason));

app.listen(PORT, async () => {
  console.log('');
  console.log('─────────────────────────────────────────');
  console.log(`  🚀  FontVault running at:`);
  console.log(`       http://localhost:${PORT}`);
  console.log(`  📦  Supabase bucket: ${BUCKET_NAME}`);
  console.log('─────────────────────────────────────────');
  console.log('');

  // Quick connectivity check
  const fonts = await getFontList();
  console.log(`  ✅  Connected — ${fonts.length} font(s) found in bucket`);
  console.log('');
});
