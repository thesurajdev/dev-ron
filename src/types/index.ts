/**
 * Flexible, Schema-less Data Models for MCP Logger
 * 
 * Everything is stored as flexible JSON objects
 * No fixed fields - can be anything
 * Smart entity linking and deduplication
 */

/**
 * Entity: A flexible container for any data
 * Can be a person, organization, deal, project, etc.
 * Accumulates data over time without duplication
 */
export interface Entity {
  id: string; // UUID
  user_id: string;
  entity_type: string; // 'person', 'organization', 'deal', 'project', 'event', etc.
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
  last_activity: string; // ISO 8601
  
  // Core data - flexible object, can have any fields
  data: Record<string, any>;
  
  // Relationships to other entities
  related_to: Array<{
    entity_id: string;
    relationship_type: string; // 'works_at', 'child_of', 'related_to', etc.
    notes?: string;
  }>;
  
  // Activity log - history of all updates
  history: Array<{
    date: string;
    action: string; // 'added', 'updated', 'merged'
    fields_changed: string[];
    values: Record<string, any>;
  }>;
  
  // Tags for categorization
  tags: string[];
  
  // Metadata
  source?: string; // where this entity came from
  confidence?: number; // how confident we are this is correct entity (0-100)
}

/**
 * Event/Activity - something that happened involving one or more entities
 */
export interface Activity {
  id: string;
  user_id: string;
  date: string; // YYYY-MM-DD
  created_at: string;
  activity_type: string; // 'call', 'email', 'meeting', 'note', 'transaction', etc.
  
  // Flexible data about the activity
  data: Record<string, any>;
  
  // Entities involved in this activity
  involved_entities: Array<{
    entity_id: string;
    role: string; // 'initiator', 'participant', 'observer', etc.
  }>;
  
  tags: string[];
  duration_minutes?: number;
  outcome?: string;
  next_steps?: string;
}

/**
 * Metrics/KPI - calculated metrics about entities
 */
export interface Metric {
  id: string;
  user_id: string;
  date: string; // YYYY-MM-DD
  metric_name: string; // 'deal_value', 'interaction_count', 'expense_total', etc.
  
  // Can be tied to a specific entity or global
  entity_id?: string;
  
  // The actual metric value
  value: number | string;
  unit?: string;
  
  // How was it calculated?
  calculation?: string;
  
  tags: string[];
}

/**
 * MCP Input/Output types
 */

/**
 * Add or update data for an entity
 * Smart deduplication: will merge with existing entity if recognized
 */
export interface AddDataInput {
  user_id: string;
  
  // What this data is about (optional - system will try to match existing entity)
  entity_type?: string; // 'person', 'organization', 'deal', etc.
  
  // The actual data (can be anything)
  data: Record<string, any>;
  
  // Activity associated with this data (optional)
  activity_type?: string; // 'call', 'email', 'note', etc.
  activity_data?: Record<string, any>;
  
  // Links to other entities (optional)
  related_to?: Array<{
    entity_id: string;
    relationship_type: string;
  }>;
  
  // Categorization
  tags?: string[];
  
  // Date of this data (defaults to today)
  date?: string;
  
  // If this is definitely about a specific entity, provide the ID
  // Otherwise system will try to match based on data
  entity_id?: string;
}

/**
 * Get complete entity profile
 * Returns all data accumulated over time, without duplication
 */
export interface GetEntityInput {
  user_id: string;
  entity_id?: string; // Specific entity
  search_query?: string; // Search by any field
  entity_type?: string; // Filter by type
  limit?: number;
  include_history?: boolean; // Include full history
}

/**
 * Get related entities
 */
export interface GetRelatedInput {
  user_id: string;
  entity_id: string;
  relationship_type?: string; // Filter by relationship type
  depth?: number; // How many levels deep (default 1)
}

/**
 * Get summary/consolidation of data
 */
export interface GetSummaryInput {
  user_id: string;
  period: 'day' | 'week' | 'month' | 'year';
  date?: string; // Reference date (defaults to today)
  entity_id?: string; // Specific entity, or all if not provided
  entity_type?: string; // Filter by entity type
  include_metrics?: boolean;
}

/**
 * Search across all entities and activities
 */
export interface SearchInput {
  user_id: string;
  query: string; // Natural language or keyword search
  entity_type?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
}

/**
 * Link two entities together
 */
export interface LinkEntitiesInput {
  user_id: string;
  entity_id_1: string;
  entity_id_2: string;
  relationship_type: string; // 'works_at', 'married_to', 'child_of', etc.
  notes?: string;
}

/**
 * Merge two entities (if system detected duplicates)
 */
export interface MergeEntitiesInput {
  user_id: string;
  primary_entity_id: string; // Keep this one
  duplicate_entity_id: string; // Merge into primary
}

/**
 * Get timeline of activities
 */
export interface GetTimelineInput {
  user_id: string;
  entity_id?: string; // Specific entity, or all activities if not provided
  period: 'day' | 'week' | 'month' | 'year';
  date?: string;
}

/**
 * Record a metric/KPI
 */
export interface RecordMetricInput {
  user_id: string;
  metric_name: string;
  value: number | string;
  entity_id?: string;
  date?: string;
  tags?: string[];
}

/**
 * Get analytics/metrics
 */
export interface GetMetricsInput {
  user_id: string;
  metric_names?: string[];
  entity_id?: string;
  period: 'day' | 'week' | 'month' | 'year';
  date?: string;
}
