"""Download API endpoints."""
from fastapi import Request
from fastapi.responses import JSONResponse


async def start_download(request: Request):
    """Start model download."""
    body = await request.json()
    task = await request.app.state.runtime_manager.model_manager.downloader.download(
        task_id=body.get("task_id"),
        model_id=body.get("model_id"),
        provider_id=body.get("provider_id"),
        url=body.get("url"),
        total_bytes=body.get("total_bytes", 0),
        checksum=body.get("checksum", ""),
        checksum_algorithm=body.get("checksum_algorithm", "sha256"),
    )
    return JSONResponse(content={"task_id": task.id, "status": task.status})


async def list_downloads(request: Request):
    """List active downloads."""
    downloads = request.app.state.runtime_manager.model_manager.downloader.list_active()
    return JSONResponse(content={
        "downloads": [
            {
                "id": d.id,
                "model_id": d.model_id,
                "status": d.status,
                "progress": d.downloaded_bytes / d.total_bytes if d.total_bytes > 0 else 0,
            }
            for d in downloads
        ]
    })
