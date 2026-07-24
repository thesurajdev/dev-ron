import { createClient } from '@supabase/supabase-js';
import type { Entity, Activity, Metric } from '../types/index.js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.warn('Warning: Missing Supabase environment variables. Database operations will fail.');
}

export const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseKey || 'placeholder');

const unifiedTableAvailability: Record<string, boolean | undefined> = {};

function isMissingTableError(error: any): boolean {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return code === '42P01' || message.includes('does not exist');
}

async function runWithUnifiedTable(table: string, op: () => Promise<void>) {
  if (unifiedTableAvailability[table] === false) return;

  try {
    await op();
    unifiedTableAvailability[table] = true;
  } catch (error: any) {
    if (isMissingTableError(error)) {
      unifiedTableAvailability[table] = false;
      console.warn(`[dual-write] '${table}' table unavailable, skipping unified writes.`);
      return;
    }
    // Keep core runtime resilient: unified writes are best-effort.
    console.warn(`[dual-write] failed writing to '${table}': ${error?.message || error}`);
  }
}

function deriveObjectTitle(data: Record<string, any>): string | null {
  const candidates = [
    data?.title,
    data?.name,
    data?.company_name,
    data?.company,
    data?.subject,
    data?.invoice_no,
  ];

  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (value) return value;
  }

  return null;
}

async function mirrorEntityAsObject(
  userId: string,
  entityId: string,
  entityType: string,
  data: Record<string, any>
) {
  await runWithUnifiedTable('objects', async () => {
    const objectRow = {
      id: entityId,
      user_id: userId,
      type: entityType || 'unknown',
      title: deriveObjectTitle(data || {}),
      status: data?.status ? String(data.status) : null,
      properties: data || {},
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('objects')
      .upsert(objectRow, { onConflict: 'id' });

    if (error) throw error;
  });
}

async function mirrorRelation(
  userId: string,
  fromObject: string,
  relation: string,
  toObject: string,
  confidence = 100,
  properties: Record<string, any> = {}
) {
  await runWithUnifiedTable('relations', async () => {
    const relationRow = {
      user_id: userId,
      from_object: fromObject,
      relation,
      to_object: toObject,
      confidence,
      properties,
      created_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('relations')
      .upsert(relationRow, { onConflict: 'user_id,from_object,relation,to_object' });

    if (error) throw error;
  });
}

async function mirrorEvent(
  userId: string,
  type: string,
  objectId: string | null,
  payload: Record<string, any>
) {
  await runWithUnifiedTable('events', async () => {
    const { error } = await supabase
      .from('events')
      .insert({
        user_id: userId,
        type,
        object_id: objectId,
        timestamp: new Date().toISOString(),
        payload,
      });

    if (error) throw error;
  });
}

async function mirrorHistory(
  userId: string,
  objectId: string,
  action: string,
  beforeState: Record<string, any> | null,
  afterState: Record<string, any> | null,
  changedFields: string[] = []
) {
  await runWithUnifiedTable('history', async () => {
    const { error } = await supabase
      .from('history')
      .insert({
        user_id: userId,
        object_id: objectId,
        action,
        before_state: beforeState,
        after_state: afterState,
        changed_fields: changedFields,
        created_at: new Date().toISOString(),
      });

    if (error) throw error;
  });
}

function toUuidList(involvedEntities: Array<{ entity_id: string; role: string }> = []): string[] {
  return involvedEntities
    .map((e) => String(e?.entity_id || '').trim())
    .filter(Boolean);
}

function toInvolvedEntityObjects(value: any): Array<{ entity_id: string; role: string }> {
  if (!Array.isArray(value)) return [];

  // Legacy/new shape: [{ entity_id, role }]
  if (value.length === 0 || typeof value[0] === 'object') {
    return value
      .map((e: any) => ({
        entity_id: String(e?.entity_id || '').trim(),
        role: String(e?.role || 'related').trim() || 'related',
      }))
      .filter((e) => Boolean(e.entity_id));
  }

  // UUID[] shape from older deployments.
  return value
    .map((id: any) => String(id || '').trim())
    .filter(Boolean)
    .map((entity_id) => ({ entity_id, role: 'related' }));
}

function normalizeActivityRow(row: any) {
  const involvedFromV2 = toInvolvedEntityObjects(row?.involved_entities_v2);
  const involvedFromPrimary = toInvolvedEntityObjects(row?.involved_entities);

  return {
    ...row,
    involved_entities: involvedFromV2.length > 0 ? involvedFromV2 : involvedFromPrimary,
  };
}

function sanitizeSearchQuery(query: string): string {
  return String(query || '')
    .replace(/[%(),?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeSearchQuery(query: string): string[] {
  return sanitizeSearchQuery(query)
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function normalizeDigits(value: any): string {
  return String(value ?? '').replace(/\D+/g, '');
}

function tokenMatchesHaystack(haystack: string, token: string, haystackDigits: string): boolean {
  if (!token) return false;
  if (haystack.includes(token)) return true;

  // Support phone-like queries where formatting differs (e.g. +91 88008 15510 vs 8800815510).
  const tokenDigits = normalizeDigits(token);
  if (tokenDigits.length >= 7 && haystackDigits.includes(tokenDigits)) {
    return true;
  }

  return false;
}

function objectMatchesTokens(candidate: any, tokens: string[]): boolean {
  if (tokens.length === 0) return true;

  const haystack = [
    candidate?.entity_type,
    (candidate?.tags || []).join(' '),
    JSON.stringify(candidate?.data || {}),
    JSON.stringify(candidate?.related_to || []),
  ]
    .map((v) => normalizePrimitive(v))
    .join(' ');

  const haystackDigits = normalizeDigits(haystack);

  const matched = tokens.filter((t) => tokenMatchesHaystack(haystack, t, haystackDigits)).length;
  if (tokens.length <= 2) return matched >= 1;
  return matched >= Math.ceil(tokens.length * 0.6);
}

function isPlainObject(value: any): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizePrimitive(value: any): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim().toLowerCase();
  return String(value).trim().toLowerCase();
}

function flattenObject(
  input: any,
  prefix = '',
  out: Array<{ key: string; value: string }> = []
): Array<{ key: string; value: string }> {
  if (Array.isArray(input)) {
    input.forEach((item, index) => flattenObject(item, `${prefix}[${index}]`, out));
    return out;
  }

  if (isPlainObject(input)) {
    Object.entries(input).forEach(([k, v]) => {
      const next = prefix ? `${prefix}.${k}` : k;
      flattenObject(v, next, out);
    });
    return out;
  }

  const normalized = normalizePrimitive(input);
  if (normalized) {
    out.push({ key: prefix || 'value', value: normalized });
  }

  return out;
}

function canonicalString(value: any): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalString).join(',')}]`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${k}:${canonicalString(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function uniqueArray(values: any[]): any[] {
  const seen = new Set<string>();
  const result: any[] = [];
  values.forEach((v) => {
    const key = canonicalString(v);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(v);
    }
  });
  return result;
}

function deepMergeData(existing: any, incoming: any): any {
  if (Array.isArray(existing) && Array.isArray(incoming)) {
    return uniqueArray([...existing, ...incoming]);
  }

  if (isPlainObject(existing) && isPlainObject(incoming)) {
    const merged: Record<string, any> = { ...existing };
    for (const [key, incomingValue] of Object.entries(incoming)) {
      if (!(key in merged)) {
        merged[key] = incomingValue;
        continue;
      }
      merged[key] = deepMergeData(merged[key], incomingValue);
    }
    return merged;
  }

  // Prefer new scalar values while preserving history separately.
  return incoming;
}

/**
 * Initialize Supabase tables
 * Schema is now flexible and entity-centric
 */
export async function initializeDatabase() {
  try {
    const { data, error } = await supabase
      .from('entities')
      .select('id')
      .limit(1);

    if (error?.code === 'PGRST116') {
      console.log('Creating flexible entity schema...');
      // SQL to run manually in Supabase:
      // CREATE TABLE entities (
      //   id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      //   user_id TEXT NOT NULL,
      //   entity_type TEXT NOT NULL,
      //   created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      //   updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      //   last_activity TIMESTAMP WITH TIME ZONE,
      //   data JSONB NOT NULL DEFAULT '{}'::jsonb,
      //   related_to JSONB DEFAULT '[]'::jsonb,
      //   history JSONB DEFAULT '[]'::jsonb,
      //   tags TEXT[] DEFAULT ARRAY[]::TEXT[],
      //   source TEXT,
      //   confidence INTEGER DEFAULT 100,
      //   CONSTRAINT fk_user_id FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
      // );
      // CREATE INDEX idx_user_type ON entities(user_id, entity_type);
      // CREATE INDEX idx_user_data ON entities USING GIN(data);
      // CREATE INDEX idx_tags ON entities USING GIN(tags);
      // CREATE INDEX idx_user_created ON entities(user_id, created_at DESC);
    } else if (!error) {
      console.log('Entity tables ready');
    }
  } catch (err) {
    console.error('Database initialization error:', err);
  }
}

/**
 * Smart entity matching - find existing entity or create new one
 * Checks for similar entities based on data
 */
export async function findOrCreateEntity(
  userId: string,
  entityType: string,
  data: Record<string, any>,
  tags: string[] = []
): Promise<string> {
  // Search for existing entity with similar data
  let existingQuery = supabase
    .from('entities')
    .select('id, data, confidence, entity_type, tags')
    .eq('user_id', userId)
    .limit(100);

  if (entityType && entityType !== 'unknown') {
    existingQuery = existingQuery.eq('entity_type', entityType);
  }

  const { data: existingEntities } = await existingQuery;

  if (existingEntities && existingEntities.length > 0) {
    // Try to find matching entity based on key identifiers
    const matchScore = existingEntities.map((e: any) => ({
      id: e.id,
      score: calculateMatchScore(e.data, data, e.entity_type, entityType, e.tags, tags),
    }));

    const bestMatch = matchScore.sort((a, b) => b.score - a.score)[0];

    // Strong confidence match means same entity; update instead of creating duplicate.
    if (bestMatch.score >= 70) {
      await mirrorEntityAsObject(userId, bestMatch.id, entityType, data || {});
      return bestMatch.id;
    }
  }

  // Create new entity
  const { data: newEntity, error } = await supabase
    .from('entities')
    .insert({
      user_id: userId,
      entity_type: entityType,
      data,
      tags,
      confidence: 100,
    })
    .select('id')
    .single();

  if (error) throw error;

  await mirrorEntityAsObject(userId, newEntity.id, entityType, data || {});
  await mirrorEvent(userId, 'entity_created', newEntity.id, {
    entity_type: entityType,
    data,
    tags,
  });

  return newEntity.id;
}

/**
 * Calculate match score between two data objects (0-100)
 * Higher score = more likely same entity
 */
function calculateMatchScore(
  existing: Record<string, any>,
  incoming: Record<string, any>,
  existingType?: string,
  incomingType?: string,
  existingTags: string[] = [],
  incomingTags: string[] = []
): number {
  return Math.min(
    100,
    calculateFlexibleMatchScore(
      existing,
      incoming,
      existingType,
      incomingType,
      existingTags,
      incomingTags
    )
  );
}

function calculateFlexibleMatchScore(
  existing: Record<string, any>,
  incoming: Record<string, any>,
  existingType?: string,
  incomingType?: string,
  existingTags: string[] = [],
  incomingTags: string[] = []
): number {
  let score = 0;

  // Type alignment signal
  if (existingType && incomingType) {
    if (existingType === incomingType) score += 10;
    else if (incomingType !== 'unknown' && existingType !== 'unknown') score -= 10;
  }

  const existingPairs = flattenObject(existing);
  const incomingPairs = flattenObject(incoming);

  const existingByKey = new Map<string, string[]>();
  existingPairs.forEach((p) => {
    if (!existingByKey.has(p.key)) existingByKey.set(p.key, []);
    existingByKey.get(p.key)!.push(p.value);
  });

  const incomingByKey = new Map<string, string[]>();
  incomingPairs.forEach((p) => {
    if (!incomingByKey.has(p.key)) incomingByKey.set(p.key, []);
    incomingByKey.get(p.key)!.push(p.value);
  });

  // Strong identifier matches (works with arbitrary nesting due to key suffix matching)
  const identifierHints = ['phone', 'mobile', 'whatsapp', 'email', 'id', 'name', 'username'];
  for (const [key, existingVals] of existingByKey.entries()) {
    if (!identifierHints.some((hint) => key.toLowerCase().includes(hint))) continue;
    const incomingVals = incomingByKey.get(key) || [];
    for (const ev of existingVals) {
      for (const iv of incomingVals) {
        if (!ev || !iv) continue;
        if (ev === iv) score += 30;
        else if (ev.includes(iv) || iv.includes(ev)) score += 12;
      }
    }
  }

  // Generic key+value overlap across entire flexible object
  const existingKeyValues = new Set(existingPairs.map((p) => `${p.key}:${p.value}`));
  const incomingKeyValues = new Set(incomingPairs.map((p) => `${p.key}:${p.value}`));
  let exactPairs = 0;
  existingKeyValues.forEach((item) => {
    if (incomingKeyValues.has(item)) exactPairs += 1;
  });
  score += Math.min(30, exactPairs * 6);

  // Value overlap even with different keys
  const existingValues = new Set(existingPairs.map((p) => p.value));
  const incomingValues = new Set(incomingPairs.map((p) => p.value));
  let overlappingValues = 0;
  existingValues.forEach((v) => {
    if (incomingValues.has(v)) overlappingValues += 1;
  });
  score += Math.min(20, overlappingValues * 3);

  // Tag overlap signal
  const existingTagSet = new Set((existingTags || []).map((t) => normalizePrimitive(t)));
  let tagHits = 0;
  (incomingTags || []).forEach((t) => {
    if (existingTagSet.has(normalizePrimitive(t))) tagHits += 1;
  });
  score += Math.min(10, tagHits * 3);

  return Math.max(0, score);
}

/**
 * Update entity with new data (smart merge)
 */
export async function updateEntity(
  userId: string,
  entityId: string,
  newData: Record<string, any>,
  activityType?: string
) {
  const { data: entity } = await supabase
    .from('entities')
    .select('data, history, entity_type')
    .eq('id', entityId)
    .eq('user_id', userId)
    .single();

  if (!entity) throw new Error('Entity not found');

  // Deep merge for flexible schemas: preserve nested context and dedupe arrays.
  const mergedData = deepMergeData(entity.data || {}, newData || {});

  const beforePairs = new Set(flattenObject(entity.data || {}).map((p) => `${p.key}:${p.value}`));
  const afterPairs = new Set(flattenObject(mergedData || {}).map((p) => `${p.key}:${p.value}`));
  const changedFields = Array.from(afterPairs)
    .filter((pair) => !beforePairs.has(pair))
    .map((pair) => pair.split(':')[0])
    .filter((v, i, arr) => arr.indexOf(v) === i);

  // Add to history
  const history = entity.history || [];
  history.push({
    date: new Date().toISOString(),
    action: 'updated',
    fields_changed: changedFields,
    values: newData,
  });

  // Update entity
  const { error } = await supabase
    .from('entities')
    .update({
      data: mergedData,
      history: history.slice(-50), // Keep last 50 entries
      updated_at: new Date().toISOString(),
      last_activity: new Date().toISOString(),
    })
    .eq('id', entityId)
    .eq('user_id', userId);

  if (error) throw error;

  await mirrorEntityAsObject(userId, entityId, entity.entity_type || 'unknown', mergedData || {});
  await mirrorHistory(
    userId,
    entityId,
    activityType || 'entity_updated',
    entity.data || {},
    mergedData || {},
    changedFields
  );
  await mirrorEvent(userId, activityType || 'entity_updated', entityId, {
    new_data: newData,
    changed_fields: changedFields,
  });
}

/**
 * Ensure specific tags exist on an entity without removing existing tags.
 */
export async function ensureEntityTags(
  userId: string,
  entityId: string,
  requiredTags: string[] = []
) {
  const normalizedRequired = (requiredTags || [])
    .map((t) => String(t || '').trim())
    .filter(Boolean);

  if (normalizedRequired.length === 0) return;

  const { data: entity, error: readError } = await supabase
    .from('entities')
    .select('tags')
    .eq('id', entityId)
    .eq('user_id', userId)
    .single();

  if (readError || !entity) {
    throw new Error('Entity not found in user scope');
  }

  const currentTags = Array.isArray(entity.tags) ? entity.tags : [];
  const mergedTags = Array.from(new Set([...currentTags, ...normalizedRequired]));

  if (mergedTags.length === currentTags.length) return;

  const { error: updateError } = await supabase
    .from('entities')
    .update({ tags: mergedTags, updated_at: new Date().toISOString() })
    .eq('id', entityId)
    .eq('user_id', userId);

  if (updateError) throw updateError;
}

/**
 * Get complete entity profile
 */
export async function getEntity(userId: string, entityId: string) {
  const { data, error } = await supabase
    .from('entities')
    .select('*')
    .eq('id', entityId)
    .eq('user_id', userId)
    .single();

  if (error?.code === 'PGRST116') {
    throw new Error('Entity not found in user scope');
  }
  if (error) throw error;
  return data;
}

/**
 * Search entities by any field
 */
export async function searchEntities(
  userId: string,
  query: string,
  entityType?: string
) {
  const safeQuery = sanitizeSearchQuery(query);
  if (!safeQuery) return [];
  const tokens = tokenizeSearchQuery(safeQuery);

  let q = supabase
    .from('entities')
    .select('*')
    .eq('user_id', userId);

  if (entityType) {
    q = q.eq('entity_type', entityType);
  }

  // Search across data fields
  q = q.or(
    `data->>name.ilike.%${safeQuery}%,data->>email.ilike.%${safeQuery}%,data->>phone.ilike.%${safeQuery}%,data->>company.ilike.%${safeQuery}%`
  );

  const { data, error } = await q.limit(50);

  if (error) throw error;

  const indexedResults = data || [];
  if (indexedResults.length >= 10) {
    return indexedResults;
  }

  // Fallback for schema-less matching: scan recent tenant objects and match on full payload.
  const broadCandidates = await listEntitiesByUser(userId, entityType, 400);
  const fallback = broadCandidates.filter((row: any) => objectMatchesTokens(row, tokens));

  const byId = new Map<string, any>();
  [...indexedResults, ...fallback].forEach((row: any) => {
    if (row?.id && !byId.has(row.id)) byId.set(row.id, row);
  });

  return Array.from(byId.values()).slice(0, 50);
}


/**
 * List entities for a user (used for broad fallback search over flexible JSON fields)
 */
export async function listEntitiesByUser(
  userId: string,
  entityType?: string,
  limit = 500
) {
  let q = supabase
    .from('entities')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (entityType) {
    q = q.eq('entity_type', entityType);
  }

  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

/**
 * Get related entities
 */
export async function getRelatedEntities(
  userId: string,
  entityId: string
) {
  const { data: entity } = await supabase
    .from('entities')
    .select('related_to')
    .eq('id', entityId)
    .eq('user_id', userId)
    .single();

  if (!entity || !entity.related_to) return [];

  const relatedIds = entity.related_to.map((r: any) => r.entity_id);

  if (relatedIds.length === 0) return [];

  const { data, error } = await supabase
    .from('entities')
    .select('*')
    .eq('user_id', userId)
    .in('id', relatedIds);

  if (error) throw error;
  return data || [];
}

/**
 * Add activity
 */
export async function addActivity(
  userId: string,
  activityType: string,
  data: Record<string, any>,
  involvedEntities: Array<{ entity_id: string; role: string }> = [],
  tags: string[] = []
) {
  const basePayload = {
    user_id: userId,
    activity_type: activityType,
    date: new Date().toISOString().split('T')[0],
    created_at: new Date().toISOString(),
    data,
    involved_entities: toUuidList(involvedEntities),
    tags,
  };

  // Prefer dual-write shape when companion JSONB column exists.
  const withV2Payload = {
    ...basePayload,
    involved_entities_v2: involvedEntities,
  };

  const withV2Attempt = await supabase.from('activities').insert(withV2Payload);
  if (withV2Attempt.error) {
    const fallbackAttempt = await supabase.from('activities').insert(basePayload);
    if (fallbackAttempt.error) throw fallbackAttempt.error;
  }

  const primaryObjectId = involvedEntities[0]?.entity_id || null;
  await mirrorEvent(userId, activityType, primaryObjectId, {
    source: 'activity',
    data,
    involved_entities: involvedEntities,
    tags,
  });
}

/**
 * Get activities for a period
 */
export async function getActivities(
  userId: string,
  startDate: string,
  endDate: string,
  entityId?: string
) {
  let q = supabase
    .from('activities')
    .select('*')
    .eq('user_id', userId)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: false });

  const { data, error } = await q;

  if (error) throw error;

  let activities = (data || []).map((row: any) => normalizeActivityRow(row));

  if (entityId) {
    activities = activities.filter((a: any) =>
      a.involved_entities.some((e: any) => e.entity_id === entityId)
    );
  }

  return activities;
}

/**
 * Record metric
 */
export async function recordMetric(
  userId: string,
  metricName: string,
  value: number | string,
  entityId?: string,
  tags: string[] = []
) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    throw new Error('Metric value must be numeric for current database schema');
  }

  const { error } = await supabase
    .from('metrics')
    .insert({
      user_id: userId,
      metric_name: metricName,
      value: numericValue,
      entity_id: entityId,
      date: new Date().toISOString().split('T')[0],
      tags,
    });

  if (error) throw error;

  await mirrorEvent(userId, 'metric_recorded', entityId || null, {
    metric_name: metricName,
    value: numericValue,
    tags,
  });
}

/**
 * Get metrics for a period
 */
export async function getMetrics(
  userId: string,
  startDate: string,
  endDate: string,
  entityId?: string,
  metricNames?: string[]
) {
  let q = supabase
    .from('metrics')
    .select('*')
    .eq('user_id', userId)
    .gte('date', startDate)
    .lte('date', endDate);

  if (entityId) {
    q = q.eq('entity_id', entityId);
  }

  if (metricNames && metricNames.length > 0) {
    q = q.in('metric_name', metricNames);
  }

  const { data, error } = await q;

  if (error) throw error;
  return data || [];
}

/**
 * Graph-first: get one object row.
 */
export async function getGraphObject(userId: string, objectId: string) {
  const { data, error } = await supabase
    .from('objects')
    .select('*')
    .eq('user_id', userId)
    .eq('id', objectId)
    .single();

  if (error?.code === 'PGRST116') {
    throw new Error('Object not found in user scope');
  }
  if (error) throw error;
  return data;
}

/**
 * Graph-first: get object relations and hydrate connected nodes.
 */
export async function getGraphConnections(
  userId: string,
  objectId: string,
  relation?: string,
  direction: 'outgoing' | 'incoming' | 'both' = 'both'
) {
  let outgoing: any[] = [];
  let incoming: any[] = [];

  if (direction === 'outgoing' || direction === 'both') {
    let q = supabase
      .from('relations')
      .select('*')
      .eq('user_id', userId)
      .eq('from_object', objectId);

    if (relation) q = q.eq('relation', relation);

    const { data, error } = await q;
    if (error) throw error;
    outgoing = data || [];
  }

  if (direction === 'incoming' || direction === 'both') {
    let q = supabase
      .from('relations')
      .select('*')
      .eq('user_id', userId)
      .eq('to_object', objectId);

    if (relation) q = q.eq('relation', relation);

    const { data, error } = await q;
    if (error) throw error;
    incoming = data || [];
  }

  const allObjectIds = Array.from(
    new Set(
      [...outgoing.map((r) => r.to_object), ...incoming.map((r) => r.from_object)]
        .filter(Boolean)
        .map((id) => String(id))
    )
  );

  let connectedObjects: any[] = [];
  if (allObjectIds.length > 0) {
    const { data, error } = await supabase
      .from('objects')
      .select('*')
      .eq('user_id', userId)
      .in('id', allObjectIds);

    if (error) throw error;
    connectedObjects = data || [];
  }

  return {
    outgoing,
    incoming,
    connected_objects: connectedObjects,
  };
}

/**
 * Graph-first: get events linked to an object.
 */
export async function getGraphTimeline(
  userId: string,
  objectId: string,
  limit = 100,
  eventType?: string
) {
  let q = supabase
    .from('events')
    .select('*')
    .eq('user_id', userId)
    .eq('object_id', objectId)
    .order('timestamp', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 500));

  if (eventType) {
    q = q.eq('type', eventType);
  }

  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

/**
 * Link two entities
 */
export async function linkEntities(
  userId: string,
  entityId1: string,
  entityId2: string,
  relationshipType: string
) {
  // Get first entity
  const { data: entity1, error: entity1Error } = await supabase
    .from('entities')
    .select('related_to')
    .eq('id', entityId1)
    .eq('user_id', userId)
    .single();

  if (entity1Error || !entity1) {
    throw new Error('Primary entity not found in user scope');
  }

  const relatedTo = entity1?.related_to || [];

  // Check if already linked
  if (!relatedTo.some((r: any) => r.entity_id === entityId2)) {
    relatedTo.push({
      entity_id: entityId2,
      relationship_type: relationshipType,
    });
  }

  await supabase
    .from('entities')
    .update({ related_to: relatedTo })
    .eq('id', entityId1)
    .eq('user_id', userId);

  // Also link back
  const { data: entity2, error: entity2Error } = await supabase
    .from('entities')
    .select('related_to')
    .eq('id', entityId2)
    .eq('user_id', userId)
    .single();

  if (entity2Error || !entity2) {
    throw new Error('Related entity not found in user scope');
  }

  const relatedTo2 = entity2?.related_to || [];

  if (!relatedTo2.some((r: any) => r.entity_id === entityId1)) {
    relatedTo2.push({
      entity_id: entityId1,
      relationship_type: relationshipType,
    });
  }

  await supabase
    .from('entities')
    .update({ related_to: relatedTo2 })
    .eq('id', entityId2)
    .eq('user_id', userId);

  await mirrorRelation(userId, entityId1, relationshipType, entityId2, 100, {
    source: 'link_entities',
  });
  await mirrorRelation(userId, entityId2, relationshipType, entityId1, 100, {
    source: 'link_entities_reverse',
  });
  await mirrorEvent(userId, 'relation_linked', entityId1, {
    to_object: entityId2,
    relation: relationshipType,
  });
}

/**
 * Merge duplicate entities
 */
export async function mergeEntities(
  userId: string,
  primaryId: string,
  duplicateId: string
) {
  const { data: primary } = await supabase
    .from('entities')
    .select('data, history, related_to, entity_type')
    .eq('id', primaryId)
    .eq('user_id', userId)
    .single();

  const { data: duplicate } = await supabase
    .from('entities')
    .select('data, history, related_to, entity_type')
    .eq('id', duplicateId)
    .eq('user_id', userId)
    .single();

  if (!primary || !duplicate) {
    throw new Error('Could not find entities to merge');
  }

  // Deep merge preserves nested fields and de-duplicates arrays.
  const mergedData = deepMergeData(duplicate.data || {}, primary.data || {});

  // Merge history
  const mergedHistory = uniqueArray([...(primary.history || []), ...(duplicate.history || [])]);

  // Merge relationships
  const mergedRelations = [
    ...(primary.related_to || []),
    ...(duplicate.related_to || []),
  ];

  // Remove duplicates
  const uniqueRelations = uniqueArray(
    Array.from(new Map(mergedRelations.map((r: any) => [r.entity_id, r])).values())
  );

  // Update primary
  await supabase
    .from('entities')
    .update({
      data: mergedData,
      history: mergedHistory,
      related_to: uniqueRelations,
    })
    .eq('id', primaryId)
    .eq('user_id', userId);

  // Delete duplicate
  await supabase
    .from('entities')
    .delete()
    .eq('id', duplicateId)
    .eq('user_id', userId);

  await mirrorEntityAsObject(userId, primaryId, primary.entity_type || 'unknown', mergedData || {});
  await mirrorHistory(
    userId,
    primaryId,
    'entity_merged',
    primary.data || {},
    mergedData || {},
    ['merged_from']
  );
  await mirrorEvent(userId, 'entity_merged', primaryId, {
    primary_id: primaryId,
    merged_id: duplicateId,
  });
}
