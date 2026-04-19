"""Inventory Diagnostic Agent — deterministic runtime package.

Only `intent_parser.py`, `followup_interpreter.py`, and `response_composer.py`
may import `app.services.llm_service`. Every other module here must be pure
Python / SQLAlchemy. A lint test enforces this boundary.
"""
