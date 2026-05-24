use std::path::PathBuf;
use std::time::Duration;

use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct FileConfig {
    search_dir: Option<PathBuf>,
    data_dir: Option<PathBuf>,
    exclude_dirs: Option<Vec<PathBuf>>,
    refresh_ttl_secs: Option<u64>,
    idle_ttl_secs: Option<u64>,
    cleanup_interval_secs: Option<u64>,
    top_k: Option<usize>,
    nucleo_threads: Option<usize>,
}

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
        Self::from_sources()
    }

    pub fn from_sources() -> anyhow::Result<Self> {
        reject_legacy_root_env()?;

        let mut config = Self::default_for(PathBuf::from("files"));
        if let Some(file_config) = load_file_config()? {
            apply_file_config(&mut config, file_config)?;
        }
        apply_env_config(&mut config)?;
        finalize_config(&mut config)?;
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

fn reject_legacy_root_env() -> anyhow::Result<()> {
    if std::env::var_os("FZFETCH_ROOT").is_some() {
        anyhow::bail!("FZFETCH_ROOT is no longer supported; use FZFETCH_SEARCH_DIR instead");
    }
    Ok(())
}

fn load_file_config() -> anyhow::Result<Option<FileConfig>> {
    if let Some(path) = std::env::var_os("FZFETCH_CONFIG").map(PathBuf::from) {
        let contents = std::fs::read_to_string(&path).map_err(|error| {
            anyhow::anyhow!(
                "failed to read FZFETCH_CONFIG at {}: {error}",
                path.display()
            )
        })?;
        return parse_file_config(&path, &contents).map(Some);
    }

    let path = PathBuf::from("fzfetch.toml");
    match std::fs::read_to_string(&path) {
        Ok(contents) => parse_file_config(&path, &contents).map(Some),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(anyhow::anyhow!(
            "failed to read {}: {error}",
            path.display()
        )),
    }
}

fn parse_file_config(path: &std::path::Path, contents: &str) -> anyhow::Result<FileConfig> {
    toml::from_str(contents)
        .map_err(|error| anyhow::anyhow!("failed to parse {}: {error}", path.display()))
}

fn apply_file_config(config: &mut AppConfig, file: FileConfig) -> anyhow::Result<()> {
    if let Some(search_dir) = file.search_dir {
        config.root_dir = search_dir;
    }
    if let Some(data_dir) = file.data_dir {
        config.data_dir = data_dir;
    }
    if let Some(exclude_dirs) = file.exclude_dirs {
        config.exclude_dirs = exclude_dirs;
    }
    if let Some(refresh_ttl_secs) = file.refresh_ttl_secs {
        config.refresh_ttl = Duration::from_secs(refresh_ttl_secs);
    }
    if let Some(idle_ttl_secs) = file.idle_ttl_secs {
        config.idle_ttl = Duration::from_secs(idle_ttl_secs);
    }
    if let Some(cleanup_interval_secs) = file.cleanup_interval_secs {
        config.cleanup_interval = Duration::from_secs(cleanup_interval_secs);
    }
    if let Some(top_k) = file.top_k {
        config.top_k = top_k;
    }
    if let Some(nucleo_threads) = file.nucleo_threads {
        if nucleo_threads == 0 {
            anyhow::bail!("nucleo_threads must be greater than zero");
        }
        config.nucleo_threads = nucleo_threads;
    }
    Ok(())
}

fn apply_env_config(config: &mut AppConfig) -> anyhow::Result<()> {
    if let Some(search_dir) = read_env_var("FZFETCH_SEARCH_DIR")? {
        config.root_dir = PathBuf::from(search_dir);
    }
    if let Some(data_dir) = read_env_var("FZFETCH_DATA_DIR")? {
        config.data_dir = PathBuf::from(data_dir);
    }
    if let Some(exclude_dirs) = parse_path_list_env("FZFETCH_EXCLUDE_DIRS")? {
        config.exclude_dirs = exclude_dirs;
    }
    if let Some(value) = read_env_var("FZFETCH_REFRESH_TTL_SECS")? {
        config.refresh_ttl = Duration::from_secs(parse_u64_value(
            "FZFETCH_REFRESH_TTL_SECS",
            Some(value),
            config.refresh_ttl.as_secs(),
        )?);
    }
    if let Some(value) = read_env_var("FZFETCH_IDLE_TTL_SECS")? {
        config.idle_ttl = Duration::from_secs(parse_u64_value(
            "FZFETCH_IDLE_TTL_SECS",
            Some(value),
            config.idle_ttl.as_secs(),
        )?);
    }
    if let Some(value) = read_env_var("FZFETCH_CLEANUP_INTERVAL_SECS")? {
        config.cleanup_interval = Duration::from_secs(parse_u64_value(
            "FZFETCH_CLEANUP_INTERVAL_SECS",
            Some(value),
            config.cleanup_interval.as_secs(),
        )?);
    }
    if let Some(value) = read_env_var("FZFETCH_TOP_K")? {
        config.top_k = parse_usize_value("FZFETCH_TOP_K", Some(value), config.top_k)?;
    }
    if let Some(value) = read_env_var("FZFETCH_NUCLEO_THREADS")? {
        let nucleo_threads =
            parse_usize_value("FZFETCH_NUCLEO_THREADS", Some(value), config.nucleo_threads)?;
        if nucleo_threads == 0 {
            anyhow::bail!("FZFETCH_NUCLEO_THREADS must be greater than zero");
        }
        config.nucleo_threads = nucleo_threads;
    }
    Ok(())
}

fn finalize_config(config: &mut AppConfig) -> anyhow::Result<()> {
    config.canonical_root_dir =
        std::fs::canonicalize(&config.root_dir).unwrap_or_else(|_| config.root_dir.clone());
    config.cache_file = config.data_dir.join("cache.txt");
    config.refresh_canonical_exclude_dirs();
    Ok(())
}

fn read_env_var(name: &str) -> anyhow::Result<Option<String>> {
    match std::env::var(name) {
        Ok(value) => Ok(Some(value)),
        Err(std::env::VarError::NotPresent) => Ok(None),
        Err(error) => Err(anyhow::anyhow!("failed to read {name}: {error}")),
    }
}

fn parse_path_list_env(name: &str) -> anyhow::Result<Option<Vec<PathBuf>>> {
    let Some(value) = read_env_var(name)? else {
        return Ok(None);
    };

    Ok(Some(
        value
            .split(',')
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(PathBuf::from)
            .collect(),
    ))
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
