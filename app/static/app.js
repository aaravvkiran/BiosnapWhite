// ===================================================
// Eco Snap Application Logic
// Two-Panel Split Layout & Full-Featured Model Wiring
// ===================================================

let currentImageFile = null;
let activeWebcamStream = null;
let allCatalogSpecies = [];
let currentCategoryFilter = 'all';

function sanitizeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ---------------------------------------------------
// 1. Header Navigation Tabs
// ---------------------------------------------------
window.switchTab = function(tabKey) {
  const tabKeys = ['about', 'invasive-species', 'neighbor', 'tech-updates'];
  const btnMap = {
    'about': 'tabNavAbout',
    'invasive-species': 'tabNavInvasive',
    'neighbor': 'tabNavNeighbor',
    'tech-updates': 'tabNavTech'
  };
  const paneMap = {
    'about': 'paneViewAbout',
    'invasive-species': 'paneViewInvasive',
    'neighbor': 'paneViewNeighbor',
    'tech-updates': 'paneViewTech'
  };

  tabKeys.forEach(key => {
    const btn = document.getElementById(btnMap[key]);
    const pane = document.getElementById(paneMap[key]);
    if (btn) btn.classList.remove('active');
    if (pane) pane.style.display = 'none';
  });

  const targetBtn = document.getElementById(btnMap[tabKey]);
  const targetPane = document.getElementById(paneMap[tabKey]);
  if (targetBtn) targetBtn.classList.add('active');
  if (targetPane) targetPane.style.display = 'block';

  if (tabKey === 'invasive-species' && allCatalogSpecies.length === 0) {
    fetchCatalogFromAPI();
  }
};

// ---------------------------------------------------
// 2. Camera & Upload Management
// ---------------------------------------------------
window.openUploadDialog = function() {
  const fileInput = document.getElementById('fileUploadInput');
  if (fileInput) {
    fileInput.value = '';
    fileInput.click();
  }
};

window.handleFileInputChange = function(inputEl) {
  if (inputEl && inputEl.files && inputEl.files[0]) {
    onImageSelected(inputEl.files[0]);
  }
};

window.startCameraStream = async function() {
  const cameraState = document.getElementById('cardCameraState');
  const promptState = document.getElementById('cardPromptState');
  const resultsState = document.getElementById('cardResultsState');
  const videoEl = document.getElementById('webcamVideo');

  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    try {
      activeWebcamStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      if (videoEl) {
        videoEl.srcObject = activeWebcamStream;
      }
      if (promptState) promptState.style.display = 'none';
      if (resultsState) resultsState.style.display = 'none';
      if (cameraState) cameraState.style.display = 'block';
      return;
    } catch (err) {
      console.warn('Webcam stream unavailable or permission denied, using camera input fallback:', err);
    }
  }

  // Fallback to cameraCaptureInput
  const cameraInput = document.getElementById('cameraCaptureInput');
  if (cameraInput) {
    cameraInput.value = '';
    cameraInput.click();
  }
};

window.stopCameraStream = function() {
  if (activeWebcamStream) {
    activeWebcamStream.getTracks().forEach(t => t.stop());
    activeWebcamStream = null;
  }
  const videoEl = document.getElementById('webcamVideo');
  if (videoEl) videoEl.srcObject = null;

  const cameraState = document.getElementById('cardCameraState');
  const promptState = document.getElementById('cardPromptState');
  if (cameraState) cameraState.style.display = 'none';
  if (promptState) promptState.style.display = 'block';
};

window.captureCameraSnapshot = function() {
  const videoEl = document.getElementById('webcamVideo');
  if (!videoEl || !videoEl.videoWidth) return;

  const canvas = document.createElement('canvas');
  canvas.width = videoEl.videoWidth;
  canvas.height = videoEl.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

  canvas.toBlob(blob => {
    if (!blob) return;
    const file = new File([blob], 'snapshot.jpg', { type: 'image/jpeg' });
    stopCameraStream();
    onImageSelected(file);
  }, 'image/jpeg', 0.9);
};

window.resetToPrompt = function() {
  currentImageFile = null;
  stopCameraStream();

  const fileInput = document.getElementById('fileUploadInput');
  const cameraInput = document.getElementById('cameraCaptureInput');
  if (fileInput) fileInput.value = '';
  if (cameraInput) cameraInput.value = '';

  const promptState = document.getElementById('cardPromptState');
  const resultsState = document.getElementById('cardResultsState');
  const cameraState = document.getElementById('cardCameraState');
  const previewImg = document.getElementById('selectedImagePreview');
  const predContainer = document.getElementById('aiPredictionsContainer');
  const reportBox = document.getElementById('reportBoxModal');

  if (promptState) promptState.style.display = 'block';
  if (resultsState) resultsState.style.display = 'none';
  if (cameraState) cameraState.style.display = 'none';
  if (reportBox) reportBox.style.display = 'none';
  if (previewImg) previewImg.src = '';
  if (predContainer) predContainer.innerHTML = '';
};

// ---------------------------------------------------
// 3. Selection & BioCLIP 2 Inference
// ---------------------------------------------------
function onImageSelected(file) {
  if (!file || !file.type.startsWith('image/')) return;
  currentImageFile = file;

  const promptState = document.getElementById('cardPromptState');
  const cameraState = document.getElementById('cardCameraState');
  const resultsState = document.getElementById('cardResultsState');
  const previewImg = document.getElementById('selectedImagePreview');
  const statusBanner = document.getElementById('aiStatusBanner');
  const predContainer = document.getElementById('aiPredictionsContainer');

  if (promptState) promptState.style.display = 'none';
  if (cameraState) cameraState.style.display = 'none';
  if (resultsState) resultsState.style.display = 'block';

  if (previewImg) {
    previewImg.src = URL.createObjectURL(file);
  }
  if (statusBanner) {
    statusBanner.textContent = 'Analyzing image with BioCLIP 2...';
    statusBanner.style.color = '#8fa0b5';
  }
  if (predContainer) {
    predContainer.innerHTML = '';
  }

  // Trigger BioCLIP 2 inference
  sendImageForIdentification(file);
}

async function sendImageForIdentification(file) {
  const statusBanner = document.getElementById('aiStatusBanner');
  const predContainer = document.getElementById('aiPredictionsContainer');

  const fd = new FormData();
  fd.append('file', file);

  try {
    const res = await fetch('/api/identify', { method: 'POST', body: fd });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || 'Model identification failed.');
    }

    if (statusBanner) {
      statusBanner.textContent = data.possible_alb
        ? '⚠️ Potential Longhorn Beetle candidate detected.'
        : 'Identification complete.';
      statusBanner.style.color = data.possible_alb ? '#f87171' : '#4ade80';
    }

    let out = '';

    // Predictions List
    if (data.predictions && data.predictions.length > 0) {
      out += '<ul class="pred-list-clean">';
      data.predictions.forEach(p => {
        const pct = (p.model_score * 100).toFixed(1);
        const watchlistTag = p.in_local_catalog ? '<span class="tag-watchlist">Local Watchlist</span>' : '';
        const common = p.common_name_from_model || p.local_entry?.common_name || '';

        out += `
          <li class="pred-item-clean">
            <div class="pred-item-clean-top">
              <span><i>${sanitizeHtml(p.scientific_name)}</i> ${watchlistTag}</span>
              <span style="color:#4ade80;">${pct}%</span>
            </div>
            <div style="font-size:11.5px; color:#8fa0b5;">
              ${common ? `<span>${sanitizeHtml(common)} • </span>` : ''}
              <span>Genus: ${sanitizeHtml(p.genus || 'N/A')}</span>
              ${p.family ? ` • <span>Family: ${sanitizeHtml(p.family)}</span>` : ''}
            </div>
            <div class="pred-score-bar-bg">
              <div class="pred-score-bar-fill" style="width: ${Math.min(pct, 100)}%;"></div>
            </div>
          </li>
        `;
      });
      out += '</ul>';
    }

    // Lookalike Comparison (if Cerambycidae detected)
    if (data.lookalike_comparison && data.lookalike_comparison.length > 0) {
      out += `
        <div class="guidance-box-left" style="border-left-color: #f59e0b; background: rgba(245, 158, 11, 0.1); margin-bottom: 10px;">
          <strong style="color: #fbbf24;">⚠️ Cerambycidae Lookalike Ranking</strong>
          <p style="margin: 4px 0 6px; font-size: 11.5px; color:#cbd5e1;">Comparison against regulated pests and native sawyers:</p>
          <div style="display: flex; flex-direction: column; gap: 4px;">
      `;
      data.lookalike_comparison.forEach(item => {
        const sc = (item.relative_score * 100).toFixed(1);
        out += `
          <div style="display:flex; justify-content:space-between; font-size:11.5px; background:rgba(0,0,0,0.3); padding:4px 8px; border-radius:4px;">
            <span><i>${sanitizeHtml(item.scientific_name)}</i></span>
            <strong style="color:#fbbf24;">${sc}%</strong>
          </div>
        `;
      });
      out += '</div></div>';
    }

    // Safety Guidance
    const localEntry = data.predictions?.find(p => p.in_local_catalog);
    if (data.possible_alb) {
      out += `
        <div class="guidance-box-left" style="border-left-color: #ef4444; background: rgba(239, 68, 68, 0.1);">
          <strong style="color: #f87171;">Warning: Possible Asian Longhorned Beetle</strong>
          <p style="margin: 4px 0;">${sanitizeHtml(data.safety_note)}</p>
          ${data.official_alb_info ? `<p style="margin: 4px 0;"><a href="${sanitizeHtml(data.official_alb_info)}" target="_blank" rel="noopener" style="color: #f87171; text-decoration: underline;">USDA Reporting Info &rarr;</a></p>` : ''}
        </div>
      `;
    } else if (localEntry && localEntry.local_entry) {
      const e = localEntry.local_entry;
      out += `
        <div class="guidance-box-left">
          <strong style="color:#4ade80;">Local Catalog Match: ${sanitizeHtml(e.common_name)}</strong>
          <p style="margin: 3px 0;"><b>Area:</b> ${sanitizeHtml(e.evidence_area)}</p>
          <p style="margin: 3px 0;"><b>Damage:</b> ${sanitizeHtml(e.damage)}</p>
          <p style="margin: 3px 0;"><b>Safe Action:</b> ${sanitizeHtml(e.safe_action)}</p>
        </div>
      `;
    } else {
      out += `
        <div class="guidance-box-left" style="border-left-color: #64748b;">
          <strong>No Direct Match in 31-Species Catalog</strong>
          <p style="margin: 3px 0;">Organism may be native or non-invasive. Consult with an agricultural extension officer to verify.</p>
        </div>
      `;
    }

    if (predContainer) {
      predContainer.innerHTML = out;
    }

  } catch (err) {
    console.error('Inference error:', err);
    if (statusBanner) {
      statusBanner.textContent = 'Error: ' + err.message;
      statusBanner.style.color = '#ef4444';
    }
  }
}

// ---------------------------------------------------
// 4. Species Catalog API & Filters
// ---------------------------------------------------
async function fetchCatalogFromAPI() {
  const countLabel = document.getElementById('catalogTotalLabel');
  if (countLabel) countLabel.textContent = 'Loading species from municipal catalog...';

  try {
    const res = await fetch('/api/species');
    const data = await res.json();
    if (!Array.isArray(data)) return;

    allCatalogSpecies = data;

    // Populate species choices in report form
    const sel = document.getElementById('reportSpeciesSelect');
    if (sel) {
      data.slice().sort((a,b) => a.common_name.localeCompare(b.common_name)).forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.scientific_name;
        opt.textContent = `${s.common_name} (${s.scientific_name})`;
        sel.appendChild(opt);
      });
    }

    renderCatalogCards(allCatalogSpecies);
  } catch (err) {
    console.error('Failed to load catalog:', err);
    if (countLabel) countLabel.textContent = 'Failed to load species catalog.';
  }
}

function renderCatalogCards(speciesList) {
  const container = document.getElementById('speciesCardGrid');
  const countLabel = document.getElementById('catalogTotalLabel');
  if (!container) return;

  if (countLabel) {
    countLabel.textContent = `Showing ${speciesList.length} of ${allCatalogSpecies.length} species`;
  }

  container.innerHTML = speciesList.map(s => {
    const isPriority = s.scientific_name.includes('Lycorma') || s.scientific_name.includes('Anoplophora');
    return `
      <div class="species-item-box">
        <div class="species-title-row">
          <span class="species-common">${sanitizeHtml(s.common_name)}</span>
          <span class="${isPriority ? 'species-badge-red' : 'species-badge-green'}">
            ${isPriority ? 'High Urgency' : 'Monitored'}
          </span>
        </div>
        <div class="species-scientific">${sanitizeHtml(s.scientific_name)}</div>
        <p style="font-size:12px; color:#cbd5e1; line-height:1.45; margin-bottom:8px;">
          ${sanitizeHtml(s.damage)}
        </p>
        <div style="font-size:11.5px; color:#8fa0b5;">
          <b style="color:#94a3b8;">Safe action:</b> ${sanitizeHtml(s.safe_action)}
        </div>
      </div>
    `;
  }).join('');
}

window.applyCategoryFilter = function(category, btnEl) {
  currentCategoryFilter = category;
  document.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');
  filterCatalog();
};

window.onCatalogSearch = function(query) {
  filterCatalog();
};

function filterCatalog() {
  const q = (document.getElementById('catalogSearchQuery')?.value || '').trim().toLowerCase();
  let filtered = allCatalogSpecies;

  if (currentCategoryFilter !== 'all') {
    filtered = filtered.filter(s => {
      const cat = (s.evidence_area || '').toLowerCase() + ' ' + (s.common_name || '').toLowerCase();
      if (currentCategoryFilter === 'Insects') return cat.includes('beetle') || cat.includes('fly') || cat.includes('hornet') || cat.includes('borer') || cat.includes('aphid');
      if (currentCategoryFilter === 'Trees') return cat.includes('tree') || cat.includes('hardwood');
      if (currentCategoryFilter === 'Plants') return cat.includes('plant') || cat.includes('vine') || cat.includes('weed') || cat.includes('mustard') || cat.includes('knotweed');
      if (currentCategoryFilter === 'Aquatic') return cat.includes('reed') || cat.includes('water') || cat.includes('aquatic') || cat.includes('marsh');
      return true;
    });
  }

  if (q) {
    filtered = filtered.filter(s =>
      s.common_name.toLowerCase().includes(q) ||
      s.scientific_name.toLowerCase().includes(q) ||
      (s.damage || '').toLowerCase().includes(q)
    );
  }

  renderCatalogCards(filtered);
}

// ---------------------------------------------------
// 5. Reporting Modal & Submission
// ---------------------------------------------------
window.openReportModal = function() {
  const modal = document.getElementById('reportBoxModal');
  if (modal) {
    modal.style.display = modal.style.display === 'none' ? 'block' : 'none';
    if (modal.style.display === 'block') {
      modal.scrollIntoView({ behavior: 'smooth' });
    }
  }
};

window.handleReportSubmit = async function(e) {
  e.preventDefault();
  const out = document.getElementById('reportStatusOutput');
  if (!currentImageFile) {
    if (out) out.textContent = 'Please choose a photo before submitting.';
    return;
  }

  const fd = new FormData();
  fd.append('file', currentImageFile);
  fd.append('selected_species', document.getElementById('reportSpeciesSelect').value);
  fd.append('town', document.getElementById('reportTownSelect').value);
  fd.append('notes', document.getElementById('reportNotesInput').value);
  fd.append('consent', String(document.getElementById('reportConsentInput').checked));

  if (out) out.textContent = 'Submitting report...';

  try {
    const res = await fetch('/api/reports', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Failed to save report.');
    if (out) {
      out.textContent = `✓ Saved report ID: ${data.report_id.slice(0, 8)}. Awaiting expert review.`;
      out.style.color = '#4ade80';
    }
  } catch (err) {
    if (out) {
      out.textContent = 'Error: ' + err.message;
      out.style.color = '#ef4444';
    }
  }
};

// ---------------------------------------------------
// 6. Global Drag & Drop & Paste Listeners
// ---------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  // Pre-fetch catalog
  fetchCatalogFromAPI();

  // Drag and drop on scannerCard
  const card = document.getElementById('scannerCard');
  if (card) {
    ['dragenter', 'dragover'].forEach(name => {
      card.addEventListener(name, (e) => {
        e.preventDefault();
        card.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach(name => {
      card.addEventListener(name, (e) => {
        e.preventDefault();
        card.classList.remove('dragover');
      });
    });
    card.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      if (dt.files && dt.files[0]) {
        onImageSelected(dt.files[0]);
      }
    });
  }

  // Paste image from clipboard
  document.addEventListener('paste', e => {
    const file = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith('image/'));
    if (file) {
      e.preventDefault();
      onImageSelected(file);
    }
  });
});
