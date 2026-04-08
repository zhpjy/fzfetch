use std::collections::HashSet;
use std::path::Path;

pub struct IndexDiff {
    pub added: Vec<String>,
    pub removed: Vec<String>,
}

pub fn scan_root_files(root_dir: &Path) -> anyhow::Result<HashSet<String>> {
    let mut files = HashSet::new();
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
            files.insert(utf8_path);
        }
    }
    Ok(files)
}

pub fn diff_paths(old_paths: &HashSet<String>, new_paths: &HashSet<String>) -> IndexDiff {
    let mut added: Vec<String> = new_paths.difference(old_paths).cloned().collect();
    let mut removed: Vec<String> = old_paths.difference(new_paths).cloned().collect();
    added.sort();
    removed.sort();
    IndexDiff { added, removed }
}
