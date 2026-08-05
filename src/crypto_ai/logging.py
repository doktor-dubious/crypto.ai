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
    json_filename: str = "crypto_ai.json",
    text_filename: str = "crypto_ai.log",
    finetune_filename: str = "finetune.log",
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

    # --- Finetuning-only file handler ---
    # Inject worker name so remote workers are identifiable in the log.
    worker_name = os.environ.get("WORKER_NAME", "local")

    def _inject_worker_tag(
        logger: logging.Logger,
        method_name: str,
        event_dict: dict,
    ) -> dict:
        # Prefix the logger name with the worker tag so the
        # ConsoleRenderer produces:
        #   [info     ][RunPod] Training on outlet ...
        level = event_dict.get("level", "info")
        event = event_dict.get("event", "")
        ts = event_dict.get("timestamp", "")
        line = f"{ts} [{level:<9s}][{worker_name}] {event}"
        return {"_final": line}

    class _RawRenderer:
        """Pass the pre-formatted line through unchanged."""

        def __call__(
            self,
            logger: logging.Logger,
            method_name: str,
            event_dict: dict,
        ) -> str:
            return event_dict.get("_final", "")

    finetune_formatter = structlog.stdlib.ProcessorFormatter(
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            _inject_worker_tag,
            _RawRenderer(),
        ],
        foreign_pre_chain=shared_processors,
    )
    finetune_path = os.path.join(log_dir, finetune_filename)
    finetune_handler = logging.handlers.RotatingFileHandler(
        finetune_path,
        maxBytes=50 * 1024 * 1024,
        backupCount=5,
        encoding="utf-8",
    )
    finetune_handler.setFormatter(finetune_formatter)

    # Database-backed handler for finetune logs (survives remote workers)
    from crypto_ai.logging_db import FinetuneDbHandler

    finetune_db_handler = FinetuneDbHandler()
    # Use the same raw formatter so DB entries match the file log style
    finetune_db_handler.setFormatter(finetune_formatter)

    # Only capture finetuning-related loggers
    for ft_logger_name in (
        "crypto_ai.services._finetune_timesfm",
        "crypto_ai.services._finetune_moirai2",
        "crypto_ai.services.finetune",
        "crypto_ai.tasks.finetuning",
        "crypto_ai.tasks.finetune_examination",
    ):
        ft_logger = logging.getLogger(ft_logger_name)
        ft_logger.addHandler(finetune_handler)
        ft_logger.addHandler(finetune_db_handler)

    # --- LLM file handler (llm.txt) ---
    _llm_meta_keys = {
        "provider", "model_tag", "level", "event",
        "timestamp", "logger", "stack_info", "exception",
    }

    def _inject_llm_tag(
        logger: logging.Logger,
        method_name: str,
        event_dict: dict,
    ) -> dict:
        provider = event_dict.pop("provider", "Claude")
        model_tag = event_dict.pop("model_tag", "")
        level = event_dict.get("level", "info")
        event = event_dict.get("event", "")
        ts = event_dict.get("timestamp", "")
        tag = f"[{provider}]"
        if model_tag:
            tag += f"[{model_tag}]"
        # Append extra kwargs as key=value pairs
        extras = " ".join(
            f"{k}={v}" for k, v in event_dict.items()
            if k not in _llm_meta_keys
        )
        parts = [f"{ts} [{level:<9s}]{tag} {event}"]
        if extras:
            parts.append(extras)
        return {"_final": " ".join(parts)}

    llm_formatter = structlog.stdlib.ProcessorFormatter(
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            _inject_llm_tag,
            _RawRenderer(),
        ],
        foreign_pre_chain=shared_processors,
    )
    llm_path = os.path.join(log_dir, "llm.txt")
    llm_handler = logging.handlers.RotatingFileHandler(
        llm_path,
        maxBytes=50 * 1024 * 1024,
        backupCount=5,
        encoding="utf-8",
    )
    llm_handler.setFormatter(llm_formatter)

    llm_logger = logging.getLogger("crypto_ai.llm")
    llm_logger.addHandler(llm_handler)

    # --- Binance data file handler (binance.log) ---
    # Captures warnings/errors from the Binance kline pipeline (imports + the live
    # ingester) so they surface as the "Binance Data" log on system/logs. Level is
    # WARNING so it stays an error/warning feed, not a full activity log. Loggers
    # still propagate to root, so console/text logs are unaffected.
    binance_path = os.path.join(log_dir, "binance.log")
    binance_handler = logging.handlers.RotatingFileHandler(
        binance_path,
        maxBytes=50 * 1024 * 1024,
        backupCount=5,
        encoding="utf-8",
    )
    # Own formatter that keeps the structured kwargs (symbol/interval/error) — the
    # error detail is the whole point of this log.
    _binance_meta_keys = {"level", "event", "timestamp", "logger", "stack_info", "exception"}

    def _inject_binance_tag(
        logger: logging.Logger,
        method_name: str,
        event_dict: dict,
    ) -> dict:
        level = event_dict.get("level", "info")
        event = event_dict.get("event", "")
        ts = event_dict.get("timestamp", "")
        extras = " ".join(
            f"{k}={v}" for k, v in event_dict.items() if k not in _binance_meta_keys
        )
        line = f"{ts} [{level:<9s}] {event}"
        if extras:
            line += f" {extras}"
        return {"_final": line}

    binance_formatter = structlog.stdlib.ProcessorFormatter(
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            _inject_binance_tag,
            _RawRenderer(),
        ],
        foreign_pre_chain=shared_processors,
    )
    binance_handler.setFormatter(binance_formatter)
    binance_handler.setLevel(logging.WARNING)
    for bn_logger_name in (
        "crypto_ai.services.live_ingest",
        "crypto_ai.services.live_ingest_control",
        "crypto_ai.services.binance_import",
        "crypto_ai.services.binance",
        "crypto_ai.tasks.imports",
        "crypto_ai.api.routes.binance_import",
    ):
        logging.getLogger(bn_logger_name).addHandler(binance_handler)

    # --- Trade AI file handler (trade_ai.log) ---
    # Every AI trade-confirmation verdict (verdict + explanation + trade card
    # identity) plus advisor failures, surfaced as "Trade AI" on system/logs.
    # INFO level — the verdict lines ARE the log, not just its errors. Same
    # key=value renderer as the Binance handler.
    trade_ai_path = os.path.join(log_dir, "trade_ai.log")
    trade_ai_handler = logging.handlers.RotatingFileHandler(
        trade_ai_path,
        maxBytes=50 * 1024 * 1024,
        backupCount=5,
        encoding="utf-8",
    )
    trade_ai_handler.setFormatter(binance_formatter)
    logging.getLogger("crypto_ai.trade_ai").addHandler(trade_ai_handler)

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
