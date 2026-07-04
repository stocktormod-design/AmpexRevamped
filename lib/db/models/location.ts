import { Model } from '@nozbe/watermelondb'
import { text, date, readonly } from '@nozbe/watermelondb/decorators'

export type LocationType = 'lager' | 'bil'

/** Lager-lokasjon: sentrallager eller en bil (tildelt en montør). */
export class Location extends Model {
  static table = 'locations'

  @text('type') type: LocationType
  @text('name') name: string
  @text('assigned_to') assignedTo: string | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date
}
