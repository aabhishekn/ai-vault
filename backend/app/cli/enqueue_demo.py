from app.tasks.documents import greet
from app.tasks.queue import document_queue

if __name__ == "__main__":
    job = document_queue.enqueue(greet, "Abhishek", result_ttl=3600)
    print(f"Queued job: {job.id}")
    print("Start python -m app.worker in another terminal to process it.")
