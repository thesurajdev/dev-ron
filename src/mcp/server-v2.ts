/**
 * Smart MCP Server with Intelligent Entity Management
 * Handles flexible data, deduplication, and relational linking
 */

import {
  findOrCreateEntity,
  updateEntity,
  ensureEntityTags,
  getEntity,
  searchEntities,
  listEntitiesByUser,
  getRelatedEntities,
  addActivity,
  getActivities,
  recordMetric,
  getMetrics,
  getGraphObject,
  getGraphConnections,
  getGraphTimeline,
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
  SetProfileInput,
  GetProfileInput,
  RecordTransactionInput,
  GetCashFlowInput,
  GetFinanceSummaryInput,
  GraphGetObjectInput,
  GraphGetConnectionsInput,
  GraphGetTimelineInput,
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

const DEFAULT_MCP_USER_ID = process.env.DEFAULT_MCP_USER_ID?.trim();

function withUserId<T extends { user_id?: string }>(input: T): T & { user_id: string } {
  const explicitUserId = input?.user_id?.trim();
  if (explicitUserId) {
    return {
      ...input,
      user_id: explicitUserId,
    };
  }

  if (!DEFAULT_MCP_USER_ID) {
    throw new Error('User scope is required. Provide user_id or configure DEFAULT_MCP_USER_ID.');
  }

  return {
    ...input,
    user_id: DEFAULT_MCP_USER_ID,
  };
}

function normalizeText(value: any): string {
  if (value === null || value === undefined) return '';
  return String(value).toLowerCase();
}

function normalizeDigits(value: any): string {
  return String(value ?? '').replace(/\D+/g, '');
}

function tokenMatchesText(text: string, token: string, textDigits: string): boolean {
  if (!token) return false;
  if (text.includes(token)) return true;

  // Handle phone-like lookups where stored values may contain spaces/country codes.
  const tokenDigits = normalizeDigits(token);
  if (tokenDigits.length >= 7 && textDigits.includes(tokenDigits)) {
    return true;
  }

  return false;
}

function matchesAllTokens(text: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;

  const textDigits = normalizeDigits(text);
  const matchedCount = tokens.filter((t) => tokenMatchesText(text, t, textDigits)).length;

  // For short name-like queries, allow partial token matches (e.g. "suraj dev" when only "suraj" exists).
  if (tokens.length <= 2) {
    return matchedCount >= 1;
  }

  // For longer natural-language queries, require a strong majority of token matches.
  const minMatches = Math.ceil(tokens.length * 0.6);
  return matchedCount >= minMatches;
}

function tokenizeQuery(query: string): string[] {
  const stopwords = new Set([
    'do',
    'you',
    'know',
    'me',
    'about',
    'tell',
    'please',
    'ron',
    'how',
    'many',
    'what',
    'is',
    'are',
    'the',
    'a',
    'an',
    'we',
    'have',
    'for',
    'of',
    'in',
    'to',
    'on',
    'with',
  ]);

  return normalizeText(query)
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !stopwords.has(t));
}

function isRelationshipToken(token: string): boolean {
  return ['husband', 'wife', 'spouse', 'partner'].includes(token);
}

function normalizeRelationshipToken(token: string): string {
  if (token === 'husband' || token === 'wife') return 'spouse';
  return token;
}

function isEntityTagged(entity: any, expectedTag: string): boolean {
  const tags = Array.isArray(entity?.tags) ? entity.tags : [];
  return tags.some((tag: any) => normalizeText(tag) === normalizeText(expectedTag));
}

function getProfileDefaults(profileType: 'person' | 'business') {
  if (profileType === 'business') {
    return {
      entityType: 'organization',
      profileTag: 'profile:business',
      roleTag: 'role:owner_business',
    };
  }

  return {
    entityType: 'person',
    profileTag: 'profile:self',
    roleTag: 'role:owner',
  };
}

function toNumberOrZero(value: any): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeCurrency(value?: string): string {
  const currency = String(value || '').trim().toUpperCase();
  return currency || 'INR';
}

function normalizeTransactionType(value: any): string {
  return String(value || 'unknown').trim().toLowerCase();
}

function isInflowType(type: string, inflowTypes: Set<string>): boolean {
  return inflowTypes.has(type);
}

function isOutflowType(type: string, outflowTypes: Set<string>): boolean {
  return outflowTypes.has(type);
}

function normalizeStatus(value: any): string {
  return String(value || '').trim().toLowerCase();
}

/**
 * MCP Handlers - Smart entity management
 */
export const MCP_HANDLERS: Record<string, (input: any) => Promise<any>> = {
  /**
   * Set or update the authenticated user's profile so AI can identify the owner context.
   */
  set_profile: async (input: SetProfileInput) => {
    try {
      const normalized = withUserId(input);
      const { user_id, data, tags = [] } = normalized;
      const profile_type = normalized.profile_type || 'person';

      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return response(false, null, 'Profile data must be a JSON object');
      }

      const { entityType, profileTag, roleTag } = getProfileDefaults(profile_type);
      const profileTags = Array.from(new Set([profileTag, roleTag, ...(tags || [])]));

      const existingEntities = await listEntitiesByUser(user_id, entityType, 300);
      const existingProfile = existingEntities.find((e: any) => isEntityTagged(e, profileTag));

      let profileEntityId = existingProfile?.id;

      if (profileEntityId) {
        await updateEntity(user_id, profileEntityId, data, 'profile_update');
      } else {
        profileEntityId = await findOrCreateEntity(user_id, entityType, data, profileTags);
        await updateEntity(user_id, profileEntityId, data, 'profile_update');
      }

      await ensureEntityTags(user_id, profileEntityId, profileTags);

      const profileEntity = await getEntity(user_id, profileEntityId);

      return response(true, {
        message: 'Profile saved successfully',
        profile_type,
        entity_id: profileEntityId,
        entity_type: entityType,
        tags: profileEntity.tags,
        data: profileEntity.data,
      });
    } catch (err: any) {
      return response(false, null, err.message);
    }
  },

  /**
   * Retrieve the authenticated user's profile.
   */
  get_profile: async (input: GetProfileInput) => {
    try {
      const normalized = withUserId(input);
      const { user_id, include_history } = normalized;
      const profile_type = normalized.profile_type || 'person';

      const { entityType, profileTag } = getProfileDefaults(profile_type);
      const candidates = await listEntitiesByUser(user_id, entityType, 300);
      const profile = candidates.find((e: any) => isEntityTagged(e, profileTag));

      if (!profile) {
        return response(true, {
          found: false,
          profile_type,
          message: `No ${profile_type} profile is set yet. Call set_profile first.`,
        });
      }

      const fullProfile = await getEntity(user_id, profile.id);

      return response(true, {
        found: true,
        profile_type,
        entity: {
          id: fullProfile.id,
          type: fullProfile.entity_type,
          created: fullProfile.created_at,
          last_updated: fullProfile.updated_at,
          tags: fullProfile.tags,
          data: fullProfile.data,
          history: include_history ? fullProfile.history : undefined,
        },
      });
    } catch (err: any) {
      return response(false, null, err.message);
    }
  },

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
      await updateEntity(user_id, finalEntityId, data, activity_type);

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
        const entity = await getEntity(user_id, entity_id);
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

      const mainEntity = await getEntity(user_id, entity_id);
      const related = await getRelatedEntities(user_id, entity_id);
      const relationByEntityId = new Map<string, string>(
        (mainEntity?.related_to || []).map((r: any) => [r.entity_id, r.relationship_type])
      );

      let filtered = related;
      if (relationship_type) {
        const relatedIds = (mainEntity?.related_to || [])
          .filter((r: any) => r.relationship_type === relationship_type)
          .map((r: any) => r.entity_id);
        filtered = related.filter((r: any) => relatedIds.includes(r.id));
      }

      return response(true, {
        count: filtered.length,
        related_entities: filtered.map((e) => ({
          id: e.id,
          type: e.entity_type,
          relationship_type: relationByEntityId.get(e.id) || 'related_to',
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

      const tokens = tokenizeQuery(query);
      const relationshipToken = tokens.find((t) => isRelationshipToken(t));
      const relationshipIntent = relationshipToken
        ? normalizeRelationshipToken(relationshipToken)
        : undefined;

      // First pass: indexed field search (fast)
      const indexedResults = await searchEntities(user_id, query, entity_type);

      // Fallback pass: scan flexible JSON payloads so non-name fields are discoverable.
      const allEntities = await listEntitiesByUser(user_id, entity_type, Math.max(limit * 5, 200));
      const fallbackResults = allEntities.filter((e: any) => {
        const haystack = [
          e.entity_type,
          e.tags?.join(' '),
          JSON.stringify(e.data || {}),
          JSON.stringify(e.related_to || []),
        ]
          .map(normalizeText)
          .join(' ');
        return matchesAllTokens(haystack, tokens);
      });

      // Merge and de-duplicate
      const byId = new Map<string, any>();
      [...indexedResults, ...fallbackResults].forEach((r: any) => {
        if (r?.id && !byId.has(r.id)) byId.set(r.id, r);
      });
      const mergedResults = Array.from(byId.values());

      let relationshipSummary: Record<string, any> | undefined;
      if (relationshipIntent) {
        const subjectTokens = tokens.filter((t) => !isRelationshipToken(t));
        if (subjectTokens.length > 0) {
          const subjectQuery = subjectTokens.join(' ');
          let subjectCandidates = await searchEntities(user_id, subjectQuery, 'person');
          if (subjectCandidates.length === 0) {
            const people = await listEntitiesByUser(user_id, 'person', 500);
            subjectCandidates = people.filter((p: any) => {
              const haystack = normalizeText(
                [p.entity_type, p.tags?.join(' '), JSON.stringify(p.data || {})].join(' ')
              );
              return matchesAllTokens(haystack, subjectTokens);
            });
          }

          if (subjectCandidates.length > 0) {
            const subject = subjectCandidates[0];
              const subjectEntity = await getEntity(user_id, subject.id);
            const relationByEntityId = new Map<string, string>(
              (subjectEntity?.related_to || []).map((r: any) => [r.entity_id, r.relationship_type])
            );
            const related = await getRelatedEntities(user_id, subject.id);

            const matches = related
              .filter((r: any) => {
                const rel = normalizeText(relationByEntityId.get(r.id) || '');
                if (relationshipIntent === 'spouse') {
                  return rel.includes('spouse') || rel.includes('husband') || rel.includes('wife') || rel.includes('partner');
                }
                return rel.includes(relationshipIntent);
              })
              .map((r: any) => ({
                id: r.id,
                relationship_type: relationByEntityId.get(r.id) || 'related_to',
                name: r?.data?.name || null,
                type: r.entity_type,
                data: r.data,
              }));

            relationshipSummary = {
              query_type: 'relationship_lookup',
              relationship: relationshipIntent,
              subject: {
                id: subject.id,
                name: subject?.data?.name || null,
              },
              count: matches.length,
              matches,
            };
          }
        }
      }

      // Booking intent summary (e.g., "pending caricature booking")
      const bookingIntent = tokens.some((t) => t.includes('booking')) || tokens.some((t) => t.includes('order'));
      const pendingIntent = tokens.includes('pending');
      let intentSummary: Record<string, any> | undefined;

      if (bookingIntent) {
        const bookingTypeToken = tokens.find((t) =>
          !['pending', 'booking', 'bookings', 'order', 'orders', 'how', 'many', 'have', 'we'].includes(t)
        );

        const bookingCandidates = mergedResults.filter((e: any) => {
          const blob = normalizeText(
            [e.entity_type, e.tags?.join(' '), JSON.stringify(e.data || {})].join(' ')
          );
          const hasBooking = blob.includes('booking') || blob.includes('order');
          const hasType = bookingTypeToken ? blob.includes(bookingTypeToken) : true;
          return hasBooking && hasType;
        });

        const pendingCount = bookingCandidates.filter((e: any) => {
          const status = normalizeText(e?.data?.status || e?.data?.booking_status || e?.data?.state || '');
          return pendingIntent ? status.includes('pending') : true;
        }).length;

        intentSummary = {
          query_type: 'booking_summary',
          booking_type: bookingTypeToken || null,
          pending_count: pendingIntent ? pendingCount : undefined,
          matched_bookings: bookingCandidates.length,
        };
      }

      return response(true, {
        query,
        count: Math.min(mergedResults.length, limit),
        scope_mode: 'scoped_user_only',
        no_result_reason:
          mergedResults.length === 0
            ? 'No matching business object found in current memory scope for this query.'
            : undefined,
        relationship_summary: relationshipSummary,
        summary: intentSummary,
        results: mergedResults.slice(0, limit).map((r) => ({
          id: r.id,
          type: r.entity_type,
          data: r.data,
          related_to: r.related_to || [],
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

      await mergeEntities(user_id, primary_entity_id, duplicate_entity_id);

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

  /**
   * Record bookkeeping transaction for expense/sale/purchase/income/cashflow analysis.
   */
  record_transaction: async (input: RecordTransactionInput) => {
    try {
      const normalized = withUserId(input);
      const {
        user_id,
        transaction,
        transaction_type,
        amount,
        currency,
        category,
        description,
        date,
        payment_mode,
        entity_id,
        tags = [],
        metadata,
      } = normalized;

      const transactionObject =
        transaction && typeof transaction === 'object' && !Array.isArray(transaction)
          ? transaction
          : {};

      const resolvedType = normalizeTransactionType(
        transaction_type ?? transactionObject.transaction_type ?? transactionObject.type
      );

      const resolvedAmount =
        amount ?? transactionObject.amount ?? transactionObject.value ?? transactionObject.total;
      const normalizedAmount = toNumberOrZero(resolvedAmount);
      if (normalizedAmount <= 0) {
        return response(false, null, 'amount must be a positive number');
      }

      const txDate =
        date || transactionObject.date || transactionObject.tx_date || (new Date().toISOString().split('T')[0] as string);
      const txCurrency = normalizeCurrency(currency || transactionObject.currency);
      const txCategory = category || transactionObject.category || null;
      const txDescription = description || transactionObject.description || transactionObject.note || null;
      const txPaymentMode = payment_mode || transactionObject.payment_mode || transactionObject.paymentMethod || null;

      const inflowTypes = new Set(['sale', 'income', 'refund', 'receipt', 'credit']);
      const outflowTypes = new Set(['purchase', 'expense', 'payment', 'debit']);

      const direction = isInflowType(resolvedType, inflowTypes)
        ? 'inflow'
        : isOutflowType(resolvedType, outflowTypes)
          ? 'outflow'
          : resolvedType === 'transfer'
            ? 'neutral'
            : 'neutral';

      const signedAmount =
        direction === 'inflow' ? normalizedAmount : direction === 'outflow' ? -normalizedAmount : 0;

      await addActivity(
        user_id,
        'transaction',
        {
          transaction_type: resolvedType,
          amount: normalizedAmount,
          signed_amount: signedAmount,
          direction,
          currency: txCurrency,
          category: txCategory,
          description: txDescription,
          payment_mode: txPaymentMode,
          metadata: metadata || {},
          date: txDate,
          transaction: transactionObject,
        },
        entity_id ? [{ entity_id, role: 'counterparty' }] : [],
        ['bookkeeping', `tx:${resolvedType}`, ...(tags || [])]
      );

      return response(true, {
        message: 'Transaction recorded successfully',
        transaction: {
          transaction_type: resolvedType,
          amount: normalizedAmount,
          signed_amount: signedAmount,
          direction,
          currency: txCurrency,
          category: txCategory,
          description: txDescription,
          payment_mode: txPaymentMode,
          date: txDate,
          entity_id: entity_id || null,
          transaction: transactionObject,
        },
      });
    } catch (err: any) {
      return response(false, null, err.message);
    }
  },

  /**
   * Get cash flow summary for a period.
   */
  get_cash_flow: async (input: GetCashFlowInput) => {
    try {
      const normalized = withUserId(input);
      const {
        user_id,
        period = 'month',
        date,
        entity_id,
        currency,
        inflow_types,
        outflow_types,
      } = normalized;

      const dateRange = getDateRange(period as 'day' | 'week' | 'month' | 'year', date);
      const selectedCurrency = currency ? normalizeCurrency(currency) : undefined;
      const activities = await getActivities(user_id, dateRange.start, dateRange.end, entity_id);
      const transactions = activities.filter((a: any) => a.activity_type === 'transaction');

      const inflowTypeSet = new Set(
        (inflow_types && inflow_types.length > 0
          ? inflow_types
          : ['sale', 'income', 'refund', 'receipt', 'credit'])
          .map((t: string) => normalizeTransactionType(t))
      );
      const outflowTypeSet = new Set(
        (outflow_types && outflow_types.length > 0
          ? outflow_types
          : ['purchase', 'expense', 'payment', 'debit'])
          .map((t: string) => normalizeTransactionType(t))
      );

      const filteredTransactions = selectedCurrency
        ? transactions.filter((t: any) => normalizeCurrency(t?.data?.currency) === selectedCurrency)
        : transactions;

      let inflow = 0;
      let outflow = 0;
      const byType: Record<string, number> = {};
      const byCategory: Record<string, number> = {};

      filteredTransactions.forEach((t: any) => {
        const txType = normalizeTransactionType(t?.data?.transaction_type || t?.data?.transaction?.type);
        const category = String(t?.data?.category || 'uncategorized');
        const amount = toNumberOrZero(t?.data?.amount);
        const direction = String(t?.data?.direction || '').toLowerCase();

        let signedAmount = toNumberOrZero(t?.data?.signed_amount);
        if (!signedAmount) {
          if (direction === 'inflow' || isInflowType(txType, inflowTypeSet)) {
            signedAmount = amount;
          } else if (direction === 'outflow' || isOutflowType(txType, outflowTypeSet)) {
            signedAmount = -amount;
          } else {
            signedAmount = 0;
          }
        }

        if (signedAmount > 0) inflow += signedAmount;
        if (signedAmount < 0) outflow += Math.abs(signedAmount);

        byType[txType] = (byType[txType] || 0) + amount;
        byCategory[category] = (byCategory[category] || 0) + amount;
      });

      return response(true, {
        period,
        date_range: dateRange,
        entity_id: entity_id || null,
        currency: selectedCurrency || null,
        inflow_types: Array.from(inflowTypeSet),
        outflow_types: Array.from(outflowTypeSet),
        transaction_count: filteredTransactions.length,
        inflow,
        outflow,
        net_cash_flow: inflow - outflow,
        by_type: byType,
        by_category: byCategory,
      });
    } catch (err: any) {
      return response(false, null, err.message);
    }
  },

  /**
   * Get finance summary with profit and pending balances.
   */
  get_finance_summary: async (input: GetFinanceSummaryInput) => {
    try {
      const normalized = withUserId(input);
      const {
        user_id,
        period = 'month',
        date,
        entity_id,
        currency,
        revenue_types,
        expense_types,
        pending_statuses,
      } = normalized;

      const dateRange = getDateRange(period as 'day' | 'week' | 'month' | 'year', date);
      const selectedCurrency = currency ? normalizeCurrency(currency) : undefined;
      const activities = await getActivities(user_id, dateRange.start, dateRange.end, entity_id);
      const transactions = activities.filter((a: any) => a.activity_type === 'transaction');

      const revenueTypeSet = new Set(
        (revenue_types && revenue_types.length > 0
          ? revenue_types
          : ['sale', 'income', 'refund', 'receipt', 'credit'])
          .map((t: string) => normalizeTransactionType(t))
      );
      const expenseTypeSet = new Set(
        (expense_types && expense_types.length > 0
          ? expense_types
          : ['purchase', 'expense', 'payment', 'debit'])
          .map((t: string) => normalizeTransactionType(t))
      );
      const pendingStatusSet = new Set(
        (pending_statuses && pending_statuses.length > 0
          ? pending_statuses
          : ['pending', 'unpaid', 'partial', 'partially_paid', 'due', 'open'])
          .map((s: string) => normalizeStatus(s))
      );

      const filtered = selectedCurrency
        ? transactions.filter((t: any) => normalizeCurrency(t?.data?.currency) === selectedCurrency)
        : transactions;

      let totalRevenue = 0;
      let totalExpense = 0;
      let pendingReceivables = 0;
      let pendingPayables = 0;

      filtered.forEach((t: any) => {
        const tx = t?.data?.transaction || {};
        const txType = normalizeTransactionType(t?.data?.transaction_type || tx?.transaction_type || tx?.type);
        const amount = toNumberOrZero(t?.data?.amount || tx?.amount || tx?.value || tx?.total);
        const paidAmount = toNumberOrZero(tx?.paid_amount ?? t?.data?.paid_amount ?? 0);
        const status = normalizeStatus(tx?.status ?? t?.data?.status ?? '');
        const direction = normalizeStatus(t?.data?.direction);

        const isRevenue = direction === 'inflow' || isInflowType(txType, revenueTypeSet);
        const isExpense = direction === 'outflow' || isOutflowType(txType, expenseTypeSet);

        if (isRevenue) totalRevenue += amount;
        if (isExpense) totalExpense += amount;

        const isPendingByStatus = status ? pendingStatusSet.has(status) : false;
        const balanceDue = Math.max(0, amount - paidAmount);

        if (balanceDue > 0 || isPendingByStatus) {
          const unresolved = balanceDue > 0 ? balanceDue : amount;
          if (isRevenue) pendingReceivables += unresolved;
          if (isExpense) pendingPayables += unresolved;
        }
      });

      return response(true, {
        period,
        date_range: dateRange,
        entity_id: entity_id || null,
        currency: selectedCurrency || null,
        revenue_types: Array.from(revenueTypeSet),
        expense_types: Array.from(expenseTypeSet),
        pending_statuses: Array.from(pendingStatusSet),
        transaction_count: filtered.length,
        totals: {
          revenue: totalRevenue,
          expense: totalExpense,
          gross_profit: totalRevenue - totalExpense,
          pending_receivables: pendingReceivables,
          pending_payables: pendingPayables,
          net_position_after_pending:
            (totalRevenue - totalExpense) + (pendingReceivables - pendingPayables),
        },
      });
    } catch (err: any) {
      return response(false, null, err.message);
    }
  },

  /**
   * Graph-first: get one object from unified model.
   */
  graph_get_object: async (input: GraphGetObjectInput) => {
    try {
      const normalized = withUserId(input);
      const { user_id, object_id } = normalized;

      const object = await getGraphObject(user_id, object_id);

      return response(true, {
        object: {
          id: object.id,
          type: object.type,
          title: object.title,
          status: object.status,
          properties: object.properties,
          created_at: object.created_at,
          updated_at: object.updated_at,
          deleted_at: object.deleted_at,
        },
      });
    } catch (err: any) {
      return response(false, null, err.message);
    }
  },

  /**
   * Graph-first: get incoming/outgoing connections for an object.
   */
  graph_get_connections: async (input: GraphGetConnectionsInput) => {
    try {
      const normalized = withUserId(input);
      const { user_id, object_id, relation, direction = 'both' } = normalized;

      const graph = await getGraphConnections(user_id, object_id, relation, direction);

      return response(true, {
        object_id,
        relation: relation || null,
        direction,
        outgoing_count: graph.outgoing.length,
        incoming_count: graph.incoming.length,
        outgoing: graph.outgoing,
        incoming: graph.incoming,
        connected_objects: graph.connected_objects,
      });
    } catch (err: any) {
      return response(false, null, err.message);
    }
  },

  /**
   * Graph-first: get object event timeline.
   */
  graph_get_timeline: async (input: GraphGetTimelineInput) => {
    try {
      const normalized = withUserId(input);
      const { user_id, object_id, limit = 100, event_type } = normalized;

      const events = await getGraphTimeline(user_id, object_id, limit, event_type);

      return response(true, {
        object_id,
        event_type: event_type || null,
        count: events.length,
        events,
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
  const baseUrl = (process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  return {
    protocol: 'mcp',
    version: '2.0.0',
    server_name: 'dev-ron AI Business OS MCP',
    server_url: `${baseUrl}/api/mcp`,
    name: 'dev-ron AI Business OS MCP',
    description:
      'AI-native business operating system memory interface that transforms raw input into connected business knowledge',
    tools: [
      {
        name: 'set_profile',
        description:
          'Set or update your owner profile (person or business) so MCP and AI can identify who you are in this tenant scope.',
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
            profile_type: { type: 'string', enum: ['person', 'business'] },
            data: { type: 'object', description: 'Profile fields like name, phone, company, website, role' },
            tags: { type: 'array', items: { type: 'string' } },
          },
          required: ['data'],
        },
      },
      {
        name: 'get_profile',
        description: 'Get your saved owner profile (person or business) for the current tenant scope.',
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
            profile_type: { type: 'string', enum: ['person', 'business'] },
            include_history: { type: 'boolean' },
          },
          required: [],
        },
      },
      {
        name: 'add_data',
        description:
          'Ingest raw business input into memory. Extracts business objects and updates or merges existing knowledge without duplicates.',
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
          'Get a full business object profile with consolidated facts, relationships, and optional immutable history.',
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
        description: 'Get relationship graph neighbors for a business object, including relationship types.',
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
        description: 'Get chronological event timeline for business actions across the selected scope.',
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
          'Get a reasoning-ready summary for a period from consolidated objects, events, and metrics.',
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
        description: 'Semantic search across schema-less business objects, relationships, and memory context.',
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
        description: 'Create a typed relationship edge between two business objects in the knowledge graph.',
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
        description: 'Merge duplicate business objects into one canonical record while preserving history.',
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
        description: 'Record a business metric event and attach it to global or object-specific context.',
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
        description: 'Retrieve business metrics for a period to support operating insights and decisions.',
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
      {
        name: 'record_transaction',
        description:
          'Record bookkeeping transactions using a flexible object payload (expense, sale, purchase, or custom types).',
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
            transaction: {
              type: 'object',
              description: 'Flexible transaction object. Recommended fields: type, amount, currency, category, description, date.',
            },
            transaction_type: { type: 'string' },
            amount: { type: 'number' },
            currency: { type: 'string' },
            category: { type: 'string' },
            description: { type: 'string' },
            date: { type: 'string' },
            payment_mode: { type: 'string' },
            entity_id: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            metadata: { type: 'object' },
          },
          required: ['transaction'],
        },
      },
      {
        name: 'get_cash_flow',
        description:
          'Get inflow, outflow, and net cash flow summary from recorded bookkeeping transactions.',
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
            currency: { type: 'string' },
            inflow_types: { type: 'array', items: { type: 'string' } },
            outflow_types: { type: 'array', items: { type: 'string' } },
          },
          required: [],
        },
      },
      {
        name: 'get_finance_summary',
        description:
          'Get revenue, expense, profit, pending receivables, and pending payables from transaction records.',
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
            currency: { type: 'string' },
            revenue_types: { type: 'array', items: { type: 'string' } },
            expense_types: { type: 'array', items: { type: 'string' } },
            pending_statuses: { type: 'array', items: { type: 'string' } },
          },
          required: [],
        },
      },
      {
        name: 'graph_get_object',
        description: 'Graph-first read: fetch one object by id from unified objects table.',
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
            object_id: { type: 'string' },
          },
          required: ['object_id'],
        },
      },
      {
        name: 'graph_get_connections',
        description: 'Graph-first read: fetch incoming/outgoing relations and connected objects.',
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
            object_id: { type: 'string' },
            relation: { type: 'string' },
            direction: { type: 'string', enum: ['outgoing', 'incoming', 'both'] },
          },
          required: ['object_id'],
        },
      },
      {
        name: 'graph_get_timeline',
        description: 'Graph-first read: fetch event timeline for one object id.',
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
            object_id: { type: 'string' },
            limit: { type: 'number' },
            event_type: { type: 'string' },
          },
          required: ['object_id'],
        },
      },
    ],
    resources: [],
  };
}
