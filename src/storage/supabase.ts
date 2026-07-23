import { createClient } from '@supabase/supabase-js';
import type { Entity, Activity, Metric } from '../types/index.js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.warn('Warning: Missing Supabase environment variables. Database operations will fail.');
}

export const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseKey || 'placeholder');

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
  const { data: existingEntities } = await supabase
    .from('entities')
    .select('id, data, confidence')
    .eq('user_id', userId)
    .eq('entity_type', entityType)
    .limit(10);

  if (existingEntities && existingEntities.length > 0) {
    // Try to find matching entity based on key identifiers
    const matchScore = existingEntities.map((e: any) => ({
      id: e.id,
      score: calculateMatchScore(e.data, data),
    }));

    const bestMatch = matchScore.sort((a, b) => b.score - a.score)[0];

    // If high confidence match (>60%), use existing entity
    if (bestMatch.score > 60) {
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
  return newEntity.id;
}

/**
 * Calculate match score between two data objects (0-100)
 * Higher score = more likely same entity
 */
function calculateMatchScore(existing: Record<string, any>, incoming: Record<string, any>): number {
  let score = 0;

  // Check common identifiers
  const identifiers = ['id', 'email', 'phone', 'name', 'username'];

  for (const key of identifiers) {
    if (existing[key] && incoming[key]) {
      if (existing[key].toLowerCase?.() === incoming[key].toLowerCase?.()) {
        score += 50; // Strong match
      } else if (
        existing[key].toString().includes(incoming[key].toString()) ||
        incoming[key].toString().includes(existing[key].toString())
      ) {
        score += 25; // Partial match
      }
    }
  }

  return Math.min(score, 100);
}

/**
 * Update entity with new data (smart merge)
 */
export async function updateEntity(
  entityId: string,
  newData: Record<string, any>,
  activityType?: string
) {
  const { data: entity } = await supabase
    .from('entities')
    .select('data, history')
    .eq('id', entityId)
    .single();

  if (!entity) throw new Error('Entity not found');

  // Merge data (new data overrides, but we track changes)
  const mergedData = { ...entity.data, ...newData };
  const changedFields = Object.keys(newData);

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
    .eq('id', entityId);

  if (error) throw error;
}

/**
 * Get complete entity profile
 */
export async function getEntity(entityId: string) {
  const { data, error } = await supabase
    .from('entities')
    .select('*')
    .eq('id', entityId)
    .single();

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
  let q = supabase
    .from('entities')
    .select('*')
    .eq('user_id', userId);

  if (entityType) {
    q = q.eq('entity_type', entityType);
  }

  // Search across data fields
  q = q.or(
    `data->>name.ilike.%${query}%,data->>email.ilike.%${query}%,data->>phone.ilike.%${query}%,data->>company.ilike.%${query}%`
  );

  const { data, error } = await q.limit(50);

  if (error) throw error;
  return data || [];
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
    .single();

  if (!entity || !entity.related_to) return [];

  const relatedIds = entity.related_to.map((r: any) => r.entity_id);

  if (relatedIds.length === 0) return [];

  const { data, error } = await supabase
    .from('entities')
    .select('*')
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
  const { error } = await supabase
    .from('activities')
    .insert({
      user_id: userId,
      activity_type: activityType,
      date: new Date().toISOString().split('T')[0],
      created_at: new Date().toISOString(),
      data,
      involved_entities: involvedEntities,
      tags,
    });

  if (error) throw error;
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

  let activities = data || [];

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
  const { error } = await supabase
    .from('metrics')
    .insert({
      user_id: userId,
      metric_name: metricName,
      value,
      entity_id: entityId,
      date: new Date().toISOString().split('T')[0],
      tags,
    });

  if (error) throw error;
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
 * Link two entities
 */
export async function linkEntities(
  userId: string,
  entityId1: string,
  entityId2: string,
  relationshipType: string
) {
  // Get first entity
  const { data: entity1 } = await supabase
    .from('entities')
    .select('related_to')
    .eq('id', entityId1)
    .single();

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
    .eq('id', entityId1);

  // Also link back
  const { data: entity2 } = await supabase
    .from('entities')
    .select('related_to')
    .eq('id', entityId2)
    .single();

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
    .eq('id', entityId2);
}

/**
 * Merge duplicate entities
 */
export async function mergeEntities(
  primaryId: string,
  duplicateId: string
) {
  const { data: primary } = await supabase
    .from('entities')
    .select('data, history, related_to')
    .eq('id', primaryId)
    .single();

  const { data: duplicate } = await supabase
    .from('entities')
    .select('data, history, related_to')
    .eq('id', duplicateId)
    .single();

  if (!primary || !duplicate) {
    throw new Error('Could not find entities to merge');
  }

  // Merge data (keep existing if both have values)
  const mergedData = { ...duplicate.data, ...primary.data };

  // Merge history
  const mergedHistory = [...(primary.history || []), ...(duplicate.history || [])];

  // Merge relationships
  const mergedRelations = [
    ...(primary.related_to || []),
    ...(duplicate.related_to || []),
  ];

  // Remove duplicates
  const uniqueRelations = Array.from(
    new Map(mergedRelations.map((r: any) => [r.entity_id, r])).values()
  );

  // Update primary
  await supabase
    .from('entities')
    .update({
      data: mergedData,
      history: mergedHistory,
      related_to: uniqueRelations,
    })
    .eq('id', primaryId);

  // Delete duplicate
  await supabase
    .from('entities')
    .delete()
    .eq('id', duplicateId);
}
