// リリースビルドの Windows でコンソール窓を出さない
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    aizome_lib::run()
}
