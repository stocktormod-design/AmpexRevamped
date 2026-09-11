/**
 * pdf.js laster worker-fila si med `await import(this.workerSrc)`. Hermes
 * klarer ikke `import()` med et uttrykk som argument, og feiler når bundelen
 * kompileres — selv om linja aldri kjøres.
 *
 * Vi registrerer worker-modulen selv (`globalThis.pdfjsWorker`, se
 * lib/rom-pdf-vektor.ts), og pdf.js sjekker den FØR den dynamiske importen.
 * Linja er altså død kode hos oss, og byttes her ut med en avvisning så
 * Hermes får noe den kan kompilere.
 *
 * Gjelder bare filer under pdfjs-dist.
 */
module.exports = function pdfjsHermes({ types: t }) {
  return {
    name: 'pdfjs-hermes',
    visitor: {
      CallExpression(path, state) {
        const fil = state.filename || ''
        if (!fil.includes('pdfjs-dist')) return
        if (path.node.callee.type !== 'Import') return
        path.replaceWith(
          t.callExpression(
            t.memberExpression(t.identifier('Promise'), t.identifier('reject')),
            [t.newExpression(t.identifier('Error'), [t.stringLiteral('pdf.js-worker lastes ikke dynamisk')])],
          ),
        )
      },
    },
  }
}
