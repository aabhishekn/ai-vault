from redis import Redis
from rq import Queue
from rq.serializers import JSONSerializer

from app.core.config import redis_url

redis_connection = Redis.from_url(redis_url(), socket_connect_timeout=3)
document_queue = Queue(
    "documents", connection=redis_connection, serializer=JSONSerializer, default_timeout=300
)
