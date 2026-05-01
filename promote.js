// promote.js — Intake Zone 2 → Zone 3 promotion logic
// Handles conflict detection and atomic write to master table + audit log.
//
// SUPPORTED TARGET TABLES for direct promotion:
//   network_entities, network_relationships, network_products, network_terms
//
// For unsupported tables the agent must promote manually;
// this module returns an error so the UI surfaces it clearly.

// ── detectConflicts ──────────────────────────────────────────────────────────
// Given a target table and parsed_fields, check for known conflict conditions.
// Returns an array: [{ field, existing_value, incoming_value, severity }]
export async function detectConflicts(supabase, targetTable, parsedFields) {
  const conflicts = [];

  // ── network_entities ────────────────────────────────────────────────────
  if (targetTable === 'network_entities') {
    if (parsedFields.slug) {
      const { data } = await supabase
        .from('network_entities').select('id, legal_name')
        .eq('slug', parsedFields.slug).maybeSingle();
      if (data) conflicts.push({
        field: 'slug',
        existing_value: `${parsedFields.slug} (${data.legal_name})`,
        incoming_value: parsedFields.slug,
        severity: 'high'
      });
    }
    if (parsedFields.legal_name) {
      const { data } = await supabase
        .from('network_entities').select('id, legal_name')
        .ilike('legal_name', parsedFields.legal_name).maybeSingle();
      if (data) conflicts.push({
        field: 'legal_name',
        existing_value: data.legal_name,
        incoming_value: parsedFields.legal_name,
        severity: 'medium'
      });
    }
  }

  // ── network_products ────────────────────────────────────────────────────
  if (targetTable === 'network_products') {
    if (parsedFields.slug) {
      const { data } = await supabase
        .from('network_products').select('id, name')
        .eq('slug', parsedFields.slug).maybeSingle();
      if (data) conflicts.push({
        field: 'slug',
        existing_value: `${parsedFields.slug} (${data.name})`,
        incoming_value: parsedFields.slug,
        severity: 'high'
      });
    }
    if (parsedFields.part_number) {
      const { data } = await supabase
        .from('network_products').select('id, name')
        .eq('part_number', parsedFields.part_number).maybeSingle();
      if (data) conflicts.push({
        field: 'part_number',
        existing_value: `${parsedFields.part_number} (${data.name})`,
        incoming_value: parsedFields.part_number,
        severity: 'high'
      });
    }
  }

  // ── network_relationships ───────────────────────────────────────────────
  if (targetTable === 'network_relationships') {
    if (parsedFields.from_entity_id && parsedFields.to_entity_id && parsedFields.rel_type) {
      const { data } = await supabase
        .from('network_relationships').select('id, rel_type, status')
        .eq('from_entity_id', parsedFields.from_entity_id)
        .eq('to_entity_id',   parsedFields.to_entity_id)
        .eq('rel_type',       parsedFields.rel_type)
        .maybeSingle();
      if (data) conflicts.push({
        field: 'from_entity_id + to_entity_id + rel_type',
        existing_value: `Relationship already exists (status: ${data.status})`,
        incoming_value: `${parsedFields.rel_type} from ${parsedFields.from_entity_id} → ${parsedFields.to_entity_id}`,
        severity: 'high'
      });
    }
  }

  // ── network_terms ───────────────────────────────────────────────────────
  if (targetTable === 'network_terms') {
    if (parsedFields.entity_id && parsedFields.title) {
      const { data } = await supabase
        .from('network_terms').select('id, title')
        .eq('entity_id', parsedFields.entity_id)
        .ilike('title', parsedFields.title)
        .maybeSingle();
      if (data) conflicts.push({
        field: 'title',
        existing_value: `"${data.title}" already exists for this entity`,
        incoming_value: parsedFields.title,
        severity: 'medium'
      });
    }
  }

  return conflicts;
}

// ── promoteToMaster ──────────────────────────────────────────────────────────
// Reads an approved intake_parsed record, writes to the correct master table,
// then writes an immutable intake_promote_log row.
// Returns { master_record_id, target_table, operation } on success or { error }.
export async function promoteToMaster(supabase, intakeParsedId, promotedBy, agentNotes) {
  // 1. Fetch the parsed record
  const { data: ip, error: fetchErr } = await supabase
    .from('intake_parsed').select('*')
    .eq('id', intakeParsedId).single();

  if (fetchErr || !ip) return { error: fetchErr?.message || 'Parsed record not found.' };
  if (ip.stage !== 'approved') return { error: `Cannot promote: stage is "${ip.stage}", must be "approved".` };

  const payload = { ...ip.parsed_fields };
  const table   = ip.target_table;

  const SUPPORTED = ['network_entities', 'network_relationships', 'network_products', 'network_terms'];
  if (!SUPPORTED.includes(table)) {
    return { error: `Table "${table}" is not yet supported for direct promotion. Promote manually and record via agent_notes.` };
  }

  let master_record_id;
  let operation = 'insert';

  // 2. Write to master table — UPDATE if target_record_id set, else INSERT
  if (ip.target_record_id) {
    operation = 'update';
    const { error: upErr } = await supabase
      .from(table)
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', ip.target_record_id);
    if (upErr) return { error: upErr.message };
    master_record_id = ip.target_record_id;
  } else {
    // Apply safe defaults for new records
    if (!payload.status)    payload.status    = 'published';
    if (table === 'network_entities' && payload.is_active === undefined) payload.is_active = true;
    if (table === 'network_products' && payload.is_active === undefined) payload.is_active = true;
    if (table === 'network_terms'    && payload.is_active === undefined) payload.is_active = true;

    const { data: inserted, error: insErr } = await supabase
      .from(table).insert(payload).select('id').single();
    if (insErr) return { error: insErr.message };
    master_record_id = inserted.id;
  }

  // 3. Immutable audit log
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
  if (logErr) console.warn('Promote log write failed:', logErr.message);

  // 4. Mark parsed record promoted
  await supabase.from('intake_parsed').update({
    stage:       'promoted',
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
