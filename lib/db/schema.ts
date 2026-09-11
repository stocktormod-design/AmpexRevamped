import { appSchema, tableSchema } from '@nozbe/watermelondb'

// Speiler Postgres-skjemaet (supabase/migrations). Kolonnenavn = snake_case,
// identisk med serverens — synk-protokollen mapper 1:1.
// Ved skjemaendring: bump version + legg til migrations (WatermelonDB docs).
export const schema = appSchema({
  version: 36,
  tables: [
    tableSchema({
      name: 'product_prices',
      columns: [
        { name: 'product_id', type: 'string', isIndexed: true },
        // El-nummeret dupliseres hit med vilje: det er join-nøkkelen på tvers av
        // grossister, og en prisrad skal kunne leses uten å slå opp varen.
        { name: 'elnummer', type: 'string', isIndexed: true },
        { name: 'supplier', type: 'string', isIndexed: true },
        { name: 'net_price', type: 'number' },        // kr eks. mva, etter rabatt
        { name: 'gross_price', type: 'number', isOptional: true }, // listepris før rabatt
        { name: 'discount_percent', type: 'number', isOptional: true },
        { name: 'price_type', type: 'string', isOptional: true }, // brutto|netto|ukjent
        { name: 'sales_pack', type: 'number', isOptional: true }, // minste bestillingsmengde
        { name: 'stocked', type: 'boolean', isOptional: true },   // lagerført hos grossisten
        { name: 'discontinued', type: 'boolean', isOptional: true },
        { name: 'price_date', type: 'number', isOptional: true }, // grossistens egen prisdato
        { name: 'valid_from', type: 'number', isOptional: true }, // fra filhodet
        { name: 'valid_to', type: 'number', isOptional: true },
        { name: 'imported_at', type: 'number' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'order_archives',
      columns: [
        { name: 'order_id', type: 'string', isIndexed: true },
        // Kunden dupliseres hit: «alt vi har gjort for Hansen» skal være ett
        // oppslag, ikke en join gjennom en ordre som kan ha byttet kunde.
        { name: 'customer_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'customer_name', type: 'string', isOptional: true },
        { name: 'order_number', type: 'number', isOptional: true },
        { name: 'aar', type: 'number', isIndexed: true },
        { name: 'r2_key', type: 'string' },
        { name: 'sha256', type: 'string' }, // beviset — endres pakken, stemmer den ikke
        { name: 'bytes', type: 'number' },
        { name: 'innhold', type: 'string', isOptional: true }, // JSON: telleverk
        { name: 'frosset_at', type: 'number' },
        { name: 'frosset_av', type: 'string', isOptional: true },
        // Stemplet ved frysing. Skrus oppbevaringstiden ned senere, forkorter
        // det ikke det som allerede er lovet.
        { name: 'oppbevares_til', type: 'number' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'order_approvals',
      columns: [
        { name: 'order_id', type: 'string', isIndexed: true },
        { name: 'beslutning', type: 'string' }, // godkjent|avvist
        { name: 'godkjenner_id', type: 'string', isOptional: true },
        { name: 'godkjenner_navn', type: 'string' }, // snapshot — navnet skal stå igjen
        { name: 'begrunnelse', type: 'string', isOptional: true }, // påkrevd ved avslag
        // Snapshot av det som FAKTISK ble godkjent. Uten dette kan ingen se at
        // noen førte to timer etter at faglig ansvarlig sa ja.
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
    tableSchema({
      name: 'order_signatures',
      columns: [
        { name: 'order_id', type: 'string', isIndexed: true },
        { name: 'extra_id', type: 'string', isOptional: true, isIndexed: true }, // signatur på ETT tilleggsarbeid
        { name: 'purpose', type: 'string' }, // ferdig|overtakelse|tillegg|annet
        { name: 'signer_name', type: 'string' },
        { name: 'signer_title', type: 'string', isOptional: true }, // rolle hos kunden
        // Vektorstrøk, ikke bilde: signaturen tas ofte i en kjeller uten dekning,
        // og et bilde ville krevd opplasting som kan feile. JSON synker som alt annet.
        { name: 'strokes', type: 'string' }, // JSON: [{points:[[x,y],…]}] i 0–1-koordinater
        { name: 'aspect', type: 'number' }, // bredde/høyde på feltet den ble tegnet i
        { name: 'note', type: 'string', isOptional: true },
        { name: 'signed_at', type: 'number' },
        { name: 'signed_by', type: 'string', isOptional: true }, // vår bruker som holdt telefonen
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'quotes',
      columns: [
        { name: 'quote_number', type: 'number', isOptional: true }, // settes av server-trigger
        { name: 'title', type: 'string' },
        { name: 'description', type: 'string', isOptional: true },
        // Snapshot av kunden, samme grunn som på orders: tilbudet er et
        // dokument som ble sendt, og skal kunne leses uendret etterpå.
        { name: 'customer_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'customer_name', type: 'string', isOptional: true },
        { name: 'customer_phone', type: 'string', isOptional: true },
        { name: 'address', type: 'string', isOptional: true },
        { name: 'status', type: 'string' }, // utkast|sendt|akseptert|avslatt («utlopt» regnes ut, lagres aldri)
        { name: 'valid_until', type: 'number', isOptional: true }, // epoch ms
        { name: 'sent_at', type: 'number', isOptional: true },
        { name: 'decided_at', type: 'number', isOptional: true },
        { name: 'decided_by', type: 'string', isOptional: true }, // hvem hos KUNDEN som svarte
        { name: 'decision_method', type: 'string', isOptional: true }, // muntlig|sms|epost|signert
        { name: 'decision_note', type: 'string', isOptional: true }, // hvorfor avslått — det eneste som gjør tapte tilbud lærerike
        { name: 'order_id', type: 'string', isOptional: true, isIndexed: true }, // ordren «akseptert» opprettet
        { name: 'project_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'source_system', type: 'string', isOptional: true },
        { name: 'external_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'quote_lines',
      columns: [
        { name: 'quote_id', type: 'string', isIndexed: true },
        { name: 'sort_order', type: 'number' }, // brukerens rekkefølge — den er en del av dokumentet
        { name: 'kind', type: 'string' }, // materiell|arbeid|tekst
        { name: 'description', type: 'string' },
        { name: 'elnummer', type: 'string', isOptional: true },
        { name: 'product_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'activity_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'quantity', type: 'number', isOptional: true },
        { name: 'unit', type: 'string', isOptional: true },
        { name: 'unit_price', type: 'number', isOptional: true }, // kr eks. mva, SNAPSHOT — tilbudet er bindende
        { name: 'cost_price', type: 'number', isOptional: true },
        { name: 'discount_percent', type: 'number', isOptional: true },
        { name: 'vat_type', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'order_extras',
      columns: [
        // Tilleggsarbeid. Håndverkertjenesteloven §9 krever at forbrukeren
        // kontaktes før tillegg utføres; blir det bestridt i ettertid, er det
        // HVEM som sa ja, NÅR og HVORDAN som avgjør. Derfor er godkjenningen
        // egne felter, ikke en setning i et notat.
        { name: 'order_id', type: 'string', isIndexed: true },
        { name: 'title', type: 'string' },
        { name: 'description', type: 'string', isOptional: true },
        // fastpris → egen fakturalinje. medgatt → dekkes av timer og materiell
        // som allerede føres på ordren; raden er da ren dokumentasjon.
        { name: 'pricing', type: 'string' }, // fastpris|medgatt
        { name: 'price', type: 'number', isOptional: true }, // kr eks. mva, kun fastpris
        { name: 'vat_type', type: 'string', isOptional: true },
        { name: 'status', type: 'string' }, // foreslatt|godkjent|avvist
        { name: 'approved_by', type: 'string', isOptional: true }, // hvem hos kunden
        { name: 'approved_at', type: 'number', isOptional: true },
        { name: 'approval_method', type: 'string', isOptional: true }, // muntlig|sms|epost|signert
        { name: 'invoiced_at', type: 'number', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'customers',
      columns: [
        { name: 'name', type: 'string' },
        { name: 'org_nr', type: 'string', isOptional: true }, // 9 siffer, kun bedrift
        { name: 'is_company', type: 'boolean' },
        { name: 'email', type: 'string', isOptional: true },
        { name: 'phone', type: 'string', isOptional: true },
        { name: 'address', type: 'string', isOptional: true },
        { name: 'postal_code', type: 'string', isOptional: true },
        { name: 'city', type: 'string', isOptional: true },
        { name: 'note', type: 'string', isOptional: true },
        // Regnskapssystemet eier kunderegisteret når det er koblet — vi speiler.
        { name: 'source_system', type: 'string', isOptional: true }, // fiken|tripletex|speedycraft|null
        { name: 'external_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'activities',
      columns: [
        // Begge regnskaps-API-ene modellerer timer som aktivitet × person × dato.
        // Uten aktivitet kan en time ikke bli en fakturalinje.
        { name: 'name', type: 'string' },
        { name: 'hourly_rate', type: 'number', isOptional: true }, // kr eks. mva
        { name: 'billable', type: 'boolean' },
        { name: 'vat_type', type: 'string', isOptional: true }, // MvaType i lib/invoicing.ts — nøytral, mappes per adapter
        { name: 'archived', type: 'boolean' },
        { name: 'source_system', type: 'string', isOptional: true },
        { name: 'external_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
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
      name: 'purchase_orders',
      columns: [
        { name: 'grossist', type: 'string' },
        { name: 'grossist_epost', type: 'string', isOptional: true },
        { name: 'kundenummer', type: 'string', isOptional: true },
        { name: 'status', type: 'string' },  // utkast | sendt | mottatt | avbrutt
        { name: 'order_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'location_id', type: 'string', isOptional: true },
        { name: 'referanse', type: 'string', isOptional: true },
        { name: 'merknad', type: 'string', isOptional: true },
        { name: 'sendt_at', type: 'number', isOptional: true },
        { name: 'sendt_av', type: 'string', isOptional: true },
        { name: 'ekstern_ordrenr', type: 'string', isOptional: true },
        { name: 'mottatt_at', type: 'number', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'purchase_order_lines',
      columns: [
        { name: 'purchase_order_id', type: 'string', isIndexed: true },
        { name: 'product_id', type: 'string', isOptional: true },
        { name: 'elnummer', type: 'string', isOptional: true },
        { name: 'beskrivelse', type: 'string' },
        { name: 'antall', type: 'number' },
        { name: 'enhet', type: 'string' },
        { name: 'mottatt_antall', type: 'number' },
        { name: 'sort_order', type: 'number' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'service_agreements',
      columns: [
        { name: 'customer_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'tittel', type: 'string' },
        { name: 'beskrivelse', type: 'string', isOptional: true },
        { name: 'adresse', type: 'string', isOptional: true },
        { name: 'intervall_maneder', type: 'number' },
        { name: 'neste_forfall', type: 'number' },   // epoch ms, midnatt lokal
        { name: 'varsel_dager', type: 'number' },
        { name: 'skjema_mal_id', type: 'string', isOptional: true },
        { name: 'estimert_timer', type: 'number', isOptional: true },
        { name: 'aktiv', type: 'boolean' },
        { name: 'sist_utfort_at', type: 'number', isOptional: true },
        { name: 'sist_ordre_id', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'deviations',
      columns: [
        { name: 'order_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'project_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'document_id', type: 'string', isOptional: true },
        { name: 'tittel', type: 'string' },
        { name: 'beskrivelse', type: 'string', isOptional: true },
        { name: 'alvorlighet', type: 'string' }, // lav | middels | hoy | kritisk
        { name: 'status', type: 'string' },      // apent | lukket
        { name: 'frist_at', type: 'number', isOptional: true },
        { name: 'sted', type: 'string', isOptional: true },
        { name: 'funnet_av', type: 'string', isOptional: true },
        { name: 'funnet_at', type: 'number' },
        { name: 'tiltak', type: 'string', isOptional: true },
        { name: 'lukket_av', type: 'string', isOptional: true },
        { name: 'lukket_at', type: 'number', isOptional: true },
        { name: 'foto_nokler', type: 'string', isOptional: true }, // JSON string[]
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
        // Serverkolonnene under fantes ALLEREDE i liva-DB-en (fil-løs migrasjon) —
        // klienten speiler dem først fra v32. Norske navn er serverens.
        { name: 'beskrivelse', type: 'string', isOptional: true },
        { name: 'frist_at', type: 'number', isOptional: true },
        { name: 'drawing_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'pin_x', type: 'number', isOptional: true }, // normalisert 0..1 på tegningen
        { name: 'pin_y', type: 'number', isOptional: true },
        { name: 'synlighet', type: 'string', isOptional: true }, // null/'tildelt' = kun tildelt bruker ser pinnen
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'drawing_markup',
      columns: [
        { name: 'drawing_id', type: 'string', isIndexed: true },
        { name: 'data', type: 'string', isOptional: true }, // JSON: streker i normaliserte side-koordinater
        { name: 'kind', type: 'string', isOptional: true }, // null/'stroke' — rad-formen fra v32 (én rad per publisering)
        { name: 'created_by', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      // KUN brannkomponenter bærer registerdata (tag `sløyfe.adresse`, serienr,
      // modell) — andre symboler er rene tegneelementer i drawing_loops.
      // Detektorlista per prosjekt genereres herfra.
      name: 'fire_devices',
      columns: [
        { name: 'project_id', type: 'string', isIndexed: true },
        { name: 'drawing_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'room_id', type: 'string', isOptional: true },
        { name: 'loop_id', type: 'string', isOptional: true },
        { name: 'x', type: 'number' }, // normalisert 0..1 på tegningen
        { name: 'y', type: 'number' },
        { name: 'kind', type: 'string' }, // royk|varme|multi|melder|klokke|sirene|sentral|annet
        { name: 'tag', type: 'string' }, // sløyfe.adresse, f.eks. 01.023
        { name: 'serial', type: 'string', isOptional: true },
        { name: 'model', type: 'string', isOptional: true },
        { name: 'placed_at', type: 'number', isOptional: true },
        { name: 'note', type: 'string', isOptional: true },
        { name: 'created_by', type: 'string', isOptional: true },
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
        { name: 'note', type: 'string', isOptional: true }, // SYNLIG på faktura (Fiken description)
        { name: 'internal_note', type: 'string', isOptional: true }, // IKKE synlig på faktura
        { name: 'activity_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'billable', type: 'boolean', isOptional: true }, // null = arv fra aktivitet
        { name: 'invoiced_at', type: 'number', isOptional: true }, // satt når linja er med i et fakturautkast
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
        { name: 'source', type: 'string', isOptional: true }, // null/'lokal' | 'ekstern' (skrivebeskyttet grunnlag)
        { name: 'folder_id', type: 'string', isOptional: true, isIndexed: true }, // mappe (bygg/fag); null = rot
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'drawing_folders',
      columns: [
        { name: 'project_id', type: 'string', isIndexed: true },
        { name: 'parent_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'name', type: 'string' },
        { name: 'sort_order', type: 'number' },
        { name: 'created_by', type: 'string', isOptional: true },
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
        // Fiken product krever name + unitPrice + vatType + incomeAccount.
        // Uten disse kan en vare leses fra prisfila, men ikke bli en fakturalinje.
        { name: 'unit_price', type: 'number', isOptional: true }, // utsalg eks. mva
        { name: 'cost_price', type: 'number', isOptional: true }, // nettopris fra grossist
        { name: 'vat_type', type: 'string', isOptional: true },
        { name: 'income_account', type: 'string', isOptional: true },
        { name: 'supplier', type: 'string', isOptional: true }, // grossisten cost_price kom fra — se product_prices for alle
        { name: 'price_updated_at', type: 'number', isOptional: true }, // ferskhet per vare
        // Varekortet. Alt dette står allerede i prisfila (VL/VX/VA-poster) og
        // ble kastet før — det er grunnen til at søket føltes tomt mot EFObasen.
        { name: 'fabrikat', type: 'string', isOptional: true, isIndexed: true }, // produsent
        { name: 'type_betegnelse', type: 'string', isOptional: true }, // produsentens typenavn
        { name: 'discount_group', type: 'string', isOptional: true, isIndexed: true }, // grossistens rabattgruppe = varegruppe i faget
        { name: 'ean', type: 'string', isOptional: true, isIndexed: true },
        { name: 'nrf', type: 'string', isOptional: true, isIndexed: true },
        { name: 'image_url', type: 'string', isOptional: true },
        { name: 'fdv_url', type: 'string', isOptional: true },
        { name: 'hms_url', type: 'string', isOptional: true },
        { name: 'efobase_id', type: 'string', isOptional: true },
        { name: 'replaced_by', type: 'string', isOptional: true }, // el-nummer som erstatter en utgått vare
        { name: 'sales_pack', type: 'number', isOptional: true },  // minste bestillingsmengde
        { name: 'extra', type: 'string', isOptional: true },       // JSON: alle VX-felt, også de vi ikke viser
        // Ett felt SQLite kan LIKE-filtrere på. Uten det leses hele kartoteket
        // inn i JS ved hvert tastetrykk.
        { name: 'search_text', type: 'string', isOptional: true },
        // Varegruppe utledet av varenavnet (lib/product-category.ts). Lagres
        // fordi den skal kunne filtreres på i SQL, ikke bare regnes ut i UI-et.
        { name: 'category', type: 'string', isOptional: true, isIndexed: true },
        { name: 'source_system', type: 'string', isOptional: true },
        { name: 'external_id', type: 'string', isOptional: true, isIndexed: true },
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
        { name: 'product_id', type: 'string', isOptional: true, isIndexed: true }, // null når fritekst
        { name: 'unit_price', type: 'number', isOptional: true }, // snapshot ved registrering — prisen kan endres senere
        { name: 'discount_percent', type: 'number', isOptional: true }, // avtalt i tilbudet, følger med ved aksept
        { name: 'cost_price', type: 'number', isOptional: true },
        { name: 'vat_type', type: 'string', isOptional: true },
        { name: 'billable', type: 'boolean', isOptional: true }, // null = ja
        { name: 'invoiced_at', type: 'number', isOptional: true },
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
        // customer_name/-phone/address beholdes som snapshot: ordren skal kunne
        // leses uendret selv om kunden rettes eller slettes senere.
        { name: 'customer_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'source_system', type: 'string', isOptional: true },
        { name: 'external_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'quote_id', type: 'string', isOptional: true, isIndexed: true }, // tilbudet ordren ble akseptert fra
        { name: 'invoice_external_id', type: 'string', isOptional: true }, // utkast-/faktura-ID i regnskapet
        { name: 'invoiced_at', type: 'number', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
  ],
})
