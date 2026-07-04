import { schemaMigrations, createTable } from '@nozbe/watermelondb/Schema/migrations'

// Holder eksisterende lokale databaser i live ved skjemabump — MÅ speile schema.ts.
export const migrations = schemaMigrations({
  migrations: [
    {
      toVersion: 4,
      steps: [
        createTable({
          name: 'products',
          columns: [
            { name: 'elnummer', type: 'string', isOptional: true, isIndexed: true },
            { name: 'name', type: 'string' },
            { name: 'unit', type: 'string' },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
        createTable({
          name: 'locations',
          columns: [
            { name: 'type', type: 'string' },
            { name: 'name', type: 'string' },
            { name: 'assigned_to', type: 'string', isOptional: true },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
        createTable({
          name: 'stock_movements',
          columns: [
            { name: 'product_id', type: 'string', isIndexed: true },
            { name: 'location_id', type: 'string', isIndexed: true },
            { name: 'quantity', type: 'number' },
            { name: 'kind', type: 'string' },
            { name: 'order_id', type: 'string', isOptional: true },
            { name: 'note', type: 'string', isOptional: true },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
      ],
    },
    {
      toVersion: 3,
      steps: [
        createTable({
          name: 'order_materials',
          columns: [
            { name: 'order_id', type: 'string', isIndexed: true },
            { name: 'elnummer', type: 'string', isOptional: true },
            { name: 'description', type: 'string' },
            { name: 'quantity', type: 'number' },
            { name: 'unit', type: 'string' },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
      ],
    },
    {
      toVersion: 2,
      steps: [
        createTable({
          name: 'order_documents',
          columns: [
            { name: 'order_id', type: 'string', isIndexed: true },
            { name: 'template_id', type: 'string' },
            { name: 'template_version', type: 'number' },
            { name: 'status', type: 'string' },
            { name: 'data', type: 'string', isOptional: true },
            { name: 'completed_by', type: 'string', isOptional: true },
            { name: 'completed_at', type: 'number', isOptional: true },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
      ],
    },
  ],
})
