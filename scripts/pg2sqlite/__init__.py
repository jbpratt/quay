"""
pg2sqlite - PostgreSQL to SQLite Migration for Quay

Usage:
    python -m scripts.pg2sqlite \\
        --config-path "/conf/config.yaml" \\
        --sqlite-path "/data/quay.db"

The migration:
1. Reads DB_URI from config.yaml
2. Exports all data from PostgreSQL
3. Creates SQLite schema using Alembic
4. Imports data into SQLite
5. Updates config.yaml to use SQLite
"""

__version__ = "1.0.0"

from scripts.pg2sqlite.migrate import QuayMigrator, main

__all__ = ["QuayMigrator", "main"]
