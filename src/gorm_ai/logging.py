"""Structured logging configuration using structlog.

Configures three outputs from a single log call:
  - Console    : human-readable colored output (development / worker terminal)
  - log/*.json : newline-delimited JSON (production / log aggregation)
  - log/*.log  : human-readable plain text (no colour codes)

Call configure_logging() once at process startup — in main.py for the API
server and in tasks/celery_app.py for Celery workers.
"""

import logging
import logging.handlers
import os

import structlog


def configure_logging(
    log_dir: str = "log",
    log_level: str = "INFO",
    json_filename: str = "gorm_ai.json",
    text_filename: str = "gorm_ai.log",
) -> None:
    """Set up structlog with console (pretty) + file (JSON) + file (text) output."""
    os.makedirs(log_dir, exist_ok=True)

    # Processors shared across both renderers.
    # They run first and enrich the event dict before the final renderer.
    shared_processors: list = [
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.ExceptionRenderer(),
    ]

    # --- Console handler (human-readable) ---
    console_formatter = structlog.stdlib.ProcessorFormatter(
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            structlog.dev.ConsoleRenderer(colors=True),
        ],
        foreign_pre_chain=shared_processors,
    )
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(console_formatter)

    # --- JSON file handler ---
    json_formatter = structlog.stdlib.ProcessorFormatter(
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            structlog.processors.dict_tracebacks,
            structlog.processors.JSONRenderer(),
        ],
        foreign_pre_chain=shared_processors,
    )
    json_path = os.path.join(log_dir, json_filename)
    json_handler = logging.handlers.RotatingFileHandler(
        json_path,
        maxBytes=50 * 1024 * 1024,  # 50 MB per file
        backupCount=10,
        encoding="utf-8",
    )
    json_handler.setFormatter(json_formatter)

    # --- Plain-text file handler (human-readable, no colour codes) ---
    text_formatter = structlog.stdlib.ProcessorFormatter(
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            structlog.dev.ConsoleRenderer(colors=False),
        ],
        foreign_pre_chain=shared_processors,
    )
    text_path = os.path.join(log_dir, text_filename)
    text_handler = logging.handlers.RotatingFileHandler(
        text_path,
        maxBytes=50 * 1024 * 1024,  # 50 MB per file
        backupCount=10,
        encoding="utf-8",
    )
    text_handler.setFormatter(text_formatter)

    # Attach all handlers to the root logger
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(console_handler)
    root.addHandler(json_handler)
    root.addHandler(text_handler)
    root.setLevel(log_level)

    # Quieten noisy third-party loggers
    for noisy in ("httpx", "httpcore", "urllib3", "asyncio"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    # Wire structlog to use stdlib as its output backend
    structlog.configure(
        processors=shared_processors
        + [
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )
