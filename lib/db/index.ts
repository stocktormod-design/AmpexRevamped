import { Database } from '@nozbe/watermelondb'
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite'
import { schema } from './schema'
import { Order } from './models/order'

const adapter = new SQLiteAdapter({
  schema,
  dbName: 'ampex',
  jsi: true, // synkron SQLite via JSI — raskest, og vi er alltid på ny arkitektur
  onSetUpError: error => {
    console.error('[db] SQLite setup failed', error)
  },
})

export const database = new Database({
  adapter,
  modelClasses: [Order],
})
