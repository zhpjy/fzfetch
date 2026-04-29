use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::cache::{FileRecord, FileSnapshot, file_record_from_snapshot};

pub struct IndexDiff {
    pub added: Vec<FileRecord>,
    pub removed: Vec<String>,
}

pub fn scan_root_files(
    root_dir: &Path,
    excluded_dirs: &[PathBuf],
) -> anyhow::Result<FileSnapshot> {
    let mut files = HashMap::new();
    let mut walker = walkdir::WalkDir::new(root_dir).into_iter();
    while let Some(entry) = walker.next() {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        if entry.file_type().is_dir()
            && excluded_dirs
                .iter()
                .any(|excluded_dir| entry.path().starts_with(excluded_dir))
        {
            walker.skip_current_dir();
            continue;
        }
        if entry.file_type().is_file() {
            let abs = match entry.path().canonicalize() {
                Ok(path) => path,
                Err(_) => continue,
            };
            let utf8_path = match abs.to_str() {
                Some(path) => path.to_owned().into_boxed_str(),
                None => continue,
            };
            let size_bytes = entry.metadata().ok().map(|meta| meta.len());
            files.insert(utf8_path, size_bytes);
        }
    }
    Ok(files)
}

pub fn diff_records(
    old_records: &FileSnapshot,
    new_records: &FileSnapshot,
) -> IndexDiff {
    let mut added: Vec<FileRecord> = new_records
        .iter()
        .filter_map(|(path, size_bytes)| match old_records.get(path) {
            Some(old_size_bytes) if old_size_bytes == size_bytes => None,
            _ => Some(file_record_from_snapshot(path, *size_bytes)),
        })
        .collect();
    let mut removed: Vec<String> = old_records
        .iter()
        .filter_map(|(path, size_bytes)| match new_records.get(path) {
            Some(new_size_bytes) if new_size_bytes == size_bytes => None,
            _ => Some(path.clone()),
        })
        .map(String::from)
        .collect();
    added.sort_by(|left, right| left.path.cmp(&right.path));
    removed.sort();
    IndexDiff { added, removed }
}
