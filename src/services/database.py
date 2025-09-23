# Save this as: api/src/services/database.py

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
            
            # Update daily stats asynchronously
            self._update_daily_stats(verdict, processing_time_ms, domain)
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to log URL check: {e}")
            return False
    
    def _update_daily_stats(self, verdict: str, processing_time_ms: int, domain: str):
        """Update daily statistics (async operation)"""
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            today = datetime.now().date().isoformat()
            
            # Get current stats for today
            cursor.execute("""
                SELECT total_checks, ok_checks, warning_checks, danger_checks,
                       avg_processing_time_ms, unique_domains
                FROM daily_stats WHERE date = ?
            """, (today,))
            
            row = cursor.fetchone()
            
            if row:
                # Update existing record
                total_checks, ok_checks, warning_checks, danger_checks, avg_time, unique_domains = row
                
                new_total = total_checks + 1
                new_avg_time = ((avg_time * total_checks) + processing_time_ms) / new_total
                
                # Update verdict counts
                if verdict == 'ok':
                    ok_checks += 1
                elif verdict == 'warning':
                    warning_checks += 1
                elif verdict == 'danger':
                    danger_checks += 1
                
                # Count unique domains (simplified - could be more accurate)
                cursor.execute("""
                    SELECT COUNT(DISTINCT domain) FROM url_checks 
                    WHERE DATE(created_at) = ?
                """, (today,))
                unique_domains = cursor.fetchone()[0]
                
                cursor.execute("""
                    UPDATE daily_stats SET
                        total_checks = ?, ok_checks = ?, warning_checks = ?,
                        danger_checks = ?, avg_processing_time_ms = ?, unique_domains = ?
                    WHERE date = ?
                """, (new_total, ok_checks, warning_checks, danger_checks, 
                     new_avg_time, unique_domains, today))
            
            else:
                # Insert new record
                ok_count = 1 if verdict == 'ok' else 0
                warning_count = 1 if verdict == 'warning' else 0
                danger_count = 1 if verdict == 'danger' else 0
                
                cursor.execute("""
                    INSERT INTO daily_stats (
                        date, total_checks, ok_checks, warning_checks, danger_checks,
                        avg_processing_time_ms, unique_domains
                    ) VALUES (?, 1, ?, ?, ?, ?, 1)
                """, (today, ok_count, warning_count, danger_count, processing_time_ms))
            
            conn.commit()
            cursor.close()
            
        except Exception as e:
            logger.error(f"Failed to update daily stats: {e}")
    
    def get_daily_stats(self, days: int = 7) -> List[Dict[str, Any]]:
        """Get daily statistics for the last N days"""
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            cutoff_date = (datetime.now() - timedelta(days=days)).date().isoformat()
            
            cursor.execute("""
                SELECT * FROM daily_stats 
                WHERE date >= ?
                ORDER BY date DESC
            """, (cutoff_date,))
            
            rows = cursor.fetchall()
            cursor.close()
            
            columns = ['date', 'total_checks', 'ok_checks', 'warning_checks', 
                      'danger_checks', 'avg_processing_time_ms', 'unique_domains', 'created_at']
            
            return [dict(zip(columns, row)) for row in rows]
            
        except Exception as e:
            logger.error(f"Failed to get daily stats: {e}")
            return []
    
    def get_recent_checks(self, limit: int = 100, user_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Get recent URL checks (without exposing actual URLs)"""
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            if user_id:
                cursor.execute("""
                    SELECT domain, verdict, reasons, tier0_score, 
                           processing_time_ms, created_at
                    FROM url_checks 
                    WHERE user_id = ?
                    ORDER BY created_at DESC 
                    LIMIT ?
                """, (user_id, limit))
            else:
                cursor.execute("""
                    SELECT domain, verdict, reasons, tier0_score,
                           processing_time_ms, created_at
                    FROM url_checks 
                    ORDER BY created_at DESC 
                    LIMIT ?
                """, (limit,))
            
            rows = cursor.fetchall()
            cursor.close()
            
            columns = ['domain', 'verdict', 'reasons', 'tier0_score', 
                      'processing_time_ms', 'created_at']
            
            results = []
            for row in rows:
                result = dict(zip(columns, row))
                # Parse JSON fields
                try:
                    result['reasons'] = json.loads(result['reasons'])
                except:
                    result['reasons'] = []
                results.append(result)
            
            return results
            
        except Exception as e:
            logger.error(f"Failed to get recent checks: {e}")
            return []
    
    def get_domain_stats(self, days: int = 30) -> List[Dict[str, Any]]:
        """Get domain-level statistics"""
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            cutoff_date = (datetime.now() - timedelta(days=days)).date().isoformat()
            
            cursor.execute("""
                SELECT domain, 
                       COUNT(*) as total_checks,
                       SUM(CASE WHEN verdict = 'ok' THEN 1 ELSE 0 END) as ok_checks,
                       SUM(CASE WHEN verdict = 'warning' THEN 1 ELSE 0 END) as warning_checks,
                       SUM(CASE WHEN verdict = 'danger' THEN 1 ELSE 0 END) as danger_checks,
                       AVG(tier0_score) as avg_score,
                       MAX(created_at) as last_check
                FROM url_checks
                WHERE DATE(created_at) >= ?
                GROUP BY domain
                ORDER BY total_checks DESC
                LIMIT 50
            """, (cutoff_date,))
            
            rows = cursor.fetchall()
            cursor.close()
            
            columns = ['domain', 'total_checks', 'ok_checks', 'warning_checks',
                      'danger_checks', 'avg_score', 'last_check']
            
            return [dict(zip(columns, row)) for row in rows]
            
        except Exception as e:
            logger.error(f"Failed to get domain stats: {e}")
            return []
    
    def cleanup_old_records(self, days: int = 30) -> int:
        """Delete URL check records older than N days"""
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            cutoff_date = (datetime.now() - timedelta(days=days)).isoformat()
            
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
            
            # Get table sizes
            cursor.execute("SELECT COUNT(*) FROM url_checks")
            total_checks = cursor.fetchone()[0]
            
            cursor.execute("SELECT COUNT(*) FROM daily_stats")
            total_daily_records = cursor.fetchone()[0]
            
            # Get database file size
            db_size = self.db_path.stat().st_size if self.db_path.exists() else 0
            
            # Get date range
            cursor.execute("""
                SELECT MIN(created_at), MAX(created_at) 
                FROM url_checks
            """)
            date_range = cursor.fetchone()
            
            cursor.close()
            
            return {
                "database_path": str(self.db_path),
                "database_size_bytes": db_size,
                "database_size_mb": round(db_size / 1024 / 1024, 2),
                "total_url_checks": total_checks,
                "total_daily_records": total_daily_records,
                "date_range": {
                    "first_check": date_range[0],
                    "last_check": date_range[1]
                },
                "tables": ["url_checks", "daily_stats"]
            }
            
        except Exception as e:
            logger.error(f"Failed to get database info: {e}")
            return {"error": str(e)}


# Global database instance
db_service = DatabaseService()


# Utility functions for easy access
def log_url_check(url: str, domain: str, verdict: str, reasons: List[str], 
                 tier0_score: int, analysis_details: Dict[str, Any],
                 processing_time_ms: int, fetch_time_ms: int = 0,
                 user_id: Optional[str] = None, source: str = "extension") -> bool:
    """Convenience function to log a URL check"""
    return db_service.log_url_check(
        url, domain, verdict, reasons, tier0_score, analysis_details,
        processing_time_ms, fetch_time_ms, user_id, source
    )


def get_daily_stats(days: int = 7) -> List[Dict[str, Any]]:
    """Convenience function to get daily stats"""
    return db_service.get_daily_stats(days)


def cleanup_old_records(days: int = 30) -> int:
    """Convenience function to cleanup old records"""
    return db_service.cleanup_old_records(days)