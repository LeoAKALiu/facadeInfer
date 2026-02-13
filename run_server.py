import os

import uvicorn


def main():
    """Run the integrated FastAPI server (API + built frontend)."""
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))
    reload = os.getenv("RELOAD", "").strip().lower() in {"1", "true", "yes", "y"}

    uvicorn.run(
        "api.index:app",
        host=host,
        port=port,
        reload=reload,
        log_level=os.getenv("LOG_LEVEL", "info"),
    )


if __name__ == "__main__":
    main()

