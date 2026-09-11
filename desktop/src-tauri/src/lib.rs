// Rust-flaten holdes bevisst minimal.
//
// Grunnen til at Tauri ble valgt over Electron står i docs/DESKTOP_OG_IMPORT.md,
// og den viktigste er ikke installerstørrelsen: `tiberius` kan autentisere mot
// SpeedyCrafts MSSQL med SSPI via `secur32.dll`, altså som den innloggede
// Windows-brukeren, uten at kunden må skaffe et `sa`-passord fra Devinco.
//
// Det er dit denne fila skal — `#[tauri::command]` for å koble til MSSQL, kjøre
// oppdagelsesspørringen mot INFORMATION_SCHEMA, og starte/stoppe Pool Exe som
// sidecar. Alt annet blir liggende i React.
//
// Fristelsen blir å flytte MSSQL til Python-sidecaren i stedet for å lære Rust.
// Da mister man poenget: `pyodbc` krever en installert ODBC-driver, mens
// `tiberius` bruker Windows' egen `secur32.dll`.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("Ampex Kontor klarte ikke å starte");
}
