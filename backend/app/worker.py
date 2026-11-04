import argparse
import logging

from rq import SpawnWorker
from rq.serializers import JSONSerializer

from app.core.logging import configure_logging
from app.services.reprocessing import recover_abandoned_documents
from app.tasks.queue import document_queue, redis_connection


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the AI Vault background worker")
    parser.add_argument("--burst", action="store_true", help="Process waiting jobs, then exit")
    args = parser.parse_args()
    configure_logging()
    try:
        recover_abandoned_documents()
    except Exception:
        # Recovery is best effort; the worker must still start and serve new jobs.
        logging.getLogger(__name__).exception("abandoned_document_recovery_failed")
    worker = SpawnWorker([document_queue], connection=redis_connection, serializer=JSONSerializer)
    worker.work(burst=args.burst)


if __name__ == "__main__":
    main()
