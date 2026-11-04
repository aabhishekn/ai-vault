from sqlalchemy import create_engine

from app.core.config import database_url

url = database_url()
engine = create_engine(url, pool_pre_ping=True, connect_args={"connect_timeout": 3})
