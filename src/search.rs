use std::collections::HashSet;
use std::sync::Arc;

use nucleo::pattern::{CaseMatching, Normalization};
use nucleo::{Config, Matcher, Nucleo, Utf32String};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchHit {
    pub path: String,
    pub score: u32,
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
