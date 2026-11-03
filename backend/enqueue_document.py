import argparse
from uuid import UUID

from sqlalchemy.orm import Session

from database import engine
from jobs import extract_document
from models import Document
from task_queue import document_queue


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Queue text extraction for an uploaded PDF")
    parser.add_argument("document_id", type=UUID)
    args = parser.parse_args()
    with Session(engine) as session:
        document = session.get(Document, args.document_id)
        if document is None:
            parser.error("Document not found")
        if document.status not in ("queued", "failed"):
            parser.error(f"Document is already {document.status}")
    job = document_queue.enqueue(extract_document, str(args.document_id), result_ttl=3600)
    print(f"Queued extraction job: {job.id}")
