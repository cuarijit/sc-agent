"""Driver / consumption / shipment accuracy aggregation."""

from __future__ import annotations

from collections import defaultdict
from sqlalchemy.orm import Session

from ...models import DbfAccuracySnapshot


class DbfAccuracy:
    def __init__(self, db: Session) -> None:
        self.db = db

    def overall(self, scenario_id: str, tier: str) -> dict:
        rows = (
            self.db.query(DbfAccuracySnapshot)
            .filter(
                DbfAccuracySnapshot.scenario_id == scenario_id,
                DbfAccuracySnapshot.tier == tier,
            )
            .all()
        )
        if not rows:
            return {"mape": 0.0, "bias": 0.0, "wmape": 0.0, "weeks": 0}
        mape = sum(r.mape for r in rows) / len(rows)
        bias = sum(r.bias for r in rows) / len(rows)
        wmape = sum(r.wmape for r in rows) / len(rows)
        return {
            "mape": round(mape, 2),
            "bias": round(bias, 2),
            "wmape": round(wmape, 2),
            "weeks": len({r.week_start for r in rows}),
        }

    def trend(self, scenario_id: str, tier: str) -> list[dict]:
        rows = (
            self.db.query(DbfAccuracySnapshot)
            .filter(
                DbfAccuracySnapshot.scenario_id == scenario_id,
                DbfAccuracySnapshot.tier == tier,
            )
            .order_by(DbfAccuracySnapshot.week_start.asc())
            .all()
        )
        bucket: dict[str, list[DbfAccuracySnapshot]] = defaultdict(list)
        for r in rows:
            bucket[r.week_start].append(r)
        out = []
        for week, items in sorted(bucket.items()):
            out.append(
                {
                    "week_start": week,
                    "mape": round(sum(i.mape for i in items) / len(items), 2),
                    "bias": round(sum(i.bias for i in items) / len(items), 2),
                    "wmape": round(sum(i.wmape for i in items) / len(items), 2),
                }
            )
        return out

    def detail(self, scenario_id: str, tier: str) -> list[dict]:
        rows = (
            self.db.query(DbfAccuracySnapshot)
            .filter(
                DbfAccuracySnapshot.scenario_id == scenario_id,
                DbfAccuracySnapshot.tier == tier,
            )
            .all()
        )
        agg: dict[str, dict] = {}
        for r in rows:
            cur = agg.setdefault(
                r.entity, {"entity": r.entity, "mape": 0.0, "bias": 0.0, "wmape": 0.0, "n": 0}
            )
            cur["mape"] += r.mape
            cur["bias"] += r.bias
            cur["wmape"] += r.wmape
            cur["n"] += 1
        out = []
        for k, v in agg.items():
            n = max(1, v["n"])
            out.append(
                {
                    "entity": v["entity"],
                    "mape": round(v["mape"] / n, 2),
                    "bias": round(v["bias"] / n, 2),
                    "wmape": round(v["wmape"] / n, 2),
                    "weeks": v["n"],
                }
            )
        return sorted(out, key=lambda r: r["mape"], reverse=True)
