// submit-expository.js — Shared expository submission panel
// Usage: mountExpoPanel({ containerId, targetTable, supabase })

// \u2500\u2500 Structured templates per target table \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Each line is "Label: value" — the parser keys on these exact labels.
// Placeholder text after the colon guides the submitter; they replace it.
const TEMPLATES = {
  network_entities: `Company Name: e.g. Acme Industries LLC
Trade / DBA Name: e.g. Acme (leave blank if same as above)
Role: manufacturer | distributor | consumer | user_org
Website: e.g. https://acme.com
Email: e.g. contact@acme.com
Phone: e.g. +1 216 555 0100
Notes: any extra context, brands, product lines, history, etc.`,

  network_products: `Product Name: e.g. Timken 32207 Tapered Roller Bearing
Part Number: e.g. 32207
Description: what the product is, what it is used for, key specs
Notes: uncertainties, caveats, or manufacturer/entity links`,

  network_relationships: `From Entity ID: UUID of the source entity (distributor / buyer)
To Entity ID: UUID of the target entity (manufacturer / supplier)
Relationship Type: manufactures_for | distributes_for | purchases_from | end_user_of
Status: active | preferred | inactive | disqualified
Notes: context, agreement details, effective dates, etc.`,

  network_terms: `Entity ID: UUID of the entity these terms belong to
Title: e.g. Acme Authorized Distributor Terms
Body: full text of the terms and conditions`,
};

const DEFAULT_TEMPLATE = `Please describe what you'd like added — include any relevant details,
context, specifications, relationships, etc. The more detail, the better.`;

export function mountExpoPanel({ containerId, targetTable, supabase }) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const template   = TEMPLATES[targetTable] ?? DEFAULT_TEMPLATE;
  const hasTemplate = !!TEMPLATES[targetTable];

  container.innerHTML = `
    <details class="expo-panel">
      <summary>📝 Submit by Description <span class="badge badge-amber" style="font-size:0.7rem;vertical-align:middle">Manual Review</span></summary>
      <div class="expo-body">
        <div class="expo-notice">
          ⚠️ <strong>Heads up:</strong> Submissions go through an automated parse then human review before appearing in the system.
          ${hasTemplate
            ? '<br><br>📋 <strong>Use the template format below</strong> — fill in the values after each label. This helps the system extract your data accurately.'
            : ''}
        </div>
        <label>Your Name
          <input type="text" id="expo-name" placeholder="Jane Smith">
        </label>
        <label>Your Email
          <input type="email" id="expo-email" placeholder="jane@example.com">
        </label>
        <label>
          ${hasTemplate ? 'Submission <span style="color:#ef4444">*</span> <span style="color:#64748b;font-size:0.78rem;font-weight:400">— fill in the values after each colon</span>' : 'Description <span style="color:#ef4444">*</span>'}
          <textarea id="expo-description" required style="min-height:${hasTemplate ? '220px' : '130px'};font-family:monospace;font-size:0.82rem;line-height:1.6">${template}</textarea>
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

  // \u2500\u2500 File preview \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const fileInput = document.getElementById('expo-files');
  const preview   = document.getElementById('expo-preview');

  fileInput.addEventListener('change', () => {
    preview.innerHTML = '';
    const files = [...fileInput.files].slice(0, 3);
    files.forEach(f => {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(f);
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

  // \u2500\u2500 Submit \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  document.getElementById('expo-submit').addEventListener('click', async () => {
    const msg  = document.getElementById('expo-msg');
    msg.className = 'msg';
    const description = document.getElementById('expo-description').value.trim();

    // Reject if submitter left the raw template placeholder unchanged
    if (!description || description === template.trim()) {
      msg.className = 'msg error';
      msg.textContent = 'Please fill in the template fields before submitting.';
      return;
    }

    const btn = document.getElementById('expo-submit');
    btn.disabled = true;
    btn.textContent = 'Submitting\u2026';

    const files    = [...fileInput.files].slice(0, 3);
    const hasFiles = files.length > 0;

    const { data: sub, error: subErr } = await supabase.from('submissions').insert({
      type:             'new_entry',
      target_table:     targetTable,
      description,
      submitter_name:   document.getElementById('expo-name').value.trim()  || null,
      submitter_email:  document.getElementById('expo-email').value.trim() || null,
      has_files:        hasFiles,
      status:           'pending',
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
        const ext  = file.name.split('.').pop();
        const path = `${targetTable}/${sub.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: upErr } = await supabase.storage.from('network-media').upload(path, file, { upsert: false });
        if (upErr) { console.warn('File upload failed:', upErr.message); continue; }
        await supabase.from('submission_files').insert({
          submission_id: sub.id,
          storage_path:  path,
          original_name: file.name,
          file_type:     'image',
          file_size_bytes: file.size,
        });
      }
    }

    msg.className = 'msg success';
    msg.textContent = '✅ Submitted! Your entry is queued for review.';
    document.getElementById('expo-description').value = template; // reset to template
    document.getElementById('expo-name').value  = '';
    document.getElementById('expo-email').value = '';
    fileInput.value = '';
    preview.innerHTML = '';
    btn.disabled = false; btn.textContent = 'Submit for Review';
  });
}
