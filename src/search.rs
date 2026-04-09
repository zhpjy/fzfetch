use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use nucleo::pattern::{CaseMatching, Normalization};
use nucleo::{Config, Matcher, Nucleo, Utf32String};

use crate::cache::FileRecord;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchHit {
    pub path: String,
    pub score: u32,
    pub size_bytes: Option<u64>,
}

pub struct SearchEngine {
    nucleo: Nucleo<FileRecord>,
}

fn default_nucleo_threads() -> Option<usize> {
    None
}

impl SearchEngine {
    pub fn new() -> Self {
        let nucleo = Nucleo::new(
            Config::DEFAULT,
            Arc::new(|| {}),
            default_nucleo_threads(),
            1,
        );
        Self { nucleo }
    }

    pub fn seed(&mut self, records: impl IntoIterator<Item = FileRecord>) {
        self.nucleo.restart(true);
        self.inject_records(records);
    }

    pub fn apply_diff(
        &mut self,
        new_records: &HashMap<String, FileRecord>,
        added: &[FileRecord],
        removed: &[String],
    ) {
        if removed.is_empty() {
            self.inject_records(added.iter().cloned());
            return;
        }

        self.nucleo.restart(true);
        self.inject_records(new_records.values().cloned());
    }

    pub fn search(&mut self, query: &str, top_k: usize) -> Vec<SearchHit> {
        self.nucleo
            .pattern
            .reparse(0, query, CaseMatching::Smart, Normalization::Smart, false);
        self.drain();

        let snapshot = self.nucleo.snapshot();
        let mut matcher = Matcher::new(Config::DEFAULT);
        let query = query.trim().to_lowercase();
        let mut hits: Vec<_> = snapshot
            .matched_items(..)
            .map(|item| {
                let score = snapshot
                    .pattern()
                    .score(item.matcher_columns, &mut matcher)
                    .unwrap_or_default();
                let basename_match = basename_contains_query(&item.data.path, &query);

                (
                    basename_match,
                    score,
                    SearchHit {
                        path: item.data.path.clone(),
                        score,
                        size_bytes: item.data.size_bytes,
                    },
                )
            })
            .collect();

        hits.sort_by(|a, b| {
            b.0.cmp(&a.0)
                .then_with(|| b.1.cmp(&a.1))
                .then_with(|| a.2.path.cmp(&b.2.path))
        });

        hits.into_iter().take(top_k).map(|(_, _, hit)| hit).collect()
    }

    fn inject_records(&mut self, records: impl IntoIterator<Item = FileRecord>) {
        let injector = self.nucleo.injector();
        for record in records {
            injector.push(record, |value, columns| {
                columns[0] = Utf32String::from(value.path.as_str());
            });
        }
        self.drain();
    }

    fn drain(&mut self) {
        while self.nucleo.tick(10).running {}
    }
}

impl Default for SearchEngine {
    fn default() -> Self {
        Self::new()
    }
}

fn basename_contains_query(path: &str, query: &str) -> bool {
    if query.is_empty() {
        return false;
    }

    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_lowercase().contains(query))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use crate::cache::FileRecord;

    use super::{SearchEngine, default_nucleo_threads};

    #[test]
    fn search_engine_defaults_to_nucleo_auto_thread_count() {
        assert_eq!(default_nucleo_threads(), None);
    }

    #[test]
    fn search_includes_file_size_for_existing_files() {
        let temp = tempfile::tempdir().unwrap();
        let file_path = temp.path().join("demo.txt");
        std::fs::write(&file_path, b"hello").unwrap();

        let mut engine = SearchEngine::new();
        engine.seed([FileRecord {
            path: file_path.to_string_lossy().to_string(),
            size_bytes: Some(5),
        }]);

        let hits = engine.search("demo", 10);

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].size_bytes, Some(5));
    }

    #[test]
    fn search_uses_cached_file_size_for_missing_files() {
        let temp = tempfile::tempdir().unwrap();
        let missing_path = temp.path().join("missing.txt");

        let mut engine = SearchEngine::new();
        engine.seed([FileRecord {
            path: missing_path.to_string_lossy().to_string(),
            size_bytes: Some(42),
        }]);

        let hits = engine.search("missing", 10);

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].size_bytes, Some(42));
    }

    #[test]
    fn search_prioritizes_basename_matches_over_directory_only_matches() {
        let mut engine = SearchEngine::new();
        engine.seed([
            FileRecord {
                path: "/library/needle/archive.txt".to_string(),
                size_bytes: Some(10),
            },
            FileRecord {
                path: "/library/misc/needle-report.txt".to_string(),
                size_bytes: Some(20),
            },
        ]);

        let hits = engine.search("needle", 10);

        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].path, "/library/misc/needle-report.txt");
        assert_eq!(hits[1].path, "/library/needle/archive.txt");
    }
}
