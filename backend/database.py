import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import URL, create_engine

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

password = os.getenv("POSTGRES_PASSWORD")
if not password:
    raise RuntimeError("Set POSTGRES_PASSWORD in the repository root .env file")

url = URL.create(
    "postgresql+psycopg",
    username=os.getenv("POSTGRES_USER", "ai_vault"),
    password=password,
    host=os.getenv("POSTGRES_HOST", "127.0.0.1"),
    port=int(os.getenv("POSTGRES_PORT", "5433")),
    database=os.getenv("POSTGRES_DB", "ai_vault"),
)

engine = create_engine(url, pool_pre_ping=True, connect_args={"connect_timeout": 3})
