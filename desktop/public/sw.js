/**
 * Tjenestearbeideren til Ampex Kontor.
 *
 * Den finnes av to grunner, og bare to: nettleseren krever en for at siden skal
 * kunne legges på hjemskjermen som app, og den gjør andre gangs oppstart rask.
 * Den er IKKE et offline-lag for dataene.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Det den aldri rører
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Alt som ikke ligger på vårt eget opphav slipper rett gjennom — Supabase,
 * innlogging, R2. En mellomlagret innlogging eller en mellomlagret ordreliste
 * er ikke en raskere app, det er feil data vist som om den var riktig. Kontoret
 * skriver dessuten rett mot Supabase (regel 2 i CLAUDE.md gjelder montørappen,
 * ikke denne), så det finnes ingen lokal base å falle tilbake på.
 *
 * Bare GET mellomlagres. En POST som ble besvart fra en cache ville vært en
 * skriving som aldri skjedde.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Strategiene
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Navigering    nett først, skallet fra cache som reserve. Du skal ALLTID få
 *               den nyeste index.html når du har dekning; uten dekning får du
 *               skallet og en ærlig feilmelding fra appen selv.
 * /assets/…     cache først. Vite legger innholdshash i filnavnet, så en fil
 *               med samme navn er per definisjon samme fil. Ny versjon = nytt
 *               navn = bom i cachen = hentes.
 * ikoner, manifest
 *               cache først med oppfriskning i bakgrunnen.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Hvorfor `skipWaiting` er med, når den normalt ikke burde være det
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Standardrådet er å la en ny arbeider vente til alle faner er lukket: bytter
 * den midt i en økt, kan en åpen fane ende med gammel HTML og nye filnavn.
 *
 * Her er situasjonen en annen. Det gamle Ampex-prosjektet (`~/Documents/Ampex`,
 * Next.js) la igjen en tjenestearbeider på NØYAKTIG dette opphavet, med fire
 * cacher og `networkFirstNav`. Den serverer fortsatt den gamle mørkeblå
 * landingssida fra telefoner som besøkte ampex.no før kontoret overtok
 * domenet — derfor ser en telefon noe helt annet enn det `curl` får.
 *
 * Venter vi, tar den gamle arbeideren aldri slutt: den slipper først taket når
 * hver eneste fane mot opphavet er lukket. Med `skipWaiting` + `claim` tar
 * denne over ved første navigering, og `activate` under sletter ALLE cacher som
 * ikke er våre — inkludert `ampex-static-v2`, `ampex-nav-v1`, `ampex-data-v1`
 * og `ampex-drawings-v1`. Det er den samme koden som rydder etter oss selv;
 * den skiller ikke på hvem som lagde cachen.
 *
 * Når landingssida er borte fra alle telefoner som betyr noe, kan disse to
 * linjene fjernes igjen.
 */

/**
 * Cachenavnet ER oppryddingen.
 *
 * `activate` sletter hver cache som ikke heter dette. Bumper du tallet, blir
 * alt fra forrige runde borte i samme slengen — gamle hashede filer OG det
 * forhåndslagrede skallet. Det er den eneste sikre måten å få en telefon som
 * har satt seg fast på gammel kode tilbake på sporet.
 *
 * v2 (15. september, kveld): v1 kunne pinne et skall fra
 * installasjonsøyeblikket. Gikk én navigering i vasken — dårlig dekning er
 * normalen for denne brukergruppen — falt den tilbake på det skallet, og det
 * pekte på gamle filnavn som lå trygt i samme cache. Da satt du fast til noen
 * tømte nettleseren for hånd.
 */
// `__BYGG__` byttes ut med byggetidspunktet av `stempleSw()` i vite.config.ts.
// Det gjør at HVER utrulling får et nytt cachenavn, og `activate` under sletter
// alt som het noe annet. Ingen trenger å huske å bumpe et tall, og ingen blir
// sittende på gammel kode fordi noen glemte det.
//
// Innlogging ligger IKKE i cachen — den bor i localStorage hos Supabase — så
// en full cachetømming logger ingen ut.
const VERSJON = 'ampex-kontor-__BYGG__'
const SKALL = '/'

// Filene som må ligge der for at appen skal kunne TEGNE seg uten nett. Selve
// JS-bunten er hashet og kan ikke stå her; den havner i cachen ved første
// besøk gjennom `/assets/`-regelen under.
const FORHÅNDSLAGRET = [SKALL, '/manifest.webmanifest', '/favicon.svg', '/ikon-192.png']

self.addEventListener('install', e => {
  self.skipWaiting()
  e.waitUntil(caches.open(VERSJON).then(c => c.addAll(FORHÅNDSLAGRET)))
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(navn => Promise.all(navn.filter(n => n !== VERSJON).map(n => caches.delete(n))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', e => {
  const { request } = e
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Navigering: nett først. Faller vi gjennom til cachen, er det skallet vi
  // gir tilbake — ruta ligger uansett i hash-en, som aldri sendes til serveren.
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then(svar => {
          const kopi = svar.clone()
          caches.open(VERSJON).then(c => c.put(SKALL, kopi))
          return svar
        })
        .catch(() => caches.match(SKALL).then(t => t ?? Response.error())),
    )
    return
  }

  const hashet = url.pathname.startsWith('/assets/')
  const merke = /\.(png|svg|webmanifest|woff2?)$/.test(url.pathname)
  if (!hashet && !merke) return

  e.respondWith(
    caches.match(request).then(truffet => {
      // Hashede filer er uforanderlige: et treff er endelig, ingen grunn til å
      // spørre nettet i det hele tatt. Ikoner og manifest kan endres uten at
      // navnet gjør det, så de friskes opp i bakgrunnen.
      if (truffet && hashet) return truffet

      const fra_nett = fetch(request)
        .then(svar => {
          if (svar.ok) {
            const kopi = svar.clone()
            caches.open(VERSJON).then(c => c.put(request, kopi))
          }
          return svar
        })
        .catch(() => truffet ?? Response.error())

      return truffet ?? fra_nett
    }),
  )
})
