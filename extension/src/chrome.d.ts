/**
 * Den delen av Chrome sitt utvidelses-API vi bruker. Egen deklarasjon i stedet
 * for @types/chrome — ingen ny avhengighet for fire kall.
 */
declare namespace chrome {
  namespace runtime {
    function sendMessage<T = unknown>(melding: unknown): Promise<T>
    const onMessage: {
      addListener(fn: (melding: any, avsender: unknown, svar: (s: unknown) => void) => boolean | void): void
    }
  }
  namespace storage {
    const local: {
      get(nokkel: string): Promise<Record<string, unknown>>
      set(verdier: Record<string, unknown>): Promise<void>
      remove(nokkel: string): Promise<void>
    }
    const onChanged: { addListener(fn: () => void): void }
  }
  namespace tabs {
    function create(opts: { url: string }): Promise<unknown>
  }
}
