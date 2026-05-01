// Shared expository submission panel
// Usage: mountExpoPanel({ containerId, targetTable, supabase })

export function mountExpoPanel({ containerId, targetTable, supabase }) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `
    <details class="expo-panel">
      <summary>📝 Submit by Description <span class="badge badge-amber" style="font-size:0.7rem;vertical-align:middle">Manual Review</span></summary>
      <div class="expo-body">
        <div class="expo-notice">
          ⚠️ <strong>Heads up:</strong> Submissions made this way require manual review and parsing before they appear in the system. Please allow additional time for processing.
        </div>
        <label>Your Name
          <input type="text" id="expo-name" placeholder="Jane Smith">
        </label>
        <label>Your Email
          <input type="email" id="expo-email" placeholder="jane@example.com">
        </label>
        <label>Description <span style="color:#ef4444">*</span>
          <textarea id="expo-description" required placeholder="Describe what you'd like added — include any relevant details, context, relationships, specifications, etc. The more detail, the better." style="min-height:130px"></textarea>
        </label>
        <label>Images (optional — max 3, JPG/PNG/WebP/GIF, 10MB each)
          <input type="file" id="expo-files" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" multiple>
        </label>
        <div id="expo-preview" class="expo-preview"></div>
        <button type="button" id="expo-submit">Submit for Review</button>
        <div class="msg" id="expo-msg"></div>
      </div>
    </details>
  `;

  const fileInput = document.getElementById('expo-files');
  const preview = document.getElementById('expo-preview');

  fileInput.addEventListener('change', () => {
    preview.innerHTML = '';
    const files = [...fileInput.files].slice(0, 3);
    files.forEach(f => {
      const url = URL.createObjectURL(f);
      const img = document.createElement('img');
      img.src = url;
      img.className = 'expo-thumb';
      preview.appendChild(img);
    });
    if (fileInput.files.length > 3) {
      const note = document.createElement('small');
      note.style.color = '#ef4444';
      note.textContent = 'Only the first 3 images will be uploaded.';
      preview.appendChild(note);
    }
  });

  document.getElementById('expo-submit').addEventListener('click', async () => {
    const msg = document.getElementById('expo-msg');
    msg.className = 'msg';
    const description = document.getElementById('expo-description').value.trim();
    if (!description) { msg.className = 'msg error'; msg.textContent = 'Description is required.'; return; }

    const btn = document.getElementById('expo-submit');
    btn.disabled = true;
    btn.textContent = 'Submitting…';

    const files = [...fileInput.files].slice(0, 3);
    const hasFiles = files.length > 0;

    // Insert submission row
    const { data: sub, error: subErr } = await supabase.from('submissions').insert({
      type: 'new_entry',
      target_table: targetTable,
      description,
      submitter_name: document.getElementById('expo-name').value.trim() || null,
      submitter_email: document.getElementById('expo-email').value.trim() || null,
      has_files: hasFiles,
      status: 'pending'
    }).select('id').single();

    if (subErr) {
      msg.className = 'msg error';
      msg.textContent = subErr.message;
      btn.disabled = false; btn.textContent = 'Submit for Review';
      return;
    }

    // Upload images
    if (hasFiles) {
      for (const file of files) {
        const ext = file.name.split('.').pop();
        const path = `${targetTable}/${sub.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: upErr } = await supabase.storage.from('network-media').upload(path, file, { upsert: false });
        if (upErr) { console.warn('File upload failed:', upErr.message); continue; }
        await supabase.from('submission_files').insert({
          submission_id: sub.id,
          storage_path: path,
          original_name: file.name,
          file_type: 'image',
          file_size_bytes: file.size
        });
      }
    }

    msg.className = 'msg success';
    msg.textContent = '✅ Submitted! Your entry is queued for manual review.';
    document.getElementById('expo-description').value = '';
    document.getElementById('expo-name').value = '';
    document.getElementById('expo-email').value = '';
    fileInput.value = '';
    preview.innerHTML = '';
    btn.disabled = false; btn.textContent = 'Submit for Review';
  });
}
