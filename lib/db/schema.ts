import { appSchema, tableSchema } from '@nozbe/watermelondb'

// Speiler Postgres-skjemaet (supabase/migrations). Kolonnenavn = snake_case,
// identisk med serverens — synk-protokollen mapper 1:1.
// Ved skjemaendring: bump version + legg til migrations (WatermelonDB docs).
export const schema = appSchema({
  version: 4,
  tables: [
    tableSchema({
      name: 'products',
      columns: [
        { name: 'elnummer', type: 'string', isOptional: true, isIndexed: true },
        { name: 'name', type: 'string' },
        { name: 'unit', type: 'string' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'locations',
      columns: [
        { name: 'type', type: 'string' }, // lager|bil
        { name: 'name', type: 'string' },
        { name: 'assigned_to', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'stock_movements',
      columns: [
        { name: 'product_id', type: 'string', isIndexed: true },
        { name: 'location_id', type: 'string', isIndexed: true },
        { name: 'quantity', type: 'number' }, // fortegn: + inn, - ut
        { name: 'kind', type: 'string' }, // inn|ut|overfor|justering
        { name: 'order_id', type: 'string', isOptional: true },
        { name: 'note', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'order_materials',
      columns: [
        { name: 'order_id', type: 'string', isIndexed: true },
        { name: 'elnummer', type: 'string', isOptional: true }, // universell bestillingsnøkkel
        { name: 'description', type: 'string' },
        { name: 'quantity', type: 'number' },
        { name: 'unit', type: 'string' }, // stk|m|pk …
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'order_documents',
      columns: [
        { name: 'order_id', type: 'string', isIndexed: true },
        { name: 'template_id', type: 'string' }, // f.eks. 'ampex.risikovurdering'
        { name: 'template_version', type: 'number' },
        { name: 'status', type: 'string' }, // utkast|fullfort («foreslått» er virtuelt — ingen rad før første endring)
        { name: 'data', type: 'string', isOptional: true }, // utfylling som JSON-string
        { name: 'completed_by', type: 'string', isOptional: true },
        { name: 'completed_at', type: 'number', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'orders',
      columns: [
        { name: 'order_number', type: 'number', isOptional: true }, // settes av server-trigger
        { name: 'title', type: 'string' },
        { name: 'description', type: 'string', isOptional: true },
        { name: 'customer_name', type: 'string', isOptional: true },
        { name: 'customer_phone', type: 'string', isOptional: true },
        { name: 'address', type: 'string', isOptional: true },
        { name: 'status', type: 'string' }, // mottatt|planlagt|pagaar|fakturaklar|fakturert
        { name: 'assigned_to', type: 'string', isOptional: true },
        { name: 'scheduled_at', type: 'number', isOptional: true }, // epoch ms
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
  ],
})
