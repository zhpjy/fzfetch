use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CacheLayoutStatus {
    Created,
    Existing,
}

pub fn ensure_cache_layout(
    data_dir: &Path,
    cache_file: &Path,
) -> anyhow::Result<CacheLayoutStatus> {
    fs::create_dir_all(data_dir)?;
    if !cache_file.exists() {
        fs::File::create(cache_file)?;
        Ok(CacheLayoutStatus::Created)
    } else if !cache_file.is_file() {
        anyhow::bail!(
            "cache path exists but is not a regular file: {}",
            cache_file.display()
        );
    } else {
        Ok(CacheLayoutStatus::Existing)
    }
}

pub fn load_cache_paths(cache_file: &Path) -> anyhow::Result<HashSet<String>> {
    let content = fs::read_to_string(cache_file)?;
    Ok(content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToOwned::to_owned)
        .collect())
}

pub fn write_cache_snapshot(cache_file: &Path, paths: &HashSet<String>) -> anyhow::Result<()> {
    let parent = cache_file
        .parent()
        .ok_or_else(|| anyhow::anyhow!("cache file has no parent: {}", cache_file.display()))?;
    fs::create_dir_all(parent)?;

    let mut sorted: Vec<String> = paths.iter().cloned().collect();
    sorted.sort();

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let tmp_path = parent.join(format!(
        ".{}.{}.tmp",
        cache_file
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("cache"),
        ts
    ));

    let mut output = String::new();
    for line in sorted {
        output.push_str(&line);
        output.push('\n');
    }

    fs::write(&tmp_path, output)?;
    fs::rename(&tmp_path, cache_file)?;
    Ok(())
}
