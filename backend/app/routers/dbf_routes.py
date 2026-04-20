"""Puls8 DBF FastAPI router."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models import (
    DbfConsumptionForecast,
    DbfDriverDisplay,
    DbfDriverDistribution,
    DbfDriverFeature,
    DbfDriverPrice,
    DbfShipmentForecast,
)
from ..services.dbf import DbfAccuracy, DbfScenarios, PRODUCTION_SCENARIO_ID

router = APIRouter()


def _db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ── Scenarios ────────────────────────────────────────────────────────


@router.get("/api/dbf/scenarios")
def list_scenarios(db: Session = Depends(_db)):
    return {"scenarios": DbfScenarios(db).list_scenarios()}


@router.get("/api/dbf/scenarios/{scenario_id}")
def get_scenario(scenario_id: str, db: Session = Depends(_db)):
    rec = DbfScenarios(db).get(scenario_id)
    if rec is None:
        raise HTTPException(status_code=404, detail="scenario not found")
    return rec


@router.post("/api/dbf/scenarios")
def create_scenario(payload: dict, db: Session = Depends(_db)):
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name required")
    try:
        return DbfScenarios(db).create(
            name=name,
            description=payload.get("description") or "",
            parent_scenario_id=payload.get("parent_scenario_id"),
            created_by=payload.get("created_by") or "system",
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.delete("/api/dbf/scenarios/{scenario_id}")
def delete_scenario(scenario_id: str, db: Session = Depends(_db)):
    try:
        ok = DbfScenarios(db).delete(scenario_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    if not ok:
        raise HTTPException(status_code=404, detail="scenario not found")
    return {"deleted": scenario_id}


@router.patch("/api/dbf/scenarios/{scenario_id}/drivers")
def patch_drivers(scenario_id: str, payload: dict, db: Session = Depends(_db)):
    adjustments = payload.get("adjustments") or []
    if not isinstance(adjustments, list):
        raise HTTPException(status_code=400, detail="adjustments must be a list")
    try:
        return DbfScenarios(db).apply_driver_adjustments(scenario_id, adjustments)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.patch("/api/dbf/scenarios/{scenario_id}/consumption-adjust")
def patch_consumption(scenario_id: str, payload: dict, db: Session = Depends(_db)):
    adjustments = payload.get("adjustments") or []
    if not isinstance(adjustments, list):
        raise HTTPException(status_code=400, detail="adjustments must be a list")
    try:
        return DbfScenarios(db).apply_consumption_adjustments(scenario_id, adjustments)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/api/dbf/scenarios/{scenario_id}/publish")
def publish_scenario(scenario_id: str, db: Session = Depends(_db)):
    try:
        return DbfScenarios(db).publish(scenario_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


# ── Driver / consumption / shipment reads ───────────────────────────


@router.get("/api/dbf/drivers")
def get_drivers(
    scenario_id: str = Query(default=PRODUCTION_SCENARIO_ID),
    sku: str | None = None,
    customer: str | None = None,
    week_from: str | None = None,
    week_to: str | None = None,
    db: Session = Depends(_db),
):
    out: dict[str, list[dict[str, Any]]] = {"price": [], "distribution": [], "display": [], "feature": []}
    for model, key in (
        (DbfDriverPrice, "price"),
        (DbfDriverDistribution, "distribution"),
        (DbfDriverDisplay, "display"),
        (DbfDriverFeature, "feature"),
    ):
        q = db.query(model).filter(model.scenario_id == scenario_id)
        if sku:
            q = q.filter(model.sku == sku)
        if customer:
            q = q.filter(model.customer_id == customer)
        if week_from:
            q = q.filter(model.week_start >= week_from)
        if week_to:
            q = q.filter(model.week_start <= week_to)
        for r in q.all():
            row = {c.name: getattr(r, c.name) for c in r.__table__.columns}
            out[key].append(row)
    return out


@router.get("/api/dbf/consumption")
def get_consumption(
    scenario_id: str = Query(default=PRODUCTION_SCENARIO_ID),
    sku: str | None = None,
    customer: str | None = None,
    db: Session = Depends(_db),
):
    q = db.query(DbfConsumptionForecast).filter(DbfConsumptionForecast.scenario_id == scenario_id)
    if sku:
        q = q.filter(DbfConsumptionForecast.sku == sku)
    if customer:
        q = q.filter(DbfConsumptionForecast.customer_id == customer)
    rows = [
        {c.name: getattr(r, c.name) for c in r.__table__.columns}
        for r in q.order_by(DbfConsumptionForecast.week_start.asc()).all()
    ]
    return {"rows": rows, "total": len(rows)}


@router.get("/api/dbf/shipment")
def get_shipment(
    scenario_id: str = Query(default=PRODUCTION_SCENARIO_ID),
    sku: str | None = None,
    customer: str | None = None,
    location: str | None = None,
    db: Session = Depends(_db),
):
    q = db.query(DbfShipmentForecast).filter(DbfShipmentForecast.scenario_id == scenario_id)
    if sku:
        q = q.filter(DbfShipmentForecast.sku == sku)
    if customer:
        q = q.filter(DbfShipmentForecast.customer_id == customer)
    if location:
        q = q.filter(DbfShipmentForecast.location == location)
    rows = [
        {c.name: getattr(r, c.name) for c in r.__table__.columns}
        for r in q.order_by(DbfShipmentForecast.week_start.asc()).all()
    ]
    return {"rows": rows, "total": len(rows)}


# ── Accuracy ─────────────────────────────────────────────────────────


@router.get("/api/dbf/accuracy/{tier}")
def get_accuracy(
    tier: str,
    scenario_id: str = Query(default=PRODUCTION_SCENARIO_ID),
    db: Session = Depends(_db),
):
    if tier not in {"driver", "consumption", "shipment"}:
        raise HTTPException(status_code=400, detail="tier must be driver|consumption|shipment")
    svc = DbfAccuracy(db)
    return {
        "overall": svc.overall(scenario_id, tier),
        "trend": svc.trend(scenario_id, tier),
        "detail": svc.detail(scenario_id, tier),
    }


# ── Reference data ───────────────────────────────────────────────────


@router.get("/api/dbf/reference")
def get_reference(db: Session = Depends(_db)):
    """Returns SKUs/customers/locations seeded for DBF so the frontend
    selectors don't have to query masters separately."""
    skus = sorted({r[0] for r in db.query(DbfConsumptionForecast.sku).distinct().all()})
    customers = sorted({r[0] for r in db.query(DbfConsumptionForecast.customer_id).distinct().all()})
    locations = sorted({r[0] for r in db.query(DbfShipmentForecast.location).distinct().all()})
    return {"skus": skus, "customers": customers, "locations": locations}
