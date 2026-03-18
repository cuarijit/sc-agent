from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query
from fastapi import Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from .database import SessionLocal
from .schemas import (
    AutonomousExecuteRequest,
    AutonomousResponse,
    ChatbotFeedbackRequest,
    ChatbotFeedbackResponse,
    ChatbotRequest,
    ChatbotResponse,
    ChatRequest,
    ChatResponse,
    DashboardResponse,
    DemoAlertsResponse,
    DemoOrdersResponse,
    DemoResetResponse,
    DocumentSearchResponse,
    FilterState,
    LlmConnectionTestRequest,
    LlmConnectionTestResponse,
    LlmOptionsResponse,
    ParameterApplyResponse,
    ParameterValueBulkApplyRequest,
    ParameterValueMutationResponse,
    ParameterValuePasteRequest,
    ParameterValueRecord,
    ParameterRecommendationRunRequest,
    ParameterValueUpdateRequest,
    NetworkAgentRequest,
    NetworkAgentResponse,
    NetworkBaselineResponse,
    NetworkChangeRequest,
    NetworkOptionsResponse,
    NetworkViewResponse,
    NetworkScenarioCreateRequest,
    NetworkScenarioDetailResponse,
    NetworkImpactedSkuRecord,
    NetworkScenarioResponse,
    NetworkScenarioUpdateRequest,
    NetworkSimulationResponse,
    ReplenishmentOrdersResponse,
    ReplenishmentOrderDetailsResponse,
    ReplenishmentOrderCreateRequest,
    ReplenishmentOrderUpdateRequest,
    ReplenishmentOrderMutationResponse,
    InventoryProjectionResponse,
    ProjectedInventoryAlertRecord,
    InventorySimulationSaveRequest,
    InventorySimulationSaveResponse,
    ScenarioRequest,
    ScenarioResponse,
    SkuDetailResponse,
)
from .services.chatbot_service import ChatbotService
from .services.inventory_projection_service import InventoryProjectionService
from .services.document_search_service import index_documents, search_documents
from .services.llm_service import llm_options_payload, resolve_llm_selection, test_llm_connection
from .services.network_service import NetworkService
from .services.planning_service import PlanningService
from .services.seed_loader import init_database, reset_and_seed, reseed_network_only


@asynccontextmanager
async def lifespan(app: FastAPI):
    db = SessionLocal()
    try:
        init_database(db)
    finally:
        db.close()
    yield


app = FastAPI(title="MEIO Inventory Optimization API", version="0.2.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


def get_db_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_service() -> PlanningService:
    db = SessionLocal()
    try:
        yield PlanningService(db)
    finally:
        db.close()


def get_network_service() -> NetworkService:
    db = SessionLocal()
    try:
        yield NetworkService(db)
    finally:
        db.close()


def get_inventory_projection_service() -> InventoryProjectionService:
    db = SessionLocal()
    try:
        yield InventoryProjectionService(db)
    finally:
        db.close()


def get_chatbot_service() -> ChatbotService:
    db = SessionLocal()
    try:
        yield ChatbotService(db)
    finally:
        db.close()


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "date": "2026-03-08"}


@app.get("/alerts", response_model=DemoAlertsResponse)
def demo_alerts(service: NetworkService = Depends(get_network_service)) -> dict[str, object]:
    return service.get_demo_alerts()


@app.get("/orders", response_model=DemoOrdersResponse)
def demo_orders(
    region: list[str] | None = Query(default=None),
    location: list[str] | None = Query(default=None),
    sku: list[str] | None = Query(default=None),
    alert_id: list[str] | None = Query(default=None),
    order_id: list[str] | None = Query(default=None),
    order_type: list[str] | None = Query(default=None),
    status: list[str] | None = Query(default=None),
    exception_reason: list[str] | None = Query(default=None),
    ship_from_node_id: list[str] | None = Query(default=None),
    ship_to_node_id: list[str] | None = Query(default=None),
    exception_only: bool = False,
    service: PlanningService = Depends(get_service),
) -> dict[str, object]:
    filters = FilterState(
        region=region,
        location=location,
        sku=sku,
        alert_id=alert_id,
        order_id=order_id,
        order_type=order_type,
        status=status,
        exception_reason=exception_reason,
        ship_from_node_id=ship_from_node_id,
        ship_to_node_id=ship_to_node_id,
    )
    return service.get_replenishment_orders(filters.model_dump(), exception_only=exception_only)


@app.post("/orders", response_model=ReplenishmentOrderMutationResponse)
def demo_create_order(
    payload: ReplenishmentOrderCreateRequest,
    service: PlanningService = Depends(get_service),
) -> dict[str, object]:
    try:
        return service.create_replenishment_order(payload.model_dump())
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.patch("/orders/{order_id}", response_model=ReplenishmentOrderMutationResponse)
def demo_update_order(
    order_id: str,
    payload: ReplenishmentOrderUpdateRequest,
    service: PlanningService = Depends(get_service),
) -> dict[str, object]:
    try:
        return service.update_replenishment_order(order_id, payload.model_dump(exclude_none=True))
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.get("/projected-inventory", response_model=InventoryProjectionResponse)
def demo_projected_inventory(
    sku: str = Query(...),
    location: str | None = None,
    scenario_id: str | None = None,
    service: InventoryProjectionService = Depends(get_inventory_projection_service),
) -> dict[str, object]:
    try:
        return service.get_projection(sku=sku, location=location, scenario_id=scenario_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.get("/projected-inventory/alerts", response_model=list[ProjectedInventoryAlertRecord])
def projected_inventory_alerts(
    sku: str = Query(...),
    location: str = Query(...),
    include_archived: bool = False,
    match_scope: str = Query("all"),
    service: NetworkService = Depends(get_network_service),
) -> list[dict[str, object]]:
    return service.get_alerts_for_sku_node(
        sku=sku,
        node=location,
        include_archived=include_archived,
        match_scope=match_scope,
    )


@app.post("/agent", response_model=NetworkAgentResponse)
def demo_agent(
    payload: NetworkAgentRequest,
    service: NetworkService = Depends(get_network_service),
) -> dict[str, object]:
    return service.analyze_network_question(payload.model_dump())


@app.post("/autonomous", response_model=AutonomousResponse)
def run_autonomous(
    payload: AutonomousExecuteRequest,
    service: NetworkService = Depends(get_network_service),
) -> dict[str, object]:
    return service.execute_autonomous(payload.model_dump())


@app.get("/autonomous", response_model=AutonomousResponse)
def get_autonomous(service: NetworkService = Depends(get_network_service)) -> dict[str, object]:
    return service.get_autonomous_runs(enabled=True)


@app.post("/demo/reset", response_model=DemoResetResponse)
def demo_reset(db: Session = Depends(get_db_session)) -> dict[str, object]:
    stats = reset_and_seed(db)
    return {"status": "ok", "message": "Demo data reset to baseline seed.", "seeded": stats}


@app.post("/api/runs/plan")
def create_run(service: PlanningService = Depends(get_service)) -> dict[str, object]:
    return service.create_run()


@app.get("/api/runs/{run_id}")
def get_run(run_id: str) -> dict[str, object]:
    return {"run_id": run_id, "status": "available"}


@app.get("/api/dashboard/stockouts", response_model=DashboardResponse)
def get_dashboard(
    run_id: list[str] | None = Query(default=None),
    region: list[str] | None = Query(default=None),
    location: list[str] | None = Query(default=None),
    sku: list[str] | None = Query(default=None),
    category: list[str] | None = Query(default=None),
    supplier: list[str] | None = Query(default=None),
    exception_status: list[str] | None = Query(default=None),
    service: PlanningService = Depends(get_service),
) -> dict[str, object]:
    filters = FilterState(
        run_id=run_id,
        region=region,
        location=location,
        sku=sku,
        category=category,
        supplier=supplier,
        exception_status=exception_status,
    )
    return service.get_dashboard(filters.model_dump())


@app.get("/api/skus/{sku}/locations/{location}", response_model=SkuDetailResponse)
def get_sku_detail(
    sku: str,
    location: str,
    run_id: str | None = None,
    service: PlanningService = Depends(get_service),
) -> dict[str, object]:
    try:
        return service.get_sku_detail(sku, location, run_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.post("/api/scenarios/evaluate", response_model=ScenarioResponse)
def evaluate_scenario(
    payload: ScenarioRequest,
    service: PlanningService = Depends(get_service),
) -> dict[str, object]:
    return service.evaluate_scenario(payload.model_dump())


@app.post("/api/chat/explain", response_model=ChatResponse)
def explain(
    payload: ChatRequest,
    service: PlanningService = Depends(get_service),
) -> dict[str, object]:
    return service.explain(
        payload.question,
        payload.sku,
        payload.location,
        payload.llm_provider,
        payload.llm_model,
    )


@app.get("/api/parameters/effective")
def get_effective_parameters(
    sku: str = Query(...),
    location: str = Query(...),
    service: PlanningService = Depends(get_service),
) -> list[dict[str, object]]:
    return service.get_effective_values(sku, location)


@app.get("/api/parameters/values", response_model=list[ParameterValueRecord])
def get_parameter_values(
    sku: list[str] | None = Query(default=None),
    location: list[str] | None = Query(default=None),
    region: list[str] | None = Query(default=None),
    parameter_code: list[str] | None = Query(default=None),
    issue_type: list[str] | None = Query(default=None),
    service: PlanningService = Depends(get_service),
) -> list[dict[str, object]]:
    return service.get_parameter_values(
        {
            "sku": sku,
            "location": location,
            "region": region,
            "parameter_code": parameter_code,
            "issue_type": issue_type,
        }
    )


@app.get("/api/parameters/exceptions")
def get_parameter_exceptions(
    sku: list[str] | None = Query(default=None),
    location: list[str] | None = Query(default=None),
    region: list[str] | None = Query(default=None),
    exception_status: list[str] | None = Query(default=None),
    recommendation_id: list[str] | None = Query(default=None),
    parameter_code: list[str] | None = Query(default=None),
    issue_type: list[str] | None = Query(default=None),
    service: PlanningService = Depends(get_service),
) -> list[dict[str, object]]:
    filters = FilterState(
        sku=sku,
        location=location,
        region=region,
        exception_status=exception_status,
        recommendation_id=recommendation_id,
        parameter_code=parameter_code,
        issue_type=issue_type,
    )
    return service.get_parameter_exceptions(filters.model_dump())


@app.post("/api/parameters/recommendations/run")
def run_parameter_recommendations(
    payload: ParameterRecommendationRunRequest,
    service: PlanningService = Depends(get_service),
) -> dict[str, object]:
    return service.run_parameter_recommendations(payload.model_dump())


@app.post("/api/parameters/recommendations/{recommendation_id}/apply", response_model=ParameterApplyResponse)
def apply_parameter_recommendation(
    recommendation_id: str,
    service: PlanningService = Depends(get_service),
) -> dict[str, object]:
    try:
        return service.apply_parameter_recommendation(recommendation_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=f"Recommendation not found: {recommendation_id}") from error


@app.patch("/api/parameters/values/{row_id}", response_model=ParameterValueRecord)
def update_parameter_value(
    row_id: int,
    payload: ParameterValueUpdateRequest,
    service: PlanningService = Depends(get_service),
) -> dict[str, object]:
    try:
        return service.update_parameter_value(row_id, payload.model_dump())
    except KeyError as error:
        raise HTTPException(status_code=404, detail=f"Parameter row not found: {row_id}") from error


@app.post("/api/parameters/values/bulk-apply", response_model=ParameterValueMutationResponse)
def bulk_apply_parameter_values(
    payload: ParameterValueBulkApplyRequest,
    service: PlanningService = Depends(get_service),
) -> dict[str, object]:
    return service.bulk_apply_parameter_values(payload.model_dump())


@app.post("/api/parameters/values/paste", response_model=ParameterValueMutationResponse)
def paste_parameter_values(
    payload: ParameterValuePasteRequest,
    service: PlanningService = Depends(get_service),
) -> dict[str, object]:
    return service.paste_parameter_values(payload.model_dump())


@app.post("/api/parameters/chat", response_model=ChatResponse)
def parameter_chat(
    payload: ChatRequest,
    service: PlanningService = Depends(get_service),
) -> dict[str, object]:
    return service.parameter_chat(payload.question, payload.llm_provider, payload.llm_model)


@app.post("/api/chatbot/query", response_model=ChatbotResponse)
def chatbot_query(
    payload: ChatbotRequest,
    service: ChatbotService = Depends(get_chatbot_service),
) -> dict[str, object]:
    return service.query(
        message=payload.message,
        conversation_id=payload.conversation_id,
        context_cursor=payload.context_cursor,
        assistant_mode=payload.assistant_mode,
        llm_provider=payload.llm_provider,
        llm_model=payload.llm_model,
        openai_api_key=payload.openai_api_key,
    )


@app.post("/api/chatbot/followup", response_model=ChatbotResponse)
def chatbot_followup(
    payload: ChatbotRequest,
    service: ChatbotService = Depends(get_chatbot_service),
) -> dict[str, object]:
    return service.follow_up(
        message=payload.message,
        conversation_id=payload.conversation_id or "",
        context_cursor=payload.context_cursor,
        assistant_mode=payload.assistant_mode,
        llm_provider=payload.llm_provider,
        llm_model=payload.llm_model,
        openai_api_key=payload.openai_api_key,
    )


@app.post("/api/chatbot/feedback", response_model=ChatbotFeedbackResponse)
def chatbot_feedback(
    payload: ChatbotFeedbackRequest,
    service: ChatbotService = Depends(get_chatbot_service),
) -> dict[str, object]:
    if payload.vote not in {"up", "down"}:
        raise HTTPException(status_code=400, detail="vote must be either 'up' or 'down'.")
    if not payload.conversation_id.strip():
        raise HTTPException(status_code=400, detail="conversation_id is required.")
    if not payload.answer_text.strip():
        raise HTTPException(status_code=400, detail="answer_text is required.")
    return service.save_feedback(
        conversation_id=payload.conversation_id,
        vote=payload.vote,
        answer_text=payload.answer_text,
        generated_sql=payload.generated_sql,
        user_message=payload.user_message,
    )


@app.post("/api/documents/ingest")
def ingest_documents(db: Session = Depends(get_db_session)) -> dict[str, object]:
    stats = reset_and_seed(db)
    es_stats = index_documents(db)
    return {
        "indexed_documents": stats["documents"],
        "chunk_count": stats["chunks"],
        "search_indexed_documents": es_stats["indexed_documents"],
        "message": "SQLite documents reindexed from seed files and pushed to Elasticsearch when available.",
    }


@app.get("/api/documents/search", response_model=DocumentSearchResponse)
def document_search(
    query: str = Query(..., min_length=2),
    vendor: str | None = None,
    db: Session = Depends(get_db_session),
) -> dict[str, object]:
    return {"results": search_documents(db, query, vendor)}


@app.get("/api/llm/options", response_model=LlmOptionsResponse)
def llm_options() -> dict[str, object]:
    return llm_options_payload()


@app.post("/api/llm/test", response_model=LlmConnectionTestResponse)
def llm_test_connection(payload: LlmConnectionTestRequest) -> dict[str, object]:
    provider, model = resolve_llm_selection(payload.provider, payload.model)
    return test_llm_connection(provider=provider, model=model, api_key=payload.api_key)


@app.get("/api/master-data/options")
def get_master_data_options(service: PlanningService = Depends(get_service)) -> dict[str, object]:
    return service.get_master_data_options()


@app.get("/api/master-data/search")
def search_master_data(
    query: str = Query(..., min_length=1),
    service: PlanningService = Depends(get_service),
) -> dict[str, object]:
    return service.search_master_data(query)


@app.get("/api/replenishment/orders", response_model=ReplenishmentOrdersResponse)
def replenishment_orders(
    region: list[str] | None = Query(default=None),
    location: list[str] | None = Query(default=None),
    sku: list[str] | None = Query(default=None),
    alert_id: list[str] | None = Query(default=None),
    order_id: list[str] | None = Query(default=None),
    order_type: list[str] | None = Query(default=None),
    status: list[str] | None = Query(default=None),
    exception_reason: list[str] | None = Query(default=None),
    ship_from_node_id: list[str] | None = Query(default=None),
    ship_to_node_id: list[str] | None = Query(default=None),
    exception_only: bool = False,
    service: PlanningService = Depends(get_service),
) -> dict[str, object]:
    filters = FilterState(
        region=region,
        location=location,
        sku=sku,
        alert_id=alert_id,
        order_id=order_id,
        order_type=order_type,
        status=status,
        exception_reason=exception_reason,
        ship_from_node_id=ship_from_node_id,
        ship_to_node_id=ship_to_node_id,
    )
    return service.get_replenishment_orders(filters.model_dump(), exception_only=exception_only)


@app.get("/api/replenishment/order-details", response_model=ReplenishmentOrderDetailsResponse)
def replenishment_order_details(
    region: list[str] | None = Query(default=None),
    location: list[str] | None = Query(default=None),
    sku: list[str] | None = Query(default=None),
    alert_id: list[str] | None = Query(default=None),
    order_id: list[str] | None = Query(default=None),
    order_type: list[str] | None = Query(default=None),
    status: list[str] | None = Query(default=None),
    exception_reason: list[str] | None = Query(default=None),
    ship_from_node_id: list[str] | None = Query(default=None),
    ship_to_node_id: list[str] | None = Query(default=None),
    exception_only: bool = False,
    service: PlanningService = Depends(get_service),
) -> dict[str, object]:
    filters = FilterState(
        region=region,
        location=location,
        sku=sku,
        alert_id=alert_id,
        order_id=order_id,
        order_type=order_type,
        status=status,
        exception_reason=exception_reason,
        ship_from_node_id=ship_from_node_id,
        ship_to_node_id=ship_to_node_id,
    )
    return service.get_replenishment_order_details(
        filters.model_dump(),
        exception_only=exception_only,
        order_id=order_id,
    )


@app.post("/api/replenishment/orders", response_model=ReplenishmentOrderMutationResponse)
@app.post("/api/replenishment/order-details", response_model=ReplenishmentOrderMutationResponse)
def create_replenishment_order(
    payload: ReplenishmentOrderCreateRequest,
    service: PlanningService = Depends(get_service),
) -> dict[str, object]:
    try:
        return service.create_replenishment_order(payload.model_dump())
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.patch("/api/replenishment/orders/{order_id}", response_model=ReplenishmentOrderMutationResponse)
@app.patch("/api/replenishment/order-details/{order_id}", response_model=ReplenishmentOrderMutationResponse)
@app.patch("/api/replenishment/order/{order_id}", response_model=ReplenishmentOrderMutationResponse)
def update_replenishment_order(
    order_id: str,
    payload: ReplenishmentOrderUpdateRequest,
    service: PlanningService = Depends(get_service),
) -> dict[str, object]:
    try:
        return service.update_replenishment_order(order_id, payload.model_dump(exclude_none=True))
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.get("/api/inventory-projection/{sku}", response_model=InventoryProjectionResponse)
def inventory_projection(
    sku: str,
    location: str | None = None,
    scenario_id: str | None = None,
    service: InventoryProjectionService = Depends(get_inventory_projection_service),
) -> dict[str, object]:
    try:
        return service.get_projection(sku=sku, location=location, scenario_id=scenario_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.get("/api/inventory-projection-alerts", response_model=list[ProjectedInventoryAlertRecord])
def api_inventory_projection_alerts(
    sku: str = Query(...),
    location: str = Query(...),
    include_archived: bool = False,
    match_scope: str = Query("all"),
    service: NetworkService = Depends(get_network_service),
) -> list[dict[str, object]]:
    return service.get_alerts_for_sku_node(
        sku=sku,
        node=location,
        include_archived=include_archived,
        match_scope=match_scope,
    )


@app.post("/api/simulation/save", response_model=InventorySimulationSaveResponse)
def save_inventory_simulation(
    payload: InventorySimulationSaveRequest,
    service: InventoryProjectionService = Depends(get_inventory_projection_service),
) -> dict[str, object]:
    return service.save_scenario(
        sku=payload.sku,
        location=payload.location,
        user_id=payload.user_id,
        overrides=[item.model_dump() for item in payload.overrides],
        scenario_id=payload.scenario_id,
    )


@app.get("/api/network/baseline", response_model=NetworkBaselineResponse)
def network_baseline(
    region: str | None = None,
    product: str | None = None,
    scenario_id: str | None = None,
    alert_id: list[str] | None = Query(default=None),
    alert_type: list[str] | None = Query(default=None),
    severity: list[str] | None = Query(default=None),
    service: NetworkService = Depends(get_network_service),
) -> dict[str, object]:
    return service.get_baseline_network(
        region=region,
        product=product,
        scenario_id=scenario_id,
        alert_id=alert_id,
        alert_type=alert_type,
        severity=severity,
    )


@app.get("/api/network/options", response_model=NetworkOptionsResponse)
def network_options(service: NetworkService = Depends(get_network_service)) -> dict[str, object]:
    return service.get_network_options()


@app.get("/api/network/view", response_model=NetworkViewResponse)
def network_view(
    sku: str | None = None,
    node: str | None = None,
    alert_id: str | None = None,
    weeks_of_coverage: int = 8,
    service: NetworkService = Depends(get_network_service),
) -> dict[str, object]:
    return service.get_network_view(sku=sku, node=node, alert_id=alert_id, weeks_of_coverage=weeks_of_coverage)


@app.post("/api/network/reseed")
def network_reseed(db: Session = Depends(get_db_session)) -> dict[str, object]:
    """Clear network_nodes, network_sourcing_rules, network_lanes, and related tables; repopulate with demo data (1 plant, 2 CDCs, 5 RDCs, 35 stores, single sourcing)."""
    return reseed_network_only(db)


@app.post("/api/network/scenarios", response_model=NetworkScenarioResponse)
def create_network_scenario(
    payload: NetworkScenarioCreateRequest,
    service: NetworkService = Depends(get_network_service),
) -> dict[str, object]:
    return service.create_network_scenario(payload.model_dump())


@app.get("/api/network/scenarios/{scenario_id}", response_model=NetworkScenarioDetailResponse)
def get_network_scenario(
    scenario_id: str,
    service: NetworkService = Depends(get_network_service),
) -> dict[str, object]:
    try:
        return service.get_network_scenario(scenario_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=f"Network scenario not found: {scenario_id}") from error


@app.patch("/api/network/scenarios/{scenario_id}", response_model=NetworkScenarioResponse)
def update_network_scenario(
    scenario_id: str,
    payload: NetworkScenarioUpdateRequest,
    service: NetworkService = Depends(get_network_service),
) -> dict[str, object]:
    try:
        return service.update_network_scenario(scenario_id, payload.model_dump(exclude_none=True))
    except KeyError as error:
        raise HTTPException(status_code=404, detail=f"Network scenario not found: {scenario_id}") from error


@app.post("/api/network/scenarios/{scenario_id}/changes")
def apply_network_change(
    scenario_id: str,
    payload: NetworkChangeRequest,
    service: NetworkService = Depends(get_network_service),
) -> dict[str, object]:
    try:
        return service.apply_network_change(scenario_id, payload.model_dump())
    except KeyError as error:
        raise HTTPException(status_code=404, detail=f"Network scenario not found: {scenario_id}") from error


@app.post("/api/network/scenarios/{scenario_id}/simulate", response_model=NetworkSimulationResponse)
def simulate_network_scenario(
    scenario_id: str,
    service: NetworkService = Depends(get_network_service),
) -> dict[str, object]:
    try:
        return service.simulate_network_scenario(scenario_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=f"Network scenario not found: {scenario_id}") from error


@app.post("/api/network/scenarios/{scenario_id}/save")
def save_network_scenario(
    scenario_id: str,
    service: NetworkService = Depends(get_network_service),
) -> dict[str, object]:
    try:
        return service.save_network_scenario(scenario_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=f"Network scenario not found: {scenario_id}") from error


@app.post("/api/network/agent/analyze", response_model=NetworkAgentResponse)
def analyze_network(
    payload: NetworkAgentRequest,
    service: NetworkService = Depends(get_network_service),
) -> dict[str, object]:
    return service.analyze_network_question(payload.model_dump())


@app.get("/api/network/alerts/{alert_id}/impacted-skus", response_model=list[NetworkImpactedSkuRecord])
def network_alert_impacted_skus(
    alert_id: str,
    service: NetworkService = Depends(get_network_service),
) -> list[dict[str, object]]:
    try:
        return service.get_alert_impacted_skus(alert_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=f"Network alert not found: {alert_id}") from error
