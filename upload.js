/**
 * ============================================================
 *  Upload Page – Font Manager
 * ============================================================
 *  Handles password verification, font file selection via
 *  drag-and-drop or file picker, upload with progress tracking,
 *  theme toggling, and toast notifications.
 * ============================================================
 */

// ── DOM References ──────────────────────────────────────────
const passwordCard    = document.getElementById('password-card');
const uploadCard      = document.getElementById('upload-card');
const passwordForm    = document.getElementById('password-form');
const passwordInput   = document.getElementById('password-input');
const passwordError   = document.getElementById('password-error');
const togglePasswordBtn = document.getElementById('toggle-password');
const dropZone        = document.getElementById('drop-zone');
const fileInput       = document.getElementById('file-input');
const fileList        = document.getElementById('file-list');
const fileListItems   = document.getElementById('file-list-items');
const fileCount       = document.getElementById('file-count');
const uploadBtn       = document.getElementById('upload-btn');
const uploadProgress  = document.getElementById('upload-progress');
const progressFill    = document.getElementById('progress-fill');
const progressText    = document.getElementById('progress-text');
const uploadResults   = document.getElementById('upload-results');
const themeToggle     = document.getElementById('theme-toggle');
const toastContainer  = document.getElementById('toast-container');

// ── State ───────────────────────────────────────────────────
let selectedFiles   = [];   // Files queued for upload
let isAuthenticated = false;
let isUploading     = false;

// Allowed font file extensions
const ALLOWED_EXTENSIONS = ['.ttf', '.otf', '.woff', '.woff2'];


/* ═══════════════════════════════════════════════════════════
 *  INITIALISATION
 * ═══════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  // 1. Restore persisted theme
  loadThemePreference();

  // 2. Wire up every event listener
  initEventListeners();

  // 3. Auto-focus the password field for quick entry
  if (passwordInput) passwordInput.focus();
});


/**
 * Attach all event listeners in a single, easy-to-audit place.
 */
function initEventListeners() {
  // Password form submission
  if (passwordForm) {
    passwordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pwd = passwordInput?.value.trim();
      if (pwd) await verifyPassword(pwd);
    });
  }

  // Toggle password visibility (eye icon)
  if (togglePasswordBtn) {
    togglePasswordBtn.addEventListener('click', togglePasswordVisibility);
  }

  // ── Drag & Drop ──────────────────────────────────────────
  if (dropZone) {
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('active');
    });

    dropZone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('active');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('active');
      if (e.dataTransfer?.files?.length) {
        handleFiles(e.dataTransfer.files);
      }
    });

    // Click the drop zone to open native file picker
    dropZone.addEventListener('click', () => fileInput?.click());
  }

  // File input change (native picker)
  if (fileInput) {
    fileInput.addEventListener('change', () => {
      if (fileInput.files?.length) {
        handleFiles(fileInput.files);
        fileInput.value = ''; // reset so re-selecting same file triggers change
      }
    });
  }

  // Upload button
  if (uploadBtn) {
    uploadBtn.addEventListener('click', uploadFonts);
  }

  // Theme toggle
  if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
  }
}


/* ═══════════════════════════════════════════════════════════
 *  PASSWORD HANDLING
 * ═══════════════════════════════════════════════════════════ */

/**
 * Verify the entered password against the server.
 * On success the password card fades out and the upload card fades in.
 * @param {string} password
 */
async function verifyPassword(password) {
  try {
    const res = await fetch('/api/verify-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    const data = await res.json();

    if (res.ok && data.success) {
      // ✅ Authenticated
      isAuthenticated = true;

      // Fade out password card, then reveal upload card
      passwordCard.classList.add('fade-out');

      passwordCard.addEventListener('animationend', () => {
        passwordCard.style.display = 'none';
        uploadCard.style.display = '';
        // Small delay so the browser paints the element before animating
        requestAnimationFrame(() => uploadCard.classList.add('fade-in'));
      }, { once: true });

      showToast('Authentication successful', 'success');
    } else {
      // ❌ Wrong password
      showPasswordError('Wrong Password');
      showToast('Incorrect password', 'error');
    }
  } catch (err) {
    console.error('Password verification failed:', err);
    showPasswordError('Network error – please try again');
    showToast('Network error – could not verify password', 'error');
  }
}


/**
 * Display an inline error beneath the password input with a shake.
 * @param {string} message
 */
function showPasswordError(message) {
  if (passwordError) {
    passwordError.textContent = message;
    passwordError.style.display = 'block';
  }

  // Shake animation on the card
  passwordCard.classList.add('shake');
  passwordCard.addEventListener('animationend', () => {
    passwordCard.classList.remove('shake');
  }, { once: true });

  // Clear & re-focus
  if (passwordInput) {
    passwordInput.value = '';
    passwordInput.focus();
  }
}


/**
 * Toggle the password field between masked and plain-text,
 * and swap the eye / eye-off icon accordingly.
 */
function togglePasswordVisibility() {
  if (!passwordInput) return;

  const isHidden = passwordInput.type === 'password';
  passwordInput.type = isHidden ? 'text' : 'password';

  // Swap icon visibility (expects two child SVGs / elements)
  const eyeIcon    = togglePasswordBtn.querySelector('.eye-icon');
  const eyeOffIcon = togglePasswordBtn.querySelector('.eye-off-icon');

  if (eyeIcon)    eyeIcon.style.display    = isHidden ? 'none'  : '';
  if (eyeOffIcon) eyeOffIcon.style.display = isHidden ? ''      : 'none';
}


/* ═══════════════════════════════════════════════════════════
 *  FILE SELECTION
 * ═══════════════════════════════════════════════════════════ */

/**
 * Process a FileList – filter for allowed types, reject duplicates,
 * then update the UI.
 * @param {FileList} files
 */
function handleFiles(files) {
  const incoming  = Array.from(files);
  const accepted  = [];
  const rejected  = [];

  incoming.forEach((file) => {
    const ext = getFileExtension(file.name);

    // Check extension
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      rejected.push({ name: file.name, reason: 'Unsupported format' });
      return;
    }

    // Check for duplicates already in queue
    const isDuplicate = selectedFiles.some(
      (f) => f.name === file.name && f.size === file.size
    );
    if (isDuplicate) {
      rejected.push({ name: file.name, reason: 'Already added' });
      return;
    }

    accepted.push(file);
  });

  // Merge accepted files into the queue
  selectedFiles = [...selectedFiles, ...accepted];

  // Notify user about rejected files
  if (rejected.length) {
    const names = rejected.map((r) => `${r.name} (${r.reason})`).join(', ');
    showToast(`Skipped: ${names}`, 'error');
  }

  if (accepted.length) {
    showToast(`${accepted.length} file${accepted.length > 1 ? 's' : ''} added`, 'success');
  }

  // Re-draw the list
  renderFileList();
}


/**
 * Extract the lowercase extension from a filename, e.g. ".woff2".
 * @param {string} filename
 * @returns {string}
 */
function getFileExtension(filename) {
  const match = filename.match(/\.[a-z0-9]+$/i);
  return match ? match[0].toLowerCase() : '';
}


/**
 * Render the selected-files list into the DOM.
 */
function renderFileList() {
  if (!fileListItems) return;

  // Clear existing items
  fileListItems.innerHTML = '';

  if (selectedFiles.length === 0) {
    // Hide list section & upload button
    if (fileList) fileList.style.display = 'none';
    if (uploadBtn) uploadBtn.style.display = 'none';
    return;
  }

  // Build a list item for every queued file
  selectedFiles.forEach((file, index) => {
    const li = document.createElement('li');
    li.className = 'file-item';

    const ext = getFileExtension(file.name).replace('.', '').toUpperCase();

    li.innerHTML = `
      <div class="file-info">
        <span class="file-type-icon">${getFileTypeIcon(ext)}</span>
        <span class="file-name">${escapeHTML(file.name)}</span>
        <span class="file-size">${formatFileSize(file.size)}</span>
      </div>
      <button class="remove-file-btn" data-index="${index}" title="Remove file">&times;</button>
    `;

    // Attach remove handler
    li.querySelector('.remove-file-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      removeFile(index);
    });

    fileListItems.appendChild(li);
  });

  // Update badge / counter
  if (fileCount) {
    fileCount.textContent = selectedFiles.length;
    fileCount.style.display = '';
  }

  // Reveal list & upload button
  if (fileList) fileList.style.display = '';
  if (uploadBtn) uploadBtn.style.display = '';
}


/**
 * Return an emoji / icon string based on font extension.
 * @param {string} ext  Uppercase extension without the dot
 * @returns {string}
 */
function getFileTypeIcon(ext) {
  const icons = {
    TTF:   '🔤',
    OTF:   '🔡',
    WOFF:  '🌐',
    WOFF2: '🌐',
  };
  return icons[ext] || '📄';
}


/**
 * Remove a file from the queue by index and re-render.
 * @param {number} index
 */
function removeFile(index) {
  if (index < 0 || index >= selectedFiles.length) return;
  const removed = selectedFiles.splice(index, 1);
  showToast(`Removed ${removed[0].name}`, 'info');
  renderFileList();
}


/**
 * Convert bytes to a human-readable string (B / KB / MB).
 * @param {number} bytes
 * @returns {string}
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}


/**
 * Simple HTML-escape to prevent injection in file names.
 * @param {string} str
 * @returns {string}
 */
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}


/* ═══════════════════════════════════════════════════════════
 *  UPLOAD
 * ═══════════════════════════════════════════════════════════ */

/**
 * Upload all queued font files to the server with progress tracking.
 */
async function uploadFonts() {
  if (!selectedFiles.length || isUploading) return;

  isUploading = true;

  // Prepare UI
  if (uploadBtn) uploadBtn.style.display = 'none';
  if (uploadProgress) uploadProgress.style.display = '';
  if (progressFill) progressFill.style.width = '0%';
  if (progressText) progressText.textContent = 'Uploading… 0%';

  // Build multipart form data
  const formData = new FormData();
  selectedFiles.forEach((file) => formData.append('fonts', file));
  formData.append('password', passwordInput?.value || '');

  // Use XHR so we can track upload progress
  const xhr = new XMLHttpRequest();

  xhr.upload.addEventListener('progress', (e) => {
    if (e.lengthComputable) {
      const pct = Math.round((e.loaded / e.total) * 100);
      if (progressFill) progressFill.style.width = `${pct}%`;
      if (progressText) progressText.textContent = `Uploading… ${pct}%`;
    }
  });

  xhr.addEventListener('load', () => {
    isUploading = false;

    if (xhr.status >= 200 && xhr.status < 300) {
      try {
        const data = JSON.parse(xhr.responseText);
        showUploadResults(data);
        showToast('Upload complete!', 'success');

        // Clear the queue
        selectedFiles = [];
        renderFileList();
      } catch {
        showToast('Upload succeeded but response was unexpected', 'info');
        resetUploadForm();
      }
    } else {
      // Server returned an error status
      let msg = 'Upload failed';
      try {
        const err = JSON.parse(xhr.responseText);
        if (err.message) msg = err.message;
      } catch { /* ignore parse error */ }

      showToast(msg, 'error');
      if (uploadBtn) uploadBtn.style.display = '';
      if (uploadProgress) uploadProgress.style.display = 'none';
    }
  });

  xhr.addEventListener('error', () => {
    isUploading = false;
    showToast('Network error – upload failed', 'error');
    if (uploadBtn) uploadBtn.style.display = '';
    if (uploadProgress) uploadProgress.style.display = 'none';
  });

  xhr.addEventListener('abort', () => {
    isUploading = false;
    showToast('Upload cancelled', 'info');
    if (uploadBtn) uploadBtn.style.display = '';
    if (uploadProgress) uploadProgress.style.display = 'none';
  });

  xhr.open('POST', '/api/upload');
  xhr.send(formData);
}


/**
 * Present the upload results (uploaded files & skipped duplicates).
 * @param {Object} data  – Expected shape:
 *   { uploaded: string[], duplicates?: string[] }
 */
function showUploadResults(data) {
  if (!uploadResults) return;

  // Hide progress bar
  if (uploadProgress) uploadProgress.style.display = 'none';

  let html = '';

  // ✅ Successfully uploaded
  if (data.uploaded?.length) {
    html += `<h3>Uploaded</h3><ul class="result-list">`;
    data.uploaded.forEach((name) => {
      html += `<li><span class="result-icon success">✓</span> ${escapeHTML(name)}</li>`;
    });
    html += `</ul>`;
  }

  // ⚠️ Duplicates skipped
  if (data.duplicates?.length) {
    html += `<h3>Skipped (already exist)</h3><ul class="result-list">`;
    data.duplicates.forEach((name) => {
      html += `<li><span class="result-icon warning">⚠</span> ${escapeHTML(name)}</li>`;
    });
    html += `</ul>`;
  }

  // Action buttons
  html += `
    <div class="result-actions">
      <button class="btn btn-primary" id="upload-more-btn">Upload More</button>
      <a href="/" class="btn btn-secondary">Browse Fonts</a>
    </div>
  `;

  uploadResults.innerHTML = html;
  uploadResults.style.display = '';

  // "Upload More" resets the form
  const uploadMoreBtn = document.getElementById('upload-more-btn');
  if (uploadMoreBtn) {
    uploadMoreBtn.addEventListener('click', resetUploadForm);
  }
}


/**
 * Reset the upload form to its initial state so the user can
 * drag in another batch of files.
 */
function resetUploadForm() {
  selectedFiles = [];

  if (fileListItems) fileListItems.innerHTML = '';
  if (fileList) fileList.style.display = 'none';
  if (fileCount) fileCount.style.display = 'none';
  if (uploadResults) {
    uploadResults.innerHTML = '';
    uploadResults.style.display = 'none';
  }
  if (uploadProgress) uploadProgress.style.display = 'none';
  if (uploadBtn) uploadBtn.style.display = 'none';
  if (dropZone) dropZone.style.display = '';
  if (fileInput) fileInput.value = '';
}


/* ═══════════════════════════════════════════════════════════
 *  THEME TOGGLE
 * ═══════════════════════════════════════════════════════════ */

/**
 * Load persisted theme preference from localStorage.
 */
function loadThemePreference() {
  const theme = localStorage.getItem('font-manager-theme');
  if (theme === 'light') {
    document.body.classList.add('light-mode');
  }
}

/**
 * Toggle between dark (default) and light mode.
 * Persists choice to localStorage so it survives page navigations.
 */
function toggleTheme() {
  document.body.classList.toggle('light-mode');
  const isLight = document.body.classList.contains('light-mode');
  localStorage.setItem('font-manager-theme', isLight ? 'light' : 'dark');
}


/* ═══════════════════════════════════════════════════════════
 *  TOAST NOTIFICATIONS
 * ═══════════════════════════════════════════════════════════ */

/**
 * Show a small, auto-dismissing toast notification.
 * @param {string} message  – Text to display
 * @param {'success'|'error'|'info'} type – Visual style
 */
function showToast(message, type = 'info') {
  if (!toastContainer) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  // Icon per type
  const icons = {
    success: '✓',
    error:   '✕',
    info:    'ℹ',
  };

  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span class="toast-message">${escapeHTML(message)}</span>
  `;

  toastContainer.appendChild(toast);

  // Trigger entrance animation on next frame
  requestAnimationFrame(() => toast.classList.add('toast-visible'));

  // Auto-dismiss after 3 seconds
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    toast.classList.add('toast-exit');
    setTimeout(() => {
      if (toast.parentNode) toast.remove();
    }, 300);
  }, 3000);
}
