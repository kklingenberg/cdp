mod conf;

fn main() {
    let conf = conf::init().unwrap();
    println!("Hello, world! log level is {}", conf.log_level);
}
