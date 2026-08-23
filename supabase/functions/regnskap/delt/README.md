# GENERERT — ikke rediger

Filene her er speil av `lib/invoicing.ts` og `lib/accounting/*.ts`, laget av
`npm run bygg:regnskap`. Deno krever filendelse på relative importer; resten av
prosjektet bruker node-oppslag uten. Generatoren legger på `.ts` og ingenting
annet.

Endrer du regnestykket eller en adapter, kjør `npm run bygg:regnskap` før du
deployer — ellers går et annet regnestykke ut enn det appen viser.
