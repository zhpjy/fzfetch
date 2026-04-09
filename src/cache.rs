use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CacheLayoutStatus {
    Created,
    Existing,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileRecord {
    pub path: String,
    pub size_bytes: Option<u64>,
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

pub fn load_cache_records(cache_file: &Path) -> anyhow::Result<HashMap<String, FileRecord>> {
    let file = fs::File::open(cache_file)?;
    load_cache_records_from_reader(BufReader::new(file))
}

pub fn load_cache_records_from_reader<R: BufRead>(
    reader: R,
) -> anyhow::Result<HashMap<String, FileRecord>> {
    let mut records = HashMap::new();
    for line in reader.lines() {
        let line = line?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let record = parse_cache_line(trimmed)?;
        records.insert(record.path.clone(), record);
    }
    Ok(records)
}

pub fn write_cache_snapshot(
    cache_file: &Path,
    records: &HashMap<String, FileRecord>,
) -> anyhow::Result<()> {
    let parent = cache_file
        .parent()
        .ok_or_else(|| anyhow::anyhow!("cache file has no parent: {}", cache_file.display()))?;
    fs::create_dir_all(parent)?;

    let mut sorted: Vec<&FileRecord> = records.values().collect();
    sorted.sort_by(|left, right| left.path.cmp(&right.path));

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
    for record in sorted {
        match record.size_bytes {
            Some(size_bytes) => output.push_str(&size_bytes.to_string()),
            None => output.push('-'),
        }
        output.push('\t');
        output.push_str(&record.path);
        output.push('\n');
    }

    fs::write(&tmp_path, output)?;
    fs::rename(&tmp_path, cache_file)?;
    Ok(())
}

fn parse_cache_line(line: &str) -> anyhow::Result<FileRecord> {
    if let Some((size_field, path_field)) = line.split_once('\t') {
        let path = path_field.trim().to_owned();
        if path.is_empty() {
            anyhow::bail!("cache record path is empty");
        }

        let size_bytes = if size_field == "-" {
            None
        } else {
            Some(size_field.parse::<u64>().map_err(|error| {
                anyhow::anyhow!("invalid cache record size '{size_field}': {error}")
            })?)
        };
        Ok(FileRecord { path, size_bytes })
    } else {
        Ok(FileRecord {
            path: line.to_owned(),
            size_bytes: None,
        })
    }
}
