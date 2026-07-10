// ============================================================
//  Font Manager — Express.js Server
//  A clean, production-ready backend for managing font files.
// ============================================================

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const fsp     = fs.promises;
const multer  = require('multer');

// ────────────────────────────────────────────────────────────
//  Constants & Configuration
// ────────────────────────────────────────────────────────────

const PORT              = 3000;
const FONTS_DIR         = path.join(__dirname, 'fonts');
const UPLOAD_PASSWORD   = '12345';
const ALLOWED_EXTENSIONS = ['.ttf', '.otf', '.woff', '.woff2'];

/** Map file extensions → correct MIME types for font delivery */
const MIME_TYPES = {
  '.ttf':   'font/ttf',
  '.otf':   'font/otf',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2'
};

// ────────────────────────────────────────────────────────────
//  Multer Setup — Disk Storage, skip exact duplicates
// ────────────────────────────────────────────────────────────

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, FONTS_DIR),

  filename: (_req, file, cb) => {
    const ext      = path.extname(file.originalname).toLowerCase();
    const baseName = path.basename(file.originalname, path.extname(file.originalname));
    cb(null, `${baseName}${ext}`);
  }
});

/** Only allow font files with approved extensions AND reject exact duplicates */
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();

  // Reject unsupported types
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return cb(new Error(`File type "${ext}" is not allowed. Accepted: ${ALLOWED_EXTENSIONS.join(', ')}`), false);
  }

  // Reject if a file with the same name already exists on disk
  const destPath = path.join(FONTS_DIR, file.originalname);
  if (fs.existsSync(destPath)) {
    if (!req.skippedFiles) req.skippedFiles = [];
    req.skippedFiles.push(file.originalname);
    return cb(null, false); // skip — don't save
  }

  cb(null, true); // accept
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 } // 50 MB
});

// ────────────────────────────────────────────────────────────
//  Utility — Format Bytes into Human-Readable Sizes
// ────────────────────────────────────────────────────────────

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  const k     = 1024;
  // Determine which unit bracket the value falls into
  const i     = Math.floor(Math.log(bytes) / Math.log(k));
  const size  = bytes / Math.pow(k, i);

  // Only show decimals for KB and above
  return i === 0
    ? `${size} ${units[i]}`
    : `${size.toFixed(1)} ${units[i]}`;
}

// ────────────────────────────────────────────────────────────
//  Utility — Build the Font List from the fonts/ Directory
// ────────────────────────────────────────────────────────────

async function getFontList() {
  try {
    const files = await fsp.readdir(FONTS_DIR);

    // Keep only files whose extension is in the allowed list
    const fontFiles = files.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return ALLOWED_EXTENSIONS.includes(ext);
    });

    // Gather metadata for each font file
    const fonts = await Promise.all(
      fontFiles.map(async (fileName) => {
        const filePath  = path.join(FONTS_DIR, fileName);
        const stat      = await fsp.stat(filePath);
        const ext       = path.extname(fileName).toLowerCase();
        const rawName   = path.basename(fileName, path.extname(fileName));

        // Pretty-print the name: swap underscores & hyphens for spaces
        const cleanName = rawName
          .replace(/[_]/g, ' ')
          .replace(/[-]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        return {
          name:      cleanName,
          fileName:  fileName,
          extension: ext.slice(1),          // 'ttf', 'otf', etc.
          size:      formatFileSize(stat.size),
          sizeBytes: stat.size
        };
      })
    );

    // Sort alphabetically by display name (case-insensitive)
    fonts.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

    return fonts;
  } catch (err) {
    console.error('❌ Error reading font directory:', err.message);
    return [];
  }
}

// ────────────────────────────────────────────────────────────
//  Express App Initialisation
// ────────────────────────────────────────────────────────────

const app = express();

// ── Middleware ───────────────────────────────────────────────

// Parse JSON & URL-encoded bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS — allow all origins for local development
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (_req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Simple request logger
app.use((req, _res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}]  ${req.method}  ${req.url}`);
  next();
});

// ── Static File Serving ─────────────────────────────────────

// Serve front-end assets (HTML, CSS, JS) from the project root
app.use(express.static(__dirname, { index: false }));

// Serve /fonts/ with correct MIME types and caching
app.use('/fonts', express.static(FONTS_DIR, {
  setHeaders: (res, filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (MIME_TYPES[ext]) {
      res.setHeader('Content-Type', MIME_TYPES[ext]);
    }
    // Cache fonts for 7 days — they rarely change
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  }
}));

// ────────────────────────────────────────────────────────────
//  Routes — Pages
// ────────────────────────────────────────────────────────────

/** Home page */
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

/** Upload page */
app.get('/upload', (_req, res) => {
  res.sendFile(path.join(__dirname, 'upload.html'));
});

// ────────────────────────────────────────────────────────────
//  Routes — API
// ────────────────────────────────────────────────────────────

/**
 * GET /api/fonts
 * Returns the full list of font files with metadata.
 * Optional query: ?sort=asc|desc
 */
app.get('/api/fonts', async (req, res) => {
  try {
    let fonts = await getFontList();

    // Apply optional sort direction
    const sortDir = (req.query.sort || '').toLowerCase();
    if (sortDir === 'desc') {
      fonts.reverse();
    }
    // 'asc' is the default from getFontList(), so no action needed

    res.json({ success: true, fonts, count: fonts.length });
  } catch (err) {
    console.error('❌ /api/fonts error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to retrieve font list' });
  }
});

/**
 * GET /api/fonts/download/:filename
 * Download a specific font file by its exact filename.
 */
app.get('/api/fonts/download/:filename', async (req, res) => {
  try {
    const fileName = req.params.filename;
    const filePath = path.join(FONTS_DIR, fileName);

    // Security: make sure the resolved path is still inside FONTS_DIR
    if (!filePath.startsWith(FONTS_DIR)) {
      return res.status(400).json({ success: false, message: 'Invalid filename' });
    }

    // Check existence
    try {
      await fsp.access(filePath);
    } catch {
      return res.status(404).json({ success: false, message: 'Font not found' });
    }

    const ext = path.extname(fileName).toLowerCase();
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
    res.sendFile(filePath);
  } catch (err) {
    console.error('❌ Download error:', err.message);
    res.status(500).json({ success: false, message: 'Download failed' });
  }
});

/**
 * POST /api/verify-password
 * Quick check whether the supplied password matches.
 */
app.post('/api/verify-password', (req, res) => {
  const { password } = req.body;
  const valid = password === UPLOAD_PASSWORD;
  res.json({ success: valid });
});

/**
 * POST /api/upload
 * Upload one or more font files (field name: "fonts").
 * Requires the correct password in the body.
 */
app.post('/api/upload', (req, res) => {
  // ── Step 1: Verify password first ──────────────────────
  // Because multer consumes the stream, we need to parse
  // the password from the multipart body. We'll use multer
  // first, then check password after parsing.

  const uploader = upload.array('fonts');

  uploader(req, res, async (err) => {
    // ── Multer errors ──────────────────────────────────
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: 'File too large. Maximum size is 50 MB.'
        });
      }
      return res.status(400).json({ success: false, message: err.message });
    }
    if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }

    // ── Password check (available after multer parsing) ─
    const { password } = req.body;
    if (password !== UPLOAD_PASSWORD) {
      // Wrong password — delete any files multer already saved
      if (req.files && req.files.length > 0) {
        for (const file of req.files) {
          try { await fsp.unlink(file.path); } catch { /* ignore */ }
        }
      }
      return res.status(401).json({ success: false, message: 'Wrong Password' });
    }

    // ── Success ────────────────────────────────────────
    const uploaded   = req.files ? req.files.map(f => f.filename) : [];
    const duplicates = req.skippedFiles || [];

    console.log(`✅ Uploaded ${uploaded.length} font(s):`, uploaded.join(', ') || 'none');
    if (duplicates.length) {
      console.log(`⚠️  Skipped ${duplicates.length} duplicate(s):`, duplicates.join(', '));
    }

    res.json({
      success:    true,
      message:    'Fonts uploaded successfully',
      uploaded,
      duplicates
    });
  });
});

// ────────────────────────────────────────────────────────────
//  Global Error Handler
// ────────────────────────────────────────────────────────────

app.use((err, _req, res, _next) => {
  console.error('💥 Unhandled error:', err.message);
  res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message
  });
});

// ────────────────────────────────────────────────────────────
//  Server Startup
// ────────────────────────────────────────────────────────────

// Keep the process alive and log unhandled errors instead of crashing
process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught exception:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('💥 Unhandled rejection:', reason);
});

(async () => {
  // Ensure the fonts directory exists
  if (!fs.existsSync(FONTS_DIR)) {
    fs.mkdirSync(FONTS_DIR, { recursive: true });
    console.log('📁 Created fonts directory:', FONTS_DIR);
  }

  // Count existing fonts
  const fonts = await getFontList();
  console.log(`📦 Found ${fonts.length} font(s) in the library.`);

  // Start listening — if port is busy, wait and retry up to 10 times
  function startServer(port, attempt = 1) {
    const server = app.listen(port, () => {
      console.log('');
      console.log('───────────────────────────────────────────');
      console.log(`  🚀  Font Manager running at:`);
      console.log(`       http://localhost:${port}`);
      console.log('───────────────────────────────────────────');
      console.log('');
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        if (attempt <= 10) {
          console.log(`⏳ Port ${port} busy — retrying in 2s (attempt ${attempt}/10)…`);
          setTimeout(() => startServer(port, attempt + 1), 2000);
        } else {
          console.error(`❌ Could not bind to port ${port} after 10 attempts. Is another server still running?`);
          process.exit(1);
        }
      } else {
        console.error('❌ Server error:', err.message);
      }
    });
  }

  startServer(PORT);
})();
