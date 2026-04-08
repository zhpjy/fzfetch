use std::collections::HashSet;
use std::sync::Arc;

use nucleo::pattern::{CaseMatching, Normalization};
use nucleo::{Config, Matcher, Nucleo, Utf32String};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchHit {
    pub path: String,
    pub score: u32,
    pub size_bytes: Option<u64>,
}

pub struct SearchEngine {
    nucleo: Nucleo<String>,
}

impl SearchEngine {
    pub fn new() -> Self {
        let nucleo = Nucleo::new(Config::DEFAULT, Arc::new(|| {}), Some(1), 1);
        Self { nucleo }
    }

    pub fn seed(&mut self, paths: impl IntoIterator<Item = String>) {
        self.nucleo.restart(true);
        self.inject_paths(paths);
    }

    pub fn apply_diff(
        &mut self,
        new_paths: &HashSet<String>,
        added: &[String],
        removed: &[String],
    ) {
        if removed.is_empty() {
            self.inject_paths(added.iter().cloned());
            return;
        }

        self.nucleo.restart(true);
        self.inject_paths(new_paths.iter().cloned());
    }

    pub fn search(&mut self, query: &str, top_k: usize) -> Vec<SearchHit> {
        self.nucleo
            .pattern
            .reparse(0, query, CaseMatching::Smart, Normalization::Smart, false);
        self.drain();

        let snapshot = self.nucleo.snapshot();
        let mut matcher = Matcher::new(Config::DEFAULT);

        snapshot
            .matched_items(..)
            .take(top_k)
            .map(|item| SearchHit {
                path: item.data.clone(),
                score: snapshot
                    .pattern()
                    .score(item.matcher_columns, &mut matcher)
                    .unwrap_or_default(),
                size_bytes: std::fs::metadata(&item.data).ok().map(|meta| meta.len()),
            })
            .collect()
    }

    fn inject_paths(&mut self, paths: impl IntoIterator<Item = String>) {
        let injector = self.nucleo.injector();
        for path in paths {
            injector.push(path, |value, columns| {
                columns[0] = Utf32String::from(value.as_str());
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

#[cfg(test)]
mod tests {
    use super::SearchEngine;

    #[test]
    fn search_includes_file_size_for_existing_files() {
        let temp = tempfile::tempdir().unwrap();
        let file_path = temp.path().join("demo.txt");
        std::fs::write(&file_path, b"hello").unwrap();

        let mut engine = SearchEngine::new();
        engine.seed([file_path.to_string_lossy().to_string()]);

        let hits = engine.search("demo", 10);

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].size_bytes, Some(5));
    }
}
