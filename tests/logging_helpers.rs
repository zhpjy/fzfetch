use std::path::Path;

use fzfetch::api::path_hint_for_info;

#[test]
fn path_hint_for_info_prefers_file_name() {
    let hint = path_hint_for_info(Path::new("/tmp/demo/report.pdf"));

    assert_eq!(hint, "report.pdf");
}

#[test]
fn path_hint_for_info_returns_unknown_when_file_name_missing() {
    let hint = path_hint_for_info(Path::new("/"));

    assert_eq!(hint, "<unknown>");
}
