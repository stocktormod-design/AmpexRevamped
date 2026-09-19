// Skjermbilde av kontoret, innlogget som testbrukeren, mot Vite på 5175.
//
//   cd desktop && npm run dev -- --port 5175      (i ett vindu)
//   npm i --no-save puppeteer-core                  (én gang, ligger ikke i package.json)
//   node tools/kontor-skjermbilde.mjs ut.png 1440 960 --tilbud --bunn
//
// Bruker Chrome som alt står på maskinen. Testbrukeren er den samme som
// verify:e2e. Slik ble tilbudsflaten verifisert 18.09 (docs/TILBUD_KONKURRENTER.md).
//   node shot.mjs <ut.png> [bredde] [høyde] [--tilbud] [--linje]
import puppeteer from 'puppeteer-core'

const [ut = 'ut.png', bredde = '1440', hoyde = '960', ...flagg] = process.argv.slice(2)
const URL = 'http://localhost:5175/'
const EPOST = 'test@ampex.no'
const PASSORD = 'ampex-test-2026'

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', `--window-size=${bredde},${hoyde}`],
})
try {
  const page = await browser.newPage()
  await page.setViewport({ width: Number(bredde), height: Number(hoyde), deviceScaleFactor: 2 })
  await page.goto(URL, { waitUntil: 'networkidle0' })

  // Logg inn om vi står på innloggingen.
  const epost = await page.$('input[type="email"]')
  if (epost) {
    await page.type('input[type="email"]', EPOST)
    await page.type('input[type="password"]', PASSORD)
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForSelector('nav, .sidemeny, [class*="meny"]', { timeout: 20000 }).catch(() => {}),
    ])
    await new Promise(r => setTimeout(r, 1500))
  }

  await page.goto(`${URL}#/tilbud`, { waitUntil: 'networkidle0' })
  await new Promise(r => setTimeout(r, 800))

  if (flagg.includes('--tilbud')) {
    await page.waitForSelector('.ordrerad', { timeout: 15000 })
    await page.click('.ordrerad')
    await page.waitForSelector('.tilbudsark', { timeout: 15000 })
    await new Promise(r => setTimeout(r, 800))
  }
  if (flagg.includes('--bunn')) {
    // Summen står nederst; rull den indre flaten dit.
    await page.evaluate(() => document.querySelector('.ark-bunn')?.scrollIntoView({ block: 'end' }))
    await new Promise(r => setTimeout(r, 300))
  }
  if (flagg.includes('--linje')) {
    // Fokus i første pris-celle, så regnearket vises i redigering.
    const celle = await page.$('input[data-kol="pris"]')
    if (celle) { await celle.focus(); await new Promise(r => setTimeout(r, 200)) }
  }

  await page.screenshot({ path: ut, fullPage: flagg.includes('--full') })
  console.log('skrev', ut)
} finally {
  await browser.close()
}
