import { Database } from '@nozbe/watermelondb'
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite'
import { setGenerator } from '@nozbe/watermelondb/utils/common/randomId'

// Server-push caster id til Postgres uuid — WatermelonDBs default (16 tegn base62)
// feiler da («invalid input syntax for type uuid»). Generer ekte UUID v4 lokalt.
setGenerator(() => {
  const b = new Uint8Array(16)
  for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
  b[6] = (b[6] & 0x0f) | 0x40 // versjon 4
  b[8] = (b[8] & 0x3f) | 0x80 // variant 10
  const h = Array.from(b, x => x.toString(16).padStart(2, '0'))
  return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`
})
import { schema } from './schema'
import { migrations } from './migrations'
import { Order } from './models/order'
import { OrderDocument } from './models/order-document'
import { OrderMaterial } from './models/order-material'
import { Product } from './models/product'
import { Customer } from './models/customer'
import { Activity } from './models/activity'
import { OrderExtra } from './models/order-extra'
import { Location } from './models/location'
import { StockMovement } from './models/stock-movement'
import { Project } from './models/project'
import { Drawing } from './models/drawing'
import { ProjectMember } from './models/project-member'
import { OrderMember } from './models/order-member'
import { TimeEntry } from './models/time-entry'
import { Reminder } from './models/reminder'
import { AssistantNote } from './models/assistant-note'
import { Room } from './models/room'
import { DrawingMarkup } from './models/drawing-markup'
import { Task } from './models/task'
import { FormTemplate } from './models/form-template'
import { FormRevision } from './models/form-revision'
import { FormComment } from './models/form-comment'
import { DrawingLoop } from './models/drawing-loop'
import { OrderScan } from './models/order-scan'
import { MeshMarker } from './models/mesh-marker'
import { FireDevice } from './models/fire-device'
import { NfcTag } from './models/nfc-tag'
import { OrderSignature } from './models/order-signature'
import { ProductPrice } from './models/product-price'
import { OrderApproval } from './models/order-approval'
import { OrderArchive } from './models/order-archive'
import { Quote } from './models/quote'
import { QuoteLine } from './models/quote-line'

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
  modelClasses: [Order, OrderDocument, OrderMaterial, OrderExtra, Product, Customer, Activity, Location, StockMovement, Project, Drawing, ProjectMember, OrderMember, TimeEntry, Reminder, AssistantNote, Room, DrawingMarkup, Task, FormTemplate, FormRevision, FormComment, DrawingLoop, OrderScan, MeshMarker, FireDevice, NfcTag, Quote, QuoteLine, OrderSignature, ProductPrice, OrderApproval, OrderArchive],
})
