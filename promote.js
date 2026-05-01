// promote.js — Zone 2 → Zone 3 promotion logic
// Handles conflict detection and atomic write to master table + audit log.
//
// SUPPORTED TARGET TABLES for direct promotion:
//   network_entities, network_relationships, network_products, network_terms
//
// For unsupported tables, the agent must promote manually;
// this module will return an error so the UI surfaces it clearly.

// ── detectConflicts ──────────────────────────────────────────────────────────
// Given a target table and parsed_fields, check for known conflict conditions.
// Returns an array of conflict objects: { field, existing_value, incoming_value, severity }
export async function detectConflicts(supabase, targetTable, parsedFields) {
  const conflicts = [];

  if (targetTable === 'network_entities') {
    // Slug uniqueness
    if (parsedFields.slug) {
      const { data } = await supabase
        .from('network_entities')
        .select('id, legal_name')
        .eq('slug', parsedFields.slug)
        .maybeSingle();
      if (data) {
        conflicts.push({
          field: 'slug',
          existing_value: `${data.slug} (${data.legal_name})`,
          incoming_value: parsedFields.slug,
          severity: 'high'
        });
      }
    }
    // legal_name near-duplicate (case-insensitive)
    if (parsedFields.legal_name) {
      const { data } = await supabase
        .from('network_entities')
        .select('id, legal_name')
        .ilike('legal_name', parsedFields.legal_name)
        .maybeSingle();
      if (data) {
        conflicts.push({
          field: 'legal_name',
          existing_value: data.legal_name,
          incoming_value: parsedFields.legal_name,
          severity: 'medium'
        });
      }
    }
  }

  if (targetTable === 'network_products') {
    if (parsedFields.slug) {
      const { data } = await supabase
        .from('network_products')
        .select('id, name')
        .eq('slug', parsedFields.slug)
        .maybeSingle();
      if (data) {
        conflicts.push({
          field: 'slug',
          existing_value: `${parsedFields.slug} (${data.name})`,
          incoming_value: parsedFields.slug,
          severity: 'high'
        });
      }
    }
  }

  return conflicts;
}

// ── promoteToMaster ──────────────────────────────────────────────────────────
// Reads an approved intake_parsed record, writes to the correct master table,
// then writes an immutable intake_promote_log row.
// Returns { master_record_id, target_table } on success or { error: string }.
export async function promoteToMaster(supabase, intakeParsedId, promotedBy, agentNotes) {
  // 1. Fetch the parsed record
  const { data: ip, error: fetchErr } = await supabase
    .from('intake_parsed')
    .select('*')
    .eq('id', intakeParsedId)
    .single();

  if (fetchErr || !ip) return { error: fetchErr?.message || 'Parsed record not found.' };
  if (ip.stage !== 'approved') return { error: `Cannot promote: stage is "${ip.stage}", must be "approved".` };

  const payload = { ...ip.parsed_fields };
  const table   = ip.target_table;
  let master_record_id;
  let operation = 'insert';

  // 2. Write to master table
  const SUPPORTED = ['network_entities', 'network_relationships', 'network_products', 'network_terms'];
  if (!SUPPORTED.includes(table)) {
    return { error: `Table "${table}" is not yet supported for direct promotion. Promote manually and log via the agent_notes field.` };
  }

  // If target_record_id is set, UPDATE; otherwise INSERT
  if (ip.target_record_id) {
    operation = 'update';
    const { error: upErr } = await supabase
      .from(table)
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', ip.target_record_id);
    if (upErr) return { error: upErr.message };
    master_record_id = ip.target_record_id;
  } else {
    // Ensure status defaults to 'published' for promoted records
    if (!payload.status) payload.status = 'published';
    const { data: inserted, error: insErr } = await supabase
      .from(table)
      .insert(payload)
      .select('id')
      .single();
    if (insErr) return { error: insErr.message };
    master_record_id = inserted.id;
  }

  // 3. Write immutable audit log
  const { error: logErr } = await supabase.from('intake_promote_log').insert({
    intake_parsed_id: intakeParsedId,
    submission_id:    ip.submission_id,
    target_table:     table,
    master_record_id,
    operation,
    promoted_payload: payload,
    promoted_by:      promotedBy,
    agent_notes:      agentNotes || null
  });
  if (logErr) {
    // Promote succeeded but log failed — surface as warning, not fatal
    console.warn('Promote log write failed:', logErr.message);
  }

  // 4. Mark parsed record as promoted
  await supabase.from('intake_parsed').update({
    stage: 'promoted',
    reviewed_by: promotedBy,
    reviewed_at: new Date().toISOString(),
    agent_notes: agentNotes || ip.agent_notes
  }).eq('id', intakeParsedId);

  // 5. Mark source submission accepted
  if (ip.submission_id) {
    await supabase.from('submissions').update({ status: 'accepted' }).eq('id', ip.submission_id);
  }

  return { master_record_id, target_table: table, operation };
}
