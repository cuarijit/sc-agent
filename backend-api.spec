# -*- mode: python ; coding: utf-8 -*-
import os, glob

block_cipher = None

backend_root = os.path.join('.', 'backend')
app_root = os.path.join(backend_root, 'app')

datas = []

seed_dir = os.path.join(backend_root, 'data', 'seed')
if os.path.isdir(seed_dir):
    for f in glob.glob(os.path.join(seed_dir, '*')):
        datas.append((f, os.path.join('backend', 'data', 'seed')))

a = Analysis(
    ['backend/app/server_entry.py'],
    pathex=['.'],
    binaries=[],
    datas=datas,
    hiddenimports=[
        'backend',
        'backend.app',
        'backend.app.main',
        'backend.app.database',
        'backend.app.models',
        'backend.app.schemas',
        'backend.app.server_entry',
        'backend.app.services',
        'backend.app.services.chatbot_service',
        'backend.app.services.document_search_service',
        'backend.app.services.inventory_projection_service',
        'backend.app.services.llm_service',
        'backend.app.services.network_service',
        'backend.app.services.planning_service',
        'backend.app.services.rag_service',
        'backend.app.services.seed_loader',
        'backend.app.services.workflow_service',
        'uvicorn',
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        'uvicorn.lifespan.off',
        'fastapi',
        'fastapi.middleware',
        'fastapi.middleware.cors',
        'starlette',
        'starlette.responses',
        'starlette.routing',
        'starlette.middleware',
        'starlette.middleware.cors',
        'pydantic',
        'pydantic.deprecated',
        'pydantic.deprecated.decorator',
        'sqlalchemy',
        'sqlalchemy.sql.default_comparator',
        'sqlalchemy.dialects.sqlite',
        'sqlite3',
        'email.mime.text',
        'email.mime.multipart',
        'multiprocessing',
        'json',
        'csv',
        'tempfile',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter', 'matplotlib', 'PIL', 'numpy', 'pandas', 'scipy'],
    noarchive=False,
    optimize=0,
    cipher=block_cipher,
)

pyz = PYZ(a.pure, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='backend-api',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='backend-api',
)
