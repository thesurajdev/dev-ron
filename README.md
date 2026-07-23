# Dev-Ron: AI-Powered Data Logger MCP

A comprehensive **Model Context Protocol (MCP)** tool for storing, organizing, and retrieving business data. Perfect for integrating with Claude AI to log daily activities, leads, deals, clients, and more.

## 🎯 Features

- **Store Any Data Type**: Leads, Clients, Interactions, Deals, Tasks, Notes, Profiles, Loans, Expenses
- **Smart Integration with Claude**: Claude understands your data and stores it intelligently
- **Time-Based Summaries**: Get daily, weekly, monthly, or yearly reports
- **Powerful Search**: Find entries by query, person, date range, or tags
- **Analytics & Insights**: Automatic calculations (win rates, deal values, expenses, etc.)
- **Bulk Operations**: Import/export data in JSON or CSV
- **Built with TypeScript**: Full type safety and IDE support
- **Supabase Backend**: Free, scalable PostgreSQL database

## 🚀 Quick Start

### 1. Prerequisites
- Node.js 18+ and npm
- Supabase account (free tier available)

### 2. Clone & Setup

```bash
# Clone the repository
git clone https://github.com/thesurajdev/dev-ron.git
cd dev-ron

# Install dependencies
npm install

# Create .env file with your Supabase credentials
cp .env.example .env
# Edit .env and add your SUPABASE_URL and SUPABASE_ANON_KEY
```

### 3. Database Setup

Run this SQL in your Supabase SQL editor:

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('lead', 'client', 'interaction', 'deal', 'task', 'note', 'profile', 'loan', 'expense')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  date DATE NOT NULL,
  tags TEXT[] DEFAULT ARRAY[]::TEXT[],
  data JSONB NOT NULL
);

CREATE INDEX idx_user_date ON entries(user_id, date DESC);
CREATE INDEX idx_user_type ON entries(user_id, entry_type);
CREATE INDEX idx_tags ON entries USING GIN(tags);
```

### 4. Start the Server

```bash
npm run dev:server
```

Server runs on `http://localhost:3000`

## 📖 Usage Examples

### With Claude

```
I'll share my daily business activities. Please log them for me:

1. Had a 30-minute call with John from Tech Corp. He's interested in enterprise plan.
2. Sent proposal to Jane Smith at Innovation Inc. Estimated deal value: $150k
3. Attended team meeting, discussed Q3 strategy
4. Expensed $50 for client coffee meeting
5. Created follow-up task: Call John back on Friday

Also, can you give me my weekly summary and show win rates?
```

### Using cURL (Legacy Format)

```bash
# Store a lead
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "store_entry",
    "input": {
      "user_id": "user@example.com",
      "entry_type": "lead",
      "data": {
        "name": "John Doe",
        "email": "john@example.com",
        "company": "Tech Corp",
        "status": "new",
        "estimated_value": 50000
      },
      "tags": ["sales", "important"]
    }
  }'

# Get daily summary
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "get_daily_summary",
    "input": {
      "user_id": "user@example.com",
      "date": "2024-07-23"
    }
  }'
```

### Using JSON-RPC 2.0

```bash
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "store_entry",
      "arguments": {
        "user_id": "user@example.com",
        "entry_type": "lead",
        "data": {
          "name": "Jane Smith",
          "status": "contacted"
        }
      }
    }
  }'
```

## 🔧 Available Tools

| Tool | Purpose |
|------|---------|
| `store_entry` | Store a new data entry |
| `get_entries` | Retrieve entries with filters |
| `search_entries` | Search by text query |
| `get_daily_summary` | Daily activity summary |
| `get_weekly_summary` | Weekly analytics |
| `get_monthly_summary` | Monthly insights |
| `get_yearly_summary` | Yearly report |
| `get_by_person` | Find all entries for a person |
| `update_entry` | Update an entry |
| `delete_entry` | Delete an entry |
| `bulk_import` | Import multiple entries |
| `export_data` | Export to JSON/CSV |

See [SETUP.md](./SETUP.md) for detailed documentation.

## 📊 Data Models

### Lead
```typescript
{
  name: string,
  email: string,
  phone: string,
  company: string,
  status: 'new' | 'contacted' | 'qualified' | 'converted' | 'lost',
  estimated_value: number,
  source: string,
  notes: string
}
```

### Deal
```typescript
{
  title: string,
  client_name: string,
  value: number,
  stage: 'prospect' | 'proposal' | 'negotiation' | 'closed_won' | 'closed_lost',
  probability: number (0-100),
  expected_close_date: string
}
```

### Interaction
```typescript
{
  type: 'call' | 'email' | 'meeting' | 'message' | 'demo',
  person_name: string,
  subject: string,
  duration_minutes: number,
  outcome: string
}
```

### Expense
```typescript
{
  category: string,
  amount: number,
  currency: string,
  vendor: string,
  description: string
}
```

And more... See [Types Documentation](./src/types/index.ts)

## 📁 Project Structure

```
dev-ron/
├── src/
│   ├── types/          # TypeScript type definitions
│   ├── storage/        # Supabase database functions
│   ├── core/           # Analytics and business logic
│   ├── mcp/            # MCP server and handlers
│   ├── api/            # API routes
│   └── index.ts        # Entry point
├── examples/
│   ├── server.ts       # Express.js server example
│   └── usage.ts        # Usage examples
├── SETUP.md            # Detailed setup guide
└── package.json
```

## 🛠️ Development

```bash
# Build TypeScript
npm run build

# Run tests
npm test

# Type checking
npm run type-check

# Development server
npm run dev:server
```

## 🔌 Integration Examples

### With Express.js
```typescript
import express from 'express';
import { handleMCPAPI } from './src/api/mcp-routes';

const app = express();
app.use(express.json());

app.post('/api/mcp', async (req, res) => {
  const response = await handleMCPAPI(req.body);
  res.json(response);
});

app.listen(3000);
```

### As NPM Package
```typescript
import {
  storeEntry,
  getEntries,
  getDailySummary
} from 'dev-ron';

// Use directly
await storeEntry(userId, 'lead', date, data, tags);
const entries = await getEntries(userId, { limit: 50 });
const summary = await getDailySummary(userId);
```

## 📈 Sample Output

### Daily Summary
```json
{
  "date": "2024-07-23",
  "total_entries": 12,
  "by_type": {
    "lead": 3,
    "interaction": 5,
    "deal": 2,
    "task": 2
  },
  "insights": {
    "new_leads": 3,
    "active_deals": 2,
    "total_expenses": 150.50
  }
}
```

### Monthly Summary
```json
{
  "month": "2024-07",
  "total_entries": 120,
  "analytics": {
    "total_deal_value": 500000,
    "deals_won": 8,
    "deals_lost": 2,
    "win_rate": "80.00",
    "avg_deal_size": "33333.33",
    "total_interactions": 45,
    "new_leads": 25
  }
}
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📝 License

ISC

## 🙋 Support

- 📖 [Full Documentation](./SETUP.md)
- 💬 [GitHub Issues](https://github.com/thesurajdev/dev-ron/issues)
- 📧 Contact: [GitHub Profile](https://github.com/thesurajdev)

## 🎉 Built With

- **TypeScript** - Type-safe development
- **Supabase** - PostgreSQL database
- **Express.js** - Web server
- **Model Context Protocol** - AI integration
- **Zod** - Schema validation

---

**Made with ❤️ to help you stay organized and data-driven**

