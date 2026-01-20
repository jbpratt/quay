#!/usr/bin/env python3
"""
pg2sqlite - PostgreSQL to SQLite Migration for Quay

Usage:
    python -m scripts.pg2sqlite --config-path /conf/config.yaml --sqlite-path /data/quay.db

Requirements:
    - psycopg2-binary
    - pyyaml
    - Quay source (for Alembic migrations)
"""

import argparse
import base64
import json
import logging
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


class DateTimeEncoder(json.JSONEncoder):
    """JSON encoder for PostgreSQL types."""

    def default(self, obj):
        if isinstance(obj, datetime):
            return {"__datetime__": obj.isoformat()}
        if isinstance(obj, date):
            return {"__date__": obj.isoformat()}
        if isinstance(obj, bytes):
            return {"__bytes__": base64.b64encode(obj).decode("ascii")}
        if isinstance(obj, Decimal):
            return float(obj)
        if isinstance(obj, memoryview):
            return {"__bytes__": base64.b64encode(obj.tobytes()).decode("ascii")}
        return super().default(obj)


def decode_value(value: Any) -> Any:
    """Decode JSON-encoded special types back to Python objects."""
    if isinstance(value, dict):
        if "__datetime__" in value:
            return value["__datetime__"]  # SQLite stores as string
        if "__date__" in value:
            return value["__date__"]
        if "__bytes__" in value:
            return base64.b64decode(value["__bytes__"])
    return value


class QuayMigrator:
    """
    Migrates Quay from PostgreSQL to SQLite.

    Uses Alembic for schema creation to ensure compatibility.
    """

    def __init__(
        self,
        pg_uri: str,
        sqlite_path: str,
        quay_root: str,
        export_dir: Optional[str] = None,
    ):
        self.pg_uri = pg_uri
        # Use absolute path to avoid issues with Alembic running in different cwd
        self.sqlite_path = Path(sqlite_path).resolve()
        self.quay_root = Path(quay_root).resolve()
        self.export_dir = Path(export_dir).resolve() if export_dir else None
        self._pg_conn = None
        self._sqlite_conn = None

    def _connect_pg(self):
        """Connect to PostgreSQL."""
        try:
            import psycopg2
        except ImportError:
            raise ImportError("Install psycopg2-binary: pip install psycopg2-binary")

        logger.info("Connecting to PostgreSQL...")
        self._pg_conn = psycopg2.connect(self.pg_uri)
        return self._pg_conn

    def _connect_sqlite(self):
        """Connect to SQLite."""
        logger.info(f"Connecting to SQLite: {self.sqlite_path}")
        self._sqlite_conn = sqlite3.connect(str(self.sqlite_path))
        # Enable foreign keys
        self._sqlite_conn.execute("PRAGMA foreign_keys = OFF")  # Off during import
        return self._sqlite_conn

    def _get_pg_tables(self) -> List[str]:
        """Get all tables from PostgreSQL in dependency order."""
        cursor = self._pg_conn.cursor()

        # Get tables with their foreign key dependencies
        cursor.execute(
            """
            WITH RECURSIVE deps AS (
                SELECT
                    tc.table_name,
                    ccu.table_name AS depends_on
                FROM information_schema.table_constraints tc
                JOIN information_schema.constraint_column_usage ccu
                    ON tc.constraint_name = ccu.constraint_name
                WHERE tc.constraint_type = 'FOREIGN KEY'
                    AND tc.table_schema = 'public'
                    AND ccu.table_schema = 'public'
                    AND tc.table_name != ccu.table_name
            )
            SELECT DISTINCT table_name, depends_on FROM deps
        """
        )
        dependencies = cursor.fetchall()

        # Get all tables
        cursor.execute(
            """
            SELECT tablename FROM pg_tables
            WHERE schemaname = 'public'
            ORDER BY tablename
        """
        )
        all_tables = [row[0] for row in cursor.fetchall()]

        # Build dependency graph
        dep_graph = {t: set() for t in all_tables}
        for table, depends_on in dependencies:
            if table in dep_graph and depends_on in dep_graph:
                dep_graph[table].add(depends_on)

        # Topological sort (Kahn's algorithm)
        in_degree = {t: 0 for t in all_tables}
        for table, deps in dep_graph.items():
            in_degree[table] = len(deps)

        queue = [t for t in all_tables if in_degree[t] == 0]
        result = []

        while queue:
            queue.sort()  # Deterministic order
            table = queue.pop(0)
            result.append(table)

            for other, deps in dep_graph.items():
                if table in deps:
                    in_degree[other] -= 1
                    if in_degree[other] == 0:
                        queue.append(other)

        # Add any remaining tables (circular deps)
        for table in all_tables:
            if table not in result:
                result.append(table)

        return result

    def _get_pg_columns(self, table: str) -> List[Tuple[str, str]]:
        """Get columns and types for a PostgreSQL table."""
        cursor = self._pg_conn.cursor()
        cursor.execute(
            """
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = %s
            ORDER BY ordinal_position
        """,
            (table,),
        )
        return cursor.fetchall()

    def _get_sqlite_columns(self, table: str) -> List[str]:
        """Get column names for a SQLite table."""
        cursor = self._sqlite_conn.cursor()
        cursor.execute(f"PRAGMA table_info([{table}])")
        return [row[1] for row in cursor.fetchall()]

    def _export_table(self, table: str) -> Tuple[int, List[Dict]]:
        """Export a single table from PostgreSQL."""
        columns = self._get_pg_columns(table)
        if not columns:
            return 0, []

        col_names = [c[0] for c in columns]
        col_list = ", ".join(f'"{c}"' for c in col_names)

        cursor = self._pg_conn.cursor()
        cursor.execute(f'SELECT {col_list} FROM "{table}"')

        records = []
        for row in cursor.fetchall():
            records.append(dict(zip(col_names, row)))

        return len(records), records

    def _create_sqlite_schema(self):
        """Create SQLite schema using Alembic."""
        logger.info("Creating SQLite schema with Alembic...")

        # Ensure parent directory exists with world-writable permissions
        # (needed for container access to create WAL/journal files)
        self.sqlite_path.parent.mkdir(parents=True, exist_ok=True)
        os.chmod(self.sqlite_path.parent, 0o777)

        # Remove existing database if present
        if self.sqlite_path.exists():
            logger.warning(f"Removing existing SQLite database: {self.sqlite_path}")
            self.sqlite_path.unlink()

        # Run Alembic migrations
        # Quay's app.py reads QUAY_OVERRIDE_CONFIG to override config values
        env = os.environ.copy()
        sqlite_uri = f"sqlite:///{self.sqlite_path}"
        env["QUAY_OVERRIDE_CONFIG"] = json.dumps({"DB_URI": sqlite_uri})

        # We need to run from within the Quay directory
        result = subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            cwd=str(self.quay_root),
            env=env,
            capture_output=True,
            text=True,
        )

        if result.returncode != 0:
            logger.error(f"Alembic failed:\n{result.stderr}")
            raise RuntimeError(f"Failed to create SQLite schema: {result.stderr}")

        # Set world-readable/writable permissions on database file
        # (needed for container access)
        os.chmod(self.sqlite_path, 0o666)
        logger.info("SQLite schema created successfully")

    def _import_table(self, table: str, records: List[Dict]) -> int:
        """Import records into a SQLite table."""
        if not records:
            return 0

        # Get SQLite columns (schema may differ slightly)
        sqlite_cols = self._get_sqlite_columns(table)
        if not sqlite_cols:
            logger.warning(f"Table {table} not found in SQLite schema, skipping")
            return 0

        # Only import columns that exist in both
        pg_cols = set(records[0].keys())
        common_cols = [c for c in sqlite_cols if c in pg_cols]

        if not common_cols:
            logger.warning(f"No common columns for {table}")
            return 0

        # Prepare INSERT OR IGNORE statement (handles pre-seeded data from Alembic)
        col_list = ", ".join(f'"{c}"' for c in common_cols)
        placeholders = ", ".join("?" for _ in common_cols)
        sql = f'INSERT OR IGNORE INTO "{table}" ({col_list}) VALUES ({placeholders})'

        cursor = self._sqlite_conn.cursor()
        imported = 0

        for record in records:
            values = []
            for col in common_cols:
                val = decode_value(record.get(col))
                # Convert Python types to SQLite-compatible
                if isinstance(val, bool):
                    val = 1 if val else 0
                elif isinstance(val, bytes):
                    val = val  # SQLite handles bytes natively
                values.append(val)

            try:
                cursor.execute(sql, values)
                imported += 1
            except sqlite3.Error as e:
                logger.debug(f"Error inserting into {table}: {e}")
                # Continue with other records

        return imported

    def migrate(self, dry_run: bool = False) -> Dict[str, Any]:
        """
        Run the full migration.

        Args:
            dry_run: If True, export only, don't create SQLite

        Returns:
            Migration statistics
        """
        stats = {
            "tables": {},
            "total_exported": 0,
            "total_imported": 0,
            "errors": [],
        }

        # Phase 1: Connect to PostgreSQL and export
        logger.info("=" * 60)
        logger.info("PHASE 1: Export from PostgreSQL")
        logger.info("=" * 60)

        self._connect_pg()

        # Get Alembic version
        cursor = self._pg_conn.cursor()
        cursor.execute("SELECT version_num FROM alembic_version")
        alembic_version = cursor.fetchone()
        stats["alembic_version"] = alembic_version[0] if alembic_version else None
        logger.info(f"Alembic version: {stats['alembic_version']}")

        # Get database size
        cursor.execute("SELECT pg_database_size(current_database())")
        db_size = cursor.fetchone()[0]
        stats["pg_size_bytes"] = db_size
        logger.info(f"Database size: {db_size / 1e6:.1f} MB")

        # Export tables
        tables = self._get_pg_tables()
        logger.info(f"Found {len(tables)} tables")

        exported_data = {}
        for i, table in enumerate(tables, 1):
            try:
                count, records = self._export_table(table)
                exported_data[table] = records
                stats["tables"][table] = {"exported": count}
                stats["total_exported"] += count
                if count > 0:
                    logger.info(f"[{i}/{len(tables)}] {table}: {count} records")
            except Exception as e:
                logger.error(f"[{i}/{len(tables)}] {table}: ERROR - {e}")
                stats["errors"].append(f"Export {table}: {e}")

        # Save export if directory specified
        if self.export_dir:
            self.export_dir.mkdir(parents=True, exist_ok=True)
            for table, records in exported_data.items():
                with open(self.export_dir / f"{table}.json", "w") as f:
                    json.dump(records, f, cls=DateTimeEncoder)
            with open(self.export_dir / "metadata.json", "w") as f:
                json.dump(stats, f, indent=2)
            logger.info(f"Export saved to {self.export_dir}")

        if dry_run:
            logger.info("Dry run - skipping SQLite creation")
            return stats

        # Phase 2: Create SQLite schema with Alembic
        logger.info("")
        logger.info("=" * 60)
        logger.info("PHASE 2: Create SQLite Schema (Alembic)")
        logger.info("=" * 60)

        self._create_sqlite_schema()
        self._connect_sqlite()

        # Phase 3: Import data
        logger.info("")
        logger.info("=" * 60)
        logger.info("PHASE 3: Import Data to SQLite")
        logger.info("=" * 60)

        for i, table in enumerate(tables, 1):
            records = exported_data.get(table, [])
            try:
                count = self._import_table(table, records)
                stats["tables"].setdefault(table, {})["imported"] = count
                stats["total_imported"] += count
                if count > 0:
                    logger.info(f"[{i}/{len(tables)}] {table}: {count} records")
            except Exception as e:
                logger.error(f"[{i}/{len(tables)}] {table}: ERROR - {e}")
                stats["errors"].append(f"Import {table}: {e}")

        self._sqlite_conn.commit()

        # Phase 4: Validation
        logger.info("")
        logger.info("=" * 60)
        logger.info("PHASE 4: Validation")
        logger.info("=" * 60)

        # Enable foreign keys and check
        self._sqlite_conn.execute("PRAGMA foreign_keys = ON")
        cursor = self._sqlite_conn.cursor()

        # Integrity check
        cursor.execute("PRAGMA integrity_check")
        integrity = cursor.fetchone()[0]
        stats["integrity_check"] = integrity
        logger.info(f"Integrity check: {integrity}")

        # Compare actual counts between what was exported and what's in SQLite
        mismatches = []
        for table, info in stats["tables"].items():
            exported = info.get("exported", 0)
            try:
                cursor.execute(f'SELECT COUNT(*) FROM "{table}"')
                sqlite_count = cursor.fetchone()[0]
                if exported != sqlite_count:
                    mismatches.append(f"{table}: PostgreSQL {exported}, SQLite {sqlite_count}")
            except sqlite3.Error:
                if exported > 0:
                    mismatches.append(f"{table}: PostgreSQL {exported}, SQLite table missing")

        if mismatches:
            logger.warning(f"Count mismatches: {len(mismatches)}")
            for m in mismatches[:5]:
                logger.warning(f"  {m}")
            stats["mismatches"] = mismatches

        # Summary
        logger.info("")
        logger.info("=" * 60)
        logger.info("MIGRATION COMPLETE")
        logger.info("=" * 60)
        logger.info(f"Exported: {stats['total_exported']} records")
        logger.info(f"Imported: {stats['total_imported']} records")
        logger.info(f"SQLite file: {self.sqlite_path}")
        logger.info(f"SQLite size: {self.sqlite_path.stat().st_size / 1e6:.1f} MB")

        if stats["errors"]:
            logger.warning(f"Errors: {len(stats['errors'])}")

        # Cleanup
        self._pg_conn.close()
        self._sqlite_conn.close()

        return stats


def update_config(config_path: str, sqlite_path: str, backup: bool = True) -> None:
    """
    Update Quay config.yaml to use SQLite.

    Args:
        config_path: Path to config.yaml
        sqlite_path: Path to SQLite database
        backup: Whether to create a backup of the original config
    """
    import re

    config_file = Path(config_path)
    if not config_file.exists():
        raise FileNotFoundError(f"Config file not found: {config_path}")

    # Read current config
    content = config_file.read_text()

    # Backup original
    if backup:
        backup_path = config_file.with_suffix(".yaml.bak")
        shutil.copy(config_file, backup_path)
        logger.info(f"Backed up config to: {backup_path}")

    # Update DB_URI
    # Handle both quoted and unquoted values
    new_uri = f"sqlite:///{sqlite_path}"

    # Pattern to match DB_URI with various quote styles
    patterns = [
        (r'(DB_URI:\s*)["\']postgresql://[^"\']+["\']', rf'\1"{new_uri}"'),
        (r"(DB_URI:\s*)postgresql://\S+", rf'\1"{new_uri}"'),
    ]

    updated = False
    for pattern, replacement in patterns:
        if re.search(pattern, content):
            content = re.sub(pattern, replacement, content)
            updated = True
            break

    if not updated:
        logger.warning("Could not find DB_URI in config, appending")
        content += f'\nDB_URI: "{new_uri}"\n'

    # Write updated config
    config_file.write_text(content)
    logger.info(f"Updated config: DB_URI = {new_uri}")


def read_config(config_path: str) -> Dict[str, Any]:
    """
    Read Quay config.yaml file.

    Args:
        config_path: Path to config.yaml

    Returns:
        Config dictionary
    """
    try:
        import yaml
    except ImportError:
        raise ImportError("PyYAML is required. Install with: pip install pyyaml")

    with open(config_path, "r") as f:
        return yaml.safe_load(f)


def main():
    parser = argparse.ArgumentParser(
        description="Migrate Quay from PostgreSQL to SQLite",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Full migration
  python -m scripts.pg2sqlite \\
      --config-path /conf/config.yaml \\
      --sqlite-path /data/quay.db

  # Dry run (export only)
  python -m scripts.pg2sqlite \\
      --config-path /conf/config.yaml \\
      --sqlite-path /data/quay.db \\
      --dry-run
        """,
    )
    parser.add_argument(
        "--config-path",
        required=True,
        help="Path to Quay config.yaml (reads DB_URI, updates after migration)",
    )
    parser.add_argument(
        "--sqlite-path",
        required=True,
        help="Path for the SQLite database file",
    )
    parser.add_argument(
        "--pg-uri",
        help="PostgreSQL URI (optional, defaults to DB_URI from config)",
    )
    parser.add_argument(
        "--quay-root",
        default=".",
        help="Path to Quay source code (for Alembic migrations)",
    )
    parser.add_argument(
        "--export-dir",
        help="Directory to save export files (optional)",
    )
    parser.add_argument(
        "--container-db-path",
        help="Path to SQLite as seen from inside the container (for config.yaml). "
        "For local-dev, use /quay-registry/quay.db if --sqlite-path is ./quay.db",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Export only, don't create SQLite database",
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Enable debug logging",
    )

    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    # Read PG URI from config if not provided
    pg_uri = args.pg_uri
    if not pg_uri:
        logger.info(f"Reading DB_URI from {args.config_path}")
        config = read_config(args.config_path)
        pg_uri = config.get("DB_URI")
        if not pg_uri:
            logger.error("DB_URI not found in config file")
            sys.exit(1)
        if not pg_uri.startswith("postgresql"):
            logger.error(f"DB_URI is not PostgreSQL: {pg_uri}")
            sys.exit(1)
        logger.info(f"Using DB_URI from config: {pg_uri.split('@')[-1]}")  # Hide password

    migrator = QuayMigrator(
        pg_uri=pg_uri,
        sqlite_path=args.sqlite_path,
        quay_root=args.quay_root,
        export_dir=args.export_dir,
    )

    try:
        stats = migrator.migrate(dry_run=args.dry_run)

        # Write final stats
        if args.export_dir:
            with open(Path(args.export_dir) / "migration_stats.json", "w") as f:
                json.dump(stats, f, indent=2, default=str)

        # Update config (not in dry run mode)
        if not args.dry_run:
            logger.info("")
            logger.info("=" * 60)
            logger.info("PHASE 5: Update Configuration")
            logger.info("=" * 60)
            # Use container path for config if specified, otherwise use sqlite_path
            config_db_path = args.container_db_path or args.sqlite_path
            update_config(args.config_path, config_db_path)
            logger.info("")
            logger.info("Migration complete! Restart Quay to use SQLite.")

        if stats["errors"]:
            sys.exit(1)

    except Exception as e:
        logger.error(f"Migration failed: {e}")
        raise


if __name__ == "__main__":
    main()
