import { Database } from '@nozbe/watermelondb'
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite'
import { schema } from './schema'
import { migrations } from './migrations'
import { Order } from './models/order'
import { OrderDocument } from './models/order-document'
import { OrderMaterial } from './models/order-material'
import { Product } from './models/product'
import { Location } from './models/location'
import { StockMovement } from './models/stock-movement'
import { Project } from './models/project'
import { Drawing } from './models/drawing'
import { ProjectMember } from './models/project-member'

const adapter = new SQLiteAdapter({
  schema,
  migrations,
  dbName: 'ampex',
  jsi: true, // synkron SQLite via JSI — raskest, og vi er alltid på ny arkitektur
  onSetUpError: error => {
    console.error('[db] SQLite setup failed', error)
  },
})

export const database = new Database({
  adapter,
  modelClasses: [Order, OrderDocument, OrderMaterial, Product, Location, StockMovement, Project, Drawing, ProjectMember],
})
