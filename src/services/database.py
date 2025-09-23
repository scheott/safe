# api/src/services/database.py

import sqlite3
import json
import hashlib
import os
import logging
from pathlib import Path
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta
import threading

logger = logging.getLogger(__name__)

class DatabaseService:
    """
    SQLite-based database service for SafeSignal.
    Handles URL check logging with privacy-conscious URL hashing.
    """
    
    def __init__(self, db_path: str = "data/safesignal.db"):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(exist_ok=True)
        
        # URL hashing salt (store in environment)
        self.url_salt = os.environ.get("URL_HASH_SALT", "dev-salt-change-me-in-production")
        
        # Thread-local storage for connections
        self._local = threading.local()
        
        # Initialize database
        self._init_database()
    
    def _get_connection(self) -> sqlite3.Connection:
        """Get thread-local database connection"""
        if not hasattr(self._local, 'connection'):
            self._local.connection = sqlite3.connect(
                self.db_path,
                check_same_thread=False,
                timeout=30.0
            )
            
            # Set SQLite optimizations
            cursor = self._local.connection.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA synchronous=NORMAL") 
            cursor.execute("PRAGMA temp_store=MEMORY")
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()
            
        return self._local.connection
    
    def _init_database(self):
        """Initialize database schema"""
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            # URL checks table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS url_checks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    url_hash TEXT NOT NULL,
                    domain TEXT NOT NULL,
                    verdict TEXT NOT NULL,
                    reasons TEXT NOT NULL,
                    tier0_score INTEGER,
                    analysis_details TEXT,
                    processing_time_ms INTEGER,
                    fetch_time_ms INTEGER,
                    user_id TEXT,
                    source TEXT DEFAULT 'extension',
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            # Create indexes for performance
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_checks_created_at 
                ON url_checks(created_at)
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_checks_domain 
                ON url_checks(domain)
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_checks_url_hash 
                ON url_checks(url_hash)
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_checks_verdict 
                ON url_checks(verdict)
            """)
            
            # Analytics aggregation table (for fast queries)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS daily_stats (
                    date TEXT PRIMARY KEY,
                    total_checks INTEGER DEFAULT 0,
                    ok_checks INTEGER DEFAULT 0,
                    warning_checks INTEGER DEFAULT 0,
                    danger_checks INTEGER DEFAULT 0,
                    avg_processing_time_ms REAL DEFAULT 0,
                    unique_domains INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            conn.commit()
            cursor.close()
            
            logger.info(f"Database initialized at {self.db_path}")
            
        except Exception as e:
            logger.error(f"Failed to initialize database: {e}")
            raise
    
    def _hash_url(self, url: str) -> str:
        """Create salted hash of URL for privacy"""
        return hashlib.sha256((url + self.url_salt).encode('utf-8')).hexdigest()
    
    def log_url_check(self, 
                     url: str,
                     domain: str, 
                     verdict: str,
                     reasons: List[str],
                     tier0_score: int,
                     analysis_details: Dict[str, Any],
                     processing_time_ms: int,
                     fetch_time_ms: int = 0,
                     user_id: Optional[str] = None,
                     source: str = "extension") -> bool:
        """
        Log a URL check to the database.
        
        Args:
            url: The original URL (will be hashed for privacy)
            domain: Domain name (stored for analytics)
            verdict: ok, warning, or danger
            reasons: List of reason codes that triggered the verdict
            tier0_score: Numeric score from Tier-0 analysis
            analysis_details: Full analysis details as dict
            processing_time_ms: Total processing time
            fetch_time_ms: Time spent fetching the URL
            user_id: Optional user identifier
            source: Source of the check (extension, website, etc.)
            
        Returns:
            bool: True if logged successfully, False otherwise
        """
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            url_hash = self._hash_url(url)
            reasons_json = json.dumps(reasons)
            details_json = json.dumps(analysis_details)
            
            cursor.execute("""
                INSERT INTO url_checks (
                    url_hash, domain, verdict, reasons, tier0_score,
                    analysis_details, processing_time_ms, fetch_time_ms,
                    user_id, source
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                url_hash, domain, verdict, reasons_json, tier0_score,
                details_json, processing_time_ms, fetch_time_ms,
                user_id, source
            ))
            
            conn.commit()
            cursor.close()
            
            logger.debug(f"Logged check for domain {domain}: {verdict}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to log URL check: {e}")
            return False
    
    def get_daily_stats(self, days: int = 7) -> List[Dict[str, Any]]:
        """
        Get daily statistics for the last N days.
        
        Args:
            days: Number of days to retrieve (default 7)
            
        Returns:
            List of daily stats dictionaries
        """
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            # Calculate date range
            end_date = datetime.now().date()
            start_date = end_date - timedelta(days=days-1)
            
            # Query with aggregation for days that don't have pre-computed stats
            cursor.execute("""
                WITH date_range AS (
                    SELECT date(?) + (value - 1) * interval '1 day' as date
                    FROM generate_series(0, ?) as t(value)
                ),
                daily_data AS (
                    SELECT 
                        date(created_at) as check_date,
                        COUNT(*) as total_checks,
                        SUM(CASE WHEN verdict = 'ok' THEN 1 ELSE 0 END) as ok_checks,
                        SUM(CASE WHEN verdict = 'warning' THEN 1 ELSE 0 END) as warning_checks,
                        SUM(CASE WHEN verdict = 'danger' THEN 1 ELSE 0 END) as danger_checks,
                        AVG(processing_time_ms) as avg_processing_time_ms,
                        COUNT(DISTINCT domain) as unique_domains
                    FROM url_checks 
                    WHERE date(created_at) >= ?
                    GROUP BY date(created_at)
                )
                SELECT 
                    ? as date,
                    COALESCE(dd.total_checks, 0) as total_checks,
                    COALESCE(dd.ok_checks, 0) as ok_checks,
                    COALESCE(dd.warning_checks, 0) as warning_checks,
                    COALESCE(dd.danger_checks, 0) as danger_checks,
                    COALESCE(dd.avg_processing_time_ms, 0) as avg_processing_time_ms,
                    COALESCE(dd.unique_domains, 0) as unique_domains
                FROM daily_data dd
                WHERE dd.check_date >= ?
                ORDER BY check_date DESC
            """, (start_date, days, start_date, start_date))
            
            results = cursor.fetchall()
            cursor.close()
            
            # Convert to list of dictionaries
            stats = []
            for row in results:
                stats.append({
                    "date": row[0],
                    "total_checks": row[1],
                    "ok_checks": row[2],
                    "warning_checks": row[3],
                    "danger_checks": row[4],
                    "avg_processing_time_ms": round(row[5], 2) if row[5] else 0,
                    "unique_domains": row[6]
                })
            
            # Fill in missing days with zeros
            existing_dates = {stat["date"] for stat in stats}
            for i in range(days):
                check_date = (end_date - timedelta(days=i)).isoformat()
                if check_date not in existing_dates:
                    stats.append({
                        "date": check_date,
                        "total_checks": 0,
                        "ok_checks": 0,
                        "warning_checks": 0,
                        "danger_checks": 0,
                        "avg_processing_time_ms": 0,
                        "unique_domains": 0
                    })
            
            # Sort by date descending
            stats.sort(key=lambda x: x["date"], reverse=True)
            
            return stats[:days]
            
        except Exception as e:
            logger.error(f"Failed to get daily stats: {e}")
            # Return empty stats for the requested days
            return [
                {
                    "date": (datetime.now().date() - timedelta(days=i)).isoformat(),
                    "total_checks": 0,
                    "ok_checks": 0,
                    "warning_checks": 0,
                    "danger_checks": 0,
                    "avg_processing_time_ms": 0,
                    "unique_domains": 0
                }
                for i in range(days)
            ]
    
    def get_total_checks(self) -> int:
        """Get total number of checks ever performed"""
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            cursor.execute("SELECT COUNT(*) FROM url_checks")
            result = cursor.fetchone()
            cursor.close()
            
            return result[0] if result else 0
            
        except Exception as e:
            logger.error(f"Failed to get total checks: {e}")
            return 0
    
    def get_verdict_distribution(self, days: int = 30) -> Dict[str, int]:
        """Get verdict distribution for the last N days"""
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                SELECT verdict, COUNT(*) 
                FROM url_checks 
                WHERE created_at >= datetime('now', '-{} days')
                GROUP BY verdict
            """.format(days))
            
            results = cursor.fetchall()
            cursor.close()
            
            distribution = {"ok": 0, "warning": 0, "danger": 0}
            for verdict, count in results:
                if verdict in distribution:
                    distribution[verdict] = count
                    
            return distribution
            
        except Exception as e:
            logger.error(f"Failed to get verdict distribution: {e}")
            return {"ok": 0, "warning": 0, "danger": 0}
    
    def get_domain_stats(self, days: int = 7) -> List[Dict[str, Any]]:
        """Get domain-level statistics for the last N days"""
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                SELECT 
                    domain,
                    COUNT(*) as total_checks,
                    SUM(CASE WHEN verdict = 'ok' THEN 1 ELSE 0 END) as ok_checks,
                    SUM(CASE WHEN verdict = 'warning' THEN 1 ELSE 0 END) as warning_checks,
                    SUM(CASE WHEN verdict = 'danger' THEN 1 ELSE 0 END) as danger_checks,
                    AVG(processing_time_ms) as avg_processing_time_ms,
                    MAX(created_at) as last_check
                FROM url_checks 
                WHERE created_at >= datetime('now', '-{} days')
                GROUP BY domain
                ORDER BY total_checks DESC
                LIMIT 50
            """.format(days))
            
            results = cursor.fetchall()
            cursor.close()
            
            return [
                {
                    "domain": row[0],
                    "total_checks": row[1],
                    "ok_checks": row[2],
                    "warning_checks": row[3],
                    "danger_checks": row[4],
                    "avg_processing_time_ms": round(row[5], 2) if row[5] else 0,
                    "last_check": row[6]
                }
                for row in results
            ]
            
        except Exception as e:
            logger.error(f"Failed to get domain stats: {e}")
            return []
    
    def get_recent_checks(self, limit: int = 50) -> List[Dict[str, Any]]:
        """Get recent URL checks (anonymized)"""
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                SELECT 
                    domain,
                    verdict,
                    reasons,
                    tier0_score,
                    processing_time_ms,
                    source,
                    created_at
                FROM url_checks 
                ORDER BY created_at DESC
                LIMIT ?
            """, (limit,))
            
            results = cursor.fetchall()
            cursor.close()
            
            return [
                {
                    "domain": row[0],
                    "verdict": row[1],
                    "reasons": json.loads(row[2]) if row[2] else [],
                    "tier0_score": row[3],
                    "processing_time_ms": row[4],
                    "source": row[5],
                    "created_at": row[6]
                }
                for row in results
            ]
            
        except Exception as e:
            logger.error(f"Failed to get recent checks: {e}")
            return []
    
    def cleanup_old_records(self, days_to_keep: int = 60) -> int:
        """
        Clean up old URL check records while preserving aggregated stats
        
        Args:
            days_to_keep: Number of days of raw records to keep (default 60)
            
        Returns:
            Number of records deleted
        """
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            cutoff_date = datetime.now() - timedelta(days=days_to_keep)
            
            # Delete old records
            cursor.execute("""
                DELETE FROM url_checks 
                WHERE created_at < ?
            """, (cutoff_date,))
            
            deleted_count = cursor.rowcount
            conn.commit()
            cursor.close()
            
            logger.info(f"Cleaned up {deleted_count} old URL check records")
            return deleted_count
            
        except Exception as e:
            logger.error(f"Failed to cleanup old records: {e}")
            return 0
    
    def get_database_info(self) -> Dict[str, Any]:
        """Get database information and statistics"""
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            # Get basic stats
            cursor.execute("SELECT COUNT(*) FROM url_checks")
            total_checks = cursor.fetchone()[0]
            
            cursor.execute("SELECT COUNT(DISTINCT domain) FROM url_checks")
            unique_domains = cursor.fetchone()[0]
            
            cursor.execute("SELECT MIN(created_at), MAX(created_at) FROM url_checks")
            date_range = cursor.fetchone()
            
            cursor.execute("SELECT verdict, COUNT(*) FROM url_checks GROUP BY verdict")
            verdict_counts = dict(cursor.fetchall())
            
            cursor.close()
            
            return {
                "total_checks": total_checks,
                "unique_domains": unique_domains,
                "date_range": {
                    "earliest": date_range[0],
                    "latest": date_range[1]
                },
                "verdict_distribution": verdict_counts,
                "database_path": str(self.db_path),
                "database_size_mb": round(self.db_path.stat().st_size / (1024 * 1024), 2) if self.db_path.exists() else 0
            }
            
        except Exception as e:
            logger.error(f"Failed to get database info: {e}")
            return {
                "total_checks": 0,
                "unique_domains": 0,
                "date_range": {"earliest": None, "latest": None},
                "verdict_distribution": {},
                "database_path": str(self.db_path),
                "error": str(e)
            }


# Global database service instance
db_service = DatabaseService()


def get_db_service() -> DatabaseService:
    """Get the global database service instance"""
    return db_service