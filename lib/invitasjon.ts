import type { Rolle } from './kontor-tilgang'

/**
 * Rollene appens «Inviter kollega» tilbyr, per innlogget rolle. Bare hva skjermen
 * viser — sperren står i `inviter-ansatt` (KAN_TILDELE). Eier, administrator og
 * regnskapsfører inviteres fra Kontor, der tofaktorkoden kreves.
 */
export const TILBYS: Partial<Record<Rolle, Rolle[]>> = {
  owner: ['installator', 'bas', 'montor', 'laerling'],
  admin: ['installator', 'bas', 'montor', 'laerling'],
  installator: ['installator', 'bas', 'montor', 'laerling'],
  bas: ['montor', 'laerling'],
}

export function kanInvitere(rolle: string | null): boolean {
  return !!rolle && rolle in TILBYS
}
