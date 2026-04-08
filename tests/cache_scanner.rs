use std::collections::HashSet;
use std::path::PathBuf;

use fzfetch::cache::{
    CacheLayoutStatus, ensure_cache_layout, load_cache_paths, write_cache_snapshot,
};
use fzfetch::scanner::{diff_paths, scan_root_files};

#[test]
fn ensure_cache_layout_creates_data_dir_and_cache_file() {
    let temp = tempfile::tempdir().unwrap();
    let data_dir = temp.path().join("data");
    let cache_file = data_dir.join("cache.txt");

    assert!(!data_dir.exists());
    assert!(!cache_file.exists());

    let status = ensure_cache_layout(&data_dir, &cache_file).unwrap();

    assert!(data_dir.is_dir());
    assert!(cache_file.is_file());
    assert_eq!(status, CacheLayoutStatus::Created);
}

#[test]
fn config_uses_expected_defaults() {
    let config = fzfetch::config::AppConfig::default_for(PathBuf::from("/tmp/root"));
    assert_eq!(config.data_dir, PathBuf::from("data"));
    assert_eq!(config.cache_file, PathBuf::from("data/cache.txt"));
    assert_eq!(config.top_k, 100);
}

#[test]
fn ensure_cache_layout_is_idempotent() {
    let temp = tempfile::tempdir().unwrap();
    let data_dir = temp.path().join("data");
    let cache_file = data_dir.join("cache.txt");

    let first = ensure_cache_layout(&data_dir, &cache_file).unwrap();
    let second = ensure_cache_layout(&data_dir, &cache_file).unwrap();

    assert!(data_dir.is_dir());
    assert!(cache_file.is_file());
    assert_eq!(first, CacheLayoutStatus::Created);
    assert_eq!(second, CacheLayoutStatus::Existing);
}

#[test]
fn config_canonicalize_root_dir_updates_field() {
    let temp = tempfile::tempdir().unwrap();
    let root_with_dot = temp.path().join(".");
    let expected = std::fs::canonicalize(temp.path()).unwrap();

    let mut config = fzfetch::config::AppConfig::default_for(root_with_dot);
    config.canonicalize_root_dir().unwrap();

    assert_eq!(config.canonical_root_dir, expected);
}

#[test]
fn ensure_cache_layout_errors_when_cache_path_is_not_file() {
    let temp = tempfile::tempdir().unwrap();
    let data_dir = temp.path().join("data");
    let cache_file = data_dir.join("cache.txt");

    std::fs::create_dir_all(&cache_file).unwrap();
    let result = ensure_cache_layout(&data_dir, &cache_file);

    assert!(result.is_err());
}

#[test]
fn config_default_for_uses_canonical_path_when_root_exists() {
    let temp = tempfile::tempdir().unwrap();
    let subdir = temp.path().join("subdir");
    std::fs::create_dir(&subdir).unwrap();
    let root_with_dot = subdir.join("..");
    let expected = std::fs::canonicalize(temp.path()).unwrap();

    let config = fzfetch::config::AppConfig::default_for(root_with_dot);

    assert_eq!(config.canonical_root_dir, expected);
}

#[test]
fn load_cache_paths_ignores_empty_lines() {
    let temp = tempfile::tempdir().unwrap();
    let cache_file = temp.path().join("cache.txt");
    std::fs::write(&cache_file, "\n/tmp/a\n\n   \n/tmp/b\n").unwrap();

    let paths = load_cache_paths(&cache_file).unwrap();

    let expected = HashSet::from([String::from("/tmp/a"), String::from("/tmp/b")]);
    assert_eq!(paths, expected);
}

#[test]
fn write_cache_snapshot_overwrites_previous_content() {
    let temp = tempfile::tempdir().unwrap();
    let cache_file = temp.path().join("cache.txt");
    std::fs::write(&cache_file, "/old/path\n").unwrap();

    let paths = HashSet::from([String::from("/z"), String::from("/a"), String::from("/m")]);
    write_cache_snapshot(&cache_file, &paths).unwrap();

    let written = std::fs::read_to_string(&cache_file).unwrap();
    assert_eq!(written, "/a\n/m\n/z\n");
}

#[test]
fn diff_paths_reports_added_and_removed() {
    let old_paths = HashSet::from([String::from("/a"), String::from("/b")]);
    let new_paths = HashSet::from([String::from("/b"), String::from("/c")]);

    let diff = diff_paths(&old_paths, &new_paths);

    assert_eq!(diff.added, vec![String::from("/c")]);
    assert_eq!(diff.removed, vec![String::from("/a")]);
}

#[test]
fn scan_root_files_only_collects_regular_files() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let top_file = root.join("top.txt");
    let another_top_file = root.join("another.log");
    let dir = root.join("nested");
    let nested_file = dir.join("inner.txt");

    std::fs::write(&top_file, "1").unwrap();
    std::fs::write(&another_top_file, "2").unwrap();
    std::fs::create_dir(&dir).unwrap();
    std::fs::write(&nested_file, "3").unwrap();

    let files = scan_root_files(root).unwrap();

    let expected = HashSet::from([
        top_file
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .to_string(),
        another_top_file
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .to_string(),
        nested_file
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .to_string(),
    ]);
    assert_eq!(files, expected);
}

#[cfg(unix)]
#[test]
fn scan_root_files_skips_invalid_utf8_paths_and_keeps_valid_ones() {
    use std::ffi::OsString;
    use std::os::unix::ffi::OsStringExt;

    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let valid_file = root.join("valid.txt");
    std::fs::write(&valid_file, "ok").unwrap();

    let invalid_name = OsString::from_vec(vec![0x66, 0x6f, 0x80]);
    let invalid_file = root.join(invalid_name);
    std::fs::write(&invalid_file, "bad").unwrap();

    let files = scan_root_files(root).unwrap();

    let expected = HashSet::from([valid_file
        .canonicalize()
        .unwrap()
        .to_string_lossy()
        .to_string()]);
    assert_eq!(files, expected);
}

#[cfg(unix)]
#[test]
fn scan_root_files_continues_when_walkdir_hits_unreadable_dir() {
    use std::os::unix::fs::PermissionsExt;

    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let valid_file = root.join("keep.txt");
    std::fs::write(&valid_file, "ok").unwrap();

    let blocked_dir = root.join("blocked");
    std::fs::create_dir(&blocked_dir).unwrap();
    std::fs::write(blocked_dir.join("hidden.txt"), "x").unwrap();
    std::fs::set_permissions(&blocked_dir, std::fs::Permissions::from_mode(0o000)).unwrap();

    let files = scan_root_files(root);

    std::fs::set_permissions(&blocked_dir, std::fs::Permissions::from_mode(0o755)).unwrap();

    assert!(files.is_ok());
    let files = files.unwrap();
    assert!(
        files.contains(
            &valid_file
                .canonicalize()
                .unwrap()
                .to_string_lossy()
                .to_string()
        )
    );
}
