/**
 * Smart MCP Server with Intelligent Entity Management
 * Handles flexible data, deduplication, and relational linking
 */

import {
  findOrCreateEntity,
  updateEntity,
  getEntity,
  searchEntities,
  getRelatedEntities,
  addActivity,
  getActivities,
  recordMetric,
  getMetrics,
  linkEntities,
  mergeEntities,
} from '../storage/supabase.js';
import type {
  AddDataInput,
  GetEntityInput,
  GetRelatedInput,
  GetSummaryInput,
  SearchInput,
  LinkEntitiesInput,
  MergeEntitiesInput,
  GetTimelineInput,
  RecordMetricInput,
  GetMetricsInput,
} from '../types/index.js';

/**
 * Response helper
 */
export function response(success: boolean, data?: any, error?: string) {
  if (success) {
    return { success: true, data };
  }
  return { success: false, error: error || 'Unknown error' };
}

const DEFAULT_MCP_USER_ID = process.env.DEFAULT_MCP_USER_ID || 'default_user';

function withUserId<T extends { user_id?: string }>(input: T): T & { user_id: string } {
  return {
    ...input,
    user_id: input?.user_id || DEFAULT_MCP_USER_ID,
  };
}

/**
 * MCP Handlers - Smart entity management
 */
export const MCP_HANDLERS: Record<string, (input: any) => Promise<any>> = {
  /**
   * Add or update data (smart consolidation)
   * Will find or create entity, merge data intelligently
   */
  add_data: async (input: AddDataInput) => {
    try {
      const normalized = withUserId(input);
      const {
        user_id,
        entity_type = 'unknown',
        data,
        activity_type,
        activity_data,
        related_to,
        tags = [],
        entity_id,
      } = normalized;

      // Find or create entity
      let finalEntityId = entity_id;
      if (!finalEntityId) {
        finalEntityId = await findOrCreateEntity(user_id, entity_type, data, tags);
      }

      // Update entity with new data
      await updateEntity(finalEntityId, data, activity_type);

      // Add activity if provided
      if (activity_type && activity_data) {
        await addActivity(
          user_id,
          activity_type,
          activity_data,
          [{ entity_id: finalEntityId, role: 'subject' }],
          tags
        );
      }

      // Link related entities if provided
      if (related_to && related_to.length > 0) {
        for (const relation of related_to) {
          await linkEntities(
            user_id,
            finalEntityId,
            relation.entity_id,
            relation.relationship_type
          );
        }
      }

      return response(true, {
        message: 'Data added and consolidated successfully',
        entity_id: finalEntityId,
        entity_type,
        consolidated: true,
      });
    } catch (err: any) {
      return response(false, null, err.message);
    }
  },

  /**
   * Get complete entity profile (all data consolidated)
   */
  get_entity: async (input: GetEntityInput) => {
    try {
      const normalized = withUserId(input);
      const { user_id, entity_id, search_query, entity_type, include_history } = normalized;

      let results: any[] = [];

      if (entity_id) {
        const entity = await getEntity(entity_id);
        results = [entity];
      } else if (search_query) {
        results = await searchEntities(user_id, search_query, entity_type);
      } else {
        return response(false, null, 'Must provide either entity_id or search_query');
      }

      // Format response
      const formattedResults = results.map((entity) => ({
        id: entity.id,
        type: entity.entity_type,
        created: entity.created_at,
        last_updated: entity.updated_at,
        last_activity: entity.last_activity,
        data: entity.data,
        related: entity.related_to ? entity.related_to.length : 0,
        tags: entity.tags,
        history: include_history ? entity.history : undefined,
        confidence: entity.confidence,
      }));

      return response(true, {
        count: formattedResults.length,
        entities: formattedResults,
      });
    } catch (err: any) {
      return response(false, null, err.message);
    }
  },

  /**
   * Get related entities
   */
  get_related: async (input: GetRelatedInput) => {
    try {
      const normalized = withUserId(input);
      const { user_id, entity_id, relationship_type } = normalized;

      const related = await getRelatedEntities(user_id, entity_id);

      let filtered = related;
      if (relationship_type) {
        // Get main entity to filter relationships
        const entity = await getEntity(entity_id);
        const relatedIds = entity.related_to
          .filter((r: any) => r.relationship_type === relationship_type)
          .map((r: any) => r.entity_id);
        filtered = related.filter((r: any) => relatedIds.includes(r.id));
      }

      return response(true, {
        count: filtered.length,
        related_entities: filtered.map((e) => ({
          id: e.id,
          type: e.entity_type,
          data: e.data,
          tags: e.tags,
        })),
      });
    } catch (err: any) {
      return response(false, null, err.message);
    }
  },

  /**
   * Get timeline of activities
   */
  get_timeline: async (input: GetTimelineInput) => {
    try {
      const normalized = withUserId(input);
      const { user_id, entity_id, period = 'day', date } = normalized;

      let dateRange = getDateRange(period as 'day' | 'week' | 'month' | 'year', date);
      const activities = await getActivities(
        user_id,
        dateRange.start,
        dateRange.end,
        entity_id
      );

      return response(true, {
        period,
        date_range: dateRange,
        count: activities.length,
        activities: activities.map((a) => ({
          date: a.date,
          type: a.activity_type,
          data: a.data,
          entities: a.involved_entities.length,
        })),
      });
    } catch (err: any) {
      return response(false, null, err.message);
    }
  },

  /**
   * Get comprehensive summary (consolidated data)
   */
  get_summary: async (input: GetSummaryInput) => {
    try {
      const normalized = withUserId(input);
      const { user_id, period = 'day', date, entity_id, entity_type } = normalized;

      let dateRange = getDateRange(period as 'day' | 'week' | 'month' | 'year', date);

      const activities = await getActivities(
        user_id,
        dateRange.start,
        dateRange.end,
        entity_id
      );

      const metrics = await getMetrics(user_id, dateRange.start, dateRange.end, entity_id);

      // Group activities by type
      const activityStats: Record<string, number> = {};
      activities.forEach((a: any) => {
        activityStats[a.activity_type] = (activityStats[a.activity_type] || 0) + 1;
      });

      // Aggregate metrics
      const metricStats: Record<string, any> = {};
      metrics.forEach((m: any) => {
        if (!metricStats[m.metric_name]) {
          metricStats[m.metric_name] = { values: [], total: 0 };
        }
        metricStats[m.metric_name].values.push(m.value);
        if (typeof m.value === 'number') {
          metricStats[m.metric_name].total += m.value;
        }
      });

      return response(true, {
        period,
        date_range: dateRange,
        summary: {
          activities: {
            total: activities.length,
            by_type: activityStats,
          },
          metrics: Object.entries(metricStats).reduce(
            (acc, [name, stats]) => {
              acc[name] = {
                total: stats.total,
                count: stats.values.length,
                last_value: stats.values[stats.values.length - 1],
              };
              return acc;
            },
            {} as Record<string, any>
          ),
        },
      });
    } catch (err: any) {
      return response(false, null, err.message);
    }
  },

  /**
   * Search across all entities
   */
  search: async (input: SearchInput) => {
    try {
      const normalized = withUserId(input);
      const { user_id, query, entity_type, limit = 50 } = normalized;

      const results = await searchEntities(user_id, query, entity_type);

      return response(true, {
        query,
        count: Math.min(results.length, limit),
        results: results.slice(0, limit).map((r) => ({
          id: r.id,
          type: r.entity_type,
          data: r.data,
          tags: r.tags,
          last_updated: r.updated_at,
        })),
      });
    } catch (err: any) {
      return response(false, null, err.message);
    }
  },

  /**
   * Link two entities
   */
  link_entities: async (input: LinkEntitiesInput) => {
    try {
      const normalized = withUserId(input);
      const { user_id, entity_id_1, entity_id_2, relationship_type, notes } = normalized;

      await linkEntities(user_id, entity_id_1, entity_id_2, relationship_type);

      return response(true, {
        message: 'Entities linked successfully',
        relationship: relationship_type,
        notes,
      });
    } catch (err: any) {
      return response(false, null, err.message);
    }
  },

  /**
   * Merge duplicate entities
   */
  merge_entities: async (input: MergeEntitiesInput) => {
    try {
      const normalized = withUserId(input);
      const { user_id, primary_entity_id, duplicate_entity_id } = normalized;

      await mergeEntities(primary_entity_id, duplicate_entity_id);

      return response(true, {
        message: 'Entities merged successfully',
        primary_id: primary_entity_id,
        merged_id: duplicate_entity_id,
      });
    } catch (err: any) {
      return response(false, null, err.message);
    }
  },

  /**
   * Record a metric/KPI
   */
  record_metric: async (input: RecordMetricInput) => {
    try {
      const normalized = withUserId(input);
      const { user_id, metric_name, value, entity_id, date, tags = [] } = normalized;

      await recordMetric(user_id, metric_name, value, entity_id, tags);

      return response(true, {
        message: 'Metric recorded successfully',
        metric: metric_name,
        value,
      });
    } catch (err: any) {
      return response(false, null, err.message);
    }
  },

  /**
   * Get metrics
   */
  get_metrics: async (input: GetMetricsInput) => {
    try {
      const normalized = withUserId(input);
      const { user_id, metric_names, entity_id, period = 'day', date } = normalized;

      let dateRange = getDateRange(period as 'day' | 'week' | 'month' | 'year', date);
      const metrics = await getMetrics(
        user_id,
        dateRange.start,
        dateRange.end,
        entity_id,
        metric_names
      );

      return response(true, {
        period,
        date_range: dateRange,
        count: metrics.length,
        metrics: metrics.map((m) => ({
          name: m.metric_name,
          value: m.value,
          date: m.date,
          unit: m.unit,
        })),
      });
    } catch (err: any) {
      return response(false, null, err.message);
    }
  },
};

/**
 * Get date range for period
 */
function getDateRange(period: 'day' | 'week' | 'month' | 'year', referenceDate?: string) {
  const ref = referenceDate ? new Date(referenceDate) : new Date();
  let startDate: Date;
  let endDate = new Date(ref);
  endDate.setHours(23, 59, 59, 999);

  switch (period) {
    case 'day':
      startDate = new Date(ref);
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'week':
      startDate = new Date(ref);
      const day = startDate.getDay();
      startDate.setDate(startDate.getDate() - day);
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'month':
      startDate = new Date(ref.getFullYear(), ref.getMonth(), 1);
      break;
    case 'year':
      startDate = new Date(ref.getFullYear(), 0, 1);
      break;
  }

  return {
    start: startDate.toISOString().split('T')[0] as string,
    end: endDate.toISOString().split('T')[0] as string,
  };
}

/**
 * Get MCP manifest
 */
export function getMcpManifest() {
  return {
    protocol: 'mcp',
    version: '2.0.0',
    server_name: 'Smart Data Logger MCP',
    server_url: 'https://ron.surajdev.com/api/mcp',
    name: 'Smart Data Logger MCP',
    description:
      'Flexible, schema-less MCP for storing any data with intelligent deduplication and entity relationships',
    tools: [
      {
        name: 'add_data',
        description:
          'Add or update data (smart consolidation). Auto-detects existing entities and merges without duplication.',
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: true,
        annotations: {
          readOnlyHint: false,
          openWorldHint: false,
          destructiveHint: true,
        },
        input_schema: {
          type: 'object',
          properties: {
            user_id: { type: 'string' },
            entity_type: { type: 'string', description: 'person, organization, deal, etc.' },
            data: { type: 'object', description: 'Any flexible data fields' },
            activity_type: { type: 'string', description: 'call, email, meeting, note, etc.' },
            activity_data: { type: 'object' },
            tags: { type: 'array', items: { type: 'string' } },
            entity_id: { type: 'string', description: 'Specific entity to update' },
          },
          required: ['data'],
        },
      },
      {
        name: 'get_entity',
        description:
          'Get complete entity profile with all consolidated data (no duplicates). Includes full history.',
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
        annotations: {
          readOnlyHint: true,
          openWorldHint: false,
          destructiveHint: false,
        },
        input_schema: {
          type: 'object',
          properties: {
            user_id: { type: 'string' },
            entity_id: { type: 'string' },
            search_query: { type: 'string' },
            entity_type: { type: 'string' },
            include_history: { type: 'boolean' },
          },
          required: [],
        },
      },
      {
        name: 'get_related',
        description: 'Get all entities related to this one, with relationship types',
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
        annotations: {
          readOnlyHint: true,
          openWorldHint: false,
          destructiveHint: false,
        },
        input_schema: {
          type: 'object',
          properties: {
            user_id: { type: 'string' },
            entity_id: { type: 'string' },
            relationship_type: { type: 'string' },
          },
          required: ['entity_id'],
        },
      },
      {
        name: 'get_timeline',
        description: 'Get chronological timeline of all activities',
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
        annotations: {
          readOnlyHint: true,
          openWorldHint: false,
          destructiveHint: false,
        },
        input_schema: {
          type: 'object',
          properties: {
            user_id: { type: 'string' },
            entity_id: { type: 'string' },
            period: { type: 'string', enum: ['day', 'week', 'month', 'year'] },
            date: { type: 'string' },
          },
          required: ['period'],
        },
      },
      {
        name: 'get_summary',
        description:
          'Get consolidated summary for period. Complete without duplicates or missing data.',
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
        annotations: {
          readOnlyHint: true,
          openWorldHint: false,
          destructiveHint: false,
        },
        input_schema: {
          type: 'object',
          properties: {
            user_id: { type: 'string' },
            period: { type: 'string', enum: ['day', 'week', 'month', 'year'] },
            date: { type: 'string' },
            entity_id: { type: 'string' },
            entity_type: { type: 'string' },
          },
          required: ['period'],
        },
      },
      {
        name: 'search',
        description: 'Smart search across all data fields',
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
        annotations: {
          readOnlyHint: true,
          openWorldHint: false,
          destructiveHint: false,
        },
        input_schema: {
          type: 'object',
          properties: {
            user_id: { type: 'string' },
            query: { type: 'string' },
            entity_type: { type: 'string' },
            limit: { type: 'number' },
          },
          required: ['query'],
        },
      },
      {
        name: 'link_entities',
        description: 'Create relationship between two entities',
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: true,
        annotations: {
          readOnlyHint: false,
          openWorldHint: false,
          destructiveHint: true,
        },
        input_schema: {
          type: 'object',
          properties: {
            user_id: { type: 'string' },
            entity_id_1: { type: 'string' },
            entity_id_2: { type: 'string' },
            relationship_type: { type: 'string' },
            notes: { type: 'string' },
          },
          required: ['entity_id_1', 'entity_id_2', 'relationship_type'],
        },
      },
      {
        name: 'merge_entities',
        description: 'Merge duplicate entities (detected by system)',
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: true,
        annotations: {
          readOnlyHint: false,
          openWorldHint: false,
          destructiveHint: true,
        },
        input_schema: {
          type: 'object',
          properties: {
            user_id: { type: 'string' },
            primary_entity_id: { type: 'string' },
            duplicate_entity_id: { type: 'string' },
          },
          required: ['primary_entity_id', 'duplicate_entity_id'],
        },
      },
      {
        name: 'record_metric',
        description: 'Record a KPI or metric value',
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: true,
        annotations: {
          readOnlyHint: false,
          openWorldHint: false,
          destructiveHint: true,
        },
        input_schema: {
          type: 'object',
          properties: {
            user_id: { type: 'string' },
            metric_name: { type: 'string' },
            value: { oneOf: [{ type: 'number' }, { type: 'string' }] },
            entity_id: { type: 'string' },
            date: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
          },
          required: ['metric_name', 'value'],
        },
      },
      {
        name: 'get_metrics',
        description: 'Get metrics for period',
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
        annotations: {
          readOnlyHint: true,
          openWorldHint: false,
          destructiveHint: false,
        },
        input_schema: {
          type: 'object',
          properties: {
            user_id: { type: 'string' },
            metric_names: { type: 'array', items: { type: 'string' } },
            entity_id: { type: 'string' },
            period: { type: 'string', enum: ['day', 'week', 'month', 'year'] },
            date: { type: 'string' },
          },
          required: ['period'],
        },
      },
    ],
    resources: [],
  };
}
