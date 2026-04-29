use std::path::PathBuf;
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub root_dir: PathBuf,
    pub canonical_root_dir: PathBuf,
    pub data_dir: PathBuf,
    pub cache_file: PathBuf,
    pub exclude_dirs: Vec<PathBuf>,
    pub canonical_exclude_dirs: Vec<PathBuf>,
    pub refresh_ttl: Duration,
    pub idle_ttl: Duration,
    pub cleanup_interval: Duration,
    pub top_k: usize,
    pub nucleo_threads: usize,
    pub force_initial_refresh: bool,
}

impl AppConfig {
    pub fn default_for(root_dir: PathBuf) -> Self {
        let canonical_root_dir =
            std::fs::canonicalize(&root_dir).unwrap_or_else(|_| root_dir.clone());
        Self {
            root_dir,
            canonical_root_dir,
            data_dir: PathBuf::from("data"),
            cache_file: PathBuf::from("data/cache.txt"),
            exclude_dirs: Vec::new(),
            canonical_exclude_dirs: Vec::new(),
            refresh_ttl: Duration::from_secs(24 * 60 * 60),
            idle_ttl: Duration::from_secs(30 * 60),
            cleanup_interval: Duration::from_secs(60),
            top_k: 100,
            nucleo_threads: 4,
            force_initial_refresh: false,
        }
    }

    pub fn from_env() -> anyhow::Result<Self> {
        let root_dir = std::env::var("FZFETCH_ROOT").unwrap_or_else(|_| "files".to_string());
        let data_dir = std::env::var("FZFETCH_DATA_DIR").unwrap_or_else(|_| "data".to_string());
        let mut config = Self::default_for(root_dir.into());
        config.data_dir = PathBuf::from(data_dir);
        config.cache_file = config.data_dir.join("cache.txt");
        config.exclude_dirs = parse_path_list_env("FZFETCH_EXCLUDE_DIRS")?;
        config.refresh_ttl =
            Duration::from_secs(parse_u64_env("FZFETCH_REFRESH_TTL_SECS", 24 * 60 * 60)?);
        config.idle_ttl = Duration::from_secs(parse_u64_env("FZFETCH_IDLE_TTL_SECS", 30 * 60)?);
        config.cleanup_interval =
            Duration::from_secs(parse_u64_env("FZFETCH_CLEANUP_INTERVAL_SECS", 60)?);
        config.top_k = parse_usize_env("FZFETCH_TOP_K", 100)?;
        config.nucleo_threads = parse_nonzero_usize_env("FZFETCH_NUCLEO_THREADS", 4)?;
        config.refresh_canonical_exclude_dirs();
        Ok(config)
    }

    pub fn ensure_runtime_dirs(&mut self) -> anyhow::Result<()> {
        std::fs::create_dir_all(&self.root_dir)?;
        std::fs::create_dir_all(&self.data_dir)?;
        self.canonicalize_root_dir()?;
        Ok(())
    }

    pub fn canonicalize_root_dir(&mut self) -> anyhow::Result<()> {
        self.canonical_root_dir = std::fs::canonicalize(&self.root_dir)?;
        self.refresh_canonical_exclude_dirs();
        Ok(())
    }

    fn refresh_canonical_exclude_dirs(&mut self) {
        self.canonical_exclude_dirs =
            resolve_exclude_dirs(&self.canonical_root_dir, &self.exclude_dirs);
    }
}

fn parse_u64_env(name: &str, default: u64) -> anyhow::Result<u64> {
    let value = match std::env::var(name) {
        Ok(value) => Some(value),
        Err(std::env::VarError::NotPresent) => None,
        Err(error) => return Err(anyhow::anyhow!("failed to read {name}: {error}")),
    };
    parse_u64_value(name, value, default)
}

fn parse_usize_env(name: &str, default: usize) -> anyhow::Result<usize> {
    let value = match std::env::var(name) {
        Ok(value) => Some(value),
        Err(std::env::VarError::NotPresent) => None,
        Err(error) => return Err(anyhow::anyhow!("failed to read {name}: {error}")),
    };
    parse_usize_value(name, value, default)
}

fn parse_nonzero_usize_env(name: &str, default: usize) -> anyhow::Result<usize> {
    let value = parse_usize_env(name, default)?;
    if value == 0 {
        anyhow::bail!("{name} must be greater than zero");
    }
    Ok(value)
}

fn parse_path_list_env(name: &str) -> anyhow::Result<Vec<PathBuf>> {
    let value = match std::env::var(name) {
        Ok(value) => value,
        Err(std::env::VarError::NotPresent) => return Ok(Vec::new()),
        Err(error) => return Err(anyhow::anyhow!("failed to read {name}: {error}")),
    };

    Ok(value
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(PathBuf::from)
        .collect())
}

fn parse_u64_value(name: &str, value: Option<String>, default: u64) -> anyhow::Result<u64> {
    match value {
        Some(value) => value
            .parse::<u64>()
            .map_err(|error| anyhow::anyhow!("{name} must be an unsigned integer: {error}")),
        None => Ok(default),
    }
}

fn parse_usize_value(name: &str, value: Option<String>, default: usize) -> anyhow::Result<usize> {
    match value {
        Some(value) => value
            .parse::<usize>()
            .map_err(|error| anyhow::anyhow!("{name} must be an unsigned integer: {error}")),
        None => Ok(default),
    }
}

fn resolve_exclude_dirs(root_dir: &std::path::Path, exclude_dirs: &[PathBuf]) -> Vec<PathBuf> {
    exclude_dirs
        .iter()
        .filter_map(|path| resolve_relative_dir(root_dir, path))
        .collect()
}

fn resolve_relative_dir(root_dir: &std::path::Path, path: &std::path::Path) -> Option<PathBuf> {
    let mut relative = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::Normal(part) => relative.push(part),
            std::path::Component::ParentDir => {
                if !relative.pop() {
                    return None;
                }
            }
            std::path::Component::RootDir | std::path::Component::Prefix(_) => return None,
        }
    }

    if relative.as_os_str().is_empty() {
        return None;
    }

    Some(root_dir.join(relative))
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use super::{parse_u64_value, parse_usize_value, resolve_exclude_dirs};

    #[test]
    fn parse_u64_value_falls_back_to_default_when_missing() {
        assert_eq!(parse_u64_value("FZFETCH_TEST", None, 42).unwrap(), 42);
    }

    #[test]
    fn parse_u64_value_rejects_invalid_values() {
        let result = parse_u64_value("FZFETCH_TEST", Some("abc".to_string()), 42);

        assert!(result.is_err());
    }

    #[test]
    fn parse_usize_value_reads_valid_values() {
        let result = parse_usize_value("FZFETCH_TEST", Some("256".to_string()), 42);

        assert_eq!(result.unwrap(), 256);
    }

    #[test]
    fn resolve_exclude_dirs_ignores_paths_outside_root() {
        let resolved = resolve_exclude_dirs(
            Path::new("/tmp/root"),
            &[PathBuf::from("../outside"), PathBuf::from("inside")],
        );

        assert_eq!(resolved, vec![PathBuf::from("/tmp/root/inside")]);
    }
}
