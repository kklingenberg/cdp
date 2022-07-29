use anyhow::{Context, Result};
use envconfig::Envconfig;
use log::Level;

#[derive(Envconfig)]
pub struct Conf {
    #[envconfig(from = "LOG_LEVEL", default = "info")]
    pub log_level: Level,
}

pub fn init() -> Result<Conf> {
    Conf::init_from_env().context("Failed to parse environment variable(s)")
}
