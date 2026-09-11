// Skjuler konsollvinduet i release. I dev er det der vi vil ha panikkene.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ampex_kontor_lib::run()
}
