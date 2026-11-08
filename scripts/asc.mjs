// Rått kall mot App Store Connect-API-et med Admin-nøkkelen i ~/.appstoreconnect/private_keys.
// node scripts/asc.mjs GET /v1/apps/6825845532/betaGroups
// node scripts/asc.mjs POST /v1/betaAppReviewSubmissions '{"data":…}'
import crypto from 'node:crypto'
import fs from 'node:fs'
const KID = '9NPRXZV8CZ', ISS = '67232932-e6c7-46e8-92b6-905c0e4bb337'
const key = fs.readFileSync(`${process.env.HOME}/.appstoreconnect/private_keys/AuthKey_${KID}.p8`)
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const now = Math.floor(Date.now() / 1000)
const head = b64({ alg: 'ES256', kid: KID, typ: 'JWT' }), body = b64({ iss: ISS, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' })
const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')
const jwt = `${head}.${body}.${sig}`
const [method, path, data] = process.argv.slice(2)
const r = await fetch('https://api.appstoreconnect.apple.com' + path, {
  method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
  body: data || undefined,
})
console.log(r.status, (await r.text()).slice(0, 4000))
