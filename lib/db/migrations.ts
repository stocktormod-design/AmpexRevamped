import { schemaMigrations, createTable, addColumns, unsafeExecuteSql } from '@nozbe/watermelondb/Schema/migrations'
import { byggReparasjonsSql, TABELLER_V30 } from './id-repair'

// Holder eksisterende lokale databaser i live ved skjemabump — MÅ speile schema.ts.
export const migrations = schemaMigrations({
  migrations: [
    {
      // Ingen skjemaendring — bare data. Åtte rader fra før setGenerator (eef17dd)
      // har base62-id der Postgres krever uuid, og siden watermelon_push kjører i
      // én transaksjon blokkerer de ALL synk, stille og for alltid. Se lib/db/id-repair.ts.
      toVersion: 30,
      steps: [unsafeExecuteSql(byggReparasjonsSql(TABELLER_V30))],
    },
    {
      toVersion: 29,
      steps: [
        createTable({
          name: 'order_archives',
          columns: [
            { name: 'order_id', type: 'string', isIndexed: true },
            { name: 'customer_id', type: 'string', isOptional: true, isIndexed: true },
            { name: 'customer_name', type: 'string', isOptional: true },
            { name: 'order_number', type: 'number', isOptional: true },
            { name: 'aar', type: 'number', isIndexed: true },
            { name: 'r2_key', type: 'string' },
            { name: 'sha256', type: 'string' },
            { name: 'bytes', type: 'number' },
            { name: 'innhold', type: 'string', isOptional: true },
            { name: 'frosset_at', type: 'number' },
            { name: 'frosset_av', type: 'string', isOptional: true },
            { name: 'oppbevares_til', type: 'number' },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
      ],
    },
    {
      toVersion: 28,
      steps: [
        createTable({
          name: 'order_approvals',
          columns: [
            { name: 'order_id', type: 'string', isIndexed: true },
            { name: 'beslutning', type: 'string' },
            { name: 'godkjenner_id', type: 'string', isOptional: true },
            { name: 'godkjenner_navn', type: 'string' },
            { name: 'begrunnelse', type: 'string', isOptional: true },
            { name: 'sum_ore', type: 'number', isOptional: true },
            { name: 'timer', type: 'number', isOptional: true },
            { name: 'antall_materiell', type: 'number', isOptional: true },
            { name: 'antall_dokumenter', type: 'number', isOptional: true },
            { name: 'antall_signaturer', type: 'number', isOptional: true },
            { name: 'besluttet_at', type: 'number' },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
      ],
    },
    {
      toVersion: 27,
      steps: [
        addColumns({
          table: 'products',
          columns: [{ name: 'category', type: 'string', isOptional: true, isIndexed: true }],
        }),
      ],
    },
    {
      toVersion: 26,
      steps: [
        createTable({
          name: 'product_prices',
          columns: [
            { name: 'product_id', type: 'string', isIndexed: true },
            { name: 'elnummer', type: 'string', isIndexed: true },
            { name: 'supplier', type: 'string', isIndexed: true },
            { name: 'net_price', type: 'number' },
            { name: 'gross_price', type: 'number', isOptional: true },
            { name: 'discount_percent', type: 'number', isOptional: true },
            { name: 'price_type', type: 'string', isOptional: true },
            { name: 'sales_pack', type: 'number', isOptional: true },
            { name: 'stocked', type: 'boolean', isOptional: true },
            { name: 'discontinued', type: 'boolean', isOptional: true },
            { name: 'price_date', type: 'number', isOptional: true },
            { name: 'valid_from', type: 'number', isOptional: true },
            { name: 'valid_to', type: 'number', isOptional: true },
            { name: 'imported_at', type: 'number' },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
        addColumns({
          table: 'products',
          columns: [
            { name: 'fabrikat', type: 'string', isOptional: true, isIndexed: true },
            { name: 'type_betegnelse', type: 'string', isOptional: true },
            { name: 'discount_group', type: 'string', isOptional: true, isIndexed: true },
            { name: 'ean', type: 'string', isOptional: true, isIndexed: true },
            { name: 'nrf', type: 'string', isOptional: true, isIndexed: true },
            { name: 'image_url', type: 'string', isOptional: true },
            { name: 'fdv_url', type: 'string', isOptional: true },
            { name: 'hms_url', type: 'string', isOptional: true },
            { name: 'efobase_id', type: 'string', isOptional: true },
            { name: 'replaced_by', type: 'string', isOptional: true },
            { name: 'sales_pack', type: 'number', isOptional: true },
            { name: 'extra', type: 'string', isOptional: true },
            { name: 'search_text', type: 'string', isOptional: true },
          ],
        }),
      ],
    },
    {
      toVersion: 25,
      steps: [
        createTable({
          name: 'order_signatures',
          columns: [
            { name: 'order_id', type: 'string', isIndexed: true },
            { name: 'extra_id', type: 'string', isOptional: true, isIndexed: true },
            { name: 'purpose', type: 'string' },
            { name: 'signer_name', type: 'string' },
            { name: 'signer_title', type: 'string', isOptional: true },
            { name: 'strokes', type: 'string' },
            { name: 'aspect', type: 'number' },
            { name: 'note', type: 'string', isOptional: true },
            { name: 'signed_at', type: 'number' },
            { name: 'signed_by', type: 'string', isOptional: true },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
      ],
    },
    {
      toVersion: 24,
      steps: [
        createTable({
          name: 'quotes',
          columns: [
            { name: 'quote_number', type: 'number', isOptional: true },
            { name: 'title', type: 'string' },
            { name: 'description', type: 'string', isOptional: true },
            { name: 'customer_id', type: 'string', isOptional: true, isIndexed: true },
            { name: 'customer_name', type: 'string', isOptional: true },
            { name: 'customer_phone', type: 'string', isOptional: true },
            { name: 'address', type: 'string', isOptional: true },
            { name: 'status', type: 'string' },
            { name: 'valid_until', type: 'number', isOptional: true },
            { name: 'sent_at', type: 'number', isOptional: true },
            { name: 'decided_at', type: 'number', isOptional: true },
            { name: 'decided_by', type: 'string', isOptional: true },
            { name: 'decision_method', type: 'string', isOptional: true },
            { name: 'decision_note', type: 'string', isOptional: true },
            { name: 'order_id', type: 'string', isOptional: true, isIndexed: true },
            { name: 'project_id', type: 'string', isOptional: true, isIndexed: true },
            { name: 'source_system', type: 'string', isOptional: true },
            { name: 'external_id', type: 'string', isOptional: true, isIndexed: true },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
        createTable({
          name: 'quote_lines',
          columns: [
            { name: 'quote_id', type: 'string', isIndexed: true },
            { name: 'sort_order', type: 'number' },
            { name: 'kind', type: 'string' },
            { name: 'description', type: 'string' },
            { name: 'elnummer', type: 'string', isOptional: true },
            { name: 'product_id', type: 'string', isOptional: true, isIndexed: true },
            { name: 'activity_id', type: 'string', isOptional: true, isIndexed: true },
            { name: 'quantity', type: 'number', isOptional: true },
            { name: 'unit', type: 'string', isOptional: true },
            { name: 'unit_price', type: 'number', isOptional: true },
            { name: 'cost_price', type: 'number', isOptional: true },
            { name: 'discount_percent', type: 'number', isOptional: true },
            { name: 'vat_type', type: 'string', isOptional: true },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
        addColumns({
          table: 'orders',
          columns: [{ name: 'quote_id', type: 'string', isOptional: true, isIndexed: true }],
        }),
      ],
    },
    {
      toVersion: 23,
      steps: [
        createTable({
          name: 'order_extras',
          columns: [
            { name: 'order_id', type: 'string', isIndexed: true },
            { name: 'title', type: 'string' },
            { name: 'description', type: 'string', isOptional: true },
            { name: 'pricing', type: 'string' },
            { name: 'price', type: 'number', isOptional: true },
            { name: 'vat_type', type: 'string', isOptional: true },
            { name: 'status', type: 'string' },
            { name: 'approved_by', type: 'string', isOptional: true },
            { name: 'approved_at', type: 'number', isOptional: true },
            { name: 'approval_method', type: 'string', isOptional: true },
            { name: 'invoiced_at', type: 'number', isOptional: true },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
      ],
    },
    {
      toVersion: 22,
      steps: [
        createTable({
          name: 'customers',
          columns: [
            { name: 'name', type: 'string' },
            { name: 'org_nr', type: 'string', isOptional: true },
            { name: 'is_company', type: 'boolean' },
            { name: 'email', type: 'string', isOptional: true },
            { name: 'phone', type: 'string', isOptional: true },
            { name: 'address', type: 'string', isOptional: true },
            { name: 'postal_code', type: 'string', isOptional: true },
            { name: 'city', type: 'string', isOptional: true },
            { name: 'note', type: 'string', isOptional: true },
            { name: 'source_system', type: 'string', isOptional: true },
            { name: 'external_id', type: 'string', isOptional: true, isIndexed: true },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
        createTable({
          name: 'activities',
          columns: [
            { name: 'name', type: 'string' },
            { name: 'hourly_rate', type: 'number', isOptional: true },
            { name: 'billable', type: 'boolean' },
            { name: 'vat_type', type: 'string', isOptional: true },
            { name: 'archived', type: 'boolean' },
            { name: 'source_system', type: 'string', isOptional: true },
            { name: 'external_id', type: 'string', isOptional: true, isIndexed: true },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
        addColumns({
          table: 'orders',
          columns: [
            { name: 'customer_id', type: 'string', isOptional: true, isIndexed: true },
            { name: 'source_system', type: 'string', isOptional: true },
            { name: 'external_id', type: 'string', isOptional: true, isIndexed: true },
            { name: 'invoice_external_id', type: 'string', isOptional: true },
            { name: 'invoiced_at', type: 'number', isOptional: true },
          ],
        }),
        addColumns({
          table: 'time_entries',
          columns: [
            { name: 'internal_note', type: 'string', isOptional: true },
            { name: 'activity_id', type: 'string', isOptional: true, isIndexed: true },
            { name: 'billable', type: 'boolean', isOptional: true },
            { name: 'invoiced_at', type: 'number', isOptional: true },
          ],
        }),
        addColumns({
          table: 'products',
          columns: [
            { name: 'unit_price', type: 'number', isOptional: true },
            { name: 'cost_price', type: 'number', isOptional: true },
            { name: 'vat_type', type: 'string', isOptional: true },
            { name: 'income_account', type: 'string', isOptional: true },
            { name: 'supplier', type: 'string', isOptional: true },
            { name: 'price_updated_at', type: 'number', isOptional: true },
            { name: 'source_system', type: 'string', isOptional: true },
            { name: 'external_id', type: 'string', isOptional: true, isIndexed: true },
          ],
        }),
        addColumns({
          table: 'order_materials',
          columns: [
            { name: 'product_id', type: 'string', isOptional: true, isIndexed: true },
            { name: 'unit_price', type: 'number', isOptional: true },
            { name: 'cost_price', type: 'number', isOptional: true },
            { name: 'vat_type', type: 'string', isOptional: true },
            { name: 'billable', type: 'boolean', isOptional: true },
            { name: 'invoiced_at', type: 'number', isOptional: true },
          ],
        }),
      ],
    },
    {
      toVersion: 21,
      steps: [
        createTable({
          name: 'assistant_notes',
          columns: [
            { name: 'user_id', type: 'string', isIndexed: true },
            { name: 'content', type: 'string' },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
      ],
    },
    {
      toVersion: 20,
      steps: [
        createTable({
          name: 'reminders',
          columns: [
            { name: 'user_id', type: 'string', isIndexed: true },
            { name: 'title', type: 'string' },
            { name: 'due_at', type: 'number' },
            { name: 'order_id', type: 'string', isOptional: true },
            { name: 'note', type: 'string', isOptional: true },
            { name: 'status', type: 'string' },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
      ],
    },
    {
      toVersion: 19,
      steps: [
        createTable({
          name: 'time_entries',
          columns: [
            { name: 'order_id', type: 'string', isIndexed: true },
            { name: 'user_id', type: 'string' },
            { name: 'user_name', type: 'string' },
            { name: 'date', type: 'number' },
            { name: 'hours', type: 'number' },
            { name: 'note', type: 'string', isOptional: true },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
      ],
    },
    {
      toVersion: 18,
      steps: [
        createTable({
          name: 'order_members',
          columns: [
            { name: 'order_id', type: 'string', isIndexed: true },
            { name: 'user_id', type: 'string' },
            { name: 'user_name', type: 'string' },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
      ],
    },
    {
      toVersion: 17,
      steps: [
        addColumns({
          table: 'order_documents',
          columns: [
            { name: 'ai_field_origin', type: 'string', isOptional: true },
          ],
        }),
      ],
    },
    {
      toVersion: 16,
      steps: [
        addColumns({
          table: 'locations',
          columns: [
            { name: 'reg_nr', type: 'string', isOptional: true },
            { name: 'tracker_imei', type: 'string', isOptional: true },
          ],
        }),
      ],
    },
    {
      toVersion: 15,
      steps: [
        createTable({
          name: 'nfc_tags',
          columns: [
            { name: 'tag_uid', type: 'string', isIndexed: true },
            { name: 'target_type', type: 'string' },
            { name: 'target_id', type: 'string' },
            { name: 'default_qty', type: 'number', isOptional: true },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
      ],
    },
    {
      toVersion: 14,
      steps: [
        createTable({
          name: 'mesh_markers',
          columns: [
            { name: 'room_id', type: 'string', isOptional: true, isIndexed: true },
            { name: 'order_scan_id', type: 'string', isOptional: true, isIndexed: true },
            { name: 'scan_path', type: 'string', isIndexed: true },
            { name: 'x', type: 'number' },
            { name: 'y', type: 'number' },
            { name: 'z', type: 'number' },
            { name: 'symbol_id', type: 'string' },
            { name: 'note', type: 'string', isOptional: true },
            { name: 'created_by', type: 'string', isOptional: true },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
      ],
    },
    {
      toVersion: 13,
      steps: [
        createTable({
          name: 'order_scans',
          columns: [
            { name: 'order_id', type: 'string', isIndexed: true },
            { name: 'kind', type: 'string' },
            { name: 'title', type: 'string' },
            { name: 'scan_path', type: 'string', isOptional: true },
            { name: 'created_by', type: 'string', isOptional: true },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
      ],
    },
    {
      toVersion: 12,
      steps: [
        createTable({
          name: 'drawing_loops',
          columns: [
            { name: 'drawing_id', type: 'string', isIndexed: true },
            { name: 'name', type: 'string' },
            { name: 'number', type: 'number' },
            { name: 'color', type: 'string' },
            { name: 'nodes', type: 'string', isOptional: true },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
      ],
    },
    {
      toVersion: 11,
      steps: [
        createTable({
          name: 'form_templates',
          columns: [
            { name: 'key', type: 'string', isOptional: true },
            { name: 'title', type: 'string' },
            { name: 'category', type: 'string' },
            { name: 'current_version', type: 'number' },
            { name: 'status', type: 'string' },
            { name: 'created_by', type: 'string', isOptional: true },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
        createTable({
          name: 'form_template_revisions',
          columns: [
            { name: 'template_id', type: 'string', isIndexed: true },
            { name: 'version', type: 'number' },
            { name: 'schema', type: 'string', isOptional: true },
            { name: 'change_note', type: 'string', isOptional: true },
            { name: 'changed_by', type: 'string', isOptional: true },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
        createTable({
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
      ],
    },
    {
      toVersion: 10,
      steps: [
        addColumns({
          table: 'rooms',
          columns: [
            { name: 'shape', type: 'string', isOptional: true },
            { name: 'drawing_id', type: 'string', isOptional: true, isIndexed: true },
          ],
        }),
      ],
    },
    {
      toVersion: 9,
      steps: [
        createTable({
          name: 'tasks',
          columns: [
            { name: 'project_id', type: 'string', isIndexed: true },
            { name: 'room_id', type: 'string', isOptional: true },
            { name: 'kind', type: 'string' },
            { name: 'title', type: 'string' },
            { name: 'status', type: 'string' },
            { name: 'assigned_to', type: 'string', isOptional: true, isIndexed: true },
            { name: 'created_by', type: 'string', isOptional: true },
            { name: 'done_at', type: 'number', isOptional: true },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
        addColumns({
          table: 'project_members',
          columns: [
            { name: 'is_scan_responsible', type: 'boolean', isOptional: true },
          ],
        }),
      ],
    },
    {
      toVersion: 8,
      steps: [
        createTable({
          name: 'drawing_markup',
          columns: [
            { name: 'drawing_id', type: 'string', isIndexed: true },
            { name: 'data', type: 'string', isOptional: true },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
      ],
    },
    {
      toVersion: 7,
      steps: [
        createTable({
          name: 'rooms',
          columns: [
            { name: 'project_id', type: 'string', isIndexed: true },
            { name: 'plan', type: 'string' },
            { name: 'name', type: 'string' },
            { name: 'progress', type: 'string', isOptional: true },
            { name: 'scan_path', type: 'string', isOptional: true },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
      ],
    },
    {
      toVersion: 6,
      steps: [
        createTable({
          name: 'project_members',
          columns: [
            { name: 'project_id', type: 'string', isIndexed: true },
            { name: 'user_id', type: 'string' },
            { name: 'user_name', type: 'string' },
            { name: 'role', type: 'string' },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
      ],
    },
    {
      toVersion: 5,
      steps: [
        createTable({
          name: 'projects',
          columns: [
            { name: 'name', type: 'string' },
            { name: 'customer_name', type: 'string', isOptional: true },
            { name: 'address', type: 'string', isOptional: true },
            { name: 'status', type: 'string' },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
        createTable({
          name: 'drawings',
          columns: [
            { name: 'project_id', type: 'string', isIndexed: true },
            { name: 'plan', type: 'string' },
            { name: 'discipline', type: 'string' },
            { name: 'name', type: 'string' },
            { name: 'file_path', type: 'string', isOptional: true },
            { name: 'page_count', type: 'number', isOptional: true },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
      ],
    },
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
