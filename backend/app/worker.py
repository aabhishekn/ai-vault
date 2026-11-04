import argparse

from rq import SpawnWorker
from rq.serializers import JSONSerializer

from app.core.logging import configure_logging
from app.tasks.queue import document_queue, redis_connection


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the AI Vault background worker")
    parser.add_argument("--burst", action="store_true", help="Process waiting jobs, then exit")
    args = parser.parse_args()
    configure_logging()
    worker = SpawnWorker([document_queue], connection=redis_connection, serializer=JSONSerializer)
    worker.work(burst=args.burst)


if __name__ == "__main__":
    main()
