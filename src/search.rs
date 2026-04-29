use std::cmp::{Ordering, Reverse};
use std::collections::BinaryHeap;
use std::path::Path;
use std::sync::Arc;

use nucleo::pattern::{CaseMatching, Normalization};
use nucleo::{Config, Matcher, Nucleo, Utf32String};

use crate::cache::FileRecord;

const DEFAULT_NUCLEO_THREADS: usize = 4;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchHit {
    pub path: String,
    pub score: u32,
    pub size_bytes: Option<u64>,
}

pub struct SearchEngine {
    nucleo: Nucleo<FileRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RankedHit {
    basename_match: bool,
    score: u32,
    hit: SearchHit,
}

fn default_nucleo_threads() -> Option<usize> {
    Some(DEFAULT_NUCLEO_THREADS)
}

impl SearchEngine {
    pub fn new() -> Self {
        Self::with_threads(default_nucleo_threads())
    }

    pub fn with_threads(num_threads: Option<usize>) -> Self {
        let nucleo = Nucleo::new(
            Config::DEFAULT,
            Arc::new(|| {}),
            num_threads,
            1,
        );
        Self { nucleo }
    }

    pub fn seed(&mut self, records: impl IntoIterator<Item = FileRecord>) {
        self.nucleo.restart(true);
        self.inject_records(records);
    }

    pub fn apply_diff<I>(&mut self, new_records: I, added: &[FileRecord], removed: &[String])
    where
        I: IntoIterator<Item = FileRecord>,
    {
        if removed.is_empty() {
            self.inject_records(added.iter().cloned());
            return;
        }

        self.nucleo.restart(true);
        self.inject_records(new_records);
    }

    pub fn search(&mut self, query: &str, top_k: usize) -> Vec<SearchHit> {
        self.nucleo
            .pattern
            .reparse(0, query, CaseMatching::Smart, Normalization::Smart, false);
        self.drain();

        let snapshot = self.nucleo.snapshot();
        let mut matcher = Matcher::new(Config::DEFAULT);
        let query = query.trim().to_lowercase();
        let hits = snapshot
            .matched_items(..)
            .map(|item| {
                let score = snapshot
                    .pattern()
                    .score(item.matcher_columns, &mut matcher)
                    .unwrap_or_default();
                let basename_match = basename_contains_query(&item.data.path, &query);

                RankedHit::new(
                    basename_match,
                    score,
                    SearchHit {
                        path: item.data.path.clone(),
                        score,
                        size_bytes: item.data.size_bytes,
                    },
                )
            })
            .collect::<Vec<_>>();

        collect_top_hits(hits, top_k)
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

impl RankedHit {
    fn new(basename_match: bool, score: u32, hit: SearchHit) -> Self {
        Self {
            basename_match,
            score,
            hit,
        }
    }
}

impl Ord for RankedHit {
    fn cmp(&self, other: &Self) -> Ordering {
        self.basename_match
            .cmp(&other.basename_match)
            .then_with(|| self.score.cmp(&other.score))
            .then_with(|| other.hit.path.cmp(&self.hit.path))
    }
}

impl PartialOrd for RankedHit {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

fn collect_top_hits(hits: Vec<RankedHit>, top_k: usize) -> Vec<SearchHit> {
    if top_k == 0 {
        return Vec::new();
    }

    let mut heap: BinaryHeap<Reverse<RankedHit>> = BinaryHeap::with_capacity(top_k);
    for hit in hits {
        if heap.len() < top_k {
            heap.push(Reverse(hit));
            continue;
        }

        let should_replace = heap
            .peek()
            .map(|worst| hit > worst.0)
            .unwrap_or(true);
        if should_replace {
            heap.pop();
            heap.push(Reverse(hit));
        }
    }

    let mut ranked_hits = heap.into_iter().map(|Reverse(hit)| hit).collect::<Vec<_>>();
    ranked_hits.sort_by(|left, right| right.cmp(left));
    ranked_hits.into_iter().map(|ranked| ranked.hit).collect()
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

    use super::{
        DEFAULT_NUCLEO_THREADS, SearchEngine, SearchHit, RankedHit, collect_top_hits,
        default_nucleo_threads,
    };

    #[test]
    fn search_engine_defaults_to_bounded_nucleo_thread_count() {
        assert_eq!(default_nucleo_threads(), Some(DEFAULT_NUCLEO_THREADS));
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

    #[test]
    fn collect_top_hits_keeps_only_best_ranked_hits() {
        let hits = collect_top_hits(
            vec![
                RankedHit::new(
                    false,
                    10,
                    SearchHit {
                        path: "/tmp/zeta.txt".to_string(),
                        score: 10,
                        size_bytes: Some(1),
                    },
                ),
                RankedHit::new(
                    true,
                    5,
                    SearchHit {
                        path: "/tmp/beta.txt".to_string(),
                        score: 5,
                        size_bytes: Some(2),
                    },
                ),
                RankedHit::new(
                    true,
                    5,
                    SearchHit {
                        path: "/tmp/alpha.txt".to_string(),
                        score: 5,
                        size_bytes: Some(3),
                    },
                ),
            ],
            2,
        );

        assert_eq!(
            hits,
            vec![
                SearchHit {
                    path: "/tmp/alpha.txt".to_string(),
                    score: 5,
                    size_bytes: Some(3),
                },
                SearchHit {
                    path: "/tmp/beta.txt".to_string(),
                    score: 5,
                    size_bytes: Some(2),
                },
            ]
        );
    }

    #[test]
    fn search_respects_top_k_without_reordering_best_hits() {
        let mut engine = SearchEngine::new();
        engine.seed([
            FileRecord {
                path: "/library/reports/report-zeta.txt".to_string(),
                size_bytes: Some(1),
            },
            FileRecord {
                path: "/library/reports/report-beta.txt".to_string(),
                size_bytes: Some(2),
            },
            FileRecord {
                path: "/library/reports/report-alpha.txt".to_string(),
                size_bytes: Some(3),
            },
        ]);

        let hits = engine.search("report", 2);

        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].path, "/library/reports/report-alpha.txt");
        assert_eq!(hits[1].path, "/library/reports/report-beta.txt");
    }
}
