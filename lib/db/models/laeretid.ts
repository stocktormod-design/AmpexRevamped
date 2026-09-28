import { Model } from '@nozbe/watermelondb'
import { field, text, date, readonly } from '@nozbe/watermelondb/decorators'

/**
 * Læretid — lærlingens dokumentasjon mot kompetansemålene (2026-09-16).
 *
 * **Disse tabellene eies av LÆRLINGEN, ikke av et firma.** Alt annet i denne
 * mappa henger på `company_id` og firmaets RLS. Det gjør ikke dette: en
 * koordinator i opplæringskontoret følger lærlinger hos flere bedrifter, og en
 * lærling som kjøper produktet alene har ikke noe Ampex-firma i det hele tatt.
 *
 * Derfor bærer radene `laerling_id`, og `sync_tables.eier` er satt til
 * `bruker`, slik at `watermelon_push` vokter på `laerling_id = auth.uid()` i
 * stedet for på firmaet. Se `supabase/migrations/20260916190000_laeretid.sql`.
 *
 * Reglene som avgjør hva radene BETYR ligger i `lib/laeretid/` og er selvtestet
 * i `npm run verify:laeretid` — ikke her.
 */

/**
 * Lærlingen selv. Én rad, og `id` ER profil-id-en.
 *
 * MERK ved opprettelse: raden må lages med eksplisitt id, ikke med den
 * WatermelonDB genererer —
 *
 *   db.get('laeretid_laerling').create(r => { r._raw.id = brukerId; … })
 *
 * Serveren har `id uuid primary key references profiles(id)`, og push vokter på
 * `id = auth.uid()`. Det gjør vakten sterkere enn en vanlig fremmednøkkel
 * (ingen kan finne på en annens id), men det er en felle hvis man glemmer det.
 */
export class LaeretidLaerling extends Model {
  static table = 'laeretid_laerling'

  @text('laereplan_kode') laereplanKode: 'ELE03-03' | 'ELE03-04'
  @text('opplaeringskontor') opplaeringskontor: string | null
  @text('laerebedrift') laerebedrift: string | null
  /** ISO-dato — Postgres `date` kommer som tekst. */
  @text('kontrakt_fra') kontraktFra: string | null
  @text('kontrakt_til') kontraktTil: string | null
  /** Datoen alt måles mot: er målene nådd før denne, holder læretiden. */
  @text('oppmelding_planlagt') oppmeldingPlanlagt: string | null
  /**
   * Lærlingens egen stemme, i hans ord: hva han vil ha med, hva han ALDRI vil
   * ha med, hvor kort han skriver. Dette er profil, ikke fagbase — det deles
   * aldri, heller ikke med faglig leder, og det generaliserer ikke til andre
   * lærlinger. «Ikke nevn branntetting» er hans preferanse, ikke faget.
   */
  @text('tone') tone: string | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date
}

/**
 * Hvem som følger lærlingen, og i hvilken rolle FOR NETTOPP ham.
 *
 * Krysser firmagrenser med vilje. Opprettes aldri av den som vil ha innsyn —
 * bare av at lærlingen aksepterer en invitasjon, eller selv inviterer noen som
 * takker ja. Se `kanInvitere()` og `aksepter()` i `lib/laeretid/tilgang.ts`.
 */
export class LaeretidTilknytning extends Model {
  static table = 'laeretid_tilknytning'

  @text('laerling_id') laerlingId: string
  @text('person_id') personId: string
  @text('rolle') rolle: 'faglig_leder' | 'instruktor' | 'koordinator' | 'ansatt'
  @text('gyldig_fra') gyldigFra: string
  /** Null = løpende. Settes når noen slutter — raden slettes ikke. */
  @text('gyldig_til') gyldigTil: string | null
  @text('created_by') createdBy: string | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date
}

/**
 * Én dokumentasjon. Livsløpet speiler fagbrev.io, så eksporten lander i riktig
 * tilstand: kladd → sendt → godkjent eller må rettes.
 *
 * **Kladden er hans alene.** RLS slipper ingen andre inn før `status` er noe
 * annet enn `kladd`. Det er ikke en bekvemmelighet — skriver han i noe sjefen
 * kan lese underveis, slutter han å skrive ærlig, og da er dekningstallene
 * verdiløse.
 */
export class LaeretidLogg extends Model {
  static table = 'laeretid_logg'

  @text('laerling_id') laerlingId: string
  @text('tittel') tittel: string | null
  /** Datoen arbeidet ble utført, ikke datoen loggen ble skrevet. */
  @text('arbeidsdato') arbeidsdato: string | null
  @text('status') status: 'kladd' | 'sendt' | 'godkjent' | 'maa_rettes'
  @text('innhold') innhold: string | null
  /**
   * Hva lærlingen selv sier om NETTOPP denne jobben, før boten begynner.
   * Tilsvarer instruksjonsfila han legger i datomappa i dag. Primærkilde —
   * den slår bildene når de er uenige.
   */
  @text('instruks') instruks: string | null
  /** Malen loggen følger. Null = standardmalen. Se `finnMal()` i lib/laeretid/mal.ts. */
  @text('mal_id') malId: string | null
  /**
   * Malens seksjoner som JSON — les med `lesUtfylling()`. `innhold` er den samme
   * loggen som ren tekst (`tilTekst()`), og er det quizen og eksporten leser.
   */
  @field('utfylling') utfylling: string | null
  /** Antall ganger modellen har skrevet om teksten. Grense: to, se abonnement.ts. */
  @field('ai_endringer_brukt') aiEndringerBrukt: number
  @date('sendt_at') sendtAt: Date | null
  @date('vurdert_at') vurdertAt: Date | null
  @text('vurdert_av') vurdertAv: string | null
  @text('tilbakemelding') tilbakemelding: string | null
  @text('created_by') createdBy: string | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date
}

/**
 * Ett bilde fra arbeidsdagen, med lærlingens eget notat.
 *
 * Notatet skrives i samme øyeblikk som bildet tas, mens han fortsatt husker, og
 * lagres ORDRETT. Ingen modell pusser på det ved fangst: det er råheten som
 * gjør det til bevis senere, og det er notatet — ikke bildet — som er fakta.
 * Tre faktafeil oppsto 30.08.2026 fordi bilder ble tolket som fakta.
 *
 * `modellbeskrivelse` skrives ÉN gang. Da slipper vi å sende bildet på nytt i
 * hver melding, som er der modellkostnaden faktisk ligger.
 */
export class LaeretidBilde extends Model {
  static table = 'laeretid_bilde'

  @text('laerling_id') laerlingId: string
  /** Null mens bildet ligger i innboksen og ennå ikke hører til en logg. */
  @text('logg_id') loggId: string | null
  /** EXIF der den finnes. Ryker stille gjennom Messenger — se `rekkefolge`. */
  @date('tatt_at') tattAt: Date | null
  /** Manuell rekkefølge når tidsstempelet mangler eller er feil. */
  @field('rekkefolge') rekkefolge: number
  @text('notat') notat: string | null
  @text('modellbeskrivelse') modellbeskrivelse: string | null
  @text('r2_nokkel') r2Nokkel: string | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date
}

/**
 * Selve produktet: ett belegg per del av et kompetansemål.
 *
 * Raden sier ikke at målet er nådd — den sier hva som finnes og hvordan det ble
 * til. Om krysset HOLDER avgjøres av `vurderBelegg()` i
 * `lib/laeretid/dekning.ts`, som avviser tabellrader, bisetninger, nærhet til
 * utstyr han ikke rørte, og genererte avsnitt han ikke har svart for.
 */
export class LaeretidBelegg extends Model {
  static table = 'laeretid_belegg'

  @text('laerling_id') laerlingId: string
  @text('logg_id') loggId: string
  /** 1–20. Nummeret, ikke etiketten «1.5» — den eier kontoret. */
  @field('maal_nr') maalNr: number
  /** Stabil del-id fra `lib/laeretid/laereplan.ts`, f.eks. `ekomutstyr`. */
  @text('del_id') delId: string
  @text('kilde') kilde: 'brodtekst' | 'risikotabell' | 'egenvurdering' | 'bisetning' | 'naerhet'
  /** Skrevet av modellen og godtatt uendret. Bærer aldri et kryss alene. */
  @field('generert') generert: boolean
  /** Gjorde han det selv, eller redegjorde han bare for det? */
  @field('utfort_selv') utfortSelv: boolean
  @text('utspurt') utspurt: 'bestatt' | 'stroket' | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date
}

/**
 * Invitasjon til å følge en lærlings læretid.
 *
 * **`token` finnes med vilje IKKE her.** Den leses aldri av en klient —
 * innløsning går gjennom en Edge Function som verifiserer den, på samme vis
 * som `inviter-ansatt`.
 *
 * Adressen og ikke bruker-id, fordi den inviterte ofte ikke har konto ennå.
 */
export class LaeretidInvitasjon extends Model {
  static table = 'laeretid_invitasjon'

  @text('laerling_id') laerlingId: string
  @text('epost') epost: string
  @text('rolle') rolle: 'faglig_leder' | 'instruktor' | 'koordinator' | 'ansatt'
  @text('fra_person_id') fraPersonId: string
  @date('sendt_at') sendtAt: Date
  @date('utloper_at') utloperAt: Date
  @text('status') status: 'sendt' | 'akseptert' | 'avslatt' | 'utlopt'
  @date('avgjort_at') avgjortAt: Date | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date
}

/**
 * Ett spørsmål fra utspørringen, med hans eget svar.
 *
 * **Ingen andre ser denne tabellen.** Ikke faglig leder, ikke koordinatoren,
 * uansett hvem som betaler. Det er her han innrømmer at han ikke kan noe, og
 * blir det lesbart for sjefen slutter han å innrømme det. Da er verifiseringen
 * — altså produktet — død. RLS håndhever det: `laerling_id = auth.uid()`, uten
 * unntak for tilknytninger.
 *
 * Spørsmålet lages av det HAN skrev, ikke fra en spørsmålsbank. Da kan det
 * ikke hallusinere: det spør om noe han allerede har påstått.
 */
export class LaeretidSporsmaal extends Model {
  static table = 'laeretid_sporsmaal'

  @text('laerling_id') laerlingId: string
  /** Loggen spørsmålet handler om. Null for teorispørsmål. */
  @text('logg_id') loggId: string | null
  /** Teoritema (lib/laeretid/teori.ts). Null for spørsmål om en jobb. */
  @text('tema') tema: string | null
  @field('maal_nr') maalNr: number
  @text('del_id') delId: string
  /** 1 = samme kveld, avgjør krysset. 2 = noen dager etter, sjekker at det sitter. */
  @field('runde') runde: 1 | 2
  @text('tekst') tekst: string
  /** Hans eget svar, ordrett. */
  @text('svar') svar: string | null
  @text('vurdering') vurdering: 'bestatt' | 'stroket' | null
  @date('laget_at') lagetAt: Date
  @date('besvart_at') besvartAt: Date | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date
}

/**
 * Én melding i samtalen som skriver loggen (2026-09-27).
 *
 * Lærlingen skriver ikke loggen selv — boten spør ham ut etter avhørslista i
 * `lib/laeretid/utsporing.ts` og skriver loggen av svarene. Samtalen er hans
 * alene, som quizsvarene: RLS gir ingen tilknytning innsyn.
 */
export class LaeretidMelding extends Model {
  static table = 'laeretid_melding'

  @text('laerling_id') laerlingId: string
  @text('logg_id') loggId: string
  @text('rolle') rolle: 'laerling' | 'bot'
  @text('tekst') tekst: string
  /** Punkter på avhørslista svaret dekker, kommaseparert (`Paakrevd`). */
  @text('dekker') dekker: string | null
  /** NEK-punktet boten ba ham slå opp. Nummer, aldri innhold. */
  @text('nek') nek: string | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date
}
