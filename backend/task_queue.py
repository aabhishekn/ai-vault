import os
from pathlib import Path

from dotenv import load_dotenv
from redis import Redis
from rq import Queue
from rq.serializers import JSONSerializer

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

redis_connection = Redis.from_url(
    os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0"),
    socket_connect_timeout=3,
)
document_queue = Queue(
    "documents",
    connection=redis_connection,
    serializer=JSONSerializer,
    default_timeout=300,
)
