# Warung Backend - AI Agent Guide

## Project Context

This is the backend for a **warung (small store) management system** with AI-powered features:
- Voice-based debt tracking with text-to-speech
- OCR invoice scanning for automatic stock updates
- Barcode scanning with OpenFoodFacts integration
- AI-powered item recognition via camera
- Web dashboard for inventory and analytics

## Architecture Overview

This is a **3-layer architecture** (Controllers → Services → Data Access) with dependency injection via TypeDI. Key principle: **business logic lives in services, not routes**.

```
Routes (API layer) → Services (Business logic) → Models (Data access)
     ↓                      ↓                         ↓
Middlewares         Event system (pub/sub)    PostgreSQL (Supabase)
                           ↓
              External AI APIs (Kolosal AI, OpenFoodFacts)
```

## Dependency Injection Pattern

**Critical**: Use TypeDI's `Container` for all dependencies. Never instantiate services directly.

```typescript
// ✅ Correct - Get from container
const authService = Container.get(AuthService);

// ❌ Wrong - Direct instantiation breaks DI
const authService = new AuthService();
```

**Service registration**: Repositories/clients are injected in `src/loaders/dependencyInjector.ts` using string keys:
- `'supabase'` → Supabase client instance
- `'userRepository'` → User repository for database access
- `'logger'` → Winston logger instance
- `'agendaInstance'` → Job scheduler
- `'emailClient'` → Mailgun client

## Supabase Client Pattern

**Use Supabase client directly** (no ORM needed) - provides built-in RLS, Storage, Auth, and Realtime:

```typescript
// src/loaders/supabase.ts
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: false, // Backend doesn't need session persistence
    },
    db: {
      schema: 'public'
    }
  }
);

export default supabase;
```

**Database Queries** - Always use parameterized queries:
```typescript
// ✅ Correct - Parameterized with Supabase client
const { data, error } = await this.supabase
  .from('debts')
  .select('*, customer:customers(name)')
  .eq('merchant_id', merchantId)
  .order('created_at', { ascending: false });

// ❌ Wrong - String concatenation (SQL injection risk)
const query = `SELECT * FROM debts WHERE merchant_id = '${merchantId}'`;
```

**Insert/Update/Upsert**:
```typescript
// Insert single row
const { data: newDebt, error } = await this.supabase
  .from('debts')
  .insert({ merchant_id: merchantId, customer_name: name, amount })
  .select()
  .single();

// Bulk insert
const { data: items, error } = await this.supabase
  .from('items')
  .insert([
    { merchant_id: merchantId, barcode: '123', name: 'Item 1' },
    { merchant_id: merchantId, barcode: '456', name: 'Item 2' }
  ])
  .select();

// Upsert (insert or update on conflict)
const { data: item, error } = await this.supabase
  .from('items')
  .upsert(
    { barcode: '123', merchant_id: merchantId, name: 'Updated', stock: 10 },
    { onConflict: 'barcode,merchant_id' }
  )
  .select()
  .single();
```

**Error Handling**:
```typescript
const { data, error } = await this.supabase
  .from('debts')
  .select('*')
  .eq('id', debtId)
  .single();

if (error) {
  this.logger.error('Database error: %o', error);
  throw new Error(`Failed to fetch debt: ${error.message}`);
}

return data;
```

## Route Pattern (Controllers)

Routes live in `src/api/routes/` and follow this exact pattern:

```typescript
import { Container } from 'typedi';
import { celebrate, Joi } from 'celebrate';

route.post('/endpoint',
  celebrate({
    body: Joi.object({
      field: Joi.string().required(),
    }),
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    const logger = Container.get('logger');
    try {
      const serviceInstance = Container.get(ServiceClass);
      const result = await serviceInstance.method(req.body);
      return res.status(200).json(result);
    } catch (e) {
      logger.error('🔥 error: %o', e);
      return next(e);
    }
  }
);
```

**Key requirements**:
- Always use `celebrate` + Joi for request validation at route level
- Get logger from Container, not import
- Catch all errors and pass to `next(e)` for centralized error handling
- Return response with proper status code

## Service Layer Pattern

Services in `src/services/` use the `@Service()` decorator and constructor injection:

```typescript
import { Service, Inject } from 'typedi';
import { EventDispatcher, EventDispatcherInterface } from '@/decorators/eventDispatcher';
import { SupabaseClient } from '@supabase/supabase-js';

@Service()
export default class MyService {
  constructor(
    @Inject('supabase') private supabase: SupabaseClient,
    @Inject('userRepository') private userRepository,
    @Inject('logger') private logger,
    @EventDispatcher() private eventDispatcher: EventDispatcherInterface,
  ) {}
  
  public async doSomething(input) {
    this.logger.silly('Doing something');
    // Business logic here
    this.eventDispatcher.dispatch(events.something.happened, { data });
  }
}
```

**Never put business logic in routes** - services should be testable without Express.

## Event-Driven Architecture

Use the pub/sub pattern for side effects (emails, analytics, async tasks):

1. Define events in `src/subscribers/events.ts`
2. Dispatch in services: `this.eventDispatcher.dispatch(events.user.signUp, { user })`
3. Handle in subscribers (decorators): `@On(events.user.signUp)` in `src/subscribers/`

**Don't** await event handlers - they're fire-and-forget for decoupling.

## Authentication Flow

JWT authentication uses `express-jwt` middleware:
- Middleware: `src/api/middlewares/isAuth.ts` extracts `Authorization: Bearer <token>`
- Token stored in `req.token` (not `req.user`)
- Use `attachCurrentUser` middleware to hydrate full user from DB into `req.currentUser`
- Secrets configured in `src/config/index.ts` from `.env`

Protected route pattern:
```typescript
route.get('/me', middlewares.isAuth, middlewares.attachCurrentUser, 
  (req: Request, res: Response) => {
    return res.json({ user: req.currentUser }).status(200);
  }
);
```

## Path Aliases

Use `@/` prefix for imports - configured in `tsconfig.json`:
```typescript
import config from '@/config';
import { IUser } from '@/interfaces/IUser';
```

Never use relative paths like `../../config`.

## Loader System

App initialization happens in 4 phases (`src/loaders/index.ts`):
1. **supabase** - Initialize Supabase client connection
2. **dependencyInjector** - Register repositories/services in TypeDI Container
3. **jobs** - Start Agenda.js background jobs (uses MongoDB for job queue only)
4. **express** - Configure middleware and routes

**Critical**: Import `'reflect-metadata'` first in `src/app.ts` for decorators to work.

## Background Jobs

Use Agenda.js for scheduled/background tasks:
1. Define job handlers in `src/jobs/` (must have `.handler(job, done)` method)
2. Register in `src/loaders/jobs.ts` with `agenda.define()`
3. Trigger with `agenda.now('job-name', { data })`

**Note**: Agenda.js uses MongoDB for job queue storage only. Configure separate MongoDB connection for job persistence:
```typescript
const agenda = new Agenda({ db: { address: process.env.MONGODB_URI_JOBS } });
```

Jobs access services via Container.get().

## Feature Implementation Checklist

When implementing new features, follow this order:

1. **Define Schema** - Create migration in `migrations/` with SQL DDL
2. **Add RLS Policies** - Enable Row Level Security for multi-tenancy
3. **Create Repository** in `src/repositories/` for data access layer
4. **Register Repository** in `src/loaders/dependencyInjector.ts`
5. **Create Interface** in `src/interfaces/` for TypeScript types
6. **Build Service** in `src/services/` with `@Service()` decorator
7. **Add Events** in `src/subscribers/events.ts` if needed
8. **Create Routes** in `src/api/routes/` with Celebrate validation
9. **Register Routes** in `src/api/index.ts`
10. **Add Background Jobs** in `src/jobs/` if async processing needed

## Development Commands

```bash
npm start          # Run with nodemon (auto-reload)
npm run inspect    # Debug mode with Node inspector
npm test           # Run Jest tests
npm run lint:fix   # Auto-fix ESLint issues
```

**No `npm install` needed after first setup** - dependencies rarely change.

## Domain Models

Core entities for the warung system:

**Merchant**: User model (already exists) - extends with `merchantId`, `storeName`
**Debt**: `merchantId`, `customerName`, `amount`, `createdAt`, `paidAt?`, `notes?`
**Item**: `merchantId`, `barcode`, `name`, `openFoodFactsName?`, `buyingPrice`, `sellingPrice`, `stock`, `category?`
**Transaction**: `merchantId`, `items[]`, `totalAmount`, `type` ('sale'|'spending'), `createdAt`
**Invoice**: `merchantId`, `supplierName`, `items[]`, `totalAmount`, `scannedImageUrl`, `ocrData`, `createdAt`

**Model Pattern**: All domain models should include `merchant_id` for multi-tenancy and use timestamps.

```sql
-- Example: debts table
CREATE TABLE debts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID NOT NULL REFERENCES users(id),
  customer_name VARCHAR(255) NOT NULL,
  amount DECIMAL(15, 2) NOT NULL,
  paid_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_debts_merchant_id ON debts(merchant_id);
```

**Repository Pattern**: Access database via repositories in `src/repositories/`:
```typescript
// src/repositories/debtRepository.ts
import { SupabaseClient } from '@supabase/supabase-js';
import { Inject, Service } from 'typedi';

@Service()
export class DebtRepository {
  constructor(@Inject('supabase') private supabase: SupabaseClient) {}

  async create(merchantId: string, data: DebtInput) {
    const { data: debt, error } = await this.supabase
      .from('debts')
      .insert({ merchant_id: merchantId, ...data })
      .select()
      .single();
    
    if (error) throw error;
    return debt;
  }

  async findByCustomerName(merchantId: string, name: string) {
    const { data, error } = await this.supabase
      .from('debts')
      .select('*')
      .eq('merchant_id', merchantId)
      .ilike('customer_name', `%${name}%`)
      .is('paid_at', null);
    
    if (error) throw error;
    return data;
  }

  async getTotalUnpaid(merchantId: string): Promise<number> {
    const { data, error } = await this.supabase
      .rpc('get_total_unpaid_debts', { p_merchant_id: merchantId });
    
    if (error) throw error;
    return data;
  }
}
```

## Storage API (Files & Images)

**Upload invoice/camera images**:
```typescript
// src/services/invoiceOcr.ts
import { SupabaseClient } from '@supabase/supabase-js';

export class InvoiceOcrService {
  constructor(@Inject('supabase') private supabase: SupabaseClient) {}

  async uploadInvoice(merchantId: string, file: File): Promise<string> {
    const fileName = `${merchantId}/${Date.now()}-${file.name}`;
    
    const { data, error } = await this.supabase.storage
      .from('invoices')
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type
      });
    
    if (error) throw error;
    
    // Get public URL
    const { data: { publicUrl } } = this.supabase.storage
      .from('invoices')
      .getPublicUrl(data.path);
    
    return publicUrl;
  }

  async getSignedUrl(path: string, expiresIn = 3600): Promise<string> {
    const { data, error } = await this.supabase.storage
      .from('invoices')
      .createSignedUrl(path, expiresIn);
    
    if (error) throw error;
    return data.signedUrl;
  }
}
```

**Storage buckets setup** (run via Supabase dashboard or migration):
```sql
-- Create buckets
INSERT INTO storage.buckets (id, name, public) 
VALUES 
  ('invoices', 'invoices', false),
  ('camera-scans', 'camera-scans', false);

-- RLS policies for invoices bucket
CREATE POLICY "Users can upload their invoices"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'invoices' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can view their invoices"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'invoices' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );
```

## AI Integration Patterns

**Voice Commands (Kolosal AI)**:
- Service: `src/services/voiceCommand.ts` - handles speech-to-text and intent parsing
- Parse patterns: "Catat Hutang, [Name], [Amount]" → extract customer name and debt amount
- Response: text-to-speech via event dispatcher for async processing

**OCR Invoice Scanning**:
- Service: `src/services/invoiceOcr.ts` - integrates with Kolosal AI OCR API
- Extract: supplier name, item names, quantities, prices
- Match items to existing inventory using fuzzy search or vector similarity
- Create transaction record + update stock

**OpenFoodFacts Integration**:
- Service: `src/services/openFoodFacts.ts` - wrapper for OpenFoodFacts API
- Cache results in database to reduce API calls
- Pattern: barcode → product name → fuzzy match with inventory

**Barcode Detection**:
- Service: `src/services/barcodeScanner.ts` - process camera images via AI
- Flow: image → barcode extraction → lookup in database → return item details

## Realtime Subscriptions (Dashboard Updates)

**Listen to database changes** for live dashboard:
```typescript
// In web dashboard client
const channel = supabase
  .channel('dashboard-updates')
  .on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'public',
      table: 'transactions'
    },
    (payload) => {
      console.log('New transaction:', payload.new);
      // Update UI
    }
  )
  .on(
    'postgres_changes',
    {
      event: 'UPDATE',
      schema: 'public',
      table: 'items',
      filter: 'stock=lt.10' // Low stock alert
    },
    (payload) => {
      console.log('Low stock item:', payload.new);
    }
  )
  .subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      console.log('Listening for real-time updates');
    }
  });

// Cleanup on component unmount
channel.unsubscribe();
```

## Search Patterns

**Full-Text Search (Version 1)**:
```sql
-- Add GiST index for full-text search
CREATE INDEX idx_items_fulltext ON items 
USING GIN (to_tsvector('indonesian', name || ' ' || COALESCE(open_foodfacts_name, '')));
```
```typescript
// In service
const { data: items } = await this.supabase
  .from('items')
  .select('*')
  .textSearch('fts', query, { config: 'indonesian' });
```

**Vector Search (Version 2)** - For fuzzy matching different item names:
- Use PostgreSQL with **pgvector extension** (already available in Supabase)
- Store embeddings alongside item names for semantic similarity
- Service: `src/services/itemMatcher.ts` - generates and searches embeddings

```sql
-- Enable pgvector and add vector column
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE items ADD COLUMN embedding vector(1536);
CREATE INDEX ON items USING ivfflat (embedding vector_cosine_ops);
```
```typescript
// Vector similarity search
const { data: items } = await this.supabase.rpc('match_items', {
  query_embedding: embedding,
  match_threshold: 0.8,
  match_count: 10
});
```

## Common Patterns

**Password hashing**: Use argon2, store salt separately:
```typescript
const salt = randomBytes(32);
const hashedPassword = await argon2.hash(password, { salt });
```

**Supabase queries**: Always use parameterized queries to prevent SQL injection
```typescript
const { data, error } = await this.supabase
  .from('table')
  .select('*')
  .eq('merchant_id', merchantId);
```

**Multi-tenancy with Row Level Security (RLS)** - Automatic merchant isolation:
```sql
-- Enable RLS on all tables
ALTER TABLE debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only access their own merchant's data
CREATE POLICY merchant_isolation_select ON debts
  FOR SELECT
  USING (merchant_id = auth.uid());

CREATE POLICY merchant_isolation_insert ON debts
  FOR INSERT
  WITH CHECK (merchant_id = auth.uid());

CREATE POLICY merchant_isolation_update ON debts
  FOR UPDATE
  USING (merchant_id = auth.uid())
  WITH CHECK (merchant_id = auth.uid());

CREATE POLICY merchant_isolation_delete ON debts
  FOR DELETE
  USING (merchant_id = auth.uid());
```

**Service Layer with RLS** - No need to manually filter by merchant_id:
```typescript
// RLS automatically filters by auth.uid()
// But you need to set the user context in Supabase client
export class DebtService {
  constructor(
    @Inject('supabase') private supabase: SupabaseClient,
    @Inject('debtRepository') private debtRepository
  ) {}

  // Create merchant-scoped client from JWT
  private getClientForUser(jwt: string): SupabaseClient {
    return createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!,
      {
        global: {
          headers: {
            Authorization: `Bearer ${jwt}`
          }
        }
      }
    );
  }

  async listDebts(userJwt: string) {
    const client = this.getClientForUser(userJwt);
    // RLS automatically filters by merchant_id = auth.uid()
    const { data, error } = await client
      .from('debts')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data;
  }
}
```

**Error responses**: Centralized in `src/loaders/express.ts` - just throw errors from services

**Logging**: Use winston with levels `silly` → `debug` → `info` → `error`

**External API calls**: Wrap in try-catch, add retries for transient failures, log all requests/responses

## What NOT to Do

- ❌ Don't use ORMs (Prisma, TypeORM) - Supabase client is sufficient
- ❌ Don't use passport.js (use Supabase Auth or express-jwt)
- ❌ Don't store business logic in routes
- ❌ Don't instantiate services with `new` keyword
- ❌ Don't forget `@Service()` decorator on service classes
- ❌ Don't use relative imports when `@/` alias exists
- ❌ Don't forget to call `done()` in Agenda job handlers
- ❌ Don't bypass Row Level Security - pass user JWT to queries
- ❌ Don't use string concatenation for SQL - use Supabase query builder
- ❌ Don't store API keys in code - use environment variables
- ❌ Don't forget to check `error` object after Supabase operations
- ❌ Don't use `.throwOnError()` - prefer explicit error handling
