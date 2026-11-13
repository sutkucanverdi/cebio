"""Yönetim komutları.

    python -m app.cli grant-premium kisi@ornek.com --days 30      # promosyon / test için premium ver
    python -m app.cli revoke-premium kisi@ornek.com               # premium'u kaldır
    python -m app.cli plan kisi@ornek.com                          # plan ve bu ayki kullanımı göster
    python -m app.cli ai-reports --limit 20                        # bildirilen yapay zeka cevapları (moderasyon)

backend/ klasöründen çalıştırın. Hangi veritabanına bağlanılacağı DATABASE_URL ile belirlenir.
"""
import argparse
import sys
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.core.database import SessionLocal
from app.core.migrations import run_migrations
from app.models.ai_report import AIReport
from app.models.user import User
from app.services.billing import grant_premium, plan_status


def _user(db, email: str) -> User:  # type: ignore[no-untyped-def]
    user = db.scalars(select(User).where(User.email == email.strip().lower())).first()
    if user is None:
        sys.exit(f"Kullanıcı bulunamadı: {email}")
    return user


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli", description="Cebio yönetim komutları")
    sub = parser.add_subparsers(dest="command", required=True)

    grant = sub.add_parser("grant-premium", help="Kullanıcıya belirli süre premium ver")
    grant.add_argument("email")
    grant.add_argument("--days", type=int, default=30)
    grant.add_argument("--source", default="promo", choices=["promo", "admin"])

    revoke = sub.add_parser("revoke-premium", help="Premium'u hemen kaldır")
    revoke.add_argument("email")

    show = sub.add_parser("plan", help="Plan ve kullanım durumunu göster")
    show.add_argument("email")

    reports = sub.add_parser("ai-reports", help="Kullanıcıların bildirdiği yapay zeka cevaplarını listele")
    reports.add_argument("--limit", type=int, default=20)

    args = parser.parse_args(argv)
    run_migrations()

    if args.command == "ai-reports":
        with SessionLocal() as db:
            rows = db.scalars(select(AIReport).order_by(AIReport.id.desc()).limit(args.limit)).all()
            if not rows:
                print("Bildirilmiş yapay zeka cevabı yok.")
            for r in rows:
                print(f"#{r.id} {r.created_at:%Y-%m-%d %H:%M} kullanıcı={r.user_id} sebep={r.reason}")
                if r.note:
                    print(f"   not: {r.note}")
                print("   " + " ".join(r.content[:300].split()))
        return

    with SessionLocal() as db:
        user = _user(db, args.email)
        if args.command == "grant-premium":
            if args.days <= 0:
                sys.exit("--days pozitif olmalı.")
            until = datetime.now(timezone.utc) + timedelta(days=args.days)
            grant_premium(db, user, until, args.source)
            print(f"{user.email}: premium {until:%Y-%m-%d %H:%M} UTC tarihine kadar ({args.source}).")
        elif args.command == "revoke-premium":
            grant_premium(db, user, datetime.now(timezone.utc), "admin")
            print(f"{user.email}: premium kaldırıldı.")
        status = plan_status(db, user)
        print(f"Plan: {status['plan']}  (dönem {status['period']}, yenilenme {status['resets_on']})")
        for f in status["features"]:
            print(f"  - {f['label']}: {f['used']}/{f['limit']}")


if __name__ == "__main__":
    main()
