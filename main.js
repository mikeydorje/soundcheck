/* ================================================================
   Master Check — main.js
   Browser-only audio analysis (Web Audio API, ApexCharts)
   ================================================================ */

// ── DOM refs ──
const fileInput        = document.getElementById('fileInput');
const analyzeBtn       = document.getElementById('analyzeBtn');
const status           = document.getElementById('status');
const resultsDiv       = document.getElementById('resultsSection');
const tableBody        = document.querySelector('#resultsTable tbody');
const tableHead        = document.getElementById('resultsHead');
const tracklistSection = document.getElementById('tracklistSection');
const tracklistEl      = document.getElementById('tracklist');
const albumSection     = document.getElementById('albumSection');
const albumSummary     = document.getElementById('albumSummary');
const uploadArea       = document.getElementById('uploadArea');
const filesLoadedArea  = document.getElementById('filesLoadedArea');
const fileCount        = document.getElementById('fileCount');
const resetBtn         = document.getElementById('resetBtn');
const analyzeSection   = document.getElementById('analyzeSection');
const skipAlbumLabel   = document.getElementById('skipAlbumLabel');
const skipAlbumCheckbox = document.getElementById('skipAlbumAnalysis');

let selectedFiles = [];

// ── IndexedDB cache (persists analysis results across refresh) ──
const CACHE_DB_NAME = 'soundcheck-cache';
const CACHE_STORE   = 'results';
const CACHE_DB_VER  = 1;

function openCacheDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CACHE_DB_NAME, CACHE_DB_VER);
    req.onupgradeneeded = () => req.result.createObjectStore(CACHE_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function cacheResults(results, skipAlbum) {
  try {
    const db = await openCacheDB();
    const tx = db.transaction(CACHE_STORE, 'readwrite');
    const store = tx.objectStore(CACHE_STORE);
    store.put({ results, skipAlbum, timestamp: Date.now() }, 'latest');
    db.close();
  } catch (e) { console.warn('Cache write failed:', e); }
}

async function loadCachedResults() {
  try {
    const db = await openCacheDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CACHE_STORE, 'readonly');
      const req = tx.objectStore(CACHE_STORE).get('latest');
      req.onsuccess = () => { db.close(); resolve(req.result || null); };
      req.onerror   = () => { db.close(); resolve(null); };
    });
  } catch (e) { return null; }
}

async function clearCache() {
  try {
    const db = await openCacheDB();
    const tx = db.transaction(CACHE_STORE, 'readwrite');
    tx.objectStore(CACHE_STORE).clear();
    db.close();
  } catch (e) { console.warn('Cache clear failed:', e); }
}

// ── Event wiring ──
fileInput.addEventListener('change', () => {
  selectedFiles = Array.from(fileInput.files);
  if (selectedFiles.length > 0) {
    uploadArea.classList.add('hidden');
    filesLoadedArea.classList.remove('hidden');
    fileCount.textContent = `${selectedFiles.length} track${selectedFiles.length > 1 ? 's' : ''} loaded`;
    analyzeSection.classList.remove('hidden');
  } else {
    uploadArea.classList.remove('hidden');
    filesLoadedArea.classList.add('hidden');
    analyzeSection.classList.add('hidden');
  }
  status.textContent = '';
  renderTracklist();
});

resetBtn.addEventListener('click', resetUpload);

function resetUpload() {
  selectedFiles = [];
  fileInput.value = '';
  uploadArea.classList.remove('hidden');
  filesLoadedArea.classList.add('hidden');
  analyzeSection.classList.add('hidden');
  tracklistSection.classList.add('hidden');
  tracklistSection.classList.remove('analyzing-mode');
  resultsDiv.classList.add('hidden');
  albumSection.classList.add('hidden');
  status.textContent = '';
  skipAlbumCheckbox.checked = false;
  clearCache();

  // Destroy all chart instances and clear their containers
  for (const c of chartInstances) {
    try {
      if (typeof c.destroy === 'function') c.destroy();
      else if (c.chart && typeof c.chart.destroy === 'function') c.chart.destroy();
    } catch (e) {}
  }
  chartInstances = [];
  document.querySelectorAll('.chart-container div[id]').forEach(el => { el.innerHTML = ''; });
}

analyzeBtn.addEventListener('click', runAnalysis);

// ── Tracklist drag-to-reorder ──
function renderTracklist() {
  tracklistEl.innerHTML = '';
  if (selectedFiles.length === 1) {
    // Single track — show panel without heading/hint/skip, no drag
    tracklistSection.classList.remove('hidden');
    tracklistSection.querySelector('h2').style.display = 'none';
    tracklistSection.querySelector('.tracklist-hint').style.display = 'none';
    skipAlbumLabel.classList.add('hidden');
    const li = document.createElement('li');
    li.style.cursor = 'default';
    li.innerHTML = `<span class="track-name">${esc(selectedFiles[0].name)}</span>`;
    tracklistEl.appendChild(li);
    return;
  }
  if (selectedFiles.length === 0) {
    tracklistSection.classList.add('hidden');
    skipAlbumLabel.classList.add('hidden');
    return;
  }
  tracklistSection.classList.remove('hidden');
  tracklistSection.querySelector('h2').style.display = '';
  tracklistSection.querySelector('.tracklist-hint').style.display = '';
  skipAlbumLabel.classList.remove('hidden');
  selectedFiles.forEach((file, i) => {
    const li = document.createElement('li');
    li.draggable = true;
    li.dataset.index = i;
    li.innerHTML = `<span class="drag-handle">☰</span><span>${esc(file.name)}</span>`;
    li.addEventListener('dragstart', onDragStart);
    li.addEventListener('dragover', onDragOver);
    li.addEventListener('dragenter', onDragEnter);
    li.addEventListener('dragleave', onDragLeave);
    li.addEventListener('drop', onDrop);
    li.addEventListener('dragend', onDragEnd);
    tracklistEl.appendChild(li);
  });
}

let dragSrcIndex = null;

function onDragStart(e) {
  dragSrcIndex = +this.dataset.index;
  this.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

function onDragEnter(e) {
  e.preventDefault();
  this.classList.add('drag-over');
}

function onDragLeave() {
  this.classList.remove('drag-over');
}

function onDrop(e) {
  e.stopPropagation();
  this.classList.remove('drag-over');
  const targetIndex = +this.dataset.index;
  if (dragSrcIndex !== null && dragSrcIndex !== targetIndex) {
    const [moved] = selectedFiles.splice(dragSrcIndex, 1);
    selectedFiles.splice(targetIndex, 0, moved);
    renderTracklist();
  }
}

function onDragEnd() {
  this.classList.remove('dragging');
}

// ── Fullscreen toggle per chart ──
function initFullscreenToggles() {
  document.querySelectorAll('.chart-container').forEach(container => {
    if (container.querySelector('.fullscreen-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'fullscreen-btn';
    btn.title = 'Toggle fullscreen';
    btn.innerHTML = '&#x26F6;';
    btn.addEventListener('click', () => {
      if (document.fullscreenElement === container) {
        document.exitFullscreen();
      } else {
        container.requestFullscreen().catch(() => {});
      }
    });
    container.style.position = 'relative';
    container.prepend(btn);
  });
}

document.addEventListener('fullscreenchange', () => {
  const el = document.fullscreenElement;
  document.querySelectorAll('.chart-container').forEach(c => c.classList.remove('is-fullscreen'));
  if (el && el.classList.contains('chart-container')) {
    el.classList.add('is-fullscreen');
    const chartDiv = el.querySelector('div[id]');
    if (chartDiv) {
      const instance = chartInstances.find(c => c.el === chartDiv);
      if (instance) {
        // Normalise: raw ApexCharts instance vs { el, chart, opts } wrapper
        const apex = instance.chart || instance;
        const origH = instance.opts ? instance.opts.chart.height : (apex.w && apex.w.globals.svgHeight) || 300;
        apex._origHeight = origH;
        const h = window.screen.height - 140;
        apex.updateOptions({ chart: { height: h } }, false, false);
      }
    }
  } else {
    for (const c of chartInstances) {
      const apex = c.chart || c;
      if (apex._origHeight) {
        apex.updateOptions({ chart: { height: apex._origHeight } }, false, false);
        delete apex._origHeight;
      }
    }
  }
});

// ── PDF export ──
document.getElementById('downloadZipBtn').addEventListener('click', exportZip);

// ── CSV generation (all column groups) ──
function generateCSV(results) {
  const valid = results.filter(r => !r.error);
  if (valid.length === 0) return '';

  // Build all columns: core + every group
  const allCols = [...CORE_COLUMNS];
  for (const group of COLUMN_GROUPS) {
    for (const col of group.cols) allCols.push(col);
  }

  const headers = allCols.map(c => c[0]);
  const rows = valid.map(r => allCols.map(c => {
    const val = c[1](r);
    const str = String(val);
    // Escape CSV: quote if contains comma, quote, or newline
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }));

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

// ── HTML table generation (styled, all data) ──
function generateHTMLTable(results) {
  const valid = results.filter(r => !r.error);
  if (valid.length === 0) return '';

  const allCols = [...CORE_COLUMNS];
  for (const group of COLUMN_GROUPS) {
    for (const col of group.cols) allCols.push(col);
  }

  let html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Soundcheck Report</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#050508;color:rgba(255,255,255,0.5);font-family:'Segoe UI',system-ui,sans-serif;font-size:12px;padding:32px}
h1{font-size:15px;text-transform:uppercase;letter-spacing:6px;color:rgba(255,255,255,0.3);font-weight:400;text-align:center;margin-bottom:4px}
p.sub{font-size:11px;text-transform:uppercase;letter-spacing:4px;color:rgba(255,255,255,0.18);text-align:center;margin-bottom:24px}
table{border-collapse:collapse;width:100%}
th,td{padding:6px 10px;text-align:left;border-bottom:1px solid rgba(255,255,255,0.06)}
th{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:rgba(255,255,255,0.3);font-weight:500}
td{color:rgba(255,255,255,0.45)}
tr:hover td{background:rgba(255,255,255,0.03)}
</style></head><body>
<h1>SOUNDCHECK</h1><p class="sub">Master consistency analysis</p>
<table><thead><tr>`;

  for (const col of allCols) html += `<th>${escapeHTML(col[0])}</th>`;
  html += '</tr></thead><tbody>';

  for (const r of valid) {
    html += '<tr>';
    for (const col of allCols) html += `<td>${escapeHTML(String(col[1](r)))}</td>`;
    html += '</tr>';
  }

  html += '</tbody></table></body></html>';
  return html;
}

function escapeHTML(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Sanitise chart title for filenames ──
function sanitizeFilename(title) {
  return title.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 60);
}

// ── ZIP export ──
async function exportZip() {
  const btn = document.getElementById('downloadZipBtn');
  btn.disabled = true;
  btn.textContent = 'Exporting…';

  try {
    const zip = new JSZip();
    const EXPORT_HEIGHT = Math.max(window.screen.height - 140, 600);

    for (const instance of chartInstances) {
      const apex = instance.chart || instance;
      // Resolve the chart's DOM element
      const chartDiv = instance.el || (apex.el && apex.el.parentElement) || null;
      if (!chartDiv) continue;
      const container = chartDiv.closest('.chart-container');
      const h3 = container ? container.querySelector('h3') : null;
      const title = h3 ? sanitizeFilename(h3.textContent) : sanitizeFilename(chartDiv.id || 'chart');

      // Save original height
      const origH = instance.opts
        ? instance.opts.chart.height
        : (apex.w && apex.w.globals && apex.w.globals.svgHeight) || 300;

      // Resize to export height
      try { apex.updateOptions({ chart: { height: EXPORT_HEIGHT } }, false, false); } catch (_) {}
      await new Promise(r => setTimeout(r, 300));

      // Grab SVG from DOM
      const svgEl = chartDiv.querySelector('svg');
      if (svgEl) {
        const svgString = new XMLSerializer().serializeToString(svgEl);
        zip.folder('svg').file(title + '.svg', svgString);
      }

      // Grab PNG via dataURI
      try {
        const { imgURI } = await apex.dataURI({ scale: 2 });
        const base64 = imgURI.split(',')[1];
        zip.folder('png').file(title + '.png', base64, { base64: true });
      } catch (e) {
        console.warn(`PNG export failed for ${title}:`, e);
      }

      // Restore original height
      try { apex.updateOptions({ chart: { height: origH } }, false, false); } catch (_) {}
    }

    // CSV with all data
    const csv = generateCSV(lastResults);
    if (csv) zip.file('soundcheck-data.csv', csv);

    // HTML table report
    const htmlReport = generateHTMLTable(lastResults);
    if (htmlReport) zip.file('soundcheck-report.html', htmlReport);

    // Generate and download
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'soundcheck-export.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('ZIP export failed:', err);
    alert('Export failed — see console for details.');
  }

  btn.disabled = false;
  btn.innerHTML = '&#8681; Export';
}

// ── Main pipeline ──
async function runAnalysis() {
  if (selectedFiles.length === 0) return;

  // Hide analyze button during/after analysis
  analyzeSection.classList.add('hidden');
  resultsDiv.classList.add('hidden');
  tableHead.innerHTML = '';
  tableBody.innerHTML = '';
  status.textContent = '';

  // Build / show progress list
  const isSingle = selectedFiles.length === 1;
  if (isSingle) {
    // Single track — augment the existing panel item with progress elements
    const li = tracklistEl.querySelector('li');
    li.classList.add('pending');
    const fill = document.createElement('div');
    fill.className = 'track-progress-fill';
    li.insertBefore(fill, li.firstChild);
    const statusSpan = document.createElement('span');
    statusSpan.className = 'track-status';
    li.appendChild(statusSpan);
  } else {
    // Multi-track — inject progress fill into existing tracklist items
    const items = tracklistEl.querySelectorAll('li');
    items.forEach(li => {
      li.draggable = false;
      li.classList.add('pending');
      // Insert progress fill bar and status span
      const fill = document.createElement('div');
      fill.className = 'track-progress-fill';
      li.insertBefore(fill, li.firstChild);
      // Wrap existing filename span with track-name class
      const nameSpan = li.querySelector('span:not(.drag-handle)');
      if (nameSpan) nameSpan.classList.add('track-name');
      // Add status indicator
      const statusSpan = document.createElement('span');
      statusSpan.className = 'track-status';
      li.appendChild(statusSpan);
    });
  }

  // Switch to analyzing mode (hides drag handles, swaps heading)
  tracklistSection.classList.add('analyzing-mode');

  // Allow a paint so the user sees the progress UI before heavy work starts
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const results = [];
  const items = tracklistEl.querySelectorAll('li');

  for (let i = 0; i < selectedFiles.length; i++) {
    const file = selectedFiles[i];
    const li = items[i];

    // Mark current track as analyzing
    li.classList.remove('pending');
    li.classList.add('analyzing');
    const statusSpan = li.querySelector('.track-status');

    // Let the browser paint the analyzing state
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    try {
      const arrayBuffer = await readFile(file);
      const fileInfo = parseFileInfo(arrayBuffer);
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      const metrics = analyzeBuffer(audioBuffer);
      metrics.filename = file.name;
      metrics.fileFormat = fileInfo.format;
      metrics.fileBitDepth = fileInfo.bitDepth;
      metrics.fileCodec = fileInfo.codec;
      results.push(metrics);
      li.classList.remove('analyzing');
      li.classList.add('done');
      if (statusSpan) statusSpan.textContent = '✓';
    } catch (err) {
      console.error(`Error analyzing ${file.name}:`, err);
      results.push({ filename: file.name, error: err.message });
      li.classList.remove('analyzing');
      li.classList.add('done');
      if (statusSpan) {
        statusSpan.textContent = '✗';
        statusSpan.style.color = 'rgba(255,80,80,0.5)';
      }
    }
  }

  await audioCtx.close();

  // Brief pause so the user sees all bars filled before switching to results
  await new Promise(r => setTimeout(r, 400));

  tracklistSection.classList.remove('analyzing-mode');
  tracklistSection.classList.add('hidden');

  renderTable(results);
  resultsDiv.classList.remove('hidden');
  renderCharts(results);

  // Album composition analysis (needs 2+ valid tracks, unless skipped)
  if (!skipAlbumCheckbox.checked) {
    const album = computeAlbumAnalysis(results);
    renderAlbumSection(album);
  } else {
    albumSection.classList.add('hidden');
  }

  status.textContent = `${results.length} track${results.length > 1 ? 's' : ''} analyzed`;

  // Cache results for refresh persistence
  cacheResults(results, skipAlbumCheckbox.checked);
}

// ── File reader promise wrapper ──
function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

// ════════════════════════════════════════════════════════════════
//  DSP — per-track analysis
// ════════════════════════════════════════════════════════════════

function analyzeBuffer(buf) {
  const sampleRate  = buf.sampleRate;
  const numChannels = buf.numberOfChannels;
  const length      = buf.length;

  // Mono mix for spectral / time-domain stats
  const mono = new Float32Array(length);
  for (let ch = 0; ch < numChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < length; i++) mono[i] += d[i];
  }
  if (numChannels > 1) {
    for (let i = 0; i < length; i++) mono[i] /= numChannels;
  }

  // 1. Duration
  const duration = buf.duration;

  // 2. Peak
  let peak = 0;
  for (let i = 0; i < length; i++) {
    const a = Math.abs(mono[i]);
    if (a > peak) peak = a;
  }

  // 3. RMS
  let sumSq = 0;
  for (let i = 0; i < length; i++) sumSq += mono[i] * mono[i];
  const rms = Math.sqrt(sumSq / length);

  // 4. Crest factor (dB) — industry standard: 20·log10(peak / RMS)
  const crestFactor = rms > 0 ? 20 * Math.log10(peak / rms) : 0;

  // 5. DC offset
  let sum = 0;
  for (let i = 0; i < length; i++) sum += mono[i];
  const dcOffset = sum / length;

  // 6. Stereo correlation
  let stereoCorrelation = 1;
  if (numChannels >= 2) {
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    let sumLR = 0, sumLL = 0, sumRR = 0;
    for (let i = 0; i < length; i++) {
      sumLR += L[i] * R[i];
      sumLL += L[i] * L[i];
      sumRR += R[i] * R[i];
    }
    const denom = Math.sqrt(sumLL * sumRR);
    stereoCorrelation = denom > 0 ? sumLR / denom : 1;
  }

  // 7 & 8. Spectral analysis (centroid + band ratios + avg spectrum + bass detail)
  const fftSize = 4096;
  const hopSize = 2048;
  const { centroid, sub, bass, low, mid, high, avgSpectrum, spectrumFreqs,
          bassSpectrum, bassSpectrumFreqs } =
    spectralAnalysis(mono, sampleRate, fftSize, hopSize);

  // 9. LUFS (ITU-R BS.1770-4)
  const channels = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(buf.getChannelData(ch));
  }
  const lufsResult = computeLUFS(channels, sampleRate);

  // 10. PLR (Peak-to-Loudness Ratio) — AES standard
  const plr = isFinite(lufsResult.integrated)
    ? toDBFS(peak) - lufsResult.integrated : 0;

  // 11. Bass mono compatibility (stereo correlation in 20–200 Hz)
  let bassMonoCorrelation = 1;
  if (numChannels >= 2) {
    bassMonoCorrelation = computeBassMonoCorrelation(
      buf.getChannelData(0), buf.getChannelData(1), sampleRate, fftSize, hopSize);
  }

  // 12. Bass energy over time (20–200 Hz RMS in short windows)
  const bassEnergyTimeSeries = computeBassEnergyOverTime(mono, sampleRate, fftSize);

  // 13. Per-band crest factors
  const { crestLow, crestMid, crestHigh } =
    computePerBandCrest(mono, sampleRate);

  // 14. Silence detection
  const { leadingSilence, trailingSilence } =
    detectSilence(mono, sampleRate);

  // 15. Clipped samples detection
  const { clippedSamples, clippedRuns } = detectClipping(buf);

  // 16. True peak (4× oversampled, ITU-R BS.1770-4)
  const truePeak = computeTruePeak(buf);

  return {
    duration,
    sampleRate,
    numChannels,
    peak,
    peakDB:  toDBFS(peak),
    truePeak,
    truePeakDB: toDBFS(truePeak),
    clippedSamples,
    clippedRuns,
    rms,
    rmsDB:   toDBFS(rms),
    crestFactor,
    dcOffset,
    stereoCorrelation,
    centroid,
    sub,
    bass,
    low,
    mid,
    high,
    avgSpectrum,
    spectrumFreqs,
    bassSpectrum,
    bassSpectrumFreqs,
    lufsIntegrated:   lufsResult.integrated,
    lufsShortTermMax: lufsResult.shortTermMax,
    lufsMomentaryMax: lufsResult.momentaryMax,
    lufsTimeSeries:   lufsResult.momentaryTimeSeries,
    lra:              lufsResult.lra,
    plr,
    bassMonoCorrelation,
    bassEnergyTimeSeries,
    crestLow,
    crestMid,
    crestHigh,
    leadingSilence,
    trailingSilence,
  };
}

// ── Silence detection ──
const SILENCE_THRESHOLD = Math.pow(10, -60 / 20); // -60 dBFS

function detectSilence(samples, sampleRate) {
  const len = samples.length;
  let leadEnd = 0;
  for (let i = 0; i < len; i++) {
    if (Math.abs(samples[i]) > SILENCE_THRESHOLD) { leadEnd = i; break; }
    if (i === len - 1) leadEnd = len; // entire file is silent
  }
  let trailStart = len;
  for (let i = len - 1; i >= 0; i--) {
    if (Math.abs(samples[i]) > SILENCE_THRESHOLD) { trailStart = i + 1; break; }
    if (i === 0) trailStart = 0;
  }
  return {
    leadingSilence:  leadEnd / sampleRate,
    trailingSilence: (len - trailStart) / sampleRate,
  };
}

// ── Clipped samples detection ──
function detectClipping(buf) {
  const CLIP_THRESH = 0.9999;
  const numChannels = buf.numberOfChannels;
  let clippedSamples = 0;
  let clippedRuns = 0; // runs of 3+ consecutive clipped samples
  for (let ch = 0; ch < numChannels; ch++) {
    const data = buf.getChannelData(ch);
    let consecutive = 0;
    for (let i = 0; i < data.length; i++) {
      if (Math.abs(data[i]) >= CLIP_THRESH) {
        clippedSamples++;
        consecutive++;
      } else {
        if (consecutive >= 3) clippedRuns++;
        consecutive = 0;
      }
    }
    if (consecutive >= 3) clippedRuns++;
  }
  return { clippedSamples, clippedRuns };
}

// ── True Peak (ITU-R BS.1770-4 — 4× oversampling) ──
// Uses a 48-tap polyphase FIR at 4 phases for sinc interpolation
function computeTruePeak(buf) {
  const NUM_PHASES = 4;
  const TAPS_PER_PHASE = 12;
  const TOTAL_TAPS = NUM_PHASES * TAPS_PER_PHASE; // 48
  const HALF = TOTAL_TAPS / 2;

  // Build windowed-sinc FIR polyphase filter bank
  const phases = [];
  for (let p = 0; p < NUM_PHASES; p++) {
    const coeffs = new Float32Array(TAPS_PER_PHASE);
    for (let t = 0; t < TAPS_PER_PHASE; t++) {
      const n = t * NUM_PHASES + p - HALF;
      // Sinc
      const sinc = n === 0 ? 1.0 : Math.sin(Math.PI * n / NUM_PHASES) / (Math.PI * n / NUM_PHASES);
      // Kaiser window (beta ≈ 5.0)
      const beta = 5.0;
      const m = 2 * (t * NUM_PHASES + p) / (TOTAL_TAPS - 1) - 1;
      const bess = bessel_I0(beta * Math.sqrt(Math.max(0, 1 - m * m))) / bessel_I0(beta);
      coeffs[t] = sinc * bess;
    }
    phases.push(coeffs);
  }

  let truePeak = 0;
  const numChannels = buf.numberOfChannels;

  for (let ch = 0; ch < numChannels; ch++) {
    const data = buf.getChannelData(ch);
    const len = data.length;
    for (let i = 0; i < len; i++) {
      for (let p = 0; p < NUM_PHASES; p++) {
        const coeffs = phases[p];
        let sum = 0;
        for (let t = 0; t < TAPS_PER_PHASE; t++) {
          const idx = i - TAPS_PER_PHASE + 1 + t;
          if (idx >= 0 && idx < len) {
            sum += data[idx] * coeffs[t];
          }
        }
        const abs = Math.abs(sum);
        if (abs > truePeak) truePeak = abs;
      }
    }
  }

  return truePeak;
}

// Bessel I0 approximation for Kaiser window
function bessel_I0(x) {
  let sum = 1, term = 1;
  for (let k = 1; k <= 20; k++) {
    term *= (x / (2 * k)) * (x / (2 * k));
    sum += term;
    if (term < 1e-12) break;
  }
  return sum;
}

// ── File header parsing (bit depth, format) ──
function parseFileInfo(arrayBuffer) {
  const info = { bitDepth: null, format: null, codec: null };
  const view = new DataView(arrayBuffer);
  const size = arrayBuffer.byteLength;
  if (size < 12) return info;

  // Read 4-char tag
  const tag = (off) => String.fromCharCode(
    view.getUint8(off), view.getUint8(off + 1),
    view.getUint8(off + 2), view.getUint8(off + 3));

  const magic = tag(0);

  // WAV (RIFF...WAVE)
  if (magic === 'RIFF' && size >= 44 && tag(8) === 'WAVE') {
    info.format = 'WAV';
    // Walk chunks to find 'fmt '
    let offset = 12;
    while (offset + 8 < size) {
      const chunkId = tag(offset);
      const chunkSize = view.getUint32(offset + 4, true);
      if (chunkId === 'fmt ' && offset + 24 <= size) {
        const audioFmt = view.getUint16(offset + 8, true);
        info.bitDepth = view.getUint16(offset + 22, true);
        if (audioFmt === 1) info.codec = 'PCM';
        else if (audioFmt === 3) info.codec = 'IEEE Float';
        else if (audioFmt === 0xFFFE) info.codec = 'Extensible';
        break;
      }
      offset += 8 + chunkSize;
      if (chunkSize % 2 !== 0) offset++; // pad byte
    }
    return info;
  }

  // AIFF / AIFF-C
  if (magic === 'FORM' && size >= 12) {
    const form = tag(8);
    if (form === 'AIFF' || form === 'AIFC') {
      info.format = form === 'AIFC' ? 'AIFF-C' : 'AIFF';
      let offset = 12;
      while (offset + 8 < size) {
        const chunkId = tag(offset);
        const chunkSize = view.getUint32(offset + 4, false); // big endian
        if (chunkId === 'COMM' && offset + 14 <= size) {
          info.bitDepth = view.getInt16(offset + 14, false);
          break;
        }
        offset += 8 + chunkSize;
        if (chunkSize % 2 !== 0) offset++;
      }
      return info;
    }
  }

  // FLAC
  if (view.getUint8(0) === 0x66 && view.getUint8(1) === 0x4C &&
      view.getUint8(2) === 0x61 && view.getUint8(3) === 0x43) {
    info.format = 'FLAC';
    // STREAMINFO block starts at byte 4, metadata block header is 4 bytes
    // Bit depth is at bits 20..24 of byte offset 12 from STREAMINFO data start
    if (size >= 26) {
      const byte20 = view.getUint8(24);
      const byte21 = view.getUint8(25);
      info.bitDepth = ((byte20 & 0x01) << 4 | (byte21 >> 4)) + 1;
    }
    return info;
  }

  // MP3 — detect by sync word FF FB/FA/F3/F2 or ID3 header
  if ((view.getUint8(0) === 0xFF && (view.getUint8(1) & 0xE0) === 0xE0) ||
      tag(0).substring(0, 3) === 'ID3') {
    info.format = 'MP3';
    return info;
  }

  // OGG
  if (magic === 'OggS') {
    info.format = 'OGG';
    return info;
  }

  // AAC / M4A (ftyp box)
  if (size >= 8 && tag(4) === 'ftyp') {
    info.format = 'AAC/M4A';
    return info;
  }

  return info;
}

// ── Spectral analysis ──
function spectralAnalysis(samples, sampleRate, fftSize, hopSize) {
  const hann = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
  }

  const binFreq = sampleRate / fftSize;  // Hz per bin
  const half = fftSize / 2;

  // Band bin boundaries
  const binSubEnd   = Math.min(Math.floor(60 / binFreq), half);
  const binBassEnd  = Math.min(Math.floor(200 / binFreq), half);
  const binMidEnd   = Math.min(Math.floor(2000 / binFreq), half);
  const binHighEnd  = Math.min(Math.floor(20000 / binFreq), half);
  const binLowStart = Math.max(Math.floor(20 / binFreq), 1);

  let centroidSum = 0;
  let windowCount = 0;
  let bandSub = 0, bandBass = 0, bandLow = 0, bandMid = 0, bandHigh = 0;

  // Accumulate average magnitude spectrum
  const magAccum = new Float64Array(half + 1);

  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);

  for (let start = 0; start + fftSize <= samples.length; start += hopSize) {
    for (let i = 0; i < fftSize; i++) {
      re[i] = samples[start + i] * hann[i];
      im[i] = 0;
    }

    fft(re, im);

    let magSum = 0, weightedSum = 0;

    for (let k = 1; k <= half; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      const freq = k * binFreq;
      magSum += mag;
      weightedSum += freq * mag;
      magAccum[k] += mag;

      // Band accumulation (sub / bass / low / mid / high)
      if (k >= binLowStart && k < binSubEnd) bandSub += mag;
      else if (k >= binSubEnd && k < binBassEnd) bandBass += mag;

      if (k >= binLowStart && k < binBassEnd) bandLow  += mag;
      else if (k >= binBassEnd && k < binMidEnd) bandMid  += mag;
      else if (k >= binMidEnd && k < binHighEnd) bandHigh += mag;
    }

    if (magSum > 0) {
      centroidSum += weightedSum / magSum;
    }
    windowCount++;
  }

  const centroid = windowCount > 0 ? centroidSum / windowCount : 0;

  // Sub / Bass split ratio (of combined sub+bass energy)
  const subBassTotal = bandSub + bandBass;
  const sub  = subBassTotal > 0 ? bandSub  / subBassTotal : 0;
  const bass = subBassTotal > 0 ? bandBass / subBassTotal : 0;

  // Normalize band ratios (low = sub+bass combined)
  const bandTotal = bandLow + bandMid + bandHigh;
  const low  = bandTotal > 0 ? bandLow  / bandTotal : 0;
  const mid  = bandTotal > 0 ? bandMid  / bandTotal : 0;
  const high = bandTotal > 0 ? bandHigh / bandTotal : 0;

  // Build average spectrum (downsampled to ~256 log-spaced bins for charting)
  const numBins = 256;
  const minFreq = 20, maxFreq = Math.min(20000, sampleRate / 2);
  const logMin = Math.log10(minFreq), logMax = Math.log10(maxFreq);
  const avgSpectrum = new Float64Array(numBins);
  const spectrumFreqs = new Float64Array(numBins);

  for (let i = 0; i < numBins; i++) {
    const fLo = Math.pow(10, logMin + (logMax - logMin) * i / numBins);
    const fHi = Math.pow(10, logMin + (logMax - logMin) * (i + 1) / numBins);
    spectrumFreqs[i] = Math.sqrt(fLo * fHi);

    const kLo = Math.max(1, Math.floor(fLo / binFreq));
    const kHi = Math.min(half, Math.ceil(fHi / binFreq));
    let sum = 0, count = 0;
    for (let k = kLo; k <= kHi; k++) {
      sum += magAccum[k];
      count++;
    }
    const avgMag = count > 0 && windowCount > 0 ? sum / (count * windowCount) : 0;
    avgSpectrum[i] = avgMag > 0 ? 20 * Math.log10(avgMag) : -120;
  }

  // Hi-res bass spectrum: linear-spaced bins 20–300 Hz
  const bassNumBins = 128;
  const bassMinFreq = 20, bassMaxFreq = 300;
  const bassSpectrum = new Float64Array(bassNumBins);
  const bassSpectrumFreqs = new Float64Array(bassNumBins);
  const bassStep = (bassMaxFreq - bassMinFreq) / bassNumBins;

  for (let i = 0; i < bassNumBins; i++) {
    const fLo = bassMinFreq + bassStep * i;
    const fHi = bassMinFreq + bassStep * (i + 1);
    bassSpectrumFreqs[i] = (fLo + fHi) / 2;

    const kLo = Math.max(1, Math.floor(fLo / binFreq));
    const kHi = Math.min(half, Math.ceil(fHi / binFreq));
    let sum = 0, count = 0;
    for (let k = kLo; k <= kHi; k++) {
      sum += magAccum[k];
      count++;
    }
    const avgMag = count > 0 && windowCount > 0 ? sum / (count * windowCount) : 0;
    bassSpectrum[i] = avgMag > 0 ? 20 * Math.log10(avgMag) : -120;
  }

  return {
    centroid, sub, bass, low, mid, high,
    avgSpectrum: Array.from(avgSpectrum),
    spectrumFreqs: Array.from(spectrumFreqs),
    bassSpectrum: Array.from(bassSpectrum),
    bassSpectrumFreqs: Array.from(bassSpectrumFreqs),
  };
}

// ── Radix-2 Cooley-Tukey in-place FFT ──
function fft(re, im) {
  const N = re.length;
  if (N <= 1) return;

  // Bit-reversal permutation
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    while (j & bit) { j ^= bit; bit >>= 1; }
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  // Butterfly stages
  for (let size = 2; size <= N; size *= 2) {
    const halfSize = size / 2;
    const angle = -2 * Math.PI / size;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);

    for (let i = 0; i < N; i += size) {
      let curRe = 1, curIm = 0;
      for (let j = 0; j < halfSize; j++) {
        const a = i + j;
        const b = a + halfSize;
        const tRe = curRe * re[b] - curIm * im[b];
        const tIm = curRe * im[b] + curIm * re[b];
        re[b] = re[a] - tRe;
        im[b] = im[a] - tIm;
        re[a] += tRe;
        im[a] += tIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

// ════════════════════════════════════════════════════════════════
//  Bass Mono Compatibility (stereo correlation 20–200 Hz)
// ════════════════════════════════════════════════════════════════

function computeBassMonoCorrelation(L, R, sampleRate, fftSize, hopSize) {
  const hann = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
  }
  const binFreq = sampleRate / fftSize;
  const half = fftSize / 2;
  const kLo = Math.max(1, Math.floor(20 / binFreq));
  const kHi = Math.min(half, Math.ceil(200 / binFreq));

  let sumLR = 0, sumLL = 0, sumRR = 0;

  const reL = new Float64Array(fftSize), imL = new Float64Array(fftSize);
  const reR = new Float64Array(fftSize), imR = new Float64Array(fftSize);

  for (let start = 0; start + fftSize <= L.length; start += hopSize) {
    for (let i = 0; i < fftSize; i++) {
      reL[i] = L[start + i] * hann[i]; imL[i] = 0;
      reR[i] = R[start + i] * hann[i]; imR[i] = 0;
    }
    fft(reL, imL);
    fft(reR, imR);

    for (let k = kLo; k <= kHi; k++) {
      // Cross-spectral correlation in frequency domain
      const lMag = reL[k] * reL[k] + imL[k] * imL[k];
      const rMag = reR[k] * reR[k] + imR[k] * imR[k];
      const cross = reL[k] * reR[k] + imL[k] * imR[k]; // real part of L * conj(R)
      sumLR += cross;
      sumLL += lMag;
      sumRR += rMag;
    }
  }

  const denom = Math.sqrt(sumLL * sumRR);
  return denom > 0 ? sumLR / denom : 1;
}

// ════════════════════════════════════════════════════════════════
//  Bass Energy Over Time (20–200 Hz RMS in short windows)
// ════════════════════════════════════════════════════════════════

function computeBassEnergyOverTime(mono, sampleRate, fftSize) {
  const windowLen = fftSize;
  const hopLen = Math.round(sampleRate * 0.05); // 50ms hop
  const binFreq = sampleRate / fftSize;
  const half = fftSize / 2;
  const kLo = Math.max(1, Math.floor(20 / binFreq));
  const kHi = Math.min(half, Math.ceil(200 / binFreq));

  const hann = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
  }

  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  const result = [];

  for (let start = 0; start + windowLen <= mono.length; start += hopLen) {
    for (let i = 0; i < fftSize; i++) {
      re[i] = mono[start + i] * hann[i];
      im[i] = 0;
    }
    fft(re, im);

    let power = 0;
    for (let k = kLo; k <= kHi; k++) {
      power += re[k] * re[k] + im[k] * im[k];
    }
    const rmsDB = power > 0 ? 10 * Math.log10(power / (kHi - kLo + 1)) : -120;
    result.push({
      t: parseFloat((start / sampleRate).toFixed(2)),
      db: parseFloat(rmsDB.toFixed(1)),
    });
  }
  return result;
}

// ════════════════════════════════════════════════════════════════
//  Per-Band Crest Factor (Low / Mid / High)
// ════════════════════════════════════════════════════════════════

function computePerBandCrest(mono, sampleRate) {
  // Simple 2nd-order Butterworth-style bandpass approximation using FFT
  // Process entire signal, extract band via FFT, compute peak/RMS in time domain
  // For efficiency, use overlapping windows and accumulate per-band stats

  const fftSize = 4096;
  const half = fftSize / 2;
  const binFreq = sampleRate / fftSize;

  const bands = {
    low:  { lo: 20,   hi: 200  },
    mid:  { lo: 200,  hi: 2000 },
    high: { lo: 2000, hi: 20000 },
  };

  const result = {};

  for (const [name, { lo, hi }] of Object.entries(bands)) {
    const kLo = Math.max(1, Math.floor(lo / binFreq));
    const kHi = Math.min(half, Math.ceil(hi / binFreq));

    let bandPeak = 0, bandSumSq = 0, bandCount = 0;

    const hann = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
    }

    const re = new Float64Array(fftSize);
    const im = new Float64Array(fftSize);

    for (let start = 0; start + fftSize <= mono.length; start += fftSize) {
      for (let i = 0; i < fftSize; i++) {
        re[i] = mono[start + i] * hann[i];
        im[i] = 0;
      }
      fft(re, im);

      // Zero out-of-band bins, then IFFT to get band-limited signal
      for (let k = 0; k <= half; k++) {
        if (k < kLo || k > kHi) { re[k] = 0; im[k] = 0; }
      }
      // Mirror for negative freqs
      for (let k = half + 1; k < fftSize; k++) {
        const mk = fftSize - k;
        if (mk < kLo || mk > kHi) { re[k] = 0; im[k] = 0; }
      }

      // Inverse FFT: conjugate, FFT, conjugate, scale
      for (let i = 0; i < fftSize; i++) im[i] = -im[i];
      fft(re, im);
      for (let i = 0; i < fftSize; i++) {
        const val = re[i] / fftSize;
        const a = Math.abs(val);
        if (a > bandPeak) bandPeak = a;
        bandSumSq += val * val;
        bandCount++;
      }
    }

    const bandRMS = bandCount > 0 ? Math.sqrt(bandSumSq / bandCount) : 0;
    result[`crest${name.charAt(0).toUpperCase() + name.slice(1)}`] =
      bandRMS > 0 ? 20 * Math.log10(bandPeak / bandRMS) : 0;
  }

  return result;
}

// ════════════════════════════════════════════════════════════════
//  LUFS — ITU-R BS.1770-4
// ════════════════════════════════════════════════════════════════

/**
 * Compute K-weighting filter coefficients for a given sample rate.
 * Two cascaded biquad IIR filters:
 *   Stage 1: High-shelf (models acoustic effect of the head)
 *   Stage 2: High-pass (revised low-frequency weighting, ~60 Hz)
 * Coefficients from ITU-R BS.1770-4 Table 1 & 2 (48 kHz reference),
 * pre-warped via bilinear transform for other sample rates.
 */
function kWeightCoeffs(fs) {
  // Stage 1 — Pre-filter (high shelf)
  const f0  = 1681.974450955533;
  const G   = 3.999843853973347;   // dB
  const Q   = 0.7071752369554196;

  const K  = Math.tan(Math.PI * f0 / fs);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  const a0s = 1 + K / Q + K * K;

  const s1 = {
    b0: (Vh + Vb * K / Q + K * K) / a0s,
    b1: 2 * (K * K - Vh) / a0s,
    b2: (Vh - Vb * K / Q + K * K) / a0s,
    a1: 2 * (K * K - 1) / a0s,
    a2: (1 - K / Q + K * K) / a0s,
  };

  // Stage 2 — Revised low-frequency (RLB) high-pass
  const f1  = 38.13547087602444;
  const Q1  = 0.5003270373238773;
  const K1  = Math.tan(Math.PI * f1 / fs);
  const a0h = 1 + K1 / Q1 + K1 * K1;

  const s2 = {
    b0: 1 / a0h,
    b1: -2 / a0h,
    b2: 1 / a0h,
    a1: 2 * (K1 * K1 - 1) / a0h,
    a2: (1 - K1 / Q1 + K1 * K1) / a0h,
  };

  return [s1, s2];
}

/** Apply a cascade of biquad filters in-place. */
function applyBiquads(samples, coeffs) {
  const out = new Float64Array(samples.length);
  let src = samples;

  for (const { b0, b1, b2, a1, a2 } of coeffs) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < src.length; i++) {
      const x = src[i];
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      out[i] = y;
      x2 = x1; x1 = x;
      y2 = y1; y1 = y;
    }
    // Copy out -> src for next stage (reuse buffer)
    if (coeffs.length > 1) {
      for (let i = 0; i < out.length; i++) src[i] = out[i];
      src = out;
    }
  }
  return out;
}

/**
 * Full LUFS measurement: integrated, short-term max, momentary max,
 * momentary time series, and LRA.
 * @param {Float32Array[]} channels - Array of per-channel sample arrays
 * @param {number} sampleRate
 */
function computeLUFS(channels, sampleRate) {
  const coeffs = kWeightCoeffs(sampleRate);
  const numChannels = channels.length;
  const length = channels[0].length;

  // K-weight each channel
  const kWeighted = [];
  for (let ch = 0; ch < numChannels; ch++) {
    const input = new Float64Array(channels[ch]);
    kWeighted.push(applyBiquads(input, coeffs));
  }

  // Channel weight: 1.0 for L/R (channels 0,1), 1.41 for surround — for stereo/mono, all 1.0
  const chanWeight = new Float64Array(numChannels).fill(1.0);

  // Block size for momentary (400ms) and short-term (3s)
  const momentaryLen = Math.round(sampleRate * 0.4);
  const shortTermLen = Math.round(sampleRate * 3.0);
  const stepLen      = Math.round(sampleRate * 0.1); // 100ms hop

  // Compute mean-square per block per channel, then combine
  function blockLoudness(start, blockLen) {
    let sumPower = 0;
    for (let ch = 0; ch < numChannels; ch++) {
      let ss = 0;
      const end = Math.min(start + blockLen, length);
      for (let i = start; i < end; i++) {
        ss += kWeighted[ch][i] * kWeighted[ch][i];
      }
      sumPower += chanWeight[ch] * (ss / blockLen);
    }
    return -0.691 + 10 * Math.log10(sumPower);
  }

  // Momentary loudness time series
  const momentaryBlocks = [];
  const momentaryTimes  = [];
  for (let s = 0; s + momentaryLen <= length; s += stepLen) {
    momentaryBlocks.push(blockLoudness(s, momentaryLen));
    momentaryTimes.push(s / sampleRate);
  }

  // Short-term loudness blocks (for LRA)
  const shortTermBlocks = [];
  for (let s = 0; s + shortTermLen <= length; s += stepLen) {
    shortTermBlocks.push(blockLoudness(s, shortTermLen));
  }

  // Integrated loudness with gating (BS.1770-4 §5)
  // Step 1: absolute gate at -70 LUFS
  const absGated = momentaryBlocks.filter(l => l > -70);
  if (absGated.length === 0) {
    return {
      integrated: -Infinity,
      shortTermMax: shortTermBlocks.length > 0 ? Math.max(...shortTermBlocks) : -Infinity,
      momentaryMax: momentaryBlocks.length > 0 ? Math.max(...momentaryBlocks) : -Infinity,
      momentaryTimeSeries: momentaryBlocks.map((l, i) => ({ t: momentaryTimes[i], l })),
      lra: 0,
    };
  }

  // Mean of absolute-gated blocks (in linear power)
  let powerSum = 0;
  for (const l of absGated) powerSum += Math.pow(10, l / 10);
  const absGatedMean = 10 * Math.log10(powerSum / absGated.length);

  // Step 2: relative gate at absGatedMean - 10 LU
  const relThreshold = absGatedMean - 10;
  const relGated = absGated.filter(l => l > relThreshold);

  let intPowerSum = 0;
  for (const l of relGated) intPowerSum += Math.pow(10, l / 10);
  const integrated = relGated.length > 0
    ? 10 * Math.log10(intPowerSum / relGated.length) : -Infinity;

  // LRA (EBU R128)
  // Apply absolute gate (-70) then relative gate (-20 LU) to short-term blocks
  const stAbsGated = shortTermBlocks.filter(l => l > -70);
  let stPowerSum = 0;
  for (const l of stAbsGated) stPowerSum += Math.pow(10, l / 10);
  const stMean = stAbsGated.length > 0 ? 10 * Math.log10(stPowerSum / stAbsGated.length) : -70;
  const stRelGated = stAbsGated.filter(l => l > stMean - 20).sort((a, b) => a - b);

  let lra = 0;
  if (stRelGated.length >= 2) {
    const lo = stRelGated[Math.floor(stRelGated.length * 0.10)];
    const hi = stRelGated[Math.floor(stRelGated.length * 0.95)];
    lra = hi - lo;
  }

  return {
    integrated,
    shortTermMax: shortTermBlocks.length > 0 ? Math.max(...shortTermBlocks) : -Infinity,
    momentaryMax: momentaryBlocks.length > 0 ? Math.max(...momentaryBlocks) : -Infinity,
    momentaryTimeSeries: momentaryBlocks.map((l, i) => ({ t: parseFloat(momentaryTimes[i].toFixed(2)), l: parseFloat(l.toFixed(1)) })),
    lra,
  };
}

// ── Helpers ──
function toDBFS(value) {
  if (value <= 0) return -Infinity;
  return 20 * Math.log10(value);
}

function fmtDB(db) {
  if (!isFinite(db)) return '−∞';
  return db.toFixed(1);
}

function fmtDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1);
  return `${m}:${s.padStart(4, '0')}`;
}

function fmtSci(val) {
  if (val === 0) return '0';
  return val.toExponential(2);
}

// ════════════════════════════════════════════════════════════════
//  Rendering — Table (with column group toggles)
// ════════════════════════════════════════════════════════════════

// Column groups: each group has a label and an array of [header, extractor] pairs
const COLUMN_GROUPS = [
  { key: 'levels', label: 'Levels', default: true, cols: [
    ['Peak (dBFS)',       r => fmtDB(r.peakDB)],
    ['True Peak (dBTP)',  r => r.truePeakDB != null ? fmtDB(r.truePeakDB) : '—'],
    ['RMS (dBFS)',        r => fmtDB(r.rmsDB)],
    ['Crest Factor (dB)', r => fmtDB(r.crestFactor)],
    ['LUFS (Int.)',       r => fmtDB(r.lufsIntegrated)],
    ['Clipped Samples',   r => r.clippedSamples != null ? r.clippedSamples.toLocaleString() : '—'],
  ]},
  { key: 'loudness', label: 'Loudness', default: false, cols: [
    ['LUFS (ST Max)', r => fmtDB(r.lufsShortTermMax)],
    ['LRA (LU)',      r => r.lra.toFixed(1)],
    ['PLR (dB)',      r => r.plr.toFixed(1)],
  ]},
  { key: 'lowend', label: 'Low End', default: false, cols: [
    ['Bass Mono', r => r.bassMonoCorrelation.toFixed(3)],
    ['Sub %',     r => (r.sub * 100).toFixed(1) + '%'],
    ['Bass %',    r => (r.bass * 100).toFixed(1) + '%'],
  ]},
  { key: 'stereo', label: 'Stereo & Tone', default: false, cols: [
    ['DC Offset',              r => fmtSci(r.dcOffset)],
    ['Stereo Corr.',           r => r.stereoCorrelation.toFixed(3)],
    ['Spectral Centroid (Hz)', r => r.centroid.toFixed(0)],
    ['Low %',                  r => (r.low * 100).toFixed(1) + '%'],
    ['Mid %',                  r => (r.mid * 100).toFixed(1) + '%'],
    ['High %',                 r => (r.high * 100).toFixed(1) + '%'],
  ]},
  { key: 'fileinfo', label: 'File Info', default: false, cols: [
    ['Sample Rate',  r => r.sampleRate ? (r.sampleRate / 1000).toFixed(1) + ' kHz' : '—'],
    ['Channels',     r => r.numChannels || '—'],
    ['Bit Depth',    r => r.fileBitDepth ? r.fileBitDepth + '-bit' : '—'],
    ['Format',       r => r.fileFormat || '—'],
  ]},
  { key: 'silence', label: 'Silence', default: false, cols: [
    ['Lead Silence',  r => r.leadingSilence.toFixed(2) + 's'],
    ['Trail Silence', r => r.trailingSilence.toFixed(2) + 's'],
  ]},
];

// Core columns always shown (no toggle)
const CORE_COLUMNS = [
  ['Filename', r => r.filename, true],  // true = is filename col
  ['Duration', r => fmtDuration(r.duration)],
];

const activeGroups = new Set(COLUMN_GROUPS.filter(g => g.default).map(g => g.key));
let lastResults = [];

function renderTogglePills() {
  const container = document.getElementById('columnToggles');
  container.innerHTML = '';
  for (const group of COLUMN_GROUPS) {
    const pill = document.createElement('button');
    pill.className = 'col-toggle' + (activeGroups.has(group.key) ? ' active' : '');
    pill.textContent = group.label;
    pill.addEventListener('click', () => {
      if (activeGroups.has(group.key)) {
        activeGroups.delete(group.key);
      } else {
        activeGroups.add(group.key);
      }
      renderTogglePills();
      renderTable(lastResults);
    });
    container.appendChild(pill);
  }
}

function renderTable(results) {
  lastResults = results;
  tableHead.innerHTML = '';
  tableBody.innerHTML = '';

  const valid = results.filter(r => !r.error);
  const errors = results.filter(r => r.error);

  if (valid.length === 0) return;

  renderTogglePills();

  // Build visible column list: core + active groups
  const visibleCols = [...CORE_COLUMNS];
  for (const group of COLUMN_GROUPS) {
    if (activeGroups.has(group.key)) {
      for (const col of group.cols) {
        visibleCols.push(col);
      }
    }
  }

  // Render thead
  const headerRow = document.createElement('tr');
  for (const col of visibleCols) {
    const th = document.createElement('th');
    th.textContent = col[0];
    headerRow.appendChild(th);
  }
  tableHead.appendChild(headerRow);

  // Render tbody — one row per track
  for (const r of valid) {
    const tr = document.createElement('tr');
    for (const col of visibleCols) {
      const td = document.createElement('td');
      const isFilename = col[2] === true;
      if (isFilename) {
        td.className = 'filename';
        td.title = r.filename;
        td.textContent = r.filename;
      } else {
        td.textContent = col[1](r);
      }
      tr.appendChild(td);
    }
    tableBody.appendChild(tr);
  }

  // Show errors below (if any)
  if (errors.length > 0) {
    const errRow = document.createElement('tr');
    errRow.innerHTML = `<td class="filename">Error</td>
      <td colspan="${visibleCols.length - 1}" style="color:#f85149">${errors.map(r => esc(r.filename) + ': ' + esc(r.error)).join('<br>')}</td>`;
    tableBody.appendChild(errRow);
  }
}

function esc(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

// ════════════════════════════════════════════════════════════════
//  Rendering — Charts (ApexCharts)
// ════════════════════════════════════════════════════════════════

// Track chart instances so we can destroy before re-rendering
let chartInstances = [];

const CHART_THEME = {
  background: 'transparent',
  textColor:  'rgba(255,255,255,0.4)',
  gridColor:  'rgba(255,255,255,0.06)',
};

function renderCharts(results) {
  const valid = results.filter(r => !r.error);
  if (valid.length === 0) return;

  // Destroy previous chart instances
  for (const c of chartInstances) {
    try {
      if (typeof c.destroy === 'function') c.destroy();
      else if (c.chart && typeof c.chart.destroy === 'function') c.chart.destroy();
    } catch (e) {}
  }
  chartInstances = [];

  const labels = valid.map(r => truncate(r.filename, 20));

  chartInstances.push(drawRMSChart(labels, valid));
  chartInstances.push(drawLUFSChart(labels, valid));
  chartInstances.push(drawLoudnessTimeChart(valid));
  chartInstances.push(drawPLRChart(labels, valid));
  chartInstances.push(drawPerBandCrestChart(labels, valid));
  chartInstances.push(drawBassMonoChart(labels, valid));
  chartInstances.push(drawBassEnergyTimeChart(valid));
  chartInstances.push(drawBassSpectrumChart(valid));
  chartInstances.push(drawSubBassSplitChart(labels, valid));
  chartInstances.push(drawCentroidChart(labels, valid));
  chartInstances.push(drawBandChart(labels, valid));
  chartInstances.push(drawSpectralChart(valid));
  chartInstances.push(drawRadarChart(labels, valid));

  initFullscreenToggles();
}

function baseChartOptions(selector, title) {
  return {
    chart: {
      type: 'bar',
      height: 300,
      background: CHART_THEME.background,
      foreColor: CHART_THEME.textColor,
      toolbar: {
        show: true,
        tools: { download: true, zoom: false, pan: false, reset: false },
        export: {
          svg: { filename: 'soundcheck-chart' },
          png: { filename: 'soundcheck-chart' },
        },
      },
      animations: { enabled: true, easing: 'easeinout', speed: 400 },
    },
    theme: { mode: 'dark' },
    grid: {
      borderColor: CHART_THEME.gridColor,
      strokeDashArray: 3,
    },
    plotOptions: {
      bar: { borderRadius: 3, columnWidth: '55%' },
    },
    dataLabels: {
      enabled: true,
      style: { fontSize: '11px', colors: [CHART_THEME.textColor] },
      offsetY: -4,
    },
    tooltip: {
      theme: 'dark',
    },
  };
}

function drawRMSChart(labels, data) {
  const opts = {
    ...baseChartOptions('#rmsChart', 'RMS Comparison'),
    series: [{
      name: 'RMS',
      data: data.map(r => parseFloat(r.rmsDB.toFixed(1))),
    }],
    xaxis: {
      categories: labels,
      labels: { rotate: -45, style: { fontSize: '11px' } },
    },
    yaxis: {
      title: { text: 'dBFS' },
      labels: { formatter: v => v.toFixed(1) },
    },
    colors: ['#58a6ff'],
    dataLabels: {
      enabled: true,
      formatter: v => fmtDB(v),
      style: { fontSize: '10px', colors: ['#c9d1d9'] },
      offsetY: -6,
    },
  };
  const chart = new ApexCharts(document.getElementById('rmsChart'), opts);
  chart.render();
  return chart;
}

function drawCentroidChart(labels, data) {
  const opts = {
    ...baseChartOptions('#centroidChart', 'Spectral Centroid'),
    series: [{
      name: 'Centroid',
      data: data.map(r => parseFloat(r.centroid.toFixed(0))),
    }],
    xaxis: {
      categories: labels,
      labels: { rotate: -45, style: { fontSize: '11px' } },
    },
    yaxis: {
      title: { text: 'Hz' },
      labels: { formatter: v => v.toFixed(0) },
    },
    colors: ['#3fb950'],
    dataLabels: {
      enabled: true,
      formatter: v => `${v} Hz`,
      style: { fontSize: '10px', colors: ['#c9d1d9'] },
      offsetY: -6,
    },
  };
  const chart = new ApexCharts(document.getElementById('centroidChart'), opts);
  chart.render();
  return chart;
}

function drawBandChart(labels, data) {
  const opts = {
    ...baseChartOptions('#bandChart', 'Energy Ratios'),
    chart: {
      ...baseChartOptions('#bandChart').chart,
      type: 'bar',
      stacked: true,
      stackType: '100%',
    },
    series: [
      { name: 'Low (20–200 Hz)',   data: data.map(r => parseFloat((r.low  * 100).toFixed(1))) },
      { name: 'Mid (200–2k Hz)',   data: data.map(r => parseFloat((r.mid  * 100).toFixed(1))) },
      { name: 'High (2k–20k Hz)',  data: data.map(r => parseFloat((r.high * 100).toFixed(1))) },
    ],
    xaxis: {
      categories: labels,
      labels: { rotate: -45, style: { fontSize: '11px' } },
    },
    yaxis: {
      title: { text: '%' },
      labels: { formatter: v => `${v.toFixed(0)}%` },
    },
    colors: ['#1f6feb', '#3fb950', '#d29922'],
    dataLabels: {
      enabled: false,
    },
    legend: {
      position: 'top',
      labels: { colors: '#c9d1d9' },
    },
    tooltip: {
      theme: 'dark',
      y: { formatter: v => `${v.toFixed(1)}%` },
    },
  };
  const chart = new ApexCharts(document.getElementById('bandChart'), opts);
  chart.render();
  return chart;
}

// ── LUFS bar chart with streaming platform targets ──
function drawLUFSChart(labels, data) {
  const opts = {
    ...baseChartOptions('#lufsChart', 'Integrated LUFS'),
    series: [{
      name: 'Integrated LUFS',
      data: data.map(r => parseFloat(isFinite(r.lufsIntegrated) ? r.lufsIntegrated.toFixed(1) : -70)),
    }],
    xaxis: {
      categories: labels,
      labels: { rotate: -45, style: { fontSize: '11px' } },
    },
    yaxis: {
      title: { text: 'LUFS' },
      min: -30,
      max: 0,
      labels: { formatter: v => v.toFixed(0) },
    },
    colors: ['#bc8cff'],
    dataLabels: {
      enabled: true,
      formatter: v => fmtDB(v),
      style: { fontSize: '10px', colors: ['#c9d1d9'] },
      offsetY: -6,
    },
  };
  const chart = new ApexCharts(document.getElementById('lufsChart'), opts);
  chart.render();
  return chart;
}

// ── Loudness over time (momentary LUFS) ──
function drawLoudnessTimeChart(data) {
  const TRACK_COLORS = ['#58a6ff', '#3fb950', '#bc8cff', '#d29922', '#f85149',
    '#79c0ff', '#7ee787', '#d2a8ff', '#e3b341', '#ffa198'];

  const series = data.map((r, i) => ({
    name: truncate(r.filename, 20),
    data: r.lufsTimeSeries.map(p => ({ x: p.t, y: p.l })),
  }));

  const opts = {
    chart: {
      type: 'line',
      height: 350,
      background: CHART_THEME.background,
      foreColor: CHART_THEME.textColor,
      toolbar: { show: true, tools: { download: true, zoom: true, pan: true, reset: true } },
      animations: { enabled: false },
      zoom: { enabled: true },
    },
    theme: { mode: 'dark' },
    grid: { borderColor: CHART_THEME.gridColor, strokeDashArray: 3 },
    series,
    xaxis: {
      type: 'numeric',
      title: { text: 'Time (s)' },
      labels: { formatter: v => v.toFixed(0) + 's' },
    },
    yaxis: {
      title: { text: 'Momentary LUFS' },
      labels: { formatter: v => v.toFixed(0) },
    },
    stroke: { width: 1.5, curve: 'straight' },
    colors: TRACK_COLORS.slice(0, data.length),
    legend: { position: 'bottom', labels: { colors: '#c9d1d9' } },
    tooltip: {
      theme: 'dark',
      shared: false,
      x: { formatter: v => v.toFixed(1) + 's' },
      y: { formatter: v => v.toFixed(1) + ' LUFS' },
    },
    dataLabels: { enabled: false },
  };
  const chart = new ApexCharts(document.getElementById('loudnessTimeChart'), opts);
  chart.render();
  return chart;
}

// ── Spectral comparison (overlaid avg spectra, log frequency) ──
function drawSpectralChart(data) {
  const TRACK_COLORS = ['#58a6ff', '#3fb950', '#bc8cff', '#d29922', '#f85149',
    '#79c0ff', '#7ee787', '#d2a8ff', '#e3b341', '#ffa198'];

  // Downsample to ~64 display points for readability
  const step = Math.max(1, Math.floor(data[0].avgSpectrum.length / 64));
  const freqLabels = [];
  for (let i = 0; i < data[0].spectrumFreqs.length; i += step) {
    const f = data[0].spectrumFreqs[i];
    freqLabels.push(f >= 1000 ? (f / 1000).toFixed(1) + 'k' : f.toFixed(0));
  }

  const series = data.map((r, idx) => ({
    name: truncate(r.filename, 20),
    data: r.avgSpectrum.filter((_, i) => i % step === 0).map(v => parseFloat(v.toFixed(1))),
  }));

  const opts = {
    chart: {
      type: 'line',
      height: 350,
      background: CHART_THEME.background,
      foreColor: CHART_THEME.textColor,
      toolbar: { show: true, tools: { download: true, zoom: true, pan: true, reset: true } },
      animations: { enabled: false },
      zoom: { enabled: true },
    },
    theme: { mode: 'dark' },
    grid: { borderColor: CHART_THEME.gridColor, strokeDashArray: 3 },
    series,
    xaxis: {
      categories: freqLabels,
      title: { text: 'Frequency (Hz)' },
      labels: { rotate: -45, style: { fontSize: '9px' }, hideOverlappingLabels: true },
      tickAmount: 20,
    },
    yaxis: {
      title: { text: 'Magnitude (dB)' },
      labels: { formatter: v => v.toFixed(0) },
    },
    stroke: { width: 1.5, curve: 'smooth' },
    colors: TRACK_COLORS.slice(0, data.length),
    legend: { position: 'bottom', labels: { colors: '#c9d1d9' } },
    tooltip: { theme: 'dark', y: { formatter: v => v.toFixed(1) + ' dB' } },
    dataLabels: { enabled: false },
  };
  const chart = new ApexCharts(document.getElementById('spectralChart'), opts);
  chart.render();
  return chart;
}

// ── PLR (Peak-to-Loudness Ratio) bar chart ──
function drawPLRChart(labels, data) {
  const opts = {
    ...baseChartOptions('#plrChart', 'PLR'),
    series: [{
      name: 'PLR',
      data: data.map(r => parseFloat(r.plr.toFixed(1))),
    }],
    xaxis: {
      categories: labels,
      labels: { rotate: -45, style: { fontSize: '11px' } },
    },
    yaxis: {
      title: { text: 'dB' },
      min: 0,
      labels: { formatter: v => v.toFixed(1) },
    },
    colors: ['#d2a8ff'],
    dataLabels: {
      enabled: true,
      formatter: v => v.toFixed(1),
      style: { fontSize: '10px', colors: ['#c9d1d9'] },
      offsetY: -6,
    },
    annotations: {
      yaxis: [
        { y: 12, y2: 18, fillColor: 'rgba(63,185,80,0.08)', strokeDashArray: 0,
          label: { text: 'Typical range (12–18 dB)', style: { color: '#0e1117', background: '#3fb950', fontSize: '10px' }, position: 'front', offsetX: 80 } },
      ],
    },
  };
  const chart = new ApexCharts(document.getElementById('plrChart'), opts);
  chart.render();
  return chart;
}

// ── Per-band crest factor (grouped bar) ──
function drawPerBandCrestChart(labels, data) {
  const opts = {
    ...baseChartOptions('#perBandCrestChart', 'Per-Band Crest'),
    chart: {
      ...baseChartOptions('#perBandCrestChart').chart,
      type: 'bar',
    },
    series: [
      { name: 'Low (20–200 Hz)',   data: data.map(r => parseFloat(r.crestLow.toFixed(1))) },
      { name: 'Mid (200–2k Hz)',   data: data.map(r => parseFloat(r.crestMid.toFixed(1))) },
      { name: 'High (2k–20k Hz)',  data: data.map(r => parseFloat(r.crestHigh.toFixed(1))) },
    ],
    xaxis: {
      categories: labels,
      labels: { rotate: -45, style: { fontSize: '11px' } },
    },
    yaxis: {
      title: { text: 'Crest Factor (dB)' },
      labels: { formatter: v => v.toFixed(0) },
    },
    colors: ['#1f6feb', '#3fb950', '#d29922'],
    dataLabels: { enabled: false },
    legend: {
      position: 'top',
      labels: { colors: '#c9d1d9' },
    },
    tooltip: {
      theme: 'dark',
      y: { formatter: v => `${v.toFixed(1)} dB` },
    },
  };
  const chart = new ApexCharts(document.getElementById('perBandCrestChart'), opts);
  chart.render();
  return chart;
}

// ── Bass mono compatibility bar chart ──
function drawBassMonoChart(labels, data) {
  const opts = {
    ...baseChartOptions('#bassMonoChart', 'Bass Mono'),
    series: [{
      name: 'Bass Mono Correlation',
      data: data.map(r => parseFloat(r.bassMonoCorrelation.toFixed(3))),
    }],
    xaxis: {
      categories: labels,
      labels: { rotate: -45, style: { fontSize: '11px' } },
    },
    yaxis: {
      title: { text: 'Correlation' },
      min: -1,
      max: 1,
      labels: { formatter: v => v.toFixed(2) },
    },
    colors: ['#f0883e'],
    plotOptions: {
      bar: { borderRadius: 3, columnWidth: '55%' },
    },
    dataLabels: {
      enabled: true,
      formatter: v => v.toFixed(3),
      style: { fontSize: '10px', colors: ['#c9d1d9'] },
      offsetY: -6,
    },
    annotations: {
      yaxis: [
        { y: 0.9, borderColor: '#3fb950', strokeDashArray: 4,
          label: { text: 'Safe threshold (0.9)', style: { color: '#0e1117', background: '#3fb950', fontSize: '10px' }, position: 'front', offsetX: 60 } },
      ],
    },
  };
  const chart = new ApexCharts(document.getElementById('bassMonoChart'), opts);
  chart.render();
  return chart;
}

// ── Bass energy over time (line chart, zoomable) ──
function drawBassEnergyTimeChart(data) {
  const TRACK_COLORS = ['#58a6ff', '#3fb950', '#bc8cff', '#d29922', '#f85149',
    '#79c0ff', '#7ee787', '#d2a8ff', '#e3b341', '#ffa198'];

  const series = data.map((r, i) => ({
    name: truncate(r.filename, 20),
    data: r.bassEnergyTimeSeries.map(p => ({ x: p.t, y: p.db })),
  }));

  const opts = {
    chart: {
      type: 'line',
      height: 350,
      background: CHART_THEME.background,
      foreColor: CHART_THEME.textColor,
      toolbar: { show: true, tools: { download: true, zoom: true, pan: true, reset: true } },
      animations: { enabled: false },
      zoom: { enabled: true },
    },
    theme: { mode: 'dark' },
    grid: { borderColor: CHART_THEME.gridColor, strokeDashArray: 3 },
    series,
    xaxis: {
      type: 'numeric',
      title: { text: 'Time (s)' },
      labels: { formatter: v => v.toFixed(0) + 's' },
    },
    yaxis: {
      title: { text: 'Bass RMS (dB)' },
      labels: { formatter: v => v.toFixed(0) },
    },
    stroke: { width: 1.5, curve: 'straight' },
    colors: TRACK_COLORS.slice(0, data.length),
    legend: { position: 'bottom', labels: { colors: '#c9d1d9' } },
    tooltip: {
      theme: 'dark',
      shared: false,
      x: { formatter: v => v.toFixed(1) + 's' },
      y: { formatter: v => v.toFixed(1) + ' dB' },
    },
    dataLabels: { enabled: false },
  };
  const chart = new ApexCharts(document.getElementById('bassEnergyTimeChart'), opts);
  chart.render();
  return chart;
}

// ── Low-end spectral detail (20–300 Hz, hi-res, zoomable) ──
function drawBassSpectrumChart(data) {
  const TRACK_COLORS = ['#58a6ff', '#3fb950', '#bc8cff', '#d29922', '#f85149',
    '#79c0ff', '#7ee787', '#d2a8ff', '#e3b341', '#ffa198'];

  const freqLabels = data[0].bassSpectrumFreqs.map(f => f.toFixed(0));

  const series = data.map((r) => ({
    name: truncate(r.filename, 20),
    data: r.bassSpectrum.map(v => parseFloat(v.toFixed(1))),
  }));

  const opts = {
    chart: {
      type: 'line',
      height: 350,
      background: CHART_THEME.background,
      foreColor: CHART_THEME.textColor,
      toolbar: { show: true, tools: { download: true, zoom: true, pan: true, reset: true } },
      animations: { enabled: false },
      zoom: { enabled: true },
    },
    theme: { mode: 'dark' },
    grid: { borderColor: CHART_THEME.gridColor, strokeDashArray: 3 },
    series,
    xaxis: {
      categories: freqLabels,
      title: { text: 'Frequency (Hz)' },
      labels: { rotate: -45, style: { fontSize: '9px' }, hideOverlappingLabels: true },
      tickAmount: 20,
    },
    yaxis: {
      title: { text: 'Magnitude (dB)' },
      labels: { formatter: v => v.toFixed(0) },
    },
    stroke: { width: 2, curve: 'smooth' },
    colors: TRACK_COLORS.slice(0, data.length),
    legend: { position: 'bottom', labels: { colors: '#c9d1d9' } },
    tooltip: { theme: 'dark', y: { formatter: v => v.toFixed(1) + ' dB' } },
    dataLabels: { enabled: false },
    annotations: {
      xaxis: [
        { x: '60', borderColor: 'rgba(255,255,255,0.15)', strokeDashArray: 2,
          label: { text: '60 Hz', style: { color: '#c9d1d9', background: 'transparent', fontSize: '9px' } } },
        { x: '200', borderColor: 'rgba(255,255,255,0.15)', strokeDashArray: 2,
          label: { text: '200 Hz', style: { color: '#c9d1d9', background: 'transparent', fontSize: '9px' } } },
      ],
    },
  };
  const chart = new ApexCharts(document.getElementById('bassSpectrumChart'), opts);
  chart.render();
  return chart;
}

// ── Sub / Bass energy split (stacked bar) ──
function drawSubBassSplitChart(labels, data) {
  const opts = {
    ...baseChartOptions('#subBassSplitChart', 'Sub / Bass Split'),
    chart: {
      ...baseChartOptions('#subBassSplitChart').chart,
      type: 'bar',
      stacked: true,
      stackType: '100%',
    },
    series: [
      { name: 'Sub (20–60 Hz)',   data: data.map(r => parseFloat((r.sub  * 100).toFixed(1))) },
      { name: 'Bass (60–200 Hz)', data: data.map(r => parseFloat((r.bass * 100).toFixed(1))) },
    ],
    xaxis: {
      categories: labels,
      labels: { rotate: -45, style: { fontSize: '11px' } },
    },
    yaxis: {
      title: { text: '%' },
      labels: { formatter: v => `${v.toFixed(0)}%` },
    },
    colors: ['#1f6feb', '#79c0ff'],
    dataLabels: { enabled: false },
    legend: {
      position: 'top',
      labels: { colors: '#c9d1d9' },
    },
    tooltip: {
      theme: 'dark',
      y: { formatter: v => `${v.toFixed(1)}%` },
    },
  };
  const chart = new ApexCharts(document.getElementById('subBassSplitChart'), opts);
  chart.render();
  return chart;
}

// ── Dynamic range radar chart ──
function drawRadarChart(labels, data) {
  // Normalize each metric 0–1 relative to the set
  function normalize(arr) {
    const min = Math.min(...arr);
    const max = Math.max(...arr);
    const range = max - min;
    return arr.map(v => range > 0 ? (v - min) / range : 0.5);
  }

  const crests    = normalize(data.map(r => r.crestFactor));
  const lras      = normalize(data.map(r => r.lra));
  const stereos   = normalize(data.map(r => r.stereoCorrelation));
  const centroids = normalize(data.map(r => r.centroid));
  const headrooms = normalize(data.map(r => -r.peakDB)); // more headroom = higher

  const TRACK_COLORS = ['#58a6ff', '#3fb950', '#bc8cff', '#d29922', '#f85149',
    '#79c0ff', '#7ee787', '#d2a8ff', '#e3b341', '#ffa198'];

  const series = data.map((r, i) => ({
    name: truncate(r.filename, 20),
    data: [
      parseFloat((crests[i] * 100).toFixed(0)),
      parseFloat((lras[i] * 100).toFixed(0)),
      parseFloat((stereos[i] * 100).toFixed(0)),
      parseFloat((centroids[i] * 100).toFixed(0)),
      parseFloat((headrooms[i] * 100).toFixed(0)),
    ],
  }));

  const opts = {
    chart: {
      type: 'radar',
      height: 400,
      background: CHART_THEME.background,
      foreColor: CHART_THEME.textColor,
      toolbar: { show: true, tools: { download: true } },
    },
    theme: { mode: 'dark' },
    series,
    xaxis: {
      categories: ['Crest Factor', 'Loudness Range', 'Stereo Width', 'Brightness', 'Headroom'],
    },
    yaxis: { show: false },
    stroke: { width: 2 },
    fill: { opacity: 0.15 },
    markers: { size: 3 },
    colors: TRACK_COLORS.slice(0, data.length),
    legend: { position: 'bottom', labels: { colors: '#c9d1d9' } },
    tooltip: { theme: 'dark' },
    plotOptions: {
      radar: {
        polygons: {
          strokeColors: CHART_THEME.gridColor,
          connectorColors: CHART_THEME.gridColor,
          fill: { colors: ['transparent'] },
        },
      },
    },
  };
  const chart = new ApexCharts(document.getElementById('radarChart'), opts);
  chart.render();
  return chart;
}

function truncate(str, max) {
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

// ── Album Composition Analysis ──
function computeAlbumAnalysis(results) {
  const valid = results.filter(r => !r.error);
  if (valid.length < 2) return null;

  const totalDuration = valid.reduce((s, r) => s + r.duration, 0);
  const lufsValues = valid.map(r => r.lufsIntegrated);
  const centroidValues = valid.map(r => r.centroid);
  const lraValues = valid.map(r => r.lra);
  const plrValues = valid.map(r => r.plr);
  const bassEnergy = valid.map(r => r.sub + r.bass);

  const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  const stddev = arr => {
    const m = mean(arr);
    return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
  };

  // Track-to-track LUFS jumps
  const lufsDeltas = [];
  for (let i = 1; i < lufsValues.length; i++) {
    lufsDeltas.push({
      label: `${truncate(valid[i-1].filename, 12)} → ${truncate(valid[i].filename, 12)}`,
      delta: Math.abs(lufsValues[i] - lufsValues[i - 1])
    });
  }

  // Consistency scores (0–1, 1 = perfectly consistent)
  // Normalised as 1 / (1 + stddev)
  const consistency = {
    lufs: 1 / (1 + stddev(lufsValues)),
    centroid: 1 / (1 + stddev(centroidValues) / mean(centroidValues) * 10),
    lra: 1 / (1 + stddev(lraValues)),
    plr: 1 / (1 + stddev(plrValues)),
    bass: 1 / (1 + stddev(bassEnergy) / (mean(bassEnergy) || 1) * 10),
  };

  // Silence audit
  const leadSilences = valid.map(r => r.leadingSilence);
  const trailSilences = valid.map(r => r.trailingSilence);

  return {
    trackCount: valid.length,
    totalDuration,
    lufsMean: mean(lufsValues),
    lufsStddev: stddev(lufsValues),
    lufsRange: Math.max(...lufsValues) - Math.min(...lufsValues),
    lufsDeltas,
    centroidValues,
    lufsValues,
    lraValues,
    plrValues,
    bassEnergy,
    consistency,
    leadSilences,
    trailSilences,
    labels: valid.map(r => truncate(r.filename, 16)),
  };
}

function renderAlbumSection(album) {
  if (!album) {
    albumSection.classList.add('hidden');
    return;
  }
  albumSection.classList.remove('hidden');

  albumSummary.innerHTML = `
    <span class="stat-label">Tracks</span><span class="stat-value">${album.trackCount}</span> &nbsp;·&nbsp;
    <span class="stat-label">Total Duration</span><span class="stat-value">${fmtDuration(album.totalDuration)}</span> &nbsp;·&nbsp;
    <span class="stat-label">Mean LUFS</span><span class="stat-value">${album.lufsMean.toFixed(1)}</span> &nbsp;·&nbsp;
    <span class="stat-label">LUFS σ</span><span class="stat-value">${album.lufsStddev.toFixed(2)} LU</span> &nbsp;·&nbsp;
    <span class="stat-label">LUFS Range</span><span class="stat-value">${album.lufsRange.toFixed(1)} LU</span>
  `;

  drawAlbumArcChart(album);
  drawTrackJumpsChart(album);
  drawAlbumRadarChart(album);
  initFullscreenToggles();
}

function drawAlbumArcChart(album) {
  const existing = chartInstances.find(c => c.el === document.getElementById('albumArcChart'));
  if (existing) { existing.chart.destroy(); chartInstances.splice(chartInstances.indexOf(existing), 1); }

  const opts = {
    ...baseChartOptions(),
    chart: { type: 'line', height: 340, background: 'transparent', toolbar: { show: false } },
    series: [
      { name: 'LUFS (Int.)', data: album.lufsValues },
      { name: 'Centroid (Hz)', data: album.centroidValues },
    ],
    xaxis: { categories: album.labels, labels: { style: { colors: CHART_THEME.textColor } } },
    yaxis: [
      { title: { text: 'LUFS', style: { color: CHART_THEME.textColor } }, labels: { style: { colors: CHART_THEME.textColor } } },
      { opposite: true, title: { text: 'Hz', style: { color: CHART_THEME.textColor } }, labels: { style: { colors: CHART_THEME.textColor } } },
    ],
    stroke: { width: 2, curve: 'smooth' },
    markers: { size: 4 },
    colors: ['#58a6ff', '#f0883e'],
    legend: { labels: { colors: CHART_THEME.textColor } },
    tooltip: { theme: 'dark' },
  };
  const chart = new ApexCharts(document.getElementById('albumArcChart'), opts);
  chart.render();
  chartInstances.push({ el: document.getElementById('albumArcChart'), chart, opts });
}

function drawTrackJumpsChart(album) {
  const existing = chartInstances.find(c => c.el === document.getElementById('trackJumpsChart'));
  if (existing) { existing.chart.destroy(); chartInstances.splice(chartInstances.indexOf(existing), 1); }

  const opts = {
    ...baseChartOptions(),
    chart: { type: 'bar', height: 300, background: 'transparent', toolbar: { show: false } },
    series: [{ name: 'LUFS Jump', data: album.lufsDeltas.map(d => +d.delta.toFixed(2)) }],
    xaxis: { categories: album.lufsDeltas.map(d => d.label), labels: { style: { colors: CHART_THEME.textColor }, rotate: -30 } },
    yaxis: { title: { text: 'LU', style: { color: CHART_THEME.textColor } }, labels: { style: { colors: CHART_THEME.textColor } } },
    colors: ['#f85149'],
    plotOptions: { bar: { borderRadius: 4 } },
    tooltip: { theme: 'dark' },
    annotations: {
      yaxis: [{ y: 1, borderColor: 'rgba(255,255,255,0.15)', label: { text: '1 LU threshold', style: { color: '#aaa', background: 'transparent' } } }],
    },
  };
  const chart = new ApexCharts(document.getElementById('trackJumpsChart'), opts);
  chart.render();
  chartInstances.push({ el: document.getElementById('trackJumpsChart'), chart, opts });
}

function drawAlbumRadarChart(album) {
  const existing = chartInstances.find(c => c.el === document.getElementById('albumRadarChart'));
  if (existing) { existing.chart.destroy(); chartInstances.splice(chartInstances.indexOf(existing), 1); }

  const c = album.consistency;
  const opts = {
    ...baseChartOptions(),
    chart: { type: 'radar', height: 380, background: 'transparent', toolbar: { show: false } },
    series: [{ name: 'Consistency', data: [
      +(c.lufs * 100).toFixed(1),
      +(c.centroid * 100).toFixed(1),
      +(c.lra * 100).toFixed(1),
      +(c.plr * 100).toFixed(1),
      +(c.bass * 100).toFixed(1),
    ] }],
    xaxis: { categories: ['Loudness', 'Brightness', 'LRA', 'PLR', 'Bass Energy'] },
    yaxis: { show: false, max: 100 },
    fill: { opacity: 0.2 },
    markers: { size: 3 },
    colors: ['#58a6ff'],
    tooltip: { theme: 'dark' },
    plotOptions: {
      radar: {
        polygons: {
          strokeColors: CHART_THEME.gridColor,
          connectorColors: CHART_THEME.gridColor,
          fill: { colors: ['transparent'] },
        },
      },
    },
  };
  const chart = new ApexCharts(document.getElementById('albumRadarChart'), opts);
  chart.render();
  chartInstances.push({ el: document.getElementById('albumRadarChart'), chart, opts });
}

// ── Restore cached results on page load ──
(async function restoreFromCache() {
  const cached = await loadCachedResults();
  if (!cached || !cached.results || cached.results.length === 0) return;

  const results = cached.results;

  // Show the loaded-files state
  uploadArea.classList.add('hidden');
  filesLoadedArea.classList.remove('hidden');
  fileCount.textContent = `${results.length} track${results.length > 1 ? 's' : ''} (cached)`;

  // Render results
  renderTable(results);
  resultsDiv.classList.remove('hidden');
  renderCharts(results);

  if (!cached.skipAlbum) {
    const album = computeAlbumAnalysis(results);
    renderAlbumSection(album);
  } else {
    albumSection.classList.add('hidden');
  }

  status.textContent = `${results.length} track${results.length > 1 ? 's' : ''} restored from cache`;
})();
