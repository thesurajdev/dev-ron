/**
 * Example: Storing and retrieving lead data
 */

import { handleMCPAPI } from '../src/api/mcp-routes.js';

const USER_ID = 'user@example.com';

export async function exampleStoreLead() {
  console.log('\n=== Example: Store Lead ===');

  const response = await handleMCPAPI({
    tool: 'store_entry',
    input: {
      user_id: USER_ID,
      entry_type: 'lead',
      date: new Date().toISOString().split('T')[0],
      tags: ['sales', 'important'],
      data: {
        name: 'John Doe',
        email: 'john@example.com',
        phone: '+1 (555) 123-4567',
        company: 'Tech Corp',
        position: 'CTO',
        source: 'linkedin',
        status: 'contacted',
        estimated_value: 50000,
        notes: 'Very interested in enterprise plan. Follow up next week.',
        next_follow_up: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split('T')[0],
      },
    },
  });

  console.log('Response:', JSON.stringify(response, null, 2));
  return response;
}

export async function exampleStoreInteraction() {
  console.log('\n=== Example: Store Interaction ===');

  const response = await handleMCPAPI({
    tool: 'store_entry',
    input: {
      user_id: USER_ID,
      entry_type: 'interaction',
      date: new Date().toISOString().split('T')[0],
      tags: ['call', 'sales'],
      data: {
        type: 'call',
        person_name: 'John Doe',
        subject: 'Enterprise plan discussion',
        duration_minutes: 45,
        outcome: 'Positive - client interested',
        next_step: 'Send proposal by Friday',
        attendees: ['John Doe', 'Sarah Smith'],
      },
    },
  });

  console.log('Response:', JSON.stringify(response, null, 2));
  return response;
}

export async function exampleStoreDeal() {
  console.log('\n=== Example: Store Deal ===');

  const response = await handleMCPAPI({
    tool: 'store_entry',
    input: {
      user_id: USER_ID,
      entry_type: 'deal',
      date: new Date().toISOString().split('T')[0],
      tags: ['sales', 'active'],
      data: {
        title: 'Tech Corp Enterprise Implementation',
        client_name: 'Tech Corp',
        stage: 'proposal',
        value: 250000,
        probability: 75,
        expected_close_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split('T')[0],
        description: 'Enterprise package with custom integrations',
        competitors: ['CompetitorA', 'CompetitorB'],
      },
    },
  });

  console.log('Response:', JSON.stringify(response, null, 2));
  return response;
}

export async function exampleStoreExpense() {
  console.log('\n=== Example: Store Expense ===');

  const response = await handleMCPAPI({
    tool: 'store_entry',
    input: {
      user_id: USER_ID,
      entry_type: 'expense',
      date: new Date().toISOString().split('T')[0],
      tags: ['client', 'food'],
      data: {
        category: 'food',
        amount: 150.5,
        currency: 'USD',
        vendor: 'Premium Restaurant',
        payment_method: 'credit_card',
        description: 'Client lunch meeting with Tech Corp team',
        related_to: 'Tech Corp Enterprise Implementation',
      },
    },
  });

  console.log('Response:', JSON.stringify(response, null, 2));
  return response;
}

export async function exampleGetDailySummary() {
  console.log('\n=== Example: Get Daily Summary ===');

  const response = await handleMCPAPI({
    tool: 'get_daily_summary',
    input: {
      user_id: USER_ID,
      date: new Date().toISOString().split('T')[0],
    },
  });

  console.log('Response:', JSON.stringify(response, null, 2));
  return response;
}

export async function exampleSearchEntries() {
  console.log('\n=== Example: Search Entries ===');

  const response = await handleMCPAPI({
    tool: 'search_entries',
    input: {
      user_id: USER_ID,
      search_query: 'John Doe',
      entry_types: ['lead', 'interaction'],
    },
  });

  console.log('Response:', JSON.stringify(response, null, 2));
  return response;
}

export async function exampleBulkImport() {
  console.log('\n=== Example: Bulk Import ===');

  const response = await handleMCPAPI({
    tool: 'bulk_import',
    input: {
      user_id: USER_ID,
      entries: [
        {
          entry_type: 'lead',
          date: new Date().toISOString().split('T')[0],
          data: {
            name: 'Alice Johnson',
            email: 'alice@example.com',
            company: 'Innovation Inc',
            status: 'new',
            source: 'referral',
            estimated_value: 30000,
          },
          tags: ['referral'],
        },
        {
          entry_type: 'lead',
          date: new Date().toISOString().split('T')[0],
          data: {
            name: 'Bob Smith',
            email: 'bob@example.com',
            company: 'Digital Solutions',
            status: 'contacted',
            source: 'website',
            estimated_value: 45000,
          },
          tags: ['website', 'hot'],
        },
      ],
    },
  });

  console.log('Response:', JSON.stringify(response, null, 2));
  return response;
}

// Run all examples
export async function runAllExamples() {
  try {
    await exampleStoreLead();
    await exampleStoreInteraction();
    await exampleStoreDeal();
    await exampleStoreExpense();
    await exampleGetDailySummary();
    await exampleSearchEntries();
    await exampleBulkImport();
  } catch (err) {
    console.error('Error running examples:', err);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runAllExamples();
}
