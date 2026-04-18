use std::collections::HashMap;
use std::io::Cursor;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use fzfetch::cache::{
    CacheLayoutStatus, FileRecord, ensure_cache_layout, load_cache_records,
    load_cache_records_from_reader, write_cache_snapshot,
};
use fzfetch::scanner::{diff_records, scan_root_files};

fn env_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

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
fn from_env_uses_local_default_directories() {
    let _guard = env_lock().lock().unwrap();
    unsafe {
        std::env::remove_var("FZFETCH_ROOT");
        std::env::remove_var("FZFETCH_DATA_DIR");
    }

    let config = fzfetch::config::AppConfig::from_env().unwrap();

    assert_eq!(config.root_dir, PathBuf::from("files"));
    assert_eq!(config.data_dir, PathBuf::from("data"));
    assert_eq!(config.cache_file, PathBuf::from("data/cache.txt"));
}

#[test]
fn from_env_honors_root_and_data_dir_overrides() {
    let _guard = env_lock().lock().unwrap();
    let root = PathBuf::from("/tmp/fzfetch-root");
    let data_dir = PathBuf::from("/tmp/fzfetch-data");
    unsafe {
        std::env::set_var("FZFETCH_ROOT", &root);
        std::env::set_var("FZFETCH_DATA_DIR", &data_dir);
    }

    let config = fzfetch::config::AppConfig::from_env().unwrap();

    assert_eq!(config.root_dir, root);
    assert_eq!(config.data_dir, data_dir);
    assert_eq!(
        config.cache_file,
        PathBuf::from("/tmp/fzfetch-data/cache.txt")
    );

    unsafe {
        std::env::remove_var("FZFETCH_ROOT");
        std::env::remove_var("FZFETCH_DATA_DIR");
    }
}

#[test]
fn from_env_parses_exclude_dirs_and_ignores_empty_items() {
    let _guard = env_lock().lock().unwrap();
    unsafe {
        std::env::set_var("FZFETCH_ROOT", "/tmp/fzfetch-root");
        std::env::remove_var("FZFETCH_DATA_DIR");
        std::env::set_var("FZFETCH_EXCLUDE_DIRS", "tmp, nested/cache , ,logs");
    }

    let config = fzfetch::config::AppConfig::from_env().unwrap();

    assert_eq!(
        config.exclude_dirs,
        vec![
            PathBuf::from("tmp"),
            PathBuf::from("nested/cache"),
            PathBuf::from("logs"),
        ]
    );

    unsafe {
        std::env::remove_var("FZFETCH_ROOT");
        std::env::remove_var("FZFETCH_DATA_DIR");
        std::env::remove_var("FZFETCH_EXCLUDE_DIRS");
    }
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
fn ensure_runtime_dirs_creates_missing_root_and_data_directories() {
    let temp = tempfile::tempdir().unwrap();
    let root_dir = temp.path().join("files");
    let data_dir = temp.path().join("data");
    let mut config = fzfetch::config::AppConfig::default_for(root_dir.clone());
    config.data_dir = data_dir.clone();
    config.cache_file = data_dir.join("cache.txt");

    assert!(!root_dir.exists());
    assert!(!data_dir.exists());

    config.ensure_runtime_dirs().unwrap();

    assert!(root_dir.is_dir());
    assert!(data_dir.is_dir());
    assert_eq!(config.canonical_root_dir, root_dir.canonicalize().unwrap());
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
fn load_cache_records_reads_legacy_path_only_lines() {
    let temp = tempfile::tempdir().unwrap();
    let cache_file = temp.path().join("cache.txt");
    std::fs::write(&cache_file, "\n/tmp/a\n\n   \n/tmp/b\n").unwrap();

    let records = load_cache_records(&cache_file).unwrap();

    let expected = HashMap::from([
        (
            String::from("/tmp/a"),
            FileRecord {
                path: String::from("/tmp/a"),
                size_bytes: None,
            },
        ),
        (
            String::from("/tmp/b"),
            FileRecord {
                path: String::from("/tmp/b"),
                size_bytes: None,
            },
        ),
    ]);
    assert_eq!(records, expected);
}

#[test]
fn load_cache_records_from_reader_reads_record_lines() {
    let reader = Cursor::new("5\t/tmp/a\n-\t/tmp/b\n");

    let records = load_cache_records_from_reader(reader).unwrap();

    let expected = HashMap::from([
        (
            String::from("/tmp/a"),
            FileRecord {
                path: String::from("/tmp/a"),
                size_bytes: Some(5),
            },
        ),
        (
            String::from("/tmp/b"),
            FileRecord {
                path: String::from("/tmp/b"),
                size_bytes: None,
            },
        ),
    ]);
    assert_eq!(records, expected);
}

#[test]
fn write_cache_snapshot_overwrites_previous_content() {
    let temp = tempfile::tempdir().unwrap();
    let cache_file = temp.path().join("cache.txt");
    std::fs::write(&cache_file, "/old/path\n").unwrap();

    let records = HashMap::from([
        (
            String::from("/z"),
            FileRecord {
                path: String::from("/z"),
                size_bytes: Some(9),
            },
        ),
        (
            String::from("/a"),
            FileRecord {
                path: String::from("/a"),
                size_bytes: Some(1),
            },
        ),
        (
            String::from("/m"),
            FileRecord {
                path: String::from("/m"),
                size_bytes: None,
            },
        ),
    ]);
    write_cache_snapshot(&cache_file, &records).unwrap();

    let written = std::fs::read_to_string(&cache_file).unwrap();
    assert_eq!(written, "1\t/a\n-\t/m\n9\t/z\n");
}

#[test]
fn diff_records_reports_added_removed_and_changed_metadata() {
    let old_records = HashMap::from([
        (
            String::from("/a"),
            FileRecord {
                path: String::from("/a"),
                size_bytes: Some(1),
            },
        ),
        (
            String::from("/b"),
            FileRecord {
                path: String::from("/b"),
                size_bytes: Some(2),
            },
        ),
    ]);
    let new_records = HashMap::from([
        (
            String::from("/b"),
            FileRecord {
                path: String::from("/b"),
                size_bytes: Some(3),
            },
        ),
        (
            String::from("/c"),
            FileRecord {
                path: String::from("/c"),
                size_bytes: Some(4),
            },
        ),
    ]);

    let diff = diff_records(&old_records, &new_records);

    assert_eq!(
        diff.added,
        vec![
            FileRecord {
                path: String::from("/b"),
                size_bytes: Some(3),
            },
            FileRecord {
                path: String::from("/c"),
                size_bytes: Some(4),
            },
        ]
    );
    assert_eq!(diff.removed, vec![String::from("/a"), String::from("/b")]);
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

    let files = scan_root_files(root, &[]).unwrap();

    let expected = HashMap::from([
        (
            top_file
                .canonicalize()
                .unwrap()
                .to_string_lossy()
                .to_string(),
            FileRecord {
                path: top_file
                    .canonicalize()
                    .unwrap()
                    .to_string_lossy()
                    .to_string(),
                size_bytes: Some(1),
            },
        ),
        (
            another_top_file
                .canonicalize()
                .unwrap()
                .to_string_lossy()
                .to_string(),
            FileRecord {
                path: another_top_file
                    .canonicalize()
                    .unwrap()
                    .to_string_lossy()
                    .to_string(),
                size_bytes: Some(1),
            },
        ),
        (
            nested_file
                .canonicalize()
                .unwrap()
                .to_string_lossy()
                .to_string(),
            FileRecord {
                path: nested_file
                    .canonicalize()
                    .unwrap()
                    .to_string_lossy()
                    .to_string(),
                size_bytes: Some(1),
            },
        ),
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

    let files = scan_root_files(root, &[]).unwrap();

    let expected = HashMap::from([(
        valid_file
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .to_string(),
        FileRecord {
            path: valid_file
                .canonicalize()
                .unwrap()
                .to_string_lossy()
                .to_string(),
            size_bytes: Some(2),
        },
    )]);
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

    let files = scan_root_files(root, &[]);

    std::fs::set_permissions(&blocked_dir, std::fs::Permissions::from_mode(0o755)).unwrap();

    assert!(files.is_ok());
    let files = files.unwrap();
    assert!(
        files.contains_key(
            &valid_file
                .canonicalize()
                .unwrap()
                .to_string_lossy()
                .to_string()
        )
    );
}

#[test]
fn scan_root_files_skips_excluded_directories_and_descendants() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let keep = root.join("keep.txt");
    let excluded_dir = root.join("excluded");
    let nested_dir = excluded_dir.join("deep");
    let excluded_file = nested_dir.join("skip.txt");
    let sibling_dir = root.join("sibling");
    let sibling_file = sibling_dir.join("keep.log");

    std::fs::write(&keep, "1").unwrap();
    std::fs::create_dir_all(&nested_dir).unwrap();
    std::fs::write(&excluded_file, "2").unwrap();
    std::fs::create_dir_all(&sibling_dir).unwrap();
    std::fs::write(&sibling_file, "3").unwrap();

    let files = scan_root_files(root, &[excluded_dir]).unwrap();

    assert!(files.contains_key(&keep.canonicalize().unwrap().to_string_lossy().to_string()));
    assert!(files.contains_key(
        &sibling_file
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .to_string()
    ));
    assert!(!files.contains_key(
        &excluded_file
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .to_string()
    ));
}
