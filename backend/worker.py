import argparse

from rq import SpawnWorker
from rq.serializers import JSONSerializer

from task_queue import document_queue, redis_connection


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run the AI Vault background worker")
    parser.add_argument(
        "--burst", action="store_true", help="Process waiting jobs, then exit"
    )
    args = parser.parse_args()
    worker = SpawnWorker(
        [document_queue], connection=redis_connection, serializer=JSONSerializer
    )
    worker.work(burst=args.burst)
