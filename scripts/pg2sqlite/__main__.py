"""
pg2sqlite - PostgreSQL to SQLite Migration for Quay

Usage:
    python -m scripts.pg2sqlite --config-path /conf/config.yaml --sqlite-path /data/quay.db
"""

from scripts.pg2sqlite.migrate import main

main()
