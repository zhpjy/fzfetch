use std::collections::HashMap;
use std::path::Path;

use crate::cache::FileRecord;

pub struct IndexDiff {
    pub added: Vec<FileRecord>,
    pub removed: Vec<String>,
}

pub fn scan_root_files(root_dir: &Path) -> anyhow::Result<HashMap<String, FileRecord>> {
    let mut files = HashMap::new();
    for entry in walkdir::WalkDir::new(root_dir) {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        if entry.file_type().is_file() {
            let abs = match entry.path().canonicalize() {
                Ok(path) => path,
                Err(_) => continue,
            };
            let utf8_path = match abs.to_str() {
                Some(path) => path.to_owned(),
                None => continue,
            };
            let size_bytes = entry.metadata().ok().map(|meta| meta.len());
            files.insert(
                utf8_path.clone(),
                FileRecord {
                    path: utf8_path,
                    size_bytes,
                },
            );
        }
    }
    Ok(files)
}

pub fn diff_records(
    old_records: &HashMap<String, FileRecord>,
    new_records: &HashMap<String, FileRecord>,
) -> IndexDiff {
    let mut added: Vec<FileRecord> = new_records
        .iter()
        .filter_map(|(path, record)| match old_records.get(path) {
            Some(old_record) if old_record == record => None,
            _ => Some(record.clone()),
        })
        .collect();
    let mut removed: Vec<String> = old_records
        .iter()
        .filter_map(|(path, record)| match new_records.get(path) {
            Some(new_record) if new_record == record => None,
            _ => Some(path.clone()),
        })
        .collect();
    added.sort_by(|left, right| left.path.cmp(&right.path));
    removed.sort();
    IndexDiff { added, removed }
}
