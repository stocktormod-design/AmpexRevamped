import { appSchema, tableSchema } from '@nozbe/watermelondb'

// Speiler Postgres-skjemaet (supabase/migrations). Kolonnenavn = snake_case,
// identisk med serverens — synk-protokollen mapper 1:1.
// Ved skjemaendring: bump version + legg til migrations (WatermelonDB docs).
export const schema = appSchema({
  version: 21,
  tables: [
    tableSchema({
      name: 'nfc_tags',
      columns: [
        { name: 'tag_uid', type: 'string', isIndexed: true },
        { name: 'target_type', type: 'string' }, // material | location
        { name: 'target_id', type: 'string' },
        { name: 'default_qty', type: 'number', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'mesh_markers',
      columns: [
        { name: 'room_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'order_scan_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'scan_path', type: 'string', isIndexed: true }, // hvilken GLB-revisjon punktet er satt på — følger IKKE rescan
        { name: 'x', type: 'number' },
        { name: 'y', type: 'number' },
        { name: 'z', type: 'number' },
        { name: 'symbol_id', type: 'string' }, // id fra lib/symbols.ts
        { name: 'note', type: 'string', isOptional: true },
        { name: 'created_by', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'order_scans',
      columns: [
        { name: 'order_id', type: 'string', isIndexed: true },
        { name: 'kind', type: 'string' }, // planlegging | dokumentasjon
        { name: 'title', type: 'string' },
        { name: 'scan_path', type: 'string', isOptional: true }, // R2-nøkkel til skann
        { name: 'created_by', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'drawing_loops',
      columns: [
        { name: 'drawing_id', type: 'string', isIndexed: true },
        { name: 'name', type: 'string' },
        { name: 'number', type: 'number' },
        { name: 'color', type: 'string' },
        { name: 'nodes', type: 'string', isOptional: true }, // JSON [{x,y,label?}] normalisert
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'form_templates',
      columns: [
        { name: 'key', type: 'string', isOptional: true },
        { name: 'title', type: 'string' },
        { name: 'category', type: 'string' },
        { name: 'current_version', type: 'number' },
        { name: 'status', type: 'string' }, // draft | published | archived
        { name: 'created_by', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'form_template_revisions',
      columns: [
        { name: 'template_id', type: 'string', isIndexed: true },
        { name: 'version', type: 'number' },
        { name: 'schema', type: 'string', isOptional: true }, // JSON: { items: [...] }
        { name: 'change_note', type: 'string', isOptional: true }, // HVORFOR
        { name: 'changed_by', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'form_comments',
      columns: [
        { name: 'template_id', type: 'string', isIndexed: true },
        { name: 'field_id', type: 'string', isOptional: true },
        { name: 'version', type: 'number', isOptional: true },
        { name: 'body', type: 'string' },
        { name: 'author_name', type: 'string', isOptional: true },
        { name: 'resolved', type: 'boolean' },
        { name: 'resolved_revision', type: 'number', isOptional: true },
        { name: 'created_by', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'tasks',
      columns: [
        { name: 'project_id', type: 'string', isIndexed: true },
        { name: 'room_id', type: 'string', isOptional: true },
        { name: 'kind', type: 'string' }, // general | lidar_scan
        { name: 'title', type: 'string' },
        { name: 'status', type: 'string' }, // open | done
        { name: 'assigned_to', type: 'string', isOptional: true, isIndexed: true },
        { name: 'created_by', type: 'string', isOptional: true },
        { name: 'done_at', type: 'number', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'drawing_markup',
      columns: [
        { name: 'drawing_id', type: 'string', isIndexed: true },
        { name: 'data', type: 'string', isOptional: true }, // JSON: streker i normaliserte side-koordinater
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'rooms',
      columns: [
        { name: 'project_id', type: 'string', isIndexed: true },
        { name: 'plan', type: 'string' },
        { name: 'name', type: 'string' },
        { name: 'progress', type: 'string', isOptional: true }, // JSON: per-fagfelt %
        { name: 'scan_path', type: 'string', isOptional: true }, // R2-nøkkel til LiDAR-skann
        { name: 'shape', type: 'string', isOptional: true }, // JSON {x,y,w,h} normalisert — firkant på tegningen
        { name: 'drawing_id', type: 'string', isOptional: true, isIndexed: true }, // tegningen rommet er tegnet på
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'assistant_notes',
      columns: [
        { name: 'user_id', type: 'string', isIndexed: true },
        { name: 'content', type: 'string' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'reminders',
      columns: [
        { name: 'user_id', type: 'string', isIndexed: true },
        { name: 'title', type: 'string' },
        { name: 'due_at', type: 'number' }, // epoch ms
        { name: 'order_id', type: 'string', isOptional: true },
        { name: 'note', type: 'string', isOptional: true },
        { name: 'status', type: 'string' }, // open | done
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'time_entries',
      columns: [
        { name: 'order_id', type: 'string', isIndexed: true },
        { name: 'user_id', type: 'string' },
        { name: 'user_name', type: 'string' }, // navn-snapshot for offline-visning
        { name: 'date', type: 'number' }, // dagen timene gjelder (epoch ms, midnatt lokal)
        { name: 'hours', type: 'number' },
        { name: 'note', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'order_members',
      columns: [
        { name: 'order_id', type: 'string', isIndexed: true },
        { name: 'user_id', type: 'string' },
        { name: 'user_name', type: 'string' }, // navn-snapshot for offline-visning
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'project_members',
      columns: [
        { name: 'project_id', type: 'string', isIndexed: true },
        { name: 'user_id', type: 'string' },
        { name: 'user_name', type: 'string' }, // navn-snapshot for offline-visning
        { name: 'role', type: 'string' },
        { name: 'is_scan_responsible', type: 'boolean', isOptional: true }, // per-prosjekt LiDAR-ansvarlig
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'projects',
      columns: [
        { name: 'name', type: 'string' },
        { name: 'customer_name', type: 'string', isOptional: true },
        { name: 'address', type: 'string', isOptional: true },
        { name: 'status', type: 'string' }, // aktiv|ferdig|arkivert
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'drawings',
      columns: [
        { name: 'project_id', type: 'string', isIndexed: true },
        { name: 'plan', type: 'string' }, // etasje/område
        { name: 'discipline', type: 'string' }, // elkraft|svakstrom|automasjon|annet
        { name: 'name', type: 'string' },
        { name: 'file_path', type: 'string', isOptional: true }, // R2-nøkkel til PDF
        { name: 'page_count', type: 'number', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
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
        { name: 'reg_nr', type: 'string', isOptional: true }, // kun meningsfylt når type=bil
        { name: 'tracker_imei', type: 'string', isOptional: true }, // Teltonika-enhet, klar for senere GPS-binding
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
        { name: 'ai_field_origin', type: 'string', isOptional: true }, // JSON: Record<fieldKey, {origin:'ai'|'human', reason?}>
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
