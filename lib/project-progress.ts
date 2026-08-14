import { disciplines, disciplineLabel, type Discipline } from './db/models/drawing'
import { Room, overallProgress, type RoomProgress } from './db/models/room'

export type ProjectProgress = {
  overallPct: number
  perDiscipline: Record<Discipline, number>
  perRoom: { roomId: string; name: string; pct: number; missingDisciplines: Discipline[] }[]
}

/**
 * Ren aggregering over lokale Room-rader for ett prosjekt — ingen eksisterende
 * skjerm gjør dette i dag, kun per-rom (rom.tsx). Bygget klientsidig, ikke i
 * Edge Function: dataene er allerede lokale, og å sende kun det ferdig-aggregerte
 * ut av enheten (ikke rå romdata) er billigere og sender mindre per kall (se
 * lib/ai/project-status.ts).
 */
export function computeProjectProgress(rooms: Room[]): ProjectProgress {
  if (rooms.length === 0) {
    return {
      overallPct: 0,
      perDiscipline: Object.fromEntries(disciplines.map(d => [d, 0])) as Record<Discipline, number>,
      perRoom: [],
    }
  }

  const perDiscipline = Object.fromEntries(
    disciplines.map(d => {
      const sum = rooms.reduce((s, r) => s + (r.progressMap[d] ?? 0), 0)
      return [d, Math.round(sum / rooms.length)]
    }),
  ) as Record<Discipline, number>

  const perRoom = rooms.map(r => ({
    roomId: r.id,
    name: r.name,
    pct: overallProgress(r.progressMap),
    missingDisciplines: disciplines.filter(d => (r.progressMap[d] ?? 0) === 0),
  }))

  const overallPct = Math.round(perRoom.reduce((s, r) => s + r.pct, 0) / perRoom.length)

  return { overallPct, perDiscipline, perRoom }
}

/** Til Gemini-kontekst — norske fagfelt-navn i stedet for interne nøkler (elkraft osv.). */
export function progressToSpokenContext(progress: ProjectProgress) {
  return {
    overallPct: progress.overallPct,
    perDiscipline: Object.fromEntries(
      disciplines.map(d => [disciplineLabel[d], progress.perDiscipline[d]]),
    ),
    perRoom: progress.perRoom.map(r => ({
      name: r.name,
      pct: r.pct,
      missingDisciplines: r.missingDisciplines.map(d => disciplineLabel[d]),
    })),
  }
}

export type { RoomProgress }
