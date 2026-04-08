pub mod api;
pub mod cache;
pub mod config;
pub mod error;
pub mod scanner;
pub mod search;
pub mod state;
pub mod web;
pub mod ws;

#[cfg(test)]
#[test]
fn stale_epoch_is_dropped() {
    ws::assert_stale_epoch_is_dropped();
}
