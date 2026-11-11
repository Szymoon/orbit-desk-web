"""Run the panel server:  python -m orbitdesk [--config config.toml] [--demo]"""
import argparse
import logging

import uvicorn

from . import config as config_mod
from .app import create_app


def main():
    ap = argparse.ArgumentParser(prog="orbitdesk")
    ap.add_argument("--config", default=None, help="path to config.toml")
    ap.add_argument("--demo", action="store_true", help="use built-in sample data, no internet needed")
    ap.add_argument("--host", default=None)
    ap.add_argument("--port", type=int, default=None)
    a = ap.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    cfg = config_mod.load(a.config)
    app = create_app(cfg, demo=a.demo)
    uvicorn.run(app, host=a.host or cfg["server"]["host"], port=a.port or cfg["server"]["port"],
                log_level="warning")


if __name__ == "__main__":
    main()
