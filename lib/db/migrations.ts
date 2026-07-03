import { schemaMigrations, createTable } from '@nozbe/watermelondb/Schema/migrations'

// Holder eksisterende lokale databaser i live ved skjemabump — MÅ speile schema.ts.
export const migrations = schemaMigrations({
  migrations: [
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
