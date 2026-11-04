from pydantic import BaseModel


class DocumentStatusCounts(BaseModel):
    queued: int
    processing: int
    extracted: int
    embedded: int
    ready: int
    failed: int


class DocumentStatisticsResponse(BaseModel):
    total_documents: int
    total_storage_bytes: int
    documents_with_summary: int
    total_extracted_pages: int
    total_chunks: int
    chunks_with_embeddings: int
    by_status: DocumentStatusCounts


class ProcessingMetricsResponse(BaseModel):
    total_attempts: int
    processing: int
    succeeded: int
    failed: int
    success_rate: float | None
    average_duration_ms: float | None
    average_success_duration_ms: float | None
    average_failure_duration_ms: float | None
    max_duration_ms: int | None
    observed_embedding_input_tokens: int


class ChatModelUsage(BaseModel):
    model: str
    turns: int
    input_tokens: int
    output_tokens: int
    estimated_cost_usd: float | None


class EmbeddingUsage(BaseModel):
    model: str
    input_tokens: int
    estimated_cost_usd: float | None


class AIUsageResponse(BaseModel):
    chat: list[ChatModelUsage]
    embeddings: EmbeddingUsage
    estimated_total_cost_usd: float
    unpriced_models: list[str]
    not_persisted: list[str]
