from fastapi import FastAPI

app = FastAPI(title="AI Vault")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
